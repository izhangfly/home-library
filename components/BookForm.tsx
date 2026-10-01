"use client";

// 图书表单 —— 扫码确认、手动录入、编辑三处共用。
// 多源冲突直接内联在对应字段下方（spec F1 验收条件 2），
// 这样用户是在"看着这个字段"的语境下做选择，而不是先在一个抽象的对话框里选完再看表单。

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiPatch, apiPost, uploadFile, ApiError } from "@/lib/client";
import { TagPicker, type TagOption, type TagSuggestion } from "./TagPicker";
import { Cover } from "./BookRow";
import { ErrorBanner, Labeled, Spinner } from "./ui";
import { IconCamera, IconTrash } from "./icons";

export interface FieldConflict {
  field: string;
  options: { source: string; value: unknown }[];
}

export interface BookFormValues {
  title: string;
  subtitle: string;
  originalTitle: string;
  authors: string;
  translators: string;
  publisher: string;
  pubDate: string;
  language: string;
  pageCount: string;
  binding: string;
  price: string;
  isbn13: string;
  isbn10: string;
  issn: string;
  issnAddon: string;
  heightMm: string;
  spineMm: string;
  summary: string;
  notes: string;
  coverUrl: string;
}

const EMPTY: BookFormValues = {
  title: "", subtitle: "", originalTitle: "", authors: "", translators: "",
  publisher: "", pubDate: "", language: "", pageCount: "", binding: "", price: "",
  isbn13: "", isbn10: "", issn: "", issnAddon: "", heightMm: "", spineMm: "",
  summary: "", notes: "", coverUrl: "",
};

function stringify(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export function toFormValues(source: Record<string, unknown> = {}): BookFormValues {
  const out = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as (keyof BookFormValues)[]) {
    if (source[key] != null) out[key] = stringify(source[key]);
  }
  return out;
}

const splitList = (raw: string) =>
  raw.split(/[,，;；/]/).map((s) => s.trim()).filter(Boolean);

