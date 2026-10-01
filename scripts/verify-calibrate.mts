// 书脊系数自校准的测试 —— 见 lib/calibrate.ts
//
// 这段代码的危险之处在于：它会把拟合出来的系数推到**全库**去。
// 拟合错一次，每一层的装填率、每一次"放得下吗"、整个上架算法都跟着错。
// 所以测试的重点不是"能不能拟合"，而是**什么时候必须拒绝拟合**。
//
// 跑法：npm run verify:calibrate

import { readFileSync } from "node:fs";
import { calibrate, type CalibrationSample } from "../lib/calibrate";
import { DEFAULT_COEFFICIENTS } from "../lib/capacity";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
}

/** 造一层书，并按「真实」系数算出用户会量到的宽度（可加噪声，模拟卷尺读数） */
function makeLevel(
  id: string, n: number, truth: { mmPerPage: number; base: number },
  seed: number, noiseMm = 0, hardcoverRate = 0.2,
): CalibrationSample {
  const r = rng(seed);
  const books = Array.from({ length: n }, () => ({
    pageCount: 120 + Math.floor(r() * 600),
    binding: r() < hardcoverRate ? "精装" : "平装",
  }));
  const exact = books.reduce(
    (s, b) => s + b.pageCount * truth.mmPerPage + truth.base * (b.binding === "精装" ? 2 : 1), 0);
  const noise = noiseMm ? (r() - 0.5) * 2 * noiseMm : 0;
  return { levelId: id, measuredMm: Math.round(exact + noise), books };
}

console.log("\n=== 书脊系数自校准 ===\n");

console.log("A 干净数据要能把真实系数找回来");
{
  const truth = { mmPerPage: 0.062, base: 4 };
  const samples = [
    makeLevel("L1", 30, truth, 1),
    makeLevel("L2", 25, truth, 2),
    makeLevel("L3", 35, truth, 3),
  ];
  const r = calibrate(samples);
  console.log(`    真实 0.0620 / 4.0  →  拟合 ${r.mmPerPage.toFixed(4)} / ${r.basePaperbackMm}`);
  check("A · 状态 ok", r.status === "ok", r.status);
  check("A · mmPerPage 误差 < 3%",
    Math.abs(r.mmPerPage - truth.mmPerPage) / truth.mmPerPage < 0.03,
    `${r.mmPerPage}`);
  check("A · base 误差 < 1mm", Math.abs(r.basePaperbackMm - truth.base) < 1, `${r.basePaperbackMm}`);
  check("A · 精装底厚保持平装的两倍", Math.abs(r.baseHardcoverMm - r.basePaperbackMm * 2) < 0.2);
}

console.log("\nB 带卷尺误差也要稳（人量不到毫米级）");
{
  const truth = { mmPerPage: 0.058, base: 3.5 };
  const samples = [1,2,3,4,5].map((i) => makeLevel(`L${i}`, 28, truth, i, 8));
  const r = calibrate(samples);
  console.log(`    每层 ±8mm 噪声  →  拟合 ${r.mmPerPage.toFixed(4)} / ${r.basePaperbackMm}，残差 ${r.residualMm}mm`);
  check("B · 仍然 ok", r.status === "ok", r.status);
  check("B · mmPerPage 误差 < 8%",
    Math.abs(r.mmPerPage - truth.mmPerPage) / truth.mmPerPage < 0.08, `${r.mmPerPage}`);
  check("B · 残差比默认系数小（校准确实有改善）",
    r.residualMm < r.baselineResidualMm, `${r.residualMm} vs ${r.baselineResidualMm}`);
}

console.log("\nC 数据不够时必须拒绝，而不是硬拟合");
{
  const truth = { mmPerPage: 0.06, base: 4 };
  const one = calibrate([makeLevel("L1", 30, truth, 9)]);
  check("C · 只量了一层 → not_enough_data", one.status === "not_enough_data", one.status);
  check("C · 拒绝时原样返回当前系数", one.mmPerPage === DEFAULT_COEFFICIENTS.mmPerPage);

  const few = calibrate([makeLevel("L1", 3, truth, 10), makeLevel("L2", 4, truth, 11)]);
  check("C · 两层但只有 7 本 → not_enough_data", few.status === "not_enough_data", few.status);

  const empty = calibrate([]);
  check("C · 一个样本都没有 → not_enough_data", empty.status === "not_enough_data");
}

