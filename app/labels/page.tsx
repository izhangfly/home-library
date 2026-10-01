import { prisma } from "@/lib/prisma";
import { LabelSheet } from "@/components/LabelSheet";

export const dynamic = "force-dynamic";

export default async function LabelsPage() {
  const [books, levels] = await Promise.all([
    prisma.book.findMany({
      // 按索书号排：印出来的一叠标签，顺序就是上架顺序，贴的时候不用来回找
      orderBy: { callSortKey: "asc" },
      select: {
        id: true, title: true, authors: true, callNumber: true, clc: true,
        placement: {
          select: {
            levelId: true,
            level: { select: { levelIndex: true, bookcase: { select: { name: true, room: true } } } },
          },
        },
      },
    }),
    prisma.level.findMany({
      orderBy: [{ bookcase: { sortKey: "asc" } }, { levelIndex: "asc" }],
      select: { id: true, levelIndex: true, bookcase: { select: { name: true, room: true } } },
    }),
  ]);

  return (
    <LabelSheet
      books={books.map((b) => ({
        id: b.id,
        title: b.title,
        authors: b.authors,
        callNumber: b.callNumber,
        clc: b.clc,
        levelId: b.placement?.levelId ?? null,
        bookcaseName: b.placement?.level.bookcase.name ?? null,
        roomName: b.placement?.level.bookcase.room ?? null,
        levelIndex: b.placement?.level.levelIndex ?? null,
      }))}
      levels={levels.map((l) => ({
        id: l.id,
        levelIndex: l.levelIndex,
        bookcaseName: l.bookcase.name,
        roomName: l.bookcase.room,
      }))}
    />
  );
}
