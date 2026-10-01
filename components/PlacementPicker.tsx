"use client";

// F3 —— 上架建议 + 临界情况的人工确认
//
// 最关键的一条：系统算出来是"临界"时绝不自己拍板。
// 服务端会拒绝（409 needs_confirmation），前端把球踢回给用户：
// 你去书架前看一眼，塞得下就点「塞得下」。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { ErrorBanner, Spinner } from "./ui";
import { IconCheck, IconWarn, IconX } from "./icons";

type HeightVerdict = "ok" | "assumed_ok" | "too_tall" | "unknown";

interface SpineEstimate {
  mm: number;
  source: "measured" | "pages" | "default";
  confidence: "high" | "medium" | "low";
}

interface Suggestion {
  levelId: string;
  bookcaseId: string;
  levelIndex: number;
  width: "fits" | "tight" | "overflow";
  height: HeightVerdict;
  spine: SpineEstimate;
  remainingAfterMm: number;
  needsManualConfirm: boolean;
  headroomMm?: number;
  usage: { remainingMm: number; usableMm: number; bookCount: number; estimatedCount: number };
  score: number;
  reasons: string[];
}

type LevelMeta = Record<string, { bookcaseName: string; room: string | null; levelIndex: number }>;

const REASON_KEY: Record<string, string> = {
  same_tag_zone: "capacity.suggestReasonSameTag",
  width_ok: "capacity.suggestReasonWidthOk",
  width_tight: "capacity.suggestReasonWidthTight",
  width_overflow: "capacity.suggestReasonWidthOverflow",
  height_ok: "capacity.suggestReasonHeightOk",
  height_unknown: "capacity.suggestReasonHeightUnknown",
  height_assumed: "capacity.suggestReasonHeightAssumed",
};

export function PlacementPicker({
  bookId,
  onPlaced,
  onSkip,
}: {
  bookId: string;
  /** 带上 levelId，调用方可以据此画出书架几何图 */
  onPlaced: (levelId: string) => void;
  onSkip?: () => void;
}) {
  const t = useTranslations();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [levelMeta, setLevelMeta] = useState<LevelMeta>({});
  const [error, setError] = useState<string | null>(null);
  const [busyLevel, setBusyLevel] = useState<string | null>(null);
  /** 服务端要求人工确认的那一层 */
  const [confirming, setConfirming] = useState<Suggestion | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet<{ suggestions: Suggestion[]; levelMeta: LevelMeta }>(
        `/api/placements/suggest?bookId=${bookId}`,
      );
      setSuggestions(data.suggestions);
      setLevelMeta(data.levelMeta);
    } catch {
      setError(t("errors.loadFailed"));
    }
  }, [bookId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const place = async (
    suggestion: Suggestion,
    opts: { confirmedByUser?: boolean; isNearFull?: boolean } = {},
  ) => {
    setBusyLevel(suggestion.levelId);
    setError(null);
    try {
      await apiPost("/api/placements", {
        bookId,
        levelId: suggestion.levelId,
        ...opts,
      });
      onPlaced(suggestion.levelId);
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_confirmation") {
        setConfirming(suggestion);
      } else if (err instanceof ApiError && err.code === "too_tall") {
        setError(t("capacity.heightTooTall"));
      } else {
        setError(t("errors.saveFailed"));
      }
    } finally {
      setBusyLevel(null);
    }
  };

  if (!suggestions) {
    return (
      <div className="flex items-center gap-2 p-4 text-text-muted">
        <Spinner /> {t("common.loading")}
      </div>
    );
  }

  const spine = suggestions[0]?.spine;

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      {spine && (
        <p className="hint">
          {spine.source === "measured"
            ? t("capacity.measuredSpine")
            : spine.source === "pages"
              ? t("capacity.estimatedSpine")
              : t("capacity.defaultSpine")}
          : <span className="mono">{spine.mm} mm</span>
        </p>
      )}

      {/* 临界情况：系统不判断，交给用户（spec F3 验收条件 2） */}
      {confirming && (
        <div className="rounded-md border border-warning bg-warning-soft p-4">
          <div className="mb-2 flex items-center gap-2 font-black text-warning">
            <IconWarn className="h-5 w-5" />
            {t("capacity.needsConfirm")}
          </div>
          <p className="hint mb-3">{t("capacity.needsConfirmHint")}</p>
          <p className="mono mb-3">
            {t("capacity.remainingAfter")}: {confirming.remainingAfterMm} mm
            {confirming.height === "unknown" && ` · ${t("capacity.heightUnknown")}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                void place(target, { confirmedByUser: true });
              }}
            >
              <IconCheck className="h-4 w-4" /> {t("capacity.itFits")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                void place(target, { confirmedByUser: true, isNearFull: true });
              }}
            >
              {t("capacity.markNearFull")}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(null)}
            >
              <IconX className="h-4 w-4" /> {t("capacity.itDoesnt")}
            </button>
          </div>
        </div>
      )}

      {suggestions.length === 0 ? (
        <p className="hint">{t("capacity.noSuggestion")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {suggestions.slice(0, 8).map((s) => {
            const meta = levelMeta[s.levelId];
            const tone =
              s.width === "fits" ? "chip-ok" : s.width === "tight" ? "chip-warn" : "chip-danger";
            return (
              <li key={s.levelId}>
                <div className="card flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-black">
                      {meta?.bookcaseName ?? "?"} ·{" "}
                      {t("map.levelLabel", { index: s.levelIndex })}
                      {meta?.room ? <span className="hint"> · {meta.room}</span> : null}
                    </p>
                    <p className="mono">
                      {t("map.free")} {s.usage.remainingMm} mm · {t("capacity.remainingAfter")}{" "}
                      {s.remainingAfterMm} mm
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className={`chip ${tone}`}>{t(`capacity.${s.width}`)}</span>
                      {s.reasons
                        .filter((r) => REASON_KEY[r] && r !== `width_${s.width}`)
                        .map((r) => (
                          <span key={r} className="chip">
                            {t(REASON_KEY[r])}
                          </span>
                        ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyLevel === s.levelId}
                    onClick={() => void place(s)}
                    className="btn btn-primary btn-sm"
                  >
                    {busyLevel === s.levelId ? <Spinner /> : null}
                    {t("capacity.confirmPlacement")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {onSkip && (
        <button type="button" onClick={onSkip} className="btn btn-ghost btn-sm self-start">
          {t("scan.placeLater")}
        </button>
      )}
    </div>
  );
}
