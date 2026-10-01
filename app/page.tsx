import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { levelUsage } from "@/lib/capacity";
import { getCoefficients } from "@/lib/settings";
import { loadShelfState } from "@/lib/shelfState";
import { missingFields } from "@/lib/completeness";
import { CompletenessBar, EmptyState, PageHeader, Stat } from "@/components/ui";
import { BookRow } from "@/components/BookRow";
import { SetupChecklist } from "@/components/SetupChecklist";
import { OpsAlert } from "@/components/OpsAlert";
import { IconPlus, IconScan, IconSearch } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const t = await getTranslations();

  const [totals, recent, incomplete, state, coeffs] = await Promise.all([
    Promise.all([
      prisma.book.count(),
      prisma.placement.count(),
      prisma.bookcase.count(),
      prisma.level.count(),
      prisma.tag.count(),
    ]),
    prisma.book.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        tags: { include: { tag: true } },
        placement: { include: { level: { include: { bookcase: true } } } },
      },
    }),
    prisma.book.findMany({
      where: { completeness: { lt: 70 } },
      orderBy: { completeness: "asc" },
      take: 6,
      include: {
        tags: { include: { tag: true } },
        placement: { include: { level: { include: { bookcase: true } } } },
      },
    }),
    loadShelfState(),
    getCoefficients(),
  ]);

  const [bookCount, placedCount, bookcaseCount, levelCount, tagCount] = totals;

  // 全屋空间占用：所有层的已用/可用宽度加总
  let usableMm = 0;
  let usedMm = 0;
  for (const level of state.levels) {
    const usage = levelUsage(level, state.occupancy.get(level.id) ?? [], coeffs);
    usableMm += usage.usableMm;
    usedMm += usage.usedMm;
  }
  const fillPct = usableMm > 0 ? Math.round((usedMm / usableMm) * 100) : 0;

  if (bookcaseCount === 0 && bookCount === 0) {
    return (
      <>
        <PageHeader title={t("home.title")} />
        <EmptyState
          title={t("home.getStarted")}
          action={
            <Link href="/shelves" className="btn btn-primary">
              {t("home.createFirstBookcase")}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("home.title")}
        actions={
          <>
            <Link href="/scan" className="btn btn-primary">
              <IconScan className="h-4 w-4" /> {t("home.quickScan")}
            </Link>
            <Link href="/books/new" className="btn btn-ghost">
              <IconPlus className="h-4 w-4" /> {t("home.quickManual")}
            </Link>
            <Link href="/books" className="btn btn-ghost">
              <IconSearch className="h-4 w-4" /> {t("home.quickSearch")}
            </Link>
          </>
        }
      />

      {/* 真出事了才出现：备份失败 / 太久没备份 / 派生字段漂了 */}
      <OpsAlert />

      {/* 系统知道、但一直没说的事 —— 全做完了这块自己消失 */}
      <SetupChecklist />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Stat label={t("home.totalBooks")} value={bookCount} />
        <Stat label={t("home.shelved")} value={placedCount} />
        <Stat
          label={t("home.unshelved")}
          value={bookCount - placedCount}
          tone={bookCount - placedCount > 0 ? "warn" : "default"}
        />
        <Stat label={t("home.bookcases")} value={`${bookcaseCount} / ${levelCount}`} />
        <Stat label={t("home.tags")} value={tagCount} />
      </div>

      {usableMm > 0 && (
        <section className="card mt-6 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-md">{t("home.capacityOverview")}</h2>
            <span className="mono">
              {Math.round(usedMm)} / {Math.round(usableMm)} mm · {fillPct}%
            </span>
          </div>
          <div className="mt-3">
            <CompletenessBar value={Math.min(100, fillPct)} />
          </div>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="section-title mb-3">{t("home.recentlyAdded")}</h2>
          {recent.length === 0 ? (
            <EmptyState title={t("common.empty")} />
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((book) => (
                <BookRow key={book.id} book={book} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="section-title mb-3">{t("home.needsAttention")}</h2>
          {incomplete.length === 0 ? (
            <EmptyState title={t("home.noNeedsAttention")} />
          ) : (
            <>
              <p className="hint mb-3">{t("home.needsAttentionHint")}</p>
              <ul className="flex flex-col gap-2">
                {incomplete.map((book) => (
                  <BookRow
                    key={book.id}
                    book={book}
                    missing={missingFields({
                      ...book,
                      tagCount: book.tags.length,
                      hasConfirmedPlacement: !!book.placement,
                    })}
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </>
  );
}
