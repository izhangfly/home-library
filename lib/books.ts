// Book 的写入服务：searchIndex 和 completeness 都是派生字段，
// 必须在同一个地方计算，否则某条写入路径漏算就会出现"搜不到"或"完整度一直是 0"。
import { z } from "zod";
import { prisma } from "./prisma";
import { buildSearchIndex } from "./search";
import { scoreCompleteness } from "./completeness";
import { assignDdcOffline, type DdcAssignInput } from "./ddcAssign";
import { assignClcOffline, emptyClcAssignment, type ClcAssignInput } from "./clcAssign";
import { clcSortKey, isValidClc, normalizeClc } from "./clc";
import { cutter } from "./ddc";

export const bookInputSchema = z.object({
  isbn13: z.string().trim().optional().nullable(),
  isbn10: z.string().trim().optional().nullable(),
  issn: z.string().trim().optional().nullable(),
  issnAddon: z.string().trim().optional().nullable(),
  title: z.string().trim().min(1),
  subtitle: z.string().trim().optional().nullable(),
  originalTitle: z.string().trim().optional().nullable(),
  authors: z.array(z.string().trim().min(1)).optional(),
  translators: z.array(z.string().trim().min(1)).optional(),
  publisher: z.string().trim().optional().nullable(),
  pubDate: z.string().trim().optional().nullable(),
  language: z.string().trim().optional().nullable(),
  pageCount: z.number().int().positive().optional().nullable(),
  binding: z.string().trim().optional().nullable(),
  price: z.string().trim().optional().nullable(),
  heightMm: z.number().int().positive().optional().nullable(),
  spineMm: z.number().positive().optional().nullable(),
  summary: z.string().trim().optional().nullable(),
  coverUrl: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  sourceMeta: z.record(z.string(), z.string()).optional().nullable(),
  tagIds: z.array(z.string()).optional(),
  /** 手动指定或已算好的 DDC 号 */
  // 分类号不是普通字符串：它会变成 callNumber 和 callSortKey，
  // 而 callSortKey 决定整条货架带的顺序。以前这里是 z.string()，
  // 于是 PATCH /api/books/[id] 传 clc:"随便写" 会被原样存进去，
  // callSortKey 退化成兜底值「￿」，那本书直接掉到货架带末尾。
  ddc: z.string().trim().regex(/^\d{3}$/, "ddc_must_be_3_digits").optional().nullable(),
  ddcSource: z.enum(["openLibrary", "rules", "ai", "manual"]).optional().nullable(),
  clc: z.string().trim().refine((v) => isValidClc(v), "invalid_clc").optional().nullable(),
  clcSource: z.enum(["rules", "ai", "manual"]).optional().nullable(),
  /** 以下两个是入库时的临时输入，不入库，只用来推断 DDC */
  subjects: z.array(z.string()).optional(),
  authoritativeDdc: z.string().optional().nullable(),
});

export type BookInput = z.infer<typeof bookInputSchema>;

/** 空字符串一律转成 null，避免 "" 和 null 混用把完整度算错 */
function clean<T extends string | null | undefined>(v: T): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

export const bookInclude = {
  tags: { include: { tag: true } },
  placement: { include: { level: { include: { bookcase: true } } } },
} as const;

type BookWithRelations = Awaited<
  ReturnType<typeof prisma.book.findFirstOrThrow<{ include: typeof bookInclude }>>
>;

export function recomputeDerived(book: {
  title: string;
  subtitle?: string | null;
  originalTitle?: string | null;
  authors: string[];
  translators: string[];
  publisher?: string | null;
  pubDate?: string | null;
  language?: string | null;
  pageCount?: number | null;
  coverUrl?: string | null;
  summary?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  issn?: string | null;
  heightMm?: number | null;
  spineMm?: number | null;
  ddc?: string | null;
  clc?: string | null;
  tagCount: number;
  hasConfirmedPlacement: boolean;
}) {
  // 索书号是派生值：作者或书名改了，著者号也要跟着变。
  // 主号用中图法（见 lib/clc.ts 开头的说明）；没有中图法号时不退回 DDC——
  // 两套体系混在一个书架顺序里排出来是乱的。
  const cut = cutter(book.authors, book.title);
  const clc = normalizeClc(book.clc);
  return {
    searchIndex: buildSearchIndex(book),
    completeness: scoreCompleteness({ ...book, ddc: book.clc ?? book.ddc }),
    callNumber: clc ? (cut ? `${clc} ${cut}` : clc) : null,
    callSortKey: clcSortKey(clc, cut),
  };
}

