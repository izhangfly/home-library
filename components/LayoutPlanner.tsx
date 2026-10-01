"use client";

// 整屋布局规划 —— 算法见 docs/shelving-v3.md
//
// 和「整理建议」的分工：那边是急救（某层塞爆了该挪谁），这边是体检
// （整屋重新安排一遍会长什么样）。这里**永远只是预览**，按了"照此执行"
// 才会落库，而且走的是和整理建议同一条带撤销的通道。
//
// 界面上最重要的一个控件是「改动幅度」滑杆：它就是算法里的惯性权重。
// 拉到最左是"从零开始的理想布局"，拉到最右是"能不动就不动"，
// 中间是连续的谱 —— 用户可以自己决定这个周末想搬多少书。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/client";
import { ErrorBanner, Spinner } from "./ui";
import { IconCheck, IconWarn } from "./icons";

interface LevelRef { bookcaseName?: string; roomName?: string | null; levelIndex?: number }

interface LayoutResponse {
  weights: { move: number; fillTarget: number };
  totals: { books: number; placed: number; moves: number; unplaced: number; exceptions: number; cost: number };
  bays: { bookcaseId: string; bookcaseName: string; from: number; to: number; count: number; label: string | null; labelText: string | null }[];
  levels: (LevelRef & { levelId: string; count: number; fill: number; usedMm: number; usableMm: number; dominantLabel: string | null })[];
  moves: (LevelRef & { bookId: string; title: string; fromLevelId: string | null; toLevelId: string; from: LevelRef | null; to: LevelRef | null })[];
  unplaced: { bookId: string; title: string; reason: string }[];
  merges: (LevelRef & { levelId: string; classes: { clc: string; label: string | null; count: number; mm: number }[] })[];
  exceptions: (LevelRef & { bookId: string; title: string; kind: string; floorMm: number; limitMm: number })[];
}

/** 惯性档位。数值是 lib/layout.ts 的 w_move（毫米当量） */
const EFFORT = [
  { key: "rebuild", move: 0 },
  { key: "tidy", move: 350 },
  { key: "minimal", move: 3000 },
] as const;

function where(r: LevelRef | null | undefined, levelLabel: (i: number) => string): string {
  if (!r || r.levelIndex == null) return "—";
  return `${r.roomName ? `${r.roomName} › ` : ""}${r.bookcaseName} › ${levelLabel(r.levelIndex)}`;
}