console.log("\nD 量错了必须拒绝 —— 这是最危险的一条");
{
  const truth = { mmPerPage: 0.06, base: 4 };
  // 用户把 760mm 记成了 76mm（少写一个零）
  const s = [makeLevel("L1", 30, truth, 12), makeLevel("L2", 28, truth, 13)];
  s[0].measuredMm = Math.round(s[0].measuredMm / 10);
  const r = calibrate(s);
  console.log(`    有一层少记一个零  →  状态 ${r.status}`);
  check("D · 判为 implausible", r.status === "implausible", r.status);
  check("D · 绝不把荒唐系数推到全库（保留原值）",
    r.mmPerPage === DEFAULT_COEFFICIENTS.mmPerPage && r.basePaperbackMm === DEFAULT_COEFFICIENTS.basePaperbackMm);
  check("D · 说清楚为什么被拒", !!r.note);
}
{
  // 这层混进了一堆非书的东西（相框、盒子），量出来远超书的总厚
  const truth = { mmPerPage: 0.06, base: 4 };
  const s = [makeLevel("L1", 30, truth, 14), makeLevel("L2", 26, truth, 15)];
  s[1].measuredMm += 600;
  const r = calibrate(s);
  check("D · 层里混了非书物件也被拒", r.status === "implausible", `${r.status} ${r.mmPerPage}`);
}

console.log("\nE 已经量过的书不参与拟合，但要从总宽里扣掉");
{
  const truth = { mmPerPage: 0.06, base: 4 };
  const a = makeLevel("L1", 30, truth, 16);
  const b = makeLevel("L2", 28, truth, 17);
  // 往其中一层塞一本"已量过"的厚书：宽度加上去，但它不该影响系数
  a.books.push({ spineMm: 45 });
  a.measuredMm += 45;
  const r = calibrate([a, b]);
  console.log(`    含一本已量过的书  →  拟合 ${r.mmPerPage.toFixed(4)} / ${r.basePaperbackMm}`);
  check("E · 系数不被已量过的书带偏",
    r.status === "ok" && Math.abs(r.mmPerPage - truth.mmPerPage) / truth.mmPerPage < 0.05,
    `${r.mmPerPage}`);
}

console.log("\nF 确定性");
{
  const truth = { mmPerPage: 0.061, base: 3.8 };
  const s = [1,2,3].map((i) => makeLevel(`L${i}`, 30, truth, i * 7, 5));
  const a = calibrate(s), b = calibrate(s);
  check("F · 同样输入两次结果完全一致", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n敏感度：这个系数值多少钱");
// 量化一下"没校准"到底意味着什么，免得以后有人拿这些数字当精确值用。
// 线上那 6 本书一本都没量过脊厚，全靠页数推。
{
  const pages = [755, 464, 300, 304, 239, 191];
  const width = (mmPerPage: number) =>
    pages.reduce((s2, p2) => s2 + (p2 * mmPerPage + DEFAULT_COEFFICIENTS.basePaperbackMm), 0) / pages.length;
  const low = Math.floor(990 / width(0.046));
  const high = Math.floor(990 / width(0.070));
  console.log(`  · 一米的层：mmPerPage=0.046 时放 ${low} 本，=0.070 时放 ${high} 本`);
  check("默认系数落在常见纸张的范围内",
    DEFAULT_COEFFICIENTS.mmPerPage >= 0.04 && DEFAULT_COEFFICIENTS.mmPerPage <= 0.08,
    String(DEFAULT_COEFFICIENTS.mmPerPage));
  // 差这么多，界面就不能给一个听起来很准的数。
  check("纸张不确定性确实大到需要在界面上讲出来", low / high >= 1.3,
    `${low} vs ${high}，只差 ${((low / high - 1) * 100).toFixed(0)}%`);
  const zh = JSON.parse(readFileSync("messages/zh.json", "utf8"));
  check("没量过脊厚时给的是区间而不是单个数",
    /\{count\}[–-]\{upper\}/.test(zh.setup.shelfFullRough.what),
    zh.setup.shelfFullRough?.what ?? "（缺 shelfFullRough）");
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
