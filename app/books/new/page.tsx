import { prisma } from "@/lib/prisma";
import { ManualEntry } from "@/components/ManualEntry";

export const dynamic = "force-dynamic";

export default async function NewBookPage() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortKey: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameEn: true, color: true },
  });

  return <ManualEntry tags={tags} />;
}