const toInt = (raw: string) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toFloat = (raw: string) => {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function buildPayload(values: BookFormValues, tagIds: string[], sourceMeta?: Record<string, string>) {
  return {
    title: values.title.trim(),
    subtitle: values.subtitle || null,
    originalTitle: values.originalTitle || null,
    authors: splitList(values.authors),
    translators: splitList(values.translators),
    publisher: values.publisher || null,
    pubDate: values.pubDate || null,
    language: values.language || null,
    pageCount: toInt(values.pageCount),
    binding: values.binding || null,
    price: values.price || null,
    isbn13: values.isbn13 || null,
    isbn10: values.isbn10 || null,
    issn: values.issn || null,
    issnAddon: values.issnAddon || null,
    heightMm: toInt(values.heightMm),
    spineMm: toFloat(values.spineMm),
    summary: values.summary || null,
    notes: values.notes || null,
    coverUrl: values.coverUrl || null,
    sourceMeta: sourceMeta ?? undefined,
    tagIds,
  };
}

export function BookForm({
  bookId,
  initial,
  conflicts,
  sourceMeta,
  tags,
  initialTagIds = [],
  tagSuggestions,
  onSaved,
  submitLabel,
  compact,
}: {
  bookId?: string;
  initial?: Partial<BookFormValues>;
  conflicts?: FieldConflict[];
  sourceMeta?: Record<string, string>;
  tags: TagOption[];
  initialTagIds?: string[];
  tagSuggestions?: TagSuggestion[];
  onSaved?: (book: { id: string; title: string }) => void;
  submitLabel?: string;
  /** 扫码流程里嵌用时收起次要字段，减少每本书的操作步数 */
  compact?: boolean;
}) {
  const t = useTranslations();
  const fileRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<BookFormValues>({ ...EMPTY, ...initial });
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [tagOptions, setTagOptions] = useState<TagOption[]>(tags);
  const [meta, setMeta] = useState<Record<string, string>>(sourceMeta ?? {});
  const [showAll, setShowAll] = useState(!compact);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflictMap = useMemo(() => {
    const map = new Map<string, FieldConflict>();
    for (const c of conflicts ?? []) map.set(c.field, c);
    return map;
  }, [conflicts]);

  const set = (key: keyof BookFormValues, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  // 用户手动改过的字段，来源标记为"手动填写"
  const setManual = (key: keyof BookFormValues, value: string) => {
    set(key, value);
    setMeta((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const pickConflict = (field: keyof BookFormValues, source: string, value: unknown) => {
    set(field, stringify(value));
    setMeta((prev) => ({ ...prev, [field]: source }));
  };

  const onPickCover = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadFile(file);
      set("coverUrl", url);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : t("errors.saveFailed"));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.title.trim()) {
      setError(t("errors.titleRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPayload(values, tagIds, Object.keys(meta).length ? meta : undefined);
      const { book } = bookId
        ? await apiPatch<{ book: { id: string; title: string } }>(`/api/books/${bookId}`, payload)
        : await apiPost<{ book: { id: string; title: string } }>("/api/books", payload);
      onSaved?.(book);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "internal_error"
          ? t("book.duplicateIsbn")
          : t("errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const Field = ({
    name,
    label,
    hint,
    type = "text",
    placeholder,
  }: {
    name: keyof BookFormValues;
    label: string;
    hint?: string;
    type?: string;
    placeholder?: string;
  }) => {
    const conflict = conflictMap.get(name);
    return (
      <Labeled label={label} hint={hint} htmlFor={`f-${name}`}>
        <input
          id={`f-${name}`}
          type={type}
          inputMode={type === "number" ? "numeric" : undefined}
          className="field"
          value={values[name]}
          placeholder={placeholder}
          onChange={(e) => setManual(name, e.target.value)}
        />
        {meta[name] && (
          <p className="mono mt-1">
            {t("common.source")}: {meta[name]}
          </p>
        )}
        {conflict && (
          <div className="mt-2 rounded-sm border border-warning/50 bg-warning-soft p-2">
            <p className="mb-1.5 text-2xs font-black text-warning">{t("scan.conflictTitle")}</p>
            <div className="flex flex-wrap gap-1.5">
              {conflict.options.map((opt) => (
                <button
                  key={opt.source}
                  type="button"
                  onClick={() => pickConflict(name, opt.source, opt.value)}
                  className={`chip ${
                    stringify(opt.value) === values[name] ? "chip-ok" : ""
                  }`}
                  title={stringify(opt.value)}
                >
                  <span className="max-w-[14rem] truncate">
                    {opt.source}: {stringify(opt.value) || t("common.none")}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Labeled>
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} />}

      {/* 封面 —— 查不到数据时"拍个封面"是最快的录入方式 */}
      <div className="flex items-start gap-4">
        <Cover url={values.coverUrl || null} title={values.title || "?"} />
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickCover(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="btn btn-ghost btn-sm"
          >
            {uploading ? <Spinner /> : <IconCamera className="h-4 w-4" />}
            {t("book.takeCoverPhoto")}
          </button>
          {values.coverUrl && (
            <button
              type="button"
              onClick={() => set("coverUrl", "")}
              className="btn btn-ghost btn-sm"
            >
              <IconTrash className="h-4 w-4" /> {t("book.removeCover")}
            </button>
          )}
        </div>
      </div>

      <Field name="title" label={`${t("book.title")} *`} />
      <Field name="authors" label={t("book.authors")} placeholder={t("book.authorsPlaceholder")} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="publisher" label={t("book.publisher")} />
        <Field name="pubDate" label={t("book.pubDate")} placeholder="2019-09" />
      </div>

      <Labeled label={t("book.tags")}>
        <TagPicker
          tags={tagOptions}
          selected={tagIds}
          onChange={setTagIds}
          suggestions={tagSuggestions}
          onTagCreated={(tag) => setTagOptions((prev) => [...prev, tag])}
        />
      </Labeled>

      {!showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="btn btn-ghost btn-sm self-start">
          {t("common.more")}
        </button>
      )}

      {showAll && (
        <>
          <Field name="subtitle" label={t("book.subtitle")} />
          <Field name="originalTitle" label={t("book.originalTitle")} />
          <Field name="translators" label={t("book.translators")} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Labeled label={t("book.language")} htmlFor="f-language">
              <select
                id="f-language"
                className="field"
                value={values.language}
                onChange={(e) => setManual("language", e.target.value)}
              >
                <option value="">{t("common.unknown")}</option>
                <option value="zh">{t("book.languageZh")}</option>
                <option value="en">{t("book.languageEn")}</option>
                <option value="ru">{t("book.languageRu")}</option>
                <option value="other">{t("book.languageOther")}</option>
              </select>
            </Labeled>

            <Labeled label={t("book.binding")} htmlFor="f-binding">
              <select
                id="f-binding"
                className="field"
                value={values.binding}
                onChange={(e) => setManual("binding", e.target.value)}
              >
                <option value="">{t("common.unknown")}</option>
                <option value="平装">{t("book.bindingPaperback")}</option>
                <option value="精装">{t("book.bindingHardcover")}</option>
                <option value="期刊">{t("book.bindingPeriodical")}</option>
              </select>
            </Labeled>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field name="pageCount" label={t("book.pageCount")} type="number" />
            <Field name="heightMm" label={t("book.heightMm")} type="number" />
            <Field name="spineMm" label={t("book.spineMm")} hint={t("book.spineHint")} type="number" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="isbn13" label={t("book.isbn")} />
            <Field name="price" label={t("book.price")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="issn" label={t("book.issn")} />
            <Field name="issnAddon" label={t("book.issnAddon")} />
          </div>

          <Labeled label={t("book.summary")} htmlFor="f-summary">
            <textarea
              id="f-summary"
              className="field min-h-28"
              value={values.summary}
              onChange={(e) => setManual("summary", e.target.value)}
            />
          </Labeled>

          <Labeled label={t("book.notes")} htmlFor="f-notes">
            <textarea
              id="f-notes"
              className="field min-h-20"
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Labeled>
        </>
      )}

      <button type="submit" disabled={saving} className="btn btn-primary">
        {saving ? <Spinner /> : null}
        {submitLabel ?? t("common.save")}
      </button>
    </form>
  );
}
