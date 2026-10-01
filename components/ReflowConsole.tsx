"use client";

// 理架台 —— 书架体检 + 迁移预览 + 执行 + 撤销
//
// 三条硬规矩（都是用户明确要求的）：
//   1. 系统绝不自动搬书 —— 数据库改了而人没去搬，模型就和现实脱节了
//   2. 只在真的塞不下时才建议动，不主动"优化"
//   3. 动就动最小的那一组，并且能一键撤销

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPatch, apiPost } from "@/lib/client";
import { EmptyState, ErrorBanner, PageHeader, Spinner } from "./ui";
import { IconCheck, IconWarn } from "./icons";

interface LevelInfo {
  levelId: string;
  bookcaseName: string;
  roomName: string | null;
  levelIndex: number;
  usedMm: number;
  usableMm: number;
  fill: number;
  dominantLabel: string | null;
}

interface Move { bookId: string; title: string; fromLevelId: string | null; toLevelId: string; distance: number }

/** 还能撤销的搬动批次。来自服务端，所以刷新页面、换标签页都还在。 */
interface Batch { batchId: string; at: string; note: string | null; count: number }

interface Plan {
  levelId: string;
  bookcaseName: string;
  roomName: string | null;
  levelIndex: number;
  overflowMm: number;
  needed: boolean;
  reason: string;
  moves: Move[];
  affectedClass: string | null;
  affectedLabel: string | null;
  totalDistance: number;
}

export function ReflowConsole() {
  const t = useTranslations();
  const [data, setData] = useState<{ overflow: LevelInfo[]; nearFull: LevelInfo[]; plans: Plan[]; batches: Batch[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBatch, setLastBatch] = useState<{ id: string; count: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiGet("/api/shelving/reflow"));
    } catch {
      setError(t("errors.loadFailed"));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const apply = async (plan: Plan) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ moved: number; batchId: string }>("/api/shelving/reflow", {
        moves: plan.moves.map((m) => ({ bookId: m.bookId, toLevelId: m.toLevelId })),
        note: plan.affectedLabel ?? undefined,
      });
      setLastBatch({ id: r.batchId, count: r.moved });
      await load();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (batchId: string) => {
    setBusy(true);
    try {
      const r = await apiPatch<{ reverted: number; skipped: number }>(
        "/api/shelving/reflow", { batchId },
      );
      // 有书回不去了（原来那层已经被拆掉）。这必须说出来 ——
      // 悄悄成功的话，用户会以为整批都撤回去了，而实际上有几本还留在新位置。
      if (r.skipped > 0) setError(t("reflow.undoPartial", { reverted: r.reverted, skipped: r.skipped }));
      else setError(null);
      setLastBatch(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  const healthy = data.overflow.length === 0;

  return (
    <>
      <PageHeader
        title={t("reflow.title")}
        subtitle={t("reflow.hint")}
        actions={
          <>
            {/* 这个按钮是"照当前数据重新算一遍"，不是"刚才失败了再试一次"。
                以前它借用了 common.retry，于是页面顶上挂着一个「重试」——
                下面明明写着「所有层都装得下」，什么都没失败。 */}
            <button type="button" onClick={() => void load()} className="btn btn-ghost btn-sm">
              {t("reflow.recompute")}
            </button>
            {lastBatch && (
              <button type="button" onClick={() => void undo(lastBatch.id)} disabled={busy} className="btn btn-secondary btn-sm">
                {t("reflow.undo", { count: lastBatch.count })}
              </button>
            )}
          </>
        }
      />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {healthy && (
        <div className="card mb-4 flex items-center gap-3 p-4">
          <IconCheck className="h-6 w-6 text-success" />
          <div>
            <p className="font-black">{t("reflow.allGood")}</p>
            <p className="hint">{t("reflow.allGoodHint")}</p>
          </div>
        </div>
      )}

      {data.plans.map((p) => (
        <section key={p.levelId} className="card mb-3 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <IconWarn className="h-5 w-5 text-danger" />
            <h2 className="text-md">
              {p.roomName ? `${p.roomName} › ` : ""}{p.bookcaseName} › {t("map.levelLabel", { index: p.levelIndex })}
            </h2>
            <span className="chip chip-danger">{t("reflow.over", { mm: p.overflowMm })}</span>
          </div>

          {p.moves.length === 0 ? (
            <p className="hint">{t("reflow.noSpace")}</p>
          ) : (
            <>
              <p className="hint mb-2">
                {t("reflow.planHint", {
                  count: p.moves.length,
                  topic: p.affectedLabel ?? p.affectedClass ?? "?",
                })}
              </p>
              <ul className="mb-3 flex max-h-40 flex-col gap-1 overflow-y-auto">
                {p.moves.map((m) => (
                  <li key={m.bookId} className="mono truncate">· {m.title}</li>
                ))}
              </ul>
              <button type="button" onClick={() => void apply(p)} disabled={busy} className="btn btn-primary btn-sm">
                {busy ? <Spinner /> : null}{t("reflow.apply", { count: p.moves.length })}
              </button>
            </>
          )}
        </section>
      ))}

      {/* 可撤销的搬动 —— 从服务端读，所以刷新、换页、换标签页都还在。
          「整屋规划」那边一次搬几十上百本，真出了问题却找不到后悔药，
          那个功能就不该给人用。 */}
      {data.batches.length > 0 && (
        <section className="card mb-4 p-4">
          <h2 className="section-title mb-2">{t("reflow.undoable")}</h2>
          <ul className="flex flex-col gap-1">
            {data.batches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 truncate">
                  {b.note ?? t("reflow.title")}
                  <span className="hint ml-2">{new Date(b.at).toLocaleString()}</span>
                </span>
                <span className="mono">{t("map.levelBooks", { count: b.count })}</span>
                <button type="button" disabled={busy} className="btn btn-secondary btn-sm"
                  onClick={() => void undo(b.batchId)}>
                  {t("reflow.undo", { count: b.count })}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.nearFull.length > 0 && (
        <section className="card p-4">
          <h2 className="section-title mb-2">{t("reflow.nearFull")}</h2>
          <ul className="flex flex-col gap-1">
            {data.nearFull.map((l) => (
              <li key={l.levelId} className="flex flex-wrap items-center gap-2">
                <span className="flex-1 truncate">
                  {l.roomName ? `${l.roomName} › ` : ""}{l.bookcaseName} › {t("map.levelLabel", { index: l.levelIndex })}
                </span>
                <span className="chip chip-warn">{l.fill}%</span>
                <span className="mono">{l.dominantLabel ?? "—"}</span>
              </li>
            ))}
          </ul>
          <p className="hint mt-2">{t("reflow.fillTargetNote")}</p>
        </section>
      )}

      {healthy && data.nearFull.length === 0 && (
        <EmptyState title={t("reflow.nothingToDo")} />
      )}
    </>
  );
}
