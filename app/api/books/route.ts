import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { bookInclude, bookInputSchema, createBook } from "@/lib/books";
import { searchTerms } from "@/lib/search";
import { ok, readJson, route } from "@/lib/api";

// F4 —— 模糊搜索 + 高级筛选
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tagId = url.searchParams.get("tagId") ?? undefined;
  const language = url.searchParams.get("language") ?? undefined;
  const shelved = url.searchParams.get("shelved"); // "yes" | "no" | null
  const clcClass = url.searchParams.get("clcClass") ?? undefined; // "I" 这种大类字母
  const sort = url.searchParams.get("sort") ?? "recent";
  const take = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
  // 分页必须有。以前只有 take 没有 skip：第 201 本之后的书在界面上根本不存在，
  // 而结果数显示的又是真实总数 —— 你会以为自己看完了。
  const skip = Math.max(0, Number(url.searchParams.get("skip") ?? 0) || 0);

  const where: Prisma.BookWhereInput = {};
  const and: Prisma.BookWhereInput[] = [];

  // 多个词之间是 AND：searchIndex 里存了原文+全拼+首字母，一个 contains 就能覆盖三种输入
  for (const term of searchTerms(q)) {
    and.push({ searchIndex: { contains: term, mode: "insensitive" } });
  }
  if (tagId) and.push({ tags: { some: { tagId } } });
  if (language) and.push({ language });
  if (shelved === "yes") and.push({ placement: { isNot: null } });
  if (shelved === "no") and.push({ placement: { is: null } });
  // 大类筛选：中图法号以该字母开头即属于该大类（I → I2/I247.5…）
  if (clcClass) and.push({ clc: { startsWith: clcClass } });
  if (and.length) where.AND = and;

  const orderBy: Prisma.BookOrderByWithRelationInput =
    sort === "title" ? { title: "asc" }
    : sort === "completeness" ? { completeness: "asc" }
    // 按索书号排 = 书架上的物理顺序，逛书架时用这个
    : sort === "call" ? { callSortKey: "asc" }
    : { createdAt: "desc" };

  const [books, total] = await Promise.all([
    prisma.book.findMany({ where, orderBy, take, skip, include: bookInclude }),
    prisma.book.count({ where }),
  ]);

  return ok({ books, total });
});

// 加书不需要管理员密码 —— F5 的核心要求
export const POST = route(async (req: Request) => {
  const input = bookInputSchema.parse(await readJson(req));
  const book = await createBook(input);
  return ok({ book }, { status: 201 });
});
