// 封面质量对比：光看"有没有 coverUrl"是不够的 ——
// Google Books 给的常是 128px 缩略图，OpenLibrary 偶尔返回 1x1 空白占位图。
// 这个脚本把每个源的封面真的抓下来量尺寸，才知道哪个源的封面能用。
// 跑法：npm run compare:covers
import "dotenv/config";
import sharp from "sharp";
import { doubanProvider } from "../lib/providers/douban";
import { googleBooksProvider } from "../lib/providers/googleBooks";
import { openLibraryProvider } from "../lib/providers/openLibrary";
import { parseBarcode } from "../lib/isbn";
import type { MetadataProvider } from "../lib/providers/types";

const SAMPLES: { label: string; isbn: string; lang: "zh" | "en" }[] = [
  { label: "三体", isbn: "9787536692930", lang: "zh" },
  { label: "活着", isbn: "9787506365437", lang: "zh" },
  { label: "极简欧洲史", isbn: "9787559819918", lang: "zh" },
  { label: "红楼梦(下)", isbn: "9787020002207", lang: "zh" },
  { label: "明朝那些事儿", isbn: "9787801655493", lang: "zh" },
  { label: "白夜行", isbn: "9787544258609", lang: "zh" },
  { label: "人类简史(中文)", isbn: "9787508647357", lang: "zh" },
  { label: "小王子(中文)", isbn: "9787544253994", lang: "zh" },
  { label: "Sapiens", isbn: "9780062316097", lang: "en" },
  { label: "Crime & Punishment", isbn: "9780140449136", lang: "en" },
  { label: "Thinking Fast/Slow", isbn: "9780374533557", lang: "en" },
  { label: "The Hobbit", isbn: "9780547928227", lang: "en" },
  { label: "Educated", isbn: "9780399590504", lang: "en" },
];

const PROVIDERS: { id: string; p: MetadataProvider }[] = [
  { id: "douban", p: doubanProvider },
  { id: "googleBooks", p: googleBooksProvider },
  { id: "openLibrary", p: openLibraryProvider },
];

/** 宽度 < 200px 或体积 < 3KB 基本就是缩略图/占位图，列表页尚可，详情页糊 */
const USABLE_WIDTH = 200;

interface Shot { ok: boolean; width?: number; height?: number; bytes?: number; note?: string }

async function probe(url: string | undefined): Promise<Shot> {
  if (!url) return { ok: false, note: "无封面" };
  try {
    const res = await fetch(url, {
      headers: {
        Referer: url.includes("doubanio") ? "https://book.douban.com/" : new URL(url).origin,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    return { ok: true, width: meta.width, height: meta.height, bytes: buf.length };
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.name : "err" };
  }
}

function cell(s: Shot): string {
  if (!s.ok) return (s.note ?? "—").padEnd(16);
  const usable = (s.width ?? 0) >= USABLE_WIDTH;
  return `${s.width}x${s.height} ${(s.bytes! / 1024).toFixed(0)}K${usable ? "" : " ⚠小"}`.padEnd(16);
}

const stats: Record<string, { has: number; usable: number; widths: number[] }> = {};
for (const { id } of PROVIDERS) stats[id] = { has: 0, usable: 0, widths: [] };

console.log("书名".padEnd(20), PROVIDERS.map((x) => x.id.padEnd(16)).join(""));
console.log("-".repeat(74));

for (const s of SAMPLES) {
  const parsed = parseBarcode(s.isbn);
  const row: string[] = [];
  for (const { id, p } of PROVIDERS) {
    let shot: Shot = { ok: false, note: "无记录" };
    try {
      const found = await p.byIsbn(parsed.isbn13!, parsed.isbn10);
      shot = await probe(found[0]?.coverUrl);
    } catch {
      shot = { ok: false, note: "源失败" };
    }
    if (shot.ok) {
      stats[id].has++;
      stats[id].widths.push(shot.width ?? 0);
      if ((shot.width ?? 0) >= USABLE_WIDTH) stats[id].usable++;
    }
    row.push(cell(shot));
  }
  console.log(s.label.padEnd(18), row.join(""));
}

console.log(`\n=== 汇总（共 ${SAMPLES.length} 本，可用 = 宽度 ≥ ${USABLE_WIDTH}px）===`);
for (const { id } of PROVIDERS) {
  const st = stats[id];
  const avg = st.widths.length ? Math.round(st.widths.reduce((a, b) => a + b, 0) / st.widths.length) : 0;
  console.log(`${id.padEnd(13)} 有图 ${st.has}/${SAMPLES.length}   可用 ${st.usable}/${SAMPLES.length}   平均宽度 ${avg}px`);
}
