"use client";

// 书脊系数校准 —— 算法见 lib/calibrate.ts
//
// 整个容量模型（装填率、放不放得下、上架算法的每一步）都建在
// `书脊 ≈ 页数 × 系数 + 底厚` 这一个公式上，而系数原本是照 80g 纸推出来的猜测。
// 猜偏了没人知道，直到你抱着书走到架子前发现塞不进去。
//
// 真实数据其实极其好拿：拿卷尺量一下某一层的书占了多宽。十秒钟一层。
// 两三层就能把系数拟合出来，之后全库的数字都跟着准。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/client";
import { ErrorBanner, Labeled, LoadFailed, Spinner } from "./ui";
import { IconCheck, IconTrash } from "./icons";

interface Result {
  mmPerPage: number;
  basePaperbackMm: number;
  baseHardcoverMm: number;
  samples: number;
  booksUsed: number;
  residualMm: number;
  baselineResidualMm: number;
  status: "ok" | "not_enough_data" | "implausible";
  note?: string;
}

interface Sample {
  levelId: string;
  measuredMm: number;
  at?: string;
  books: number;
  bookcaseName: string | null;
  levelIndex: number | null;
  estimatedMm: number;
}

interface Data {
  current: { mmPerPage: number; basePaperbackMm: number; baseHardcoverMm: number };
  result: Result;
  samples: Sample[];
}

export interface CalibrateLevel {
  id: string;
  levelIndex: number;
  widthMm: number;
  bookcase: { name: string };
}

export function CalibratePanel({ levels }: { levels: CalibrateLevel[] }) {
  const t = useTranslations();
  const [data, setData] = useState<Data | null>(null);
  const [levelId, setLevelId] = useState("");
  const [measured, setMeasured] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await apiGet<Data>("/api/settings/calibrate"));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const mm = Number(measured);
    if (!levelId || !(mm > 0)) return setError(t("errors.validation"));
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/settings/calibrate", { levelId, measuredMm: Math.round(mm) });
      setMeasured("");
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "";
      setError(
        code === "level_empty" ? t("calibrate.errEmpty")
        : code === "wider_than_shelf" ? t("calibrate.errTooWide")
        : t("errors.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch("/api/settings/calibrate", {});
      setApplied(true);
      await load();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm(t("calibrate.clearConfirm"))) return;
    await apiDelete("/api/settings/calibrate");
    setApplied(false);
    await load();
  };

  if (failed) {
    return <section className="card p-4"><LoadFailed onRetry={() => void load()} /></section>;
  }

  if (!data) {
    return <div className="flex items-center gap-2 p-4 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  const r = data.result;

  return (
    <section className="card p-4">
      <h2 className="text-md">{t("calibrate.title")}</h2>
      <p className="hint mb-3">{t("calibrate.hint")}</p>

      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      <form onSubmit={add} className="mb-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Labeled label={t("calibrate.pickLevel")} htmlFor="cal-level">
          <select id="cal-level" className="field" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
            <option value="">{t("common.select")}</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.bookcase.name} · {t("map.levelLabel", { index: l.levelIndex })}（{l.widthMm}mm）
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label={t("calibrate.measured")} htmlFor="cal-mm">
          <input id="cal-mm" className="field" type="number" inputMode="numeric" min="1"
            placeholder="例如 620" value={measured} onChange={(e) => setMeasured(e.target.value)} />
        </Labeled>
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? <Spinner /> : null}{t("calibrate.record")}
        </button>
      </form>

      {data.samples.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1">
          {data.samples.map((s) => {
            const diff = s.measuredMm - s.estimatedMm;
            return (
              <li key={s.levelId} className="flex flex-wrap items-center gap-2 text-2xs">
                <span className="flex-1 truncate font-black">
                  {s.bookcaseName ?? "—"} · {t("map.levelLabel", { index: s.levelIndex ?? 0 })}
                </span>
                <span className="mono">{t("calibrate.rowBooks", { count: s.books })}</span>
                <span className="mono">{t("calibrate.rowMeasured", { mm: s.measuredMm })}</span>
                <span className={`mono ${Math.abs(diff) > 30 ? "text-warning" : "text-text-muted"}`}>
                  {t("calibrate.rowDiff", { mm: diff > 0 ? `+${diff}` : String(diff) })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* 结果：好也说、不够也说、荒唐也说 */}
      <div className="rounded-md border-2 border-border bg-surface-2 p-3">
        {r.status === "not_enough_data" ? (
          <p className="hint">{t("calibrate.needMore", { samples: r.samples, books: r.booksUsed })}</p>
        ) : r.status === "implausible" ? (
          <p className="text-danger">{t("calibrate.implausible")}{r.note ? `（${r.note}）` : ""}</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label={t("calibrate.statPerPage")}
                now={data.current.mmPerPage.toFixed(4)} next={r.mmPerPage.toFixed(4)} />
              <Stat label={t("calibrate.statBase")}
                now={`${data.current.basePaperbackMm}mm`} next={`${r.basePaperbackMm}mm`} />
              <Stat label={t("calibrate.statResidual")}
                now={`${r.baselineResidualMm}mm`} next={`${r.residualMm}mm`} />
            </div>
            <p className="hint mt-2">
              {t("calibrate.basedOn", { samples: r.samples, books: r.booksUsed })}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void apply()} disabled={busy} className="btn btn-primary btn-sm">
                {busy ? <Spinner /> : <IconCheck className="h-4 w-4" />}{t("calibrate.apply")}
              </button>
              {applied && <span className="chip chip-info">{t("calibrate.applied")}</span>}
            </div>
          </>
        )}
      </div>

      {data.samples.length > 0 && (
        <button type="button" onClick={() => void clear()} className="btn btn-ghost btn-sm mt-3">
          <IconTrash className="h-4 w-4" /> {t("calibrate.clear")}
        </button>
      )}
    </section>
  );
}

function Stat({ label, now, next }: { label: string; now: string; next: string }) {
  const changed = now !== next;
  return (
    <div className="rounded-sm border border-border bg-surface-1 p-2 text-center">
      <div className="section-title">{label}</div>
      <div className="mono">
        <span className={changed ? "text-text-faint line-through" : ""}>{now}</span>
        {changed && <> → <span className="font-black">{next}</span></>}
      </div>
    </div>
  );
}
