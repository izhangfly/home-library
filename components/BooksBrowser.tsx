"use client";

// F4 —— 检索与高级筛选
// 搜索走服务端的 searchIndex（原文 + 全拼 + 首字母），所以"sanguo"和"sgyy"都能命中。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CLC_CLASSES } from "@/lib/clc";
import { apiGet } from "@/lib/client";
import { tagChipStyle } from "@/lib/contrast";
import { CallNumber } from "./CallNumber";
import { DirectoryPath } from "./DirectoryPath";
import { Cover } from "./BookRow";
import { EmptyState, LoadFailed, PageHeader, Spinner } from "./ui";
import { IconPlus, IconScan, IconSearch } from "./icons";
import type { TagOption } from "./TagPicker";

interface BookResult {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  language: string | null;
  completeness: number;
  callNumber: string | null;
  ddc: string | null;
  clc: string | null;
  clcSource: string | null;
  tags: { tag: { id: string; name: string; color: string } }[];
  placement: { level: { levelIndex: number; bookcase: { name: string; room: string | null } } } | null;
}

/** 一页取多少本。太小翻不动，太大手机上一次要下几 MB */
const PAGE_SIZE = 100;

export function BooksBrowser({ tags }: { tags: TagOption[] }) {
  const t = useTranslations();
  const locale = useLocale();
  const [q, setQ] = useState("");
  const [tagId, setTagId] = useState("");
  const [language, setLanguage] = useState("");
  const [shelved, setShelved] = useState("");
  const [clcClass, setClcClass] = useState("");
  const [sort, setSort] = useState("recent");
  const [books, setBooks] = useState<BookResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const query = useCallback((skip: number) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (tagId) params.set("tagId", tagId);
    if (language) params.set("language", language);
    if (shelved) params.set("shelved", shelved);
    if (clcClass) params.set("clcClass", clcClass);
    if (sort) params.set("sort", sort);
    params.set("limit", String(PAGE_SIZE));
    if (skip) params.set("skip", String(skip));
    return apiGet<{ books: BookResult[]; total: number }>(`/api/books?${params.toString()}`);
  }, [q, tagId, language, shelved, clcClass, sort]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const data = await query(0);
      setBooks(data.books);
      setTotal(data.total);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  /** 接着往后取一页。书越攒越多时，这是唯一能看到第 200 本之后的路。 */
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await query(books.length);
      setBooks((prev) => [...prev, ...data.books]);
      setTotal(data.total);
    } finally {
      setLoadingMore(false);
    }
  };

  // 输入时防抖，避免每敲一个字就打一次库
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const hasFilters = !!(q || tagId || language || shelved || clcClass);

  return (
    <>
      <PageHeader
        title={t("books.title")}
        actions={
          <>
            <Link href="/scan" className="btn btn-primary btn-sm">
              <IconScan className="h-4 w-4" /> {t("nav.scan")}
            </Link>
            <Link href="/books/new" className="btn btn-ghost btn-sm">
              <IconPlus className="h-4 w-4" /> {t("common.add")}
            </Link>
          </>
        }
      />

      <div className="card mb-4 flex flex-col gap-3 p-3">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            className="field pl-9"
            placeholder={t("books.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            type="search"
            aria-label={t("common.search")}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className="field" value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label={t("books.filterTag")}>
            <option value="">{t("books.filterTag")}: {t("common.all")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>

          <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t("books.filterLanguage")}>
            <option value="">{t("books.filterLanguage")}: {t("common.all")}</option>
            <option value="zh">{t("book.languageZh")}</option>
            <option value="en">{t("book.languageEn")}</option>
            <option value="ru">{t("book.languageRu")}</option>
            <option value="other">{t("book.languageOther")}</option>
          </select>

          <select className="field" value={shelved} onChange={(e) => setShelved(e.target.value)} aria-label={t("books.filterShelved")}>
            <option value="">{t("books.filterShelved")}: {t("common.all")}</option>
            <option value="yes">{t("books.shelvedYes")}</option>
            <option value="no">{t("books.shelvedNo")}</option>
          </select>

          <select className="field" value={clcClass} onChange={(e) => setClcClass(e.target.value)} aria-label={t("callNumber.filterClass")}>
            <option value="">{t("callNumber.filterClass")}: {t("common.all")}</option>
            {CLC_CLASSES.map((c) => (
              <option key={c.code} value={c.code}>{c.code} {locale === "en" ? c.en : c.zh}</option>
            ))}
          </select>

          <select className="field" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("books.sortBy")}>
            <option value="recent">{t("books.sortRecent")}</option>
            <option value="call">{t("books.sortCall")}</option>
            <option value="title">{t("books.sortTitle")}</option>
            <option value="completeness">{t("books.sortCompleteness")}</option>
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="mono">
            {loading ? <Spinner className="h-3 w-3" />
              : books.length < total
                ? t("books.resultCountPaged", { shown: books.length, count: total })
                : t("books.resultCount", { count: total })}
          </span>
          {hasFilters && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setQ(""); setTagId(""); setLanguage(""); setShelved(""); setClcClass("");
              }}
            >
              {t("books.clearFilters")}
            </button>
          )}
        </div>
      </div>

      {failed ? (
        <LoadFailed onRetry={() => void load()} />
      ) : !loading && books.length === 0 ? (
        <EmptyState title={t("books.noResults")} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {books.map((book) => (
            <li key={book.id}>
              <Link
                href={`/books/${book.id}`}
                className="card-flat flex h-full items-center gap-3 p-3 transition-all hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--color-border)]"
              >
                <Cover url={book.coverUrl} title={book.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-black">{book.title}</p>
                  <p className="hint truncate">
                    {book.authors.length ? book.authors.join(" / ") : t("common.unknown")}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <CallNumber callNumber={book.callNumber} clc={book.clc} />
                    {book.tags.slice(0, 2).map(({ tag }) => (
                      <span key={tag.id} className="chip" style={tagChipStyle(tag.color)}>
                        {tag.name}
                      </span>
                    ))}
                    {/* 完整目录路径：房间 › 书柜 › 层 */}
                    <DirectoryPath
                      info={{
                        room: book.placement?.level.bookcase.room,
                        bookcaseName: book.placement?.level.bookcase.name,
                        levelIndex: book.placement?.level.levelIndex,
                        clc: book.clc,
                      }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && books.length < total && (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore}
            className="btn btn-ghost">
            {loadingMore ? <Spinner /> : null}
            {t("books.loadMore", { count: total - books.length })}
          </button>
        </div>
      )}
    </>
  );
}
