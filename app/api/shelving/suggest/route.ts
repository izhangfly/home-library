// 「这本书该放哪」—— 中图法学科邻近 + 可达性 + 留白，综合打分
import { prisma } from "@/lib/prisma";
import { getCoefficients } from "@/lib/settings";
import { loadShelfWorld } from "@/lib/shelfLoad";
import { loadLayoutWorld } from "@/lib/layoutLoad";
import { planInsert } from "@/lib/insert";
import { buildLevelStates, suggestPlacement, HOUSEHOLD, type Person } from "@/lib/shelving";
import { clcLabel } from "@/lib/clc";
import { resolveLocale } from "@/i18n/request";
import { fail, ok, route } from "@/lib/api";

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  const readerName = url.searchParams.get("reader");
  if (!bookId) return fail("missing_bookId", 400);

  const [{ levels, books }, world, coeffs, locale] = await Promise.all([
    loadShelfWorld(),
    loadLayoutWorld(),
    getCoefficients(),
    resolveLocale(),
  ]);

  const book = books.find((b) => b.id === bookId);
  if (!book) return fail("book_not_found", 404);

  // 儿童书默认按最矮的人算可达性；否则用指定的人
  const tags = await prisma.bookTag.findMany({
    where: { bookId }, include: { tag: { select: { name: true } } },
  });
  const isChildrens =
    tags.some((t) => /儿童|童书|少儿/.test(t.tag.name)) || (book.clc ?? "").startsWith("I287");
  const reader: Person | undefined =
    (readerName ? HOUSEHOLD.find((p) => p.name === readerName) : undefined) ??
    (isChildrens ? HOUSEHOLD[HOUSEHOLD.length - 1] : undefined);

  // 换架时把这本书自己从占用里剔掉
  const others = books.filter((b) => b.id !== bookId);
  const states = buildLevelStates(levels, others, coeffs);
  const options = suggestPlacement(book, states, { coeffs, reader });

  const meta = Object.fromEntries(
    levels.map((l) => [
      l.id,
      {
        bookcaseName: l.bookcaseName,
        roomName: l.roomName,
        levelIndex: l.levelIndex,
        floorMm: Math.round(l.floorMm),
        bookcaseId: l.bookcaseId,
        dominantClass: states.get(l.id)?.dominantClass ?? null,
        dominantLabel: clcLabel(states.get(l.id)?.dominantClass, locale),
        freeMm: states.get(l.id)?.freeMm ?? 0,
      },
    ]),
  );

  // 按索书号该插到哪 —— 这才是默认答案。
  // 打分只是"备选"：一本书按分类号属于某一层的中间，那一层满了，
  // 正确做法是把那层最后一本推到下一层，而不是把它丢到别处（docs/shelving-v3.md §7）。
  const target = world.books.find((b) => b.id === bookId);
  const insert = target
    ? planInsert(target, world.bookcases, world.books.filter((b) => b.id !== bookId), { coeffs })
    : null;

  return ok({
    book: { id: book.id, title: book.title, clc: book.clc, clcLabel: clcLabel(book.clc, locale) },
    reader: reader?.name ?? null,
    insert: insert && {
      ...insert,
      shifts: insert.shifts.map((sh) => ({
        ...sh,
        from: meta[sh.fromLevelId] ?? null,
        to: meta[sh.toLevelId] ?? null,
      })),
    },
    options: options.slice(0, 10),
    levelMeta: meta,
  });
});
