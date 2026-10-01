// 逐源对比：每个数据源单独能给到多少字段。
// 用来回答"某个源到底值不值得留着"这类问题，而不是靠印象拍脑袋。
// 跑法：npm run compare:sources
import "dotenv/config";
import { doubanProvider } from "../lib/providers/douban";
import { googleBooksProvider } from "../lib/providers/googleBooks";
import { openLibraryProvider } from "../lib/providers/openLibrary";
import { parseBarcode } from "../lib/isbn";
import type { BookCandidate, MetadataProvider } from "../lib/providers/types";

const SAMPLES: { label: string; isbn: string; lang: "zh" | "en" }[] = [
  { label: "三体", isbn: "9787536692930", lang: "zh" },
  { label: "活着", isbn: "9787506365437", lang: "zh" },
  { label: "极简欧洲史", isbn: "9787559819918", lang: "zh" },
  { label: "红楼梦(下)", isbn: "9787020002207", lang: "zh" },
  { label: "明朝那些事儿", isbn: "9787801655493", lang: "zh" },
  { label: "白夜行", isbn: "9787544258609", lang: "zh" },
  { label: "人类简史(中文版)", isbn: "9787508647357", lang: "zh" },
  { label: "小王子(中文版)", isbn: "9787544253994", lang: "zh" },
  { label: "Sapiens", isbn: "9780062316097", lang: "en" },
  { label: "Crime & Punishment", isbn: "9780140449136", lang: "en" },
  { label: "Thinking Fast and Slow", isbn: "9780374533557", lang: "en" },
  { label: "The Hobbit", isbn: "9780547928227", lang: "en" },
  { label: "Educated", isbn: "9780399590504", lang: "en" },
];

// 只统计"填一本书真正要用到"的字段
const FIELDS = ["title", "authors", "publisher", "pubDate", "pageCount", "coverUrl", "summary"] as const;

const PROVIDERS: { id: string; p: MetadataProvider }[] = [
  { id: "douban", p: doubanProvider },
  { id: "googleBooks", p: googleBooksProvider },
  { id: "openLibrary", p: openLibraryProvider },
];

function filled(c: BookCandidate | undefined): string[] {
  if (!c) return [];
  return FIELDS.filter((f) => {
    const v = c[f];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
  });
}

const stats: Record<string, { hits: number; fields: number; zh: number; zhFields: number; en: number; enFields: number }> = {};
for (const { id } of PROVIDERS) stats[id] = { hits: 0, fields: 0, zh: 0, zhFields: 0, en: 0, enFields: 0 };

console.log("字段口径:", FIELDS.join(", "), `(共 ${FIELDS.length} 项)\n`);
console.log("书名".padEnd(22), PROVIDERS.map((x) => x.id.padEnd(13)).join(""));
console.log("-".repeat(64));

for (const s of SAMPLES) {
  const parsed = parseBarcode(s.isbn);
  const row: string[] = [];

  for (const { id, p } of PROVIDERS) {
    let cell = "—";
    try {
      const found = await p.byIsbn(parsed.isbn13!, parsed.isbn10);
      const f = filled(found[0]);
      if (found.length) {
        cell = `${f.length}/${FIELDS.length}`;
        stats[id].hits++;
        stats[id].fields += f.length;
        if (s.lang === "zh") { stats[id].zh++; stats[id].zhFields += f.length; }
        else { stats[id].en++; stats[id].enFields += f.length; }
      }
    } catch (err) {
      cell = "ERR:" + (err instanceof Error ? err.message.slice(0, 8) : "?");
    }
    row.push(cell.padEnd(13));
  }
  console.log(s.label.padEnd(20), row.join(""));
}

const zhTotal = SAMPLES.filter((s) => s.lang === "zh").length;
const enTotal = SAMPLES.filter((s) => s.lang === "en").length;

console.log("\n=== 汇总 ===");
for (const { id } of PROVIDERS) {
  const st = stats[id];
  console.log(
    `${id.padEnd(13)} 命中 ${st.hits}/${SAMPLES.length}  ` +
      `平均字段 ${(st.fields / Math.max(1, st.hits)).toFixed(1)}/${FIELDS.length}  |  ` +
      `中文 ${st.zh}/${zhTotal} (均 ${(st.zhFields / Math.max(1, st.zh)).toFixed(1)})  ` +
      `英文 ${st.en}/${enTotal} (均 ${(st.enFields / Math.max(1, st.en)).toFixed(1)})`,
  );
}
