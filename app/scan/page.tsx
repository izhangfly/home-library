import { prisma } from "@/lib/prisma";
import { ScanFlow } from "@/components/ScanFlow";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ sortKey: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameEn: true, color: true },
  });

  return <ScanFlow tags={tags} />;
}
