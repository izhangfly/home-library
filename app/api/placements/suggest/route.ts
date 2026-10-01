// 「这本书该放哪一层」—— F3 的推荐入口
import { suggestPlacements } from "@/lib/capacity";
import { getCoefficients } from "@/lib/settings";
import { loadBookForCapacity, loadShelfState } from "@/lib/shelfState";
import { fail, ok, route } from "@/lib/api";

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const bookId = url.searchParams.get("bookId");
  if (!bookId) return fail("missing_bookId", 400);

  const [book, state, coeffs] = await Promise.all([
    loadBookForCapacity(bookId),
    loadShelfState(),
    getCoefficients(),
  ]);
  if (!book) return fail("book_not_found", 404);

  // 换架时把这本书自己从占用里剔掉
  const occupancy = new Map(
    Array.from(state.occupancy.entries()).map(([levelId, books]) => [
      levelId,
      books.filter((b) => b.id !== book.id),
    ]),
  );

  const suggestions = suggestPlacements({
    book,
    levels: state.levels,
    occupancy,
    tagZones: state.tagZones,
    coeffs,
  });

  // 带上书柜名，前端不用再查一次
  const levelMeta = Object.fromEntries(
    state.levels.map((l) => [l.id, { bookcaseName: l.bookcaseName, room: l.room, levelIndex: l.levelIndex }]),
  );

  return ok({ suggestions, levelMeta, spine: suggestions[0]?.spine ?? null });
});
