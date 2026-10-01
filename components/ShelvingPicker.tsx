"use client";

// 上架选择器（新引擎版）
//
// 和旧版最大的不同：排序依据从"哪层还有空"变成"哪层的书跟它是一类"。
// 中图法号的共同前缀长度就是学科距离，所以同类书会自然聚到一起，
// 而不是哪儿有缝往哪儿塞。可达性（儿童书放低）也进了打分。
//
// 最上面那一条是**按索书号该插的位置**（lib/insert.ts），不是打分最高的那层。
// 两者不一定一样：这本书按分类号属于第 3 层的中间，第 3 层却满了 ——
// 这时正确答案是把第 3 层最后一本推到第 4 层，而不是把它丢到还空着的第 5 层去。
// 下面的打分列表只是备选，留给"我就想放别处"的情况。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { CallNumber } from "./CallNumber";
import { ErrorBanner, Spinner } from "./ui";
import { IconCheck } from "./icons";

interface Option {
  levelId: string;
  score: number;
  freeAfterMm: number;
  fillAfter: number;
  reasons: string[];
}

interface LevelMeta {
  bookcaseName: string;
  roomName: string | null;
  levelIndex: number;
  floorMm: number;
  bookcaseId: string;
  dominantClass: string | null;
  dominantLabel: string | null;
  freeMm: number;
}

interface Shift {
  bookId: string;
  title: string;
  fromLevelId: string;
  toLevelId: string;
  from: LevelMeta | null;
  to: LevelMeta | null;
}

interface InsertPlan {
  targetLevelId: string | null;
  positionInLevel: number;
  shifts: Shift[];
  outcome: "fits" | "cascade" | "needs_review";
  reason: string;
  bookcaseId: string | null;
}

interface Resp {
  book: { id: string; title: string; clc: string | null; clcLabel: string | null };
  reader: string | null;
  insert: InsertPlan | null;
  options: Option[];
  levelMeta: Record<string, LevelMeta>;
}

const REASON: Record<string, string> = {
  same_topic: "shelving.sameTopic",
  related_topic: "shelving.relatedTopic",
  unrelated_topic: "shelving.unrelatedTopic",
  empty_level: "shelving.emptyLevel",
  ideal_reach: "shelving.idealReach",
  out_of_reach: "shelving.outOfReach",
  has_slack: "shelving.hasSlack",
  over_fill_target: "shelving.overFill",
};

/** 服务端 409 里带回来的容量判定 */
interface Fit {
  width?: "fits" | "tight" | "overflow";
  height?: "ok" | "assumed_ok" | "too_tall" | "unknown";
  remainingAfterMm?: number;
  headroomMm?: number;
  usage?: { remainingMm: number };
}

