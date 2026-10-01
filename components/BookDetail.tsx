"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiDelete, apiPost, ApiError } from "@/lib/client";
import { BookForm, toFormValues } from "./BookForm";
import { ShelvingPicker } from "./ShelvingPicker";
import { Cover } from "./BookRow";
import { coverSrc } from "@/lib/cover";
import { CallNumber, type DdcSourceValue } from "./CallNumber";
import { clcLabel } from "@/lib/clc";
import { DirectoryPath } from "./DirectoryPath";
import { tagChipStyle } from "@/lib/contrast";
import { CompletenessBar, ErrorBanner, Modal, PageHeader, Spinner } from "./ui";
import { IconBack, IconEdit, IconSpark, IconTrash } from "./icons";
import type { TagOption } from "./TagPicker";

export interface BookDetailData {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  issn: string | null;
  issnAddon: string | null;
  title: string;
  subtitle: string | null;
  originalTitle: string | null;
  authors: string[];
  translators: string[];
  publisher: string | null;
  pubDate: string | null;
  language: string | null;
  pageCount: number | null;
  binding: string | null;
  price: string | null;
  heightMm: number | null;
  spineMm: number | null;
  summary: string | null;
  aiSummary: string | null;
  coverUrl: string | null;
  notes: string | null;
  completeness: number;
  callNumber: string | null;
  ddc: string | null;
  ddcSource: DdcSourceValue;
  clc: string | null;
  clcSource: "rules" | "ai" | "manual" | null;
  sourceMeta: Record<string, string> | null;
  tags: { tag: { id: string; name: string; color: string } }[];
  placement: {
    confirmedByUser: boolean;
    isNearFull: boolean;
    level: { id: string; levelIndex: number; bookcase: { name: string; room: string | null } };
  } | null;
}

