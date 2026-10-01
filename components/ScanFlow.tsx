"use client";

// F1 编排层 —— 自动入库模式
//
// 流程：扫码 → 多源查询 → 按优先级自动选最好的值 → 直接入库 → 直接给出「放哪一层」。
// 中间不再拦人确认。理由很实际：一轮全屋整理要扫几百本，每本都停下来核对字段
// 等于把系统变成了打字工具。冲突就按 lib/providers 的优先级选（那套优先级是实测出来的），
// 入库后随时能改。
//
// 仍然会打断你的只有三种情况，都是"不问不行"的：
//   1. 这本书已经在库里了（避免悄悄多出一堆复本）
//   2. 条码校验位不对（多半是扫错了，拿错号去查等于白查）
//   3. 所有源都没查到（没有东西可自动填，只能手动录）

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiGet, apiPost, ApiError } from "@/lib/client";
import { Scanner } from "./Scanner";
import { BookForm, toFormValues, type FieldConflict } from "./BookForm";
import { ShelvingPicker } from "./ShelvingPicker";
import { ShelfDiagram } from "./ShelfDiagram";
import { useSpaceData } from "./MapPanel";
import { CallNumber, type DdcSourceValue } from "./CallNumber";
import { Cover } from "./BookRow";
import { ErrorBanner, Modal, PageHeader, Spinner } from "./ui";
import { IconCheck, IconScan, IconWarn } from "./icons";
import type { TagOption, TagSuggestion } from "./TagPicker";

interface ParsedBarcode {
  kind: "isbn" | "issn" | "ismn" | "unknown";
  raw: string;
  isbn13?: string;
  isbn10?: string;
  issn?: string;
  addon?: string;
  valid: boolean;
  reason?: string;
}

interface ProviderResult {
  source: string;
  ok: boolean;
  candidates: unknown[];
  error?: string;
  ms: number;
}

interface LookupResponse {
  parsed: ParsedBarcode;
  existing: { id: string; title: string; authors: string[]; coverUrl: string | null } | null;
  /** 同一份刊物已经有别的期了 —— 这不是重复，是提醒你填期号 */
  sameSeries?: { id: string; title: string; issnAddon: string | null } | null;
  lookup: {
    merged: Record<string, unknown>;
    sourceMeta: Record<string, string>;
    conflicts: FieldConflict[];
    results: ProviderResult[];
    empty: boolean;
  } | null;
  labels?: Record<string, string>;
}

interface SavedBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  callNumber: string | null;
  /**
   * 中图法号 —— **不是** `Book.ddc`（那是 OpenLibrary 给的杜威号，只作参考）。
   *
   * 这一整条扫码流程原来通篇用的是 ddc：补号判断看 `!book.ddc`、
   * 调 `/api/books/[id]/ddc`、确认页把杜威号显示在索书号位置上。
   * 可整套上架系统跑的是中图法：`callSortKey` 由中图法算、货架带按中图法排、
   * 书脊标签印的是中图法。于是扫完一本书，屏幕上给你看「895」，
   * 而它实际按「I247.5」摆在架上。
   *
   * 更要紧的是那个补号判断：规则给得出杜威号、给不出中图法号时，
   * `!book.ddc` 是 false，AI 补号**不会触发** —— 这本书就没有中图法号，
   * 没有 callSortKey，直接掉到货架带末尾。（线上目前 0 本处于这个状态，
   * 属于还没踩上，不是不会踩。）
   */
  clc: string | null;
  clcSource: DdcSourceValue;
}

type Stage = "scanning" | "working" | "placed" | "duplicate" | "failed";

