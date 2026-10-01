import { prisma } from "@/lib/prisma";
import { Maintenance } from "@/components/Maintenance";

export const dynamic = "force-dynamic";

export default async function ReflowPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab }, levels] = await Promise.all([
    searchParams,
    prisma.level.findMany({
      orderBy: [{ bookcase: { sortKey: "asc" } }, { levelIndex: "asc" }],
      select: {
        id: true,
        levelIndex: true,
        widthMm: true,
        bookcase: { select: { name: true, room: true } },
      },
    }),
  ]);

  return <Maintenance levels={levels} defaultTab={tab === "inventory" ? "inventory" : tab === "layout" ? "layout" : "reflow"} />;
}