async function refreshDerived(bookId: string): Promise<BookWithRelations> {
  const book = await prisma.book.findFirstOrThrow({
    where: { id: bookId },
    include: bookInclude,
  });

  const derived = recomputeDerived({
    ...book,
    ddc: book.ddc,
    clc: book.clc,
    tagCount: book.tags.length,
    hasConfirmedPlacement: !!book.placement,
  });

  const changed =
    book.searchIndex !== derived.searchIndex ||
    book.completeness !== derived.completeness ||
    book.callNumber !== derived.callNumber ||
    book.callSortKey !== derived.callSortKey;

  if (changed) {
    return prisma.book.update({ where: { id: bookId }, data: derived, include: bookInclude });
  }
  return book;
}

export async function createBook(input: BookInput): Promise<BookWithRelations> {
  const { tagIds = [], subjects, authoritativeDdc, ...rest } = input;

  // 入库时只跑不联网的那一段（权威号 + 关键词规则）。
  // 规则miss 时留空，由 /api/books/:id/ddc 在后台补 AI 推断，不拖慢扫码。
  const ddcInput: DdcAssignInput = {
    title: rest.title.trim(),
    subtitle: rest.subtitle ?? null,
    authors: rest.authors ?? [],
    publisher: rest.publisher ?? null,
    language: rest.language ?? null,
    subjects,
    summary: rest.summary ?? null,
    authoritativeDdc,
  };
  const ddcAssignment = rest.ddc
    ? { ddc: rest.ddc, ddcSource: rest.ddcSource ?? "manual" }
    : (assignDdcOffline(ddcInput) ?? { ddc: null, ddcSource: null });

  const clcInput: ClcAssignInput = { ...ddcInput, tags: undefined };
  const clcAssignment = rest.clc
    ? { ...emptyClcAssignment(), clc: rest.clc, clcSource: rest.clcSource ?? "manual" }
    : (assignClcOffline(clcInput) ?? emptyClcAssignment());

  const created = await prisma.book.create({
    data: {
      isbn13: clean(rest.isbn13),
      isbn10: clean(rest.isbn10),
      issn: clean(rest.issn),
      issnAddon: clean(rest.issnAddon),
      title: rest.title.trim(),
      subtitle: clean(rest.subtitle),
      originalTitle: clean(rest.originalTitle),
      authors: rest.authors ?? [],
      translators: rest.translators ?? [],
      publisher: clean(rest.publisher),
      pubDate: clean(rest.pubDate),
      language: clean(rest.language),
      pageCount: rest.pageCount ?? null,
      binding: clean(rest.binding),
      price: clean(rest.price),
      heightMm: rest.heightMm ?? null,
      spineMm: rest.spineMm ?? null,
      summary: clean(rest.summary),
      coverUrl: clean(rest.coverUrl),
      notes: clean(rest.notes),
      sourceMeta: rest.sourceMeta ?? undefined,
      subjects: subjects ?? [],
      ddc: ddcAssignment.ddc,
      ddcSource: ddcAssignment.ddcSource,
      clc: clcAssignment.clc,
      clcSource: clcAssignment.clcSource,
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
  });

  return refreshDerived(created.id);
}

export async function updateBook(
  id: string,
  input: Partial<BookInput>,
): Promise<BookWithRelations> {
  const { tagIds, subjects: _s, authoritativeDdc: _a, ...rest } = input;

  const data: Record<string, unknown> = {};
  const stringFields = [
    "isbn13", "isbn10", "issn", "issnAddon", "subtitle", "originalTitle",
    "publisher", "pubDate", "language", "binding", "price", "summary",
    "coverUrl", "notes", "ddc", "ddcSource", "clc", "clcSource",
  ] as const;

  for (const key of stringFields) {
    if (key in rest) data[key] = clean(rest[key] as string | null | undefined);
  }
  if (rest.title !== undefined) data.title = rest.title.trim();
  if (rest.authors !== undefined) data.authors = rest.authors;
  if (rest.translators !== undefined) data.translators = rest.translators;
  if (rest.pageCount !== undefined) data.pageCount = rest.pageCount ?? null;
  if (rest.heightMm !== undefined) data.heightMm = rest.heightMm ?? null;
  if (rest.spineMm !== undefined) data.spineMm = rest.spineMm ?? null;
  if (rest.sourceMeta !== undefined) data.sourceMeta = rest.sourceMeta ?? undefined;

  await prisma.book.update({ where: { id }, data });

  if (tagIds) {
    await prisma.bookTag.deleteMany({ where: { bookId: id } });
    if (tagIds.length) {
      await prisma.bookTag.createMany({
        data: tagIds.map((tagId) => ({ bookId: id, tagId })),
        skipDuplicates: true,
      });
    }
  }

  return refreshDerived(id);
}

/** 上架/移架/取下之后完整度会变（placement 也计入分数），所以统一走这里 */
export async function refreshBookDerived(bookId: string) {
  return refreshDerived(bookId);
}
