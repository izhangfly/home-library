"use client";

// 盘点模式：选一层 → 连续扫这层的书 → 系统就知道这层有什么。
//
// 这是"冷启动"的解法：不用一次盘完全屋，也不用把书抽出来，
// 站在书架前一格一格扫就行，随时可以停。
// 扫到不该在这层的书会自动更正位置（错架检测）。

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiPost } from "@/lib/client";
import { Scanner } from "./Scanner";
import { CallNumber } from "./CallNumber";
import { EmptyState, ErrorBanner, LoadFailed, PageHeader, Spinner } from "./ui";
import { IconCheck, IconWarn } from "./icons";

export interface InventoryLevel {
  id: string;
  levelIndex: number;
  widthMm: number;
  bookcase: { name: string; room: string | null };
}

interface ShelfBook {
  id: string;
  title: string;
  authors: string[];
  callNumber: string | null;
  clc: string | null;
  clcLabel: string | null;
}

interface ScanEvent {
  at: number;
  status: "confirmed" | "moved" | "unknown" | "bad_barcode";
  title?: string;
  fromText?: string;
  code?: string;
}

export function InventoryMode({ levels }: { levels: InventoryLevel[] }) {
  const t = useTranslations();
  const [levelId, setLevelId] = useState("");
  const [books, setBooks] = useState<ShelfBook[]>([]);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [failed, setFailed] = useState(false);
  /** 这一轮真正扫到的书 —— 用来和系统记录的对账 */
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [reconciling, setReconciling] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!levelId) return;
    setFailed(false);
    try {
      const d = await apiGet<{ books: ShelfBook[] }>(`/api/inventory?levelId=${levelId}`);
      setBooks(d.books);
    } catch {
      setFailed(true);
    }
  }, [levelId]);

  useEffect(() => { void load(); }, [load]);

  // 换一层就重新开始：上一层扫到的书和这一层无关
  useEffect(() => { setSeen(new Set()); setReconciling(false); }, [levelId]);

  const handle = useCallback(
    async (code: string) => {
      if (!levelId || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const r = await apiPost<{
          status: ScanEvent["status"];
          book?: { id: string; title: string };
          from?: { bookcaseName: string; levelIndex: number; room: string | null } | null;
        }>("/api/inventory", { levelId, code });

        setEvents((prev) => [
          {
            at: Date.now(),
            status: r.status,
            title: r.book?.title,
            code,
            fromText: r.from
              ? `${r.from.room ? r.from.room + " › " : ""}${r.from.bookcaseName} › ${t("map.levelLabel", { index: r.from.levelIndex })}`
              : undefined,
          },
          ...prev.slice(0, 29),
        ]);
        if (r.status !== "bad_barcode") await load();
        if (r.book?.id) setSeen((prev) => new Set(prev).add(r.book!.id));
        if (navigator.vibrate) navigator.vibrate(r.status === "moved" ? [40, 60, 40] : 50);
      } catch {
        setError(t("errors.networkError"));
      } finally {
        setBusy(false);
        inFlight.current = false;
      }
    },
    [levelId, load, t],
  );

  /**
   * 这本书不在这层了 —— 只解除上架关系，**书本身一个字都不动**。
   * 它会变回"未上架"，下次扫到会重新问该放哪，而不是凭空消失。
   */
  const unshelve = async (bookId: string) => {
    setBusy(true);
    try {
      await apiDelete(`/api/placements?bookId=${bookId}`);
      await load();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const chosen = levels.find((l) => l.id === levelId);

  return (
    <>
      <PageHeader title={t("inventory.title")} subtitle={t("inventory.hint")} />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <div className="card mb-4 p-4">
        <label className="label" htmlFor="inv-level">{t("inventory.pickLevel")}</label>
        <select id="inv-level" className="field" value={levelId} onChange={(e) => setLevelId(e.target.value)}>
          <option value="">{t("inventory.pickLevelPlaceholder")}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.bookcase.room ? `${l.bookcase.room} › ` : ""}{l.bookcase.name} › {t("map.levelLabel", { index: l.levelIndex })}
            </option>
          ))}
        </select>
      </div>

      {failed ? (
        <LoadFailed onRetry={() => void load()} />
      ) : !levelId ? (
        <EmptyState title={t("inventory.pickFirst")} hint={t("inventory.pickFirstHint")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Scanner onDetected={(c) => void handle(c)} />

            <div className="card p-4">
              <label className="label" htmlFor="inv-code">{t("scan.manualInput")}</label>
              <div className="flex gap-2">
                <input id="inv-code" className="field flex-1" inputMode="numeric" value={manual}
                  placeholder={t("scan.manualInputPlaceholder")}
                  onChange={(e) => setManual(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && manual.trim()) {
                      e.preventDefault();
                      void handle(manual.trim());
                      setManual("");
                    }
                  }} />
                <button type="button" className="btn btn-primary" disabled={!manual.trim() || busy}
                  onClick={() => { void handle(manual.trim()); setManual(""); }}>
                  {busy ? <Spinner /> : null}{t("inventory.record")}
                </button>
              </div>
            </div>

            {events.length > 0 && (
              <div className="card p-4">
                <h2 className="section-title mb-2">{t("inventory.recent")}</h2>
                <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                  {events.map((e) => (
                    <li key={e.at} className="flex flex-wrap items-center gap-2 text-2xs">
                      {e.status === "confirmed" && <span className="chip chip-ok"><IconCheck className="h-3 w-3" />{t("inventory.confirmed")}</span>}
                      {e.status === "moved" && <span className="chip chip-warn"><IconWarn className="h-3 w-3" />{t("inventory.corrected")}</span>}
                      {e.status === "unknown" && <span className="chip chip-info">{t("inventory.newBook")}</span>}
                      {e.status === "bad_barcode" && <span className="chip chip-danger">{t("scan.invalidBarcode")}</span>}
                      <span className="truncate">{e.title ?? e.code}</span>
                      {e.fromText && <span className="mono truncate">{t("inventory.wasAt")} {e.fromText}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="card p-4">
            <h2 className="mb-2 text-md">
              {chosen?.bookcase.name} › {t("map.levelLabel", { index: chosen?.levelIndex ?? 0 })}
            </h2>
            <p className="hint mb-3">{t("inventory.onThisLevel", { count: books.length })}</p>

            {/* 盘架的另一半。
                「书在这儿但系统记在别处」上面已经自动更正了；
                这里管的是反过来那半：**系统记在这层、你却没扫到**。
                那些书多半是被借走、挪去别屋或者卖掉了 —— 不清掉的话，
                这一层会一直显得比实际更满，容量和上架建议全跟着错。
                图书馆的 shelf reading 本来就是两边都要查，只查一边等于没查。 */}
            {seen.size > 0 && (
              <div className="mb-3 rounded-md border-2 border-border bg-surface-2 p-3">
                {(() => {
                  const missing = books.filter((b) => !seen.has(b.id));
                  if (!reconciling) {
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="hint flex-1">
                          {t("inventory.scannedCount", { seen: seen.size, total: books.length })}
                        </span>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => setReconciling(true)}>
                          {t("inventory.finishLevel")}
                        </button>
                      </div>
                    );
                  }
                  if (!missing.length) {
                    return (
                      <p className="flex items-center gap-2 font-black">
                        <IconCheck className="h-4 w-4 text-success" />{t("inventory.allAccounted")}
                      </p>
                    );
                  }
                  return (
                    <>
                      <p className="font-black">{t("inventory.missingTitle", { count: missing.length })}</p>
                      <p className="hint mb-2">{t("inventory.missingHint")}</p>
                      <ul className="flex flex-col gap-1">
                        {missing.map((b) => (
                          <li key={b.id} className="flex flex-wrap items-center gap-2 text-2xs">
                            <span className="flex-1 truncate">{b.title}</span>
                            <button type="button" disabled={busy} className="btn btn-ghost btn-sm"
                              onClick={() => void unshelve(b.id)}>
                              {t("inventory.notHere")}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button type="button" className="btn btn-ghost btn-sm mt-2"
                        onClick={() => setReconciling(false)}>
                        {t("inventory.keepScanning")}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
            {books.length === 0 ? (
              <p className="hint">{t("map.emptyLevel")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {books.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-sm border-2 border-border bg-surface-2 p-1.5">
                    <CallNumber callNumber={b.callNumber} clc={b.clc} />
                    <span className="flex-1 truncate text-xs">{b.title}</span>
                    <span className="hint truncate">{b.clcLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
