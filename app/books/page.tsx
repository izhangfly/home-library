import { prisma } from "@/lib/prisma";
import { BooksBrowser } from "@/components/BooksBrowser";

export const dynamic = "force-dynamic";

export default async function BooksPage() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortKey: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameEn: true, color: true },
  });

  return <BooksBrowser tags={tags} />;
}
