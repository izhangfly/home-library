"use client";

// 书架地图 —— 「书在哪、还有多少地方」
//
// 这一页只干一件事：一个柜子一个柜子地看（立面图 + 装填情况）。
// 整屋的平面/3D 在「3D 空间」页，不在这里再放一份 —— 同一张图分散在两个菜单里，
// 改一处另一处就落后了。这里只给一个入口链接过去。
//
// 高亮按中图法大类，不再按标签 —— 分类是自动算出来的、覆盖每一本书，
// 标签是手工打的、大部分书没有，用标签高亮什么也看不出来。

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/client";
import { CLC_CLASS_COLOR, clcLabel, clcMainClass } from "@/lib/clc";
import { EmptyState, Modal, PageHeader, Spinner, LoadFailed } from "./ui";
import { Cover } from "./BookRow";
import { BookcaseElevation, type ElevationLevel } from "./BookcaseElevation";

interface MapBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  isNearFull: boolean;
  spineMm: number;
  heightMm: number | null;
  clc: string | null;
  callNumber: string | null;
}

interface MapLevel extends ElevationLevel {
  books: MapBook[];
  usage: {
    usableMm: number;
    usedMm: number;
    remainingMm: number;
    bookCount: number;
    estimatedCount: number;
    fillRatio: number;
  };
}

interface MapBookcase {
  id: string;
  name: string;
  room: string | null;
  roomId: string | null;
  widthMm: number | null;
  heightMm: number | null;
  levels: MapLevel[];
}

export function ShelfMap() {
  const t = useTranslations();
  const [bookcases, setBookcases] = useState<MapBookcase[] | null>(null);
  const [highlight, setHighlight] = useState("");
  const [openLevel, setOpenLevel] = useState<{ level: MapLevel; bookcase: MapBookcase } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const data = await apiGet<{ bookcases: MapBookcase[] }>("/api/map");
      setBookcases(data.bookcases);
    } catch {
      // 取不到就明说，不要留在"加载中…"里转圈
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 库里实际出现过的中图法大类 —— 只列有书的，选项才不会有 22 个空条目 */
  const classes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bc of bookcases ?? []) {
      for (const lv of bc.levels) {
        for (const b of lv.books) {
          const c = clcMainClass(b.clc);
          if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [bookcases]);

  if (failed) {
    return (
      <>
        <PageHeader title={t("map.title")} />
        <LoadFailed onRetry={() => void load()} />
      </>
    );
  }

  if (!bookcases) {
    return (
      <div className="flex items-center gap-2 p-6 text-text-muted">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }

  if (!bookcases.length) {
    return (
      <>
        <PageHeader title={t("map.title")} />
        <EmptyState
          title={t("map.noBookcases")}
          action={
            <Link href="/shelves" className="btn btn-primary">
              {t("shelves.addBookcase")}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("map.title")}
        subtitle={t("map.clickLevel")}
        actions={
          <Link href="/space" className="btn btn-ghost btn-sm">
            {t("map.openSpace")}
          </Link>
        }
      />

      <div className="mb-4">
          <label className="label" htmlFor="highlight">{t("map.highlightClass")}</label>
          <select
            id="highlight"
            className="field max-w-xs"
            value={highlight}
            onChange={(e) => setHighlight(e.target.value)}
          >
            <option value="">{t("map.noHighlight")}</option>
            {classes.map(([c, n]) => (
              <option key={c} value={c}>
                {c} {clcLabel(c, "zh") ?? ""}（{n}）
              </option>
            ))}
          </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
          {bookcases.map((bookcase) => {
            const totals = bookcase.levels.reduce(
              (acc, l) => ({
                used: acc.used + l.usage.usedMm,
                usable: acc.usable + l.usage.usableMm,
                books: acc.books + l.usage.bookCount,
              }),
              { used: 0, usable: 0, books: 0 },
            );
            const pct = totals.usable > 0 ? Math.round((totals.used / totals.usable) * 100) : 0;
            return (
              <section key={bookcase.id} className="card p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-md">{bookcase.name}</h2>
                  <span className="hint">
                    {bookcase.room ?? "—"} · {t("map.levelBooks", { count: totals.books })} ·{" "}
                    {t("map.fillPct", { pct })}
                  </span>
                </div>

                {bookcase.levels.length === 0 ? (
                  <p className="hint">{t("shelves.noLevels")}</p>
                ) : (
                  <BookcaseElevation
                    bookcase={bookcase}
                    highlightClc={highlight || null}
                    onSelectLevel={(lv) => setOpenLevel({ level: lv as MapLevel, bookcase })}
                    className="h-[340px]"
                  />
                )}
            </section>
          );
        })}
      </div>

      <Modal
        open={!!openLevel}
        onClose={() => setOpenLevel(null)}
        title={
          openLevel
            ? `${openLevel.bookcase.name} · ${t("map.levelLabel", { index: openLevel.level.levelIndex })}`
            : ""
        }
        wide
      >
        {openLevel && <LevelDetail level={openLevel.level} />}
      </Modal>
    </>
  );
}

function LevelDetail({ level }: { level: MapLevel }) {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card p-2">
          <div className="section-title">{t("map.used")}</div>
          <div className="mono">{level.usage.usedMm} mm</div>
        </div>
        <div className="card p-2">
          <div className="section-title">{t("map.free")}</div>
          <div className="mono">{level.usage.remainingMm} mm</div>
        </div>
        <div className="card p-2">
          <div className="section-title">{t("book.pageCount")}</div>
          <div className="mono">{level.usage.bookCount}</div>
        </div>
      </div>

      {/* 估算的书越多，上面的数字越不可信 —— 明说 */}
      {level.usage.estimatedCount > 0 && (
        <p className="hint">
          {t("map.capacityUnknownHint", { count: level.usage.estimatedCount })}
        </p>
      )}

      {level.books.length === 0 ? (
        <p className="hint">{t("map.emptyLevel")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {level.books.map((book) => {
            const cls = clcMainClass(book.clc);
            return (
              <li key={book.id}>
                <Link
                  href={`/books/${book.id}`}
                  className="card flex items-center gap-3 p-2 hover:bg-surface-2"
                >
                  <Cover url={book.coverUrl} title={book.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black">{book.title}</p>
                    <p className="hint truncate">{book.authors.join(" / ")}</p>
                  </div>
                  {book.callNumber && (
                    <span
                      className="chip"
                      style={cls ? { background: CLC_CLASS_COLOR[cls] ?? undefined } : undefined}
                    >
                      <span className="mono">{book.callNumber}</span>
                    </span>
                  )}
                  {book.isNearFull && <span className="chip chip-warn">{t("capacity.markNearFull")}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
