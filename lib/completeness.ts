// 元数据完整度打分 —— 借鉴 qa-catalogue 的思路，但砍到家庭规模够用的程度（spec §2）
//
// 目的不是给书打分，是让「哪些书需要人工补录」一眼可见。

export interface ScorableBook {
  title?: string | null;
  authors?: string[];
  publisher?: string | null;
  pubDate?: string | null;
  language?: string | null;
  pageCount?: number | null;
  coverUrl?: string | null;
  summary?: string | null;
  isbn13?: string | null;
  issn?: string | null;
  heightMm?: number | null;
  spineMm?: number | null;
  tagCount?: number;
  hasConfirmedPlacement?: boolean;
  ddc?: string | null;
}

interface Rule {
  key: string;
  weight: number;
  filled: (b: ScorableBook) => boolean;
}

const RULES: Rule[] = [
  { key: "title", weight: 15, filled: (b) => !!b.title?.trim() },
  { key: "authors", weight: 12, filled: (b) => (b.authors?.length ?? 0) > 0 },
  { key: "identifier", weight: 10, filled: (b) => !!(b.isbn13 || b.issn) },
  { key: "publisher", weight: 8, filled: (b) => !!b.publisher?.trim() },
  { key: "pubDate", weight: 7, filled: (b) => !!b.pubDate?.trim() },
  { key: "language", weight: 5, filled: (b) => !!b.language?.trim() },
  { key: "pageCount", weight: 8, filled: (b) => (b.pageCount ?? 0) > 0 },
  { key: "cover", weight: 12, filled: (b) => !!b.coverUrl?.trim() },
  { key: "summary", weight: 5, filled: (b) => !!b.summary?.trim() },
  { key: "tags", weight: 8, filled: (b) => (b.tagCount ?? 0) > 0 },
  { key: "placement", weight: 10, filled: (b) => !!b.hasConfirmedPlacement },
  { key: "callNumber", weight: 6, filled: (b) => !!b.ddc },
];

const TOTAL = RULES.reduce((sum, r) => sum + r.weight, 0);

export function scoreCompleteness(book: ScorableBook): number {
  const earned = RULES.reduce((sum, r) => (r.filled(book) ? sum + r.weight : sum), 0);
  return Math.round((earned / TOTAL) * 100);
}

/** 缺哪些字段 —— 前端用来渲染「待补录」清单 */
export function missingFields(book: ScorableBook): string[] {
  return RULES.filter((r) => !r.filled(book)).map((r) => r.key);
}
