// 盘点模式 —— 解决"冷启动"问题
//
// 用户点出的核心难题：一开始系统不知道家里有多少书、有哪些书，
// 而人不可能把所有书抽出来重新摆一遍，只能一个书架一个书架地弄。
//
// 所以给一个"就地盘点"的入口：选一层 → 把这层的书挨个扫一遍 → 系统就知道这层有什么。
// 顺带解决错架问题：扫到一本系统以为在别处的书，说明它被挪过了，直接更正，不用手工记账。
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordScanned } from "@/lib/placeService";
import { parseBarcode } from "@/lib/isbn";
import { refreshBookDerived } from "@/lib/books";
import { clcLabel } from "@/lib/clc";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, readJson, route } from "@/lib/api";

const schema = z.object({
  levelId: z.string().min(1),
  code: z.string().min(1),
});

export const POST = route(async (req: Request) => {
  const { levelId, code } = schema.parse(await readJson(req));

  const level = await prisma.level.findUnique({
    where: { id: levelId },
    include: { bookcase: true },
  });
  if (!level) return fail("level_not_found", 404);

  const parsed = parseBarcode(code);
  if (!parsed.valid) return ok({ status: "bad_barcode", parsed });

  const where = parsed.isbn13
    ? { isbn13: parsed.isbn13 }
    : parsed.issn
      ? { issn: parsed.issn }
      : null;
  if (!where) return ok({ status: "bad_barcode", parsed });

  const book = await prisma.book.findFirst({
    where,
    include: {
      placement: { include: { level: { include: { bookcase: true } } } },
    },
  });

  // 库里没有 → 这是本新书，交给扫码流程正常入库
  if (!book) return ok({ status: "unknown", parsed });

  const locale = await resolveLocale();
  const prev = book.placement?.level;
  const wasElsewhere = prev && prev.id !== levelId;

  // 走 recordScanned：锁层 + 算对 orderInLevel。
  // 以前这里直接 upsert，orderInLevel 走 schema 默认值 0 —— 每本扫进来的新书都是 0，
  // 从别层挪过来的则保留旧层的号，整层的先后就此作废。
  await recordScanned(book.id, levelId);

  return ok({
    // moved = 错架已自动更正；confirmed = 本来就在这层
    status: wasElsewhere ? "moved" : "confirmed",
    book: {
      id: book.id,
      title: book.title,
      authors: book.authors,
      callNumber: book.callNumber,
      clc: book.clc,
      clcLabel: clcLabel(book.clc, locale),
    },
    from: wasElsewhere
      ? { bookcaseName: prev.bookcase.name, levelIndex: prev.levelIndex, room: prev.bookcase.room }
      : null,
  });
});

/** 某层现在记录着哪些书 —— 盘点时对照用 */
export const GET = route(async (req: Request) => {
  const levelId = new URL(req.url).searchParams.get("levelId");
  if (!levelId) return fail("missing_levelId", 400);

  const [level, placements, locale] = await Promise.all([
    prisma.level.findUnique({ where: { id: levelId }, include: { bookcase: true } }),
    prisma.placement.findMany({
      where: { levelId },
      include: { book: { select: { id: true, title: true, authors: true, callNumber: true, clc: true } } },
      orderBy: { orderInLevel: "asc" },
    }),
    resolveLocale(),
  ]);
  if (!level) return fail("level_not_found", 404);

  return ok({
    level: {
      id: level.id,
      levelIndex: level.levelIndex,
      bookcaseName: level.bookcase.name,
      room: level.bookcase.room,
      widthMm: level.widthMm,
      heightMm: level.heightMm,
    },
    books: placements
      .map((p) => ({ ...p.book, clcLabel: clcLabel(p.book.clc, locale) }))
      .sort((a, b) => (a.callNumber ?? "").localeCompare(b.callNumber ?? "")),
  });
});