export function ShelvingPicker({
  bookId,
  onPlaced,
  onSkip,
}: {
  bookId: string;
  onPlaced: (levelId: string) => void;
  onSkip?: () => void;
}) {
  const t = useTranslations();
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 服务端判定为临界／放不下时，把球踢回给用户 */
  const [confirm, setConfirm] = useState<{ levelId: string; kind: "tight" | "too_tall"; fit: Fit } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiGet<Resp>(`/api/shelving/suggest?bookId=${bookId}`));
    } catch {
      setError(t("errors.loadFailed"));
    }
  }, [bookId, t]);

  useEffect(() => { void load(); }, [load]);

  /**
   * 上架。
   *
   * **不许带 force。** 这里以前无条件发 `confirmedByUser: true, force: true`，
   * 等于把服务端那道 409 完全绕开了 —— 宽度临界不问、书比层高还高也照放。
   * 而这道确认恰恰是最有用的时刻：你还站在电脑前，没抱着书走过去。
   * 系统知道"这层只剩 8mm"却不说，等你走到架子前才发现，那这个应用就白做了。
   * （spec F3 验收条件 2；CLAUDE.md 里也写着不许改成自动放行。）
   */
  const place = async (levelId: string, confirmed = false) => {
    setBusy(levelId);
    setError(null);
    try {
      await apiPost("/api/placements", {
        bookId,
        levelId,
        // 只有用户在确认框里点过"知道了，就放这儿"才带确认标记
        ...(confirmed ? { confirmedByUser: true, force: true } : {}),
      });
      setConfirm(null);
      onPlaced(levelId);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "needs_confirmation" || err.code === "too_tall")) {
        setConfirm({
          levelId,
          kind: err.code === "too_tall" ? "too_tall" : "tight",
          fit: (err.payload?.fit ?? {}) as Fit,
        });
        return;
      }
      setError(err instanceof ApiError ? t("errors.saveFailed") : t("errors.networkError"));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return <div className="flex items-center gap-2 p-4 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  const ins = data.insert;
  const insMeta = ins?.targetLevelId ? data.levelMeta[ins.targetLevelId] : null;
  const where = (m: LevelMeta | null | undefined) =>
    m ? `${m.roomName ? `${m.roomName} › ` : ""}${m.bookcaseName} › ${t("map.levelLabel", { index: m.levelIndex })}` : "—";

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}

      {/* 服务端说"这个我不敢替你拍板"时，把判断依据摆出来交给用户。
          发生在你走到书架前**之前**，这正是它的价值所在。 */}
      {confirm && (
        <div role="alert" className="card border-warning p-3">
          <p className="font-black">
            {confirm.kind === "too_tall" ? t("place.tooTallTitle") : t("place.tightTitle")}
          </p>
          <p className="hint mt-1">
            {confirm.kind === "too_tall"
              ? t("place.tooTallHint", { mm: Math.abs(confirm.fit.headroomMm ?? 0) })
              : t("place.tightHint", { mm: confirm.fit.remainingAfterMm ?? 0 })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy === confirm.levelId}
              onClick={() => void place(confirm.levelId, true)} className="btn btn-primary btn-sm">
              {busy === confirm.levelId ? <Spinner /> : null}{t("place.placeAnyway")}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="btn btn-ghost btn-sm">
              {t("place.pickAnother")}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CallNumber callNumber={null} clc={data.book.clc} size="lg" />
        <span className="font-black">{data.book.clcLabel ?? t("callNumber.none")}</span>
        {data.reader && <span className="chip chip-info">{t("shelving.forReader", { name: data.reader })}</span>}
      </div>

      {/* 按索书号该插的位置 —— 默认答案 */}
      {ins && insMeta && ins.outcome !== "needs_review" && (
        <div className="card border-primary p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip chip-ok">{t("insert.byCallNumber")}</span>
            <span className="flex-1 font-black">{where(insMeta)}</span>
            <button type="button" disabled={busy === ins.targetLevelId}
              onClick={() => void place(ins.targetLevelId!)} className="btn btn-primary btn-sm">
              {busy === ins.targetLevelId ? <Spinner /> : <IconCheck className="h-4 w-4" />}
              {t("place.confirmHere")}
            </button>
          </div>
          <p className="mono mt-1">
            {t("insert.position", { n: ins.positionInLevel + 1 })} ·{" "}
            {t("shelving.thisLevelHolds")}: {insMeta.dominantLabel ?? t("shelving.nothingYet")}
          </p>
          {ins.shifts.length > 0 && (
            <div className="mt-2">
              <p className="hint">{t("insert.shiftHint", { count: ins.shifts.length })}</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {ins.shifts.map((sh) => (
                  <li key={sh.bookId} className="text-2xs">
                    <span className="font-black">{sh.title}</span>
                    <span className="hint"> · {where(sh.from)} → {where(sh.to)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {ins && ins.outcome === "needs_review" && (
        <div className="card border-warning p-3">
          <p className="font-black">{t("insert.needsReview")}</p>
          <p className="hint">{t(`insert.reason.${ins.reason}`)}</p>
        </div>
      )}

      {!data.options.length ? (
        <p className="hint">{t("capacity.noSuggestion")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {/* 备选：打分排序。上面那条才是按顺序该去的地方，所以要把它从这里剔掉 ——
              同一层出现两次，人会以为是两个不同的位置 */}
          <li className="section-title">{t("insert.alternatives")}</li>
          {data.options
            .filter((o) => o.levelId !== ins?.targetLevelId)
            .slice(0, 5)
            .map((o, i) => {
            const m = data.levelMeta[o.levelId];
            const isBest = i === 0 && !ins?.targetLevelId;
            return (
              <li key={o.levelId}>
                <div className={`card-flat p-3 ${isBest ? "border-primary" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {isBest && <span className="chip chip-ok">{t("shelving.best")}</span>}
                    <span className="flex-1 font-black">
                      {m.roomName ? `${m.roomName} › ` : ""}{m.bookcaseName} ›{" "}
                      {t("map.levelLabel", { index: m.levelIndex })}
                    </span>
                    <button type="button" disabled={busy === o.levelId}
                      onClick={() => void place(o.levelId)}
                      className={`btn btn-sm ${isBest ? "btn-primary" : "btn-ghost"}`}>
                      {busy === o.levelId ? <Spinner /> : <IconCheck className="h-4 w-4" />}
                      {t("place.confirmHere")}
                    </button>
                  </div>
                  <p className="mono mt-1">
                    {t("shelving.thisLevelHolds")}: {m.dominantLabel ?? t("shelving.nothingYet")} ·{" "}
                    {t("map.free")} {Math.round(o.freeAfterMm)}mm · {t("shelving.floorHeight")} {Math.round(m.floorMm / 10)}cm
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.reasons.filter((r) => REASON[r]).map((r) => (
                      <span key={r} className={`chip ${r === "out_of_reach" || r === "over_fill_target" ? "chip-warn" : r === "same_topic" ? "chip-ok" : ""}`}>
                        {t(REASON[r])}
                      </span>
                    ))}
                  </div>
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
