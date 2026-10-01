// spec 阶段 2 的验收：拿真实 ISBN 打一遍所有数据源，看谁能查到、要不要人工补录。
// 这个脚本的输出直接对应 spec §7 的主指标（中文书零手动补录的比例）。
// 跑法：npm run smoke:sources
import "dotenv/config";
import { parseBarcode } from "../lib/isbn";
import { lookupByIsbn } from "../lib/providers";

const SAMPLES: { label: string; code: string }[] = [
  { label: "中文 · 你一定爱读的极简欧洲史", code: "9787559819918" },
  { label: "中文 · 三体", code: "9787536692930" },
  { label: "中文 · 活着", code: "9787506365437" },
  { label: "英文 · Crime and Punishment", code: "9780140449136" },
  { label: "英文 · Sapiens", code: "9780062316097" },
  { label: "期刊 ISSN 条码（应识别为 ISSN，不当 ISBN 查）", code: "9771234567003" },
];

const FIELDS = ["title", "authors", "publisher", "pubDate", "pageCount", "coverUrl", "summary"] as const;

for (const sample of SAMPLES) {
  const parsed = parseBarcode(sample.code);
  console.log(`\n=== ${sample.label}`);
  console.log(`    条码类型: ${parsed.kind}  有效: ${parsed.valid}${parsed.reason ? ` (${parsed.reason})` : ""}`);

  if (parsed.kind !== "isbn" || !parsed.isbn13) {
    console.log("    → 不走联网查询，直接手动录入");
    continue;
  }

  const started = Date.now();
  const result = await lookupByIsbn(parsed.isbn13, parsed.isbn10);
  const ms = Date.now() - started;

  for (const r of result.results) {
    const state = !r.ok ? `失败 (${r.error})` : r.candidates.length ? "命中" : "无记录";
    console.log(`    ${r.source.padEnd(12)} ${state.padEnd(24)} ${r.ms}ms`);
  }

  const filled = FIELDS.filter((f) => {
    const v = result.merged[f];
    return Array.isArray(v) ? v.length > 0 : v != null && v !== "";
  });
  console.log(`    合并结果: ${filled.length}/${FIELDS.length} 字段  [${filled.join(", ")}]`);
  console.log(`    标题: ${result.merged.title ?? "—"}`);
  if (result.conflicts.length) {
    console.log(`    冲突字段: ${result.conflicts.map((c) => c.field).join(", ")}`);
  }
  console.log(`    总耗时 ${ms}ms  ${result.empty ? "→ 需要手动录入" : "→ 可自动入库"}`);
}
