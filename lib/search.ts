// 检索索引 —— F4
//
// Postgres 的中文分词要装扩展，家庭规模（几百到几千本）没必要。
// 这里在写入时把「原文 + 全拼 + 拼音首字母」拍平成一个字符串，
// 查询时对这个字段做 contains，就能同时支持：
//   "三国"      → 原文匹配
//   "sanguo"    → 全拼匹配
//   "sgyy"      → 首字母匹配
import { pinyin } from "pinyin-pro";

const HAS_CJK = /[一-鿿]/;

function pinyinVariants(text: string): string[] {
  if (!HAS_CJK.test(text)) return [];
  const full = pinyin(text, { toneType: "none", type: "array", nonZh: "removed" })
    .join("")
    .toLowerCase();
  const initials = pinyin(text, {
    pattern: "first",
    toneType: "none",
    type: "array",
    nonZh: "removed",
  })
    .join("")
    .toLowerCase();
  return [full, initials].filter(Boolean);
}

export interface IndexableBook {
  title: string;
  subtitle?: string | null;
  originalTitle?: string | null;
  authors?: string[];
  translators?: string[];
  publisher?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  issn?: string | null;
}

export function buildSearchIndex(book: IndexableBook): string {
  const literals = [
    book.title,
    book.subtitle,
    book.originalTitle,
    ...(book.authors ?? []),
    ...(book.translators ?? []),
    book.publisher,
    book.isbn13,
    book.isbn10,
    book.issn,
  ].filter((v): v is string => !!v);

  const parts = new Set<string>();
  for (const value of literals) {
    parts.add(value.toLowerCase());
    for (const variant of pinyinVariants(value)) parts.add(variant);
  }
  return Array.from(parts).join(" ");
}

/** 查询串拆词；中文词也生成拼音变体，这样索引里存的是拼音也能命中 */
export function searchTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    terms.add(token);
  }
  return Array.from(terms);
}