export function BookDetail({ book, tags }: { book: BookDetailData; tags: TagOption[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [aiState, setAiState] = useState<"idle" | "loading" | "insufficient" | "error">("idle");
  const [aiSummary, setAiSummary] = useState(book.aiSummary);
  const [error, setError] = useState<string | null>(null);
  // 这块面板管的是**中图法号**，不是 DDC。
  //
  // 这个项目从 DDC 迁到中图法之后，界面这边的名字没跟着改：变量叫 ddc、
  // 文案键在 ddc.* 命名空间下，而 `book.ddc` 又**确实存在**、是另一个字段
  // （OpenLibrary 给的杜威号，只作为参考信息显示在下面的元数据里）。
  // 于是同一个作用域里 `ddc` 指中图法、`book.ddc` 指杜威 —— 这种影子命名
  // 早晚会让人取错字段。顺带两句文案当时也是错的：
  // 书目页的分类筛选写着「杜威大类」，实际按中图法筛；
  // 详情页写着「只精确到三位」，那是杜威的位数，中图法长的是 I247.5。
  const [clc, setClc] = useState({ clc: book.clc, clcSource: book.clcSource as DdcSourceValue, callNumber: book.callNumber });
  const [ddcBusy, setDdcBusy] = useState(false);
  const [ddcInput, setDdcInput] = useState("");

  const assignDdc = async (manual?: string) => {
    setDdcBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ clc: string | null; clcSource: DdcSourceValue; callNumber: string | null }>(
        `/api/books/${book.id}/clc`,
        manual ? { clc: manual, force: true } : { force: true },
      );
      setClc({ clc: r.clc, clcSource: r.clcSource, callNumber: r.callNumber });
      setDdcInput("");
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setDdcBusy(false);
    }
  };

  const generateAi = async () => {
    setAiState("loading");
    setError(null);
    try {
      const res = await apiPost<{ status: string; aiSummary: string | null }>(
        `/api/books/${book.id}/ai-summary`,
      );
      if (res.status === "ok") {
        setAiSummary(res.aiSummary);
        setAiState("idle");
      } else {
        // 模型说不知道 —— 如实展示，不编造（F9 验收条件 2）
        setAiSummary(null);
        setAiState("insufficient");
      }
    } catch (err) {
      setAiState("error");
      setError(err instanceof ApiError ? err.code : t("ai.error"));
    }
  };

  const removeAi = async () => {
    await apiDelete(`/api/books/${book.id}/ai-summary`);
    setAiSummary(null);
    setAiState("idle");
  };

  const remove = async () => {
    if (!confirm(t("book.deleteConfirm"))) return;
    await apiDelete(`/api/books/${book.id}`);
    router.push("/books");
    router.refresh();
  };

  // [显示名, 值, sourceMeta 里的字段名] —— 第三项让"这个字段是哪个源给的"能对上号
  const facts: [string, string | null, string?][] = [
    [t("book.subtitle"), book.subtitle, "subtitle"],
    [t("book.originalTitle"), book.originalTitle, "originalTitle"],
    [t("book.translators"), book.translators.join(" / ") || null, "translators"],
    [t("book.publisher"), book.publisher, "publisher"],
    [t("book.pubDate"), book.pubDate, "pubDate"],
    [t("book.pageCount"), book.pageCount ? String(book.pageCount) : null, "pageCount"],
    [t("book.binding"), book.binding, "binding"],
    [t("book.price"), book.price, "price"],
    [t("book.isbn"), book.isbn13 ?? book.isbn10],
    ["DDC", book.ddc],
    [t("book.issn"), book.issn ? `${book.issn}${book.issnAddon ? ` +${book.issnAddon}` : ""}` : null],
    [t("book.heightMm"), book.heightMm ? `${book.heightMm} mm` : null],
    [t("book.spineMm"), book.spineMm ? `${book.spineMm} mm` : null],
  ];

  return (
    <>
      <PageHeader
        title={book.title}
        subtitle={book.authors.join(" / ") || undefined}
        actions={
          <>
            <Link href="/books" className="btn btn-ghost btn-sm">
              <IconBack className="h-4 w-4" /> {t("common.back")}
            </Link>
            <button type="button" onClick={() => setEditing(true)} className="btn btn-primary btn-sm">
              <IconEdit className="h-4 w-4" /> {t("common.edit")}
            </button>
            <button type="button" onClick={() => void remove()} className="btn btn-danger btn-sm">
              <IconTrash className="h-4 w-4" /> {t("common.delete")}
            </button>
          </>
        }
      />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <div className="card flex flex-col items-center gap-3 p-4">
            {book.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverSrc(book.coverUrl) ?? ""}
                alt={book.title}
                className="max-h-72 w-auto rounded-sm bg-surface-3 object-contain"
              />
            ) : (
              <Cover url={null} title={book.title} />
            )}
            <div className="w-full">
              <div className="mb-1 flex items-center justify-between">
                <span className="section-title">{t("book.completeness")}</span>
                <span className="mono">{book.completeness}%</span>
              </div>
              <CompletenessBar value={book.completeness} />
            </div>
          </div>

          {/* 索书号 —— 像图书馆一样，同时说清这个号有多可信 */}
          <div className="card p-4">
            <h2 className="section-title mb-2">{t("callNumber.callNumber")}</h2>
            <CallNumber
              callNumber={clc.callNumber}
              clc={clc.clc}
              source={clc.clcSource}
              size="lg"
              showSource
            />
            {clc.clc && (
              <p className="hint mt-2">{clcLabel(clc.clc, "zh")}</p>
            )}
            <p className="hint mt-2">
              {clc.clc ? t("callNumber.inferredNote") : t("callNumber.unsure")}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void assignDdc()}
                disabled={ddcBusy}
                className="btn btn-ghost btn-sm"
              >
                {ddcBusy ? <Spinner /> : null}
                {clc.clc ? t("callNumber.reassign") : t("callNumber.assign")}
              </button>
              <input
                className="field h-9 min-h-0 w-28 py-1"
                placeholder="I247.5 / TP311"
                value={ddcInput}
                onChange={(e) => setDdcInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ddcInput.trim()) {
                    e.preventDefault();
                    void assignDdc(ddcInput.trim());
                  }
                }}
                aria-label={t("callNumber.callNumber")}
              />
            </div>
            <p className="hint mt-2">{t("callNumber.precisionNote")}</p>
          </div>

          {/* 存放位置 —— F4 验收：看得到书在哪个书柜哪一层 */}
          <div className="card p-4">
            <h2 className="section-title mb-2">{t("book.placement")}</h2>
            {book.placement ? (
              <div className="flex flex-col gap-2">
                <DirectoryPath
                  size="lg"
                  info={{
                    room: book.placement.level.bookcase.room,
                    bookcaseName: book.placement.level.bookcase.name,
                    levelIndex: book.placement.level.levelIndex,
                    clc: book.clc,
                  }}
                />
                <div className="flex flex-wrap gap-1.5">
                  {book.placement.confirmedByUser && (
                    <span className="chip chip-ok">{t("common.confirm")}</span>
                  )}
                  {book.placement.isNearFull && (
                    <span className="chip chip-warn">{t("capacity.markNearFull")}</span>
                  )}
                </div>
                <button type="button" onClick={() => setPlacing(true)} className="btn btn-ghost btn-sm">
                  {t("capacity.moveHere")}
                </button>
              </div>
            ) : (
              <>
                <p className="chip chip-warn mb-2">{t("book.notPlaced")}</p>
                <button type="button" onClick={() => setPlacing(true)} className="btn btn-primary btn-sm">
                  {t("scan.placeNow")}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {book.tags.map(({ tag }) => (
                <span key={tag.id} className="chip" style={tagChipStyle(tag.color)}>
                  {tag.name}
                </span>
              ))}
              {book.tags.length === 0 && <span className="hint">{t("common.none")}</span>}
            </div>

            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {facts
                .filter(([, value]) => value)
                .map(([label, value, field]) => {
                  const source = field ? book.sourceMeta?.[field] : undefined;
                  return (
                    <div key={label} className="flex flex-col">
                      <dt className="section-title">{label}</dt>
                      <dd className="break-words">
                        {value}
                        {/* 字段来自哪个源 —— 人工核对时很重要 */}
                        {source && <span className="mono ml-2">({source})</span>}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </div>

          {/* 真实简介 */}
          {book.summary && (
            <div className="card p-4">
              <h2 className="section-title mb-2">{t("book.summary")}</h2>
              <p className="whitespace-pre-wrap text-text-muted">{book.summary}</p>
            </div>
          )}

          {/* AI 简介 —— 视觉上必须与真实简介明确区分（F9 验收条件 4） */}
          {!book.summary && (
            <div className="card border-dashed p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">{t("book.aiSummary")}</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void generateAi()}
                    disabled={aiState === "loading"}
                    className="btn btn-ghost btn-sm"
                  >
                    {aiState === "loading" ? <Spinner /> : <IconSpark className="h-4 w-4" />}
                    {aiSummary ? t("ai.regenerate") : t("ai.generate")}
                  </button>
                  {aiSummary && (
                    <button type="button" onClick={() => void removeAi()} className="btn btn-ghost btn-sm" aria-label={t("common.delete")}>
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              {aiSummary ? (
                <div className="rounded-md border border-primary/40 bg-primary-soft/30 p-3">
                  <span className="chip chip-info mb-2">
                    <IconSpark className="h-3 w-3" /> {t("ai.badge")}
                  </span>
                  <p className="whitespace-pre-wrap text-text-muted">{aiSummary}</p>
                </div>
              ) : aiState === "insufficient" ? (
                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <p className="font-black">{t("ai.insufficient")}</p>
                  <p className="hint mt-1">{t("ai.insufficientHint")}</p>
                </div>
              ) : (
                <p className="hint">{t("ai.onlyWhenEmpty")}</p>
              )}
            </div>
          )}

          {book.notes && (
            <div className="card p-4">
              <h2 className="section-title mb-2">{t("book.notes")}</h2>
              <p className="whitespace-pre-wrap text-text-muted">{book.notes}</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title={t("book.editTitle")} wide>
        <BookForm
          bookId={book.id}
          initial={toFormValues(book as unknown as Record<string, unknown>)}
          sourceMeta={book.sourceMeta ?? undefined}
          tags={tags}
          initialTagIds={book.tags.map((x) => x.tag.id)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      </Modal>

      <Modal open={placing} onClose={() => setPlacing(false)} title={t("capacity.chooseLevel")} wide>
        <ShelvingPicker
          bookId={book.id}
          onPlaced={() => {
            setPlacing(false);
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}