export function ScanFlow({ tags }: { tags: TagOption[] }) {
  const t = useTranslations();
  const [stage, setStage] = useState<Stage>("scanning");
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [saved, setSaved] = useState<SavedBook | null>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [repicking, setRepicking] = useState(false);
  const { data: space, reload: reloadSpace } = useSpaceData();
  const [placement, setPlacement] = useState<{ bookcaseId: string; levelId: string } | null>(null);
  const inFlight = useRef(false);

  const reset = useCallback(() => {
    setResult(null);
    setSaved(null);
    setSuggestions([]);
    setManualCode("");
    setError(null);
    setPlacement(null);
    setStage("scanning");
  }, []);

  /** 扫到码之后的一条龙：查 → 存 → 选层 → 出图 */
  const handleCode = useCallback(
    async (code: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStage("working");
      setError(null);

      try {
        const data = await apiGet<LookupResponse>(`/api/lookup?code=${encodeURIComponent(code)}`);
        setResult(data);

        if (data.existing) {
          setStage("duplicate");
          return;
        }
        if (!data.parsed.valid || !data.lookup || data.lookup.empty) {
          setStage("failed");
          return;
        }

        const m = data.lookup.merged as Record<string, never>;

        // 标签建议只是**建议**，不再自动打上。
        // 关键词猜出来的"小说/历史/科普"就是中图法分类的劣化版本：分类号是按题名、
        // 主题词、简介算出来的，覆盖每一本书还能排序；自动标签只会在库里堆出一层
        // 和分类打架的噪声。标签留给分类法表达不了的事（状态、来源），那种事只能人来标。
        const tagRes = await apiPost<{ suggestions: TagSuggestion[] }>("/api/tags/suggest", {
          title: m.title ?? null,
          subtitle: m.subtitle ?? null,
          subjects: m.subjects ?? [],
          publisher: m.publisher ?? null,
          isPeriodical: data.parsed.kind === "issn",
          language: m.language ?? null,
        });
        setSuggestions(tagRes.suggestions);

        const { book } = await apiPost<{ book: SavedBook }>("/api/books", {
          title: m.title,
          subtitle: m.subtitle ?? null,
          originalTitle: m.originalTitle ?? null,
          authors: m.authors ?? [],
          translators: m.translators ?? [],
          publisher: m.publisher ?? null,
          pubDate: m.pubDate ?? null,
          language: m.language ?? null,
          pageCount: m.pageCount ?? null,
          binding: data.parsed.kind === "issn" ? "期刊" : (m.binding ?? null),
          price: m.price ?? null,
          summary: m.summary ?? null,
          coverUrl: m.coverUrl ?? null,
          isbn13: data.parsed.isbn13 ?? null,
          isbn10: data.parsed.isbn10 ?? null,
          issn: data.parsed.issn ?? null,
          issnAddon: data.parsed.addon ?? null,
          sourceMeta: data.lookup.sourceMeta,
          subjects: m.subjects ?? [],
          authoritativeDdc: m.ddc ?? null,
        });

        setSaved(book);
        setStage("placed");

        // 规则没定出分类号时，后台补一次 AI 推断 —— 不挡着你继续扫
        if (!book.clc) {
          void apiPost<{ clc: string | null; clcSource: DdcSourceValue; callNumber: string | null }>(
            `/api/books/${book.id}/clc`,
          )
            .then((r) => setSaved((prev) => (prev && prev.id === book.id ? { ...prev, ...r } : prev)))
            .catch(() => {});
        }
      } catch (err) {
        // 限流要说清楚是限流，不然用户会以为网断了，一直重试反而更撞
        setError(
          err instanceof ApiError && err.code === "rate_limited"
            ? t("errors.rateLimited", {
                minutes: Math.ceil(Number(err.payload?.retryAfter ?? 60) / 60),
              })
            : t("errors.networkError"),
        );
        setStage("scanning");
      } finally {
        inFlight.current = false;
      }
    },
    [t],
  );

  // 上架成功后把整屋几何拉回来画图
  const loadDiagram = useCallback(async (levelId: string) => {
    const { bookcases } = await apiGet<{ bookcases: { id: string; levels: { id: string }[] }[] }>("/api/map");
    await reloadSpace();
    const bc = bookcases.find((b) => b.levels.some((l) => l.id === levelId));
    if (bc) setPlacement({ bookcaseId: bc.id, levelId });
  }, [reloadSpace]);

  // ------------------------------------------------------------ 已入库 + 上架
  if (stage === "placed" && saved) {
    return (
      <>
        <PageHeader
          title={t("scan.autoAdded")}
          subtitle={t("scan.autoAddedHint")}
          actions={
            <>
              <button type="button" onClick={reset} className="btn btn-primary btn-sm">
                <IconScan className="h-4 w-4" /> {t("scan.scanNext")}
              </button>
              <button type="button" onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">
                {t("scan.editNow")}
              </button>
            </>
          }
        />

        <div className="card mb-4 flex items-center gap-3 p-3">
          <Cover url={saved.coverUrl} title={saved.title} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-black">{saved.title}</p>
            <p className="hint truncate">{saved.authors.join(" / ")}</p>
            <div className="mt-1">
              <CallNumber
                callNumber={saved.callNumber}
                clc={saved.clc}
                source={saved.clcSource}
                showSource
              />
            </div>
          </div>
          <IconCheck className="h-6 w-6 shrink-0 text-success" />
        </div>

        {placement && space ? (
          <>
            <h2 className="mb-2 text-md">{t("place.title")}</h2>
            <p className="hint mb-3">{t("place.diagramHint")}</p>
            <ShelfDiagram
              space={space}
              targetBookcaseId={placement.bookcaseId}
              targetLevelId={placement.levelId}
              highlightBookId={saved.id}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={reset} className="btn btn-primary">
                <IconScan className="h-4 w-4" /> {t("scan.scanNext")}
              </button>
              <button type="button" onClick={() => setRepicking(true)} className="btn btn-ghost">
                {t("place.reshelve")}
              </button>
            </div>
          </>
        ) : (
          <div className="card p-4">
            <h2 className="mb-3 text-md">{t("capacity.chooseLevel")}</h2>
            <ShelvingPicker
              bookId={saved.id}
              onPlaced={(levelId) => void loadDiagram(levelId)}
              onSkip={reset}
            />
          </div>
        )}

        <Modal open={editing} onClose={() => setEditing(false)} title={t("book.editTitle")} wide>
          <BookForm
            bookId={saved.id}
            initial={toFormValues(saved as unknown as Record<string, unknown>)}
            conflicts={result?.lookup?.conflicts}
            sourceMeta={result?.lookup?.sourceMeta}
            tags={tags}
            tagSuggestions={suggestions}
            onSaved={(b) => {
              setSaved((prev) => (prev ? { ...prev, ...b } : prev));
              setEditing(false);
            }}
          />
        </Modal>

        <Modal open={repicking} onClose={() => setRepicking(false)} title={t("capacity.chooseLevel")} wide>
          <ShelvingPicker
            bookId={saved.id}
            onPlaced={(levelId) => {
              setRepicking(false);
              void loadDiagram(levelId);
            }}
          />
        </Modal>
      </>
    );
  }

  // ------------------------------------------------------------ 已存在
  if (stage === "duplicate" && result?.existing) {
    const e = result.existing;
    return (
      <>
        <PageHeader title={t("scan.alreadyExists")} />
        <div className="card flex items-center gap-3 p-4">
          <Cover url={e.coverUrl} title={e.title} />
          <div className="min-w-0">
            <p className="font-black">{e.title}</p>
            <p className="hint truncate">{e.authors.join(" / ")}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={reset} className="btn btn-primary">
            <IconScan className="h-4 w-4" /> {t("scan.scanNext")}
          </button>
          <Link href={`/books/${e.id}`} className="btn btn-ghost">
            {t("scan.viewExisting")}
          </Link>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------ 查不到 / 条码有问题
  if (stage === "failed" && result) {
    const { parsed, lookup } = result;
    const badBarcode = !parsed.valid;
    return (
      <>
        <PageHeader title={badBarcode ? t("scan.invalidBarcode") : t("scan.noResults")} />

        {/* 期刊：同一份刊物已经有别的期了。这不是重复 —— 是提醒把期号填上，
            否则下一期扫进来又分不出是哪一期。
            （附加码只有 zxing 读得到，Chrome 原生的条码接口读不出来） */}
        {result?.sameSeries && (
          <div className="card mb-4 p-3">
            <p className="font-black">{t("scan.sameSeries", { title: result.sameSeries.title })}</p>
            <p className="hint">{t("scan.sameSeriesHint")}</p>
          </div>
        )}
        {badBarcode ? (
          <ErrorBanner
            message={
              parsed.reason === "ean13_checksum" || parsed.reason === "isbn10_checksum"
                ? t("scan.checksumFailed")
                : t("scan.invalidBarcode")
            }
          />
        ) : (
          <>
            <p className="hint mb-3">{t("scan.noResultsHint")}</p>
            {parsed.kind === "issn" && (
              <div className="mb-3 rounded-md border-2 border-border bg-warning-soft p-3 text-xs font-bold text-[#7c3e00]">
                <IconWarn className="mr-1 inline h-4 w-4" />
                {t("scan.issnNotice")}
              </div>
            )}
          </>
        )}
        <p className="mono mt-2">{parsed.isbn13 ?? parsed.issn ?? parsed.raw}</p>

        <div className="card mt-4 p-4">
          <BookForm
            compact
            tags={tags}
            initial={toFormValues({
              isbn13: parsed.isbn13 ?? "",
              isbn10: parsed.isbn10 ?? "",
              issn: parsed.issn ?? "",
              issnAddon: parsed.addon ?? "",
              binding: parsed.kind === "issn" ? "期刊" : "",
            })}
            submitLabel={t("common.save")}
            onSaved={(b) => {
              setSaved({ ...(b as SavedBook), authors: [], coverUrl: null, callNumber: null, clc: null, clcSource: null });
              setStage("placed");
            }}
          />
        </div>

        <button type="button" onClick={reset} className="btn btn-ghost mt-4">
          {t("common.cancel")}
        </button>
      </>
    );
  }

  // ------------------------------------------------------------ 扫码中
  return (
    <>
      <PageHeader title={t("scan.title")} />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {stage === "working" ? (
        <div className="card flex items-center gap-3 p-6">
          <Spinner className="h-5 w-5 text-secondary" />
          <span className="font-black">{t("scan.autoLookingUp")}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Scanner onDetected={(code) => void handleCode(code)} />

          <div className="card p-4">
            <label className="label" htmlFor="manual-code">{t("scan.manualInput")}</label>
            <div className="flex gap-2">
              <input
                id="manual-code"
                className="field flex-1"
                inputMode="numeric"
                autoComplete="off"
                placeholder={t("scan.manualInputPlaceholder")}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && manualCode.trim()) {
                    e.preventDefault();
                    void handleCode(manualCode.trim());
                  }
                }}
              />
              <button
                type="button"
                disabled={!manualCode.trim()}
                onClick={() => void handleCode(manualCode.trim())}
                className="btn btn-primary"
              >
                {t("scan.lookup")}
              </button>
            </div>
          </div>

          <Link href="/books/new" className="btn btn-ghost self-start">
            {t("scan.goManual")}
          </Link>
        </div>
      )}
    </>
  );
}

