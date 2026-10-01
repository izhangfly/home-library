// 在服务器上直接生成一份整库 JSON —— 给每晚的备份用
//
// 为什么不是 curl /api/export：那条路现在要管理员登录（导出内容包含户型图
// 和全部藏书，不该对公网开放），而 cron 里没有会话。直接连库更简单也更可靠。
//
// 为什么二进制 dump 之外还要一份 JSON：
// `.dump` 只有 pg_restore 打得开，而且要对得上 PostgreSQL 大版本。
// 实测这台 Mac（异地副本的落点）**根本没装 Postgres** ——
// 也就是说那份"保命的副本"，用户自己一个字都读不出来。
// JSON 谁都打得开，十年后也打得开。
import { writeFileSync } from "node:fs";
import { buildExport } from "../lib/export.ts";

const out = process.argv[2];
if (!out) {
  console.error("用法: tsx scripts/export-json.mts <输出路径>");
  process.exit(1);
}

const payload = await buildExport();
writeFileSync(out, JSON.stringify(payload, null, 2));
const c = payload.counts;
console.log(`  ✓ JSON 导出 ${out}`);
console.log(`    ${c.books} 书 / ${c.bookcases} 柜 / ${c.levels} 层 / ${c.rooms} 房 / ${c.placements} 上架`);
process.exit(0);
