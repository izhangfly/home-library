import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BookDetail, type BookDetailData } from "@/components/BookDetail";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [book, tags] = await Promise.all([
    prisma.book.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        placement: { include: { level: { include: { bookcase: true } } } },
      },
    }),
    prisma.tag.findMany({
      orderBy: [{ sortKey: "asc" }, { name: "asc" }],
      select: { id: true, name: true, nameEn: true, color: true },
    }),
  ]);

  if (!book) notFound();

  return (
    <BookDetail
      book={book as unknown as BookDetailData}
      tags={tags}
    />
  );
}