export function LayoutPlanner() {
  const t = useTranslations();
  const [effort, setEffort] = useState<(typeof EFFORT)[number]["key"]>("tidy");
  const [data, setData] = useState<LayoutResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const levelLabel = useCallback((i: number) => t("map.levelLabel", { index: i }), [t]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      const move = EFFORT.find((e) => e.key === effort)!.move;
      setData(await apiGet<LayoutResponse>(`/api/shelving/layout?move=${move}`));
    } catch {
      setError(t("errors.loadFailed"));
    }
  }, [effort, t]);

  useEffect(() => { void load(); }, [load]);

  const apply = async () => {
    if (!data?.moves.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ moved: number }>("/api/shelving/reflow", {
        moves: data.moves.map((m) => ({ bookId: m.bookId, toLevelId: m.toLevelId })),
        note: t("layout.batchNote"),
      });
      setDone(r.moved);
      await load();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h2 className="text-md">{t("layout.title")}</h2>
        <p className="hint mb-3">{t("layout.hint")}</p>

        <div className="flex flex-wrap gap-2">
          {EFFORT.map((e) => (
            <button
              key={e.key}
              type="button"
              onClick={() => setEffort(e.key)}
              aria-pressed={effort === e.key}
              className={`btn btn-sm ${effort === e.key ? "btn-primary" : "btn-ghost"}`}
            >
              {t(`layout.effort.${e.key}`)}
            </button>
          ))}
        </div>
        <p className="hint mt-2">{t(`layout.effortHint.${effort}`)}</p>
      </section>

      {error && <ErrorBanner message={error} />}
      {done !== null && (
        <div className="card flex items-center gap-3 p-3">
          <IconCheck className="h-5 w-5 text-success" />
          <span>{t("layout.applied", { count: done })}</span>
        </div>
      )}

      {!data ? (
        <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["layout.statBooks", data.totals.placed],
              ["layout.statMoves", data.totals.moves],
              ["layout.statExceptions", data.totals.exceptions],
              ["layout.statMerges", data.merges.length],
              ["layout.statUnplaced", data.totals.unplaced],
            ] as const).map(([k, v]) => (
              <div key={k} className="card p-3 text-center">
                <div className="section-title">{t(k)}</div>
                <div className="text-md mono">{v}</div>
              </div>
            ))}
          </section>

          {/* 每个柜子该管哪一段 —— 理解整套布局最快的入口 */}
          <section className="card p-4">
            <h3 className="section-title mb-2">{t("layout.bays")}</h3>
            <ul className="flex flex-col gap-1">
              {data.bays.filter((b) => b.count > 0).map((b) => (
                <li key={b.bookcaseId} className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 truncate font-black">{b.bookcaseName}</span>
                  <span className="chip">{b.label ?? "—"} {b.labelText ?? ""}</span>
                  <span className="mono">{t("map.levelBooks", { count: b.count })}</span>
                </li>
              ))}
            </ul>
          </section>

          {data.moves.length > 0 && (
            <section className="card p-4">
              <h3 className="section-title mb-2">{t("layout.moves", { count: data.moves.length })}</h3>
              <ul className="mb-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
                {data.moves.slice(0, 200).map((m) => (
                  <li key={m.bookId} className="text-2xs">
                    <span className="font-black">{m.title}</span>
                    <span className="hint"> · {where(m.from, levelLabel)} → {where(m.to, levelLabel)}</span>
                  </li>
                ))}
              </ul>
              {data.moves.length > 200 && <p className="hint mb-2">{t("layout.truncated", { count: data.moves.length - 200 })}</p>}
              <button type="button" onClick={() => void apply()} disabled={busy} className="btn btn-primary btn-sm">
                {busy ? <Spinner /> : null}{t("layout.apply", { count: data.moves.length })}
              </button>
              <p className="hint mt-2">{t("layout.applyHint")}</p>
            </section>
          )}

          {/* 小类合并 —— 用户明确要求过：几个装不满一层的小类拼在一起时，
              要主动说清楚拼了哪些。不说的话界面上只显示最大的那个类，
              另外几类等于凭空消失，人走到架子前才发现"这儿怎么还有别的书"。 */}
          {data.merges.length > 0 && (
            <section className="card p-4">
              <h3 className="section-title mb-2">{t("layout.merges")}</h3>
              <p className="hint mb-2">{t("layout.mergesHint")}</p>
              <ul className="flex flex-col gap-2">
                {data.merges.map((m) => (
                  <li key={m.levelId} className="flex flex-wrap items-center gap-2 text-2xs">
                    <span className="min-w-40 flex-1 truncate font-black">{where(m, levelLabel)}</span>
                    <span className="flex flex-wrap gap-1">
                      {m.classes.map((c) => (
                        <span key={c.clc} className="chip">
                          {c.clc} {c.label ?? ""} · {t("map.levelBooks", { count: c.count })}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 妥协和放不下的，一条都不藏 */}
          {data.exceptions.length > 0 && (
            <section className="card p-4">
              <h3 className="section-title mb-2 flex items-center gap-2">
                <IconWarn className="h-4 w-4 text-warning" />{t("layout.exceptions")}
              </h3>
              <p className="hint mb-2">{t("layout.exceptionsHint")}</p>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {data.exceptions.slice(0, 80).map((e) => (
                  <li key={e.bookId} className="text-2xs">
                    <span className="font-black">{e.title}</span>
                    <span className="hint">
                      {" "}· {where(e, levelLabel)} · {t(`layout.exception.${e.kind}`)}
                      （{Math.round(e.floorMm / 10)}cm &gt; {Math.round(e.limitMm / 10)}cm）
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.unplaced.length > 0 && (
            <section className="card p-4">
              <h3 className="section-title mb-2">{t("layout.unplaced")}</h3>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {data.unplaced.slice(0, 80).map((u) => (
                  <li key={u.bookId} className="text-2xs">
                    <span className="font-black">{u.title}</span>
                    <span className="hint"> · {t(`layout.reason.${u.reason}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
