// spec 阶段 7：中英文案全量检查。
// 1. 比对两个语言包的 key 集合，任一边缺失就非零退出
// 2. 扫一遍源码，找出**没人用**的 key —— 重构会把界面上的文案孤立掉，
//    语言包只会越长越大，而且孤儿 key 会让人误以为某个功能还在
// 跑法：npm run check:i18n
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import zh from "../messages/zh.json" with { type: "json" };
import en from "../messages/en.json" with { type: "json" };

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : flatten(value, path);
  });
}

const zhKeys = new Set(flatten(zh as Tree));
const enKeys = new Set(flatten(en as Tree));

const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k)).sort();
const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k)).sort();

console.log(`zh: ${zhKeys.size} keys, en: ${enKeys.size} keys`);

if (missingInEn.length) {
  console.log(`\n缺少英文 (${missingInEn.length}):`);
  for (const k of missingInEn) console.log("  " + k);
}
if (missingInZh.length) {
  console.log(`\n缺少中文 (${missingInZh.length}):`);
  for (const k of missingInZh) console.log("  " + k);
}

// ---------------------------------------------------------------- 代码里用了、语言包里没有
//
// 这个方向才是会**在用户面前炸**的那个：next-intl 找不到 key 会抛
// MISSING_MESSAGE，页面上出现的是一个键名。
// 而这个检查以前根本不存在 —— 只查了"包里有、代码没用"（孤儿），
// 没查"代码用了、包里没有"。结果就是：某次清理孤儿时删掉了 common.select，
// 后来新写的组件又用上了它，一路上线，最后是端到端冒烟测试才发现。
//
// 放在孤儿检查**前面**：缺 key 是硬错误，孤儿只是垃圾。

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === ".next" || name === "generated") return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|mts)$/.test(name) ? [full] : [];
  });
}

const source = ["app", "components", "lib"]
  .flatMap((d) => walk(d))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/**
 * 一个 key 算「用到了」，只要满足其一：
 *   * 源码里出现完整路径字符串（t("map.title")）
 *   * 出现它的**父级**加模板拼接（t(`layout.effort.${k}`) → 前缀 layout.effort. 被用到）
 *   * 出现叶子名，且它的父级在别处被拼过（REASON 那种查表写法）
 */
const templatePrefixes = [...source.matchAll(/[`"']([\w.]+?)\.\$\{/g)].map((m) => m[1] + ".");
const literal = new Set([...source.matchAll(/[`"']([\w]+(?:\.[\w]+)+)[`"']/g)].map((m) => m[1]));

// 只认**真的传给 t() 的**字符串。
// 不能拿"源码里所有带点的字符串"去查：`books.google.com`（SSRF 白名单）、
// `capacity.coefficients`、`ops.lastBackup`（Setting 的键）长得都像 i18n key，
// 而且它们的首段恰好也是语言包里的命名空间，一律会被误报。
const tCalls = new Set(
  [...source.matchAll(/\bt\(\s*[`"']([\w.]+)[`"']/g)].map((m) => m[1]),
);
// next-intl 允许带命名空间的翻译器：`getTranslations("app")` 之后 `t("name")` 指的是 app.name。
// 所以查不到的 key，再拿各个命名空间前缀试一遍，能对上就不算缺。
const namespaces = [
  ...source.matchAll(/(?:useTranslations|getTranslations)\(\s*[`"']([\w.]+)[`"']/g),
].map((m) => m[1]);
const missingInPack = [...tCalls]
  .filter((k) => !zhKeys.has(k) && !namespaces.some((ns) => zhKeys.has(`${ns}.${k}`)))
  .sort();

if (missingInPack.length) {
  console.log(`\n代码里用了但语言包里没有 (${missingInPack.length}) —— 这些会在页面上抛 MISSING_MESSAGE：`);
  for (const k of missingInPack) console.log("  " + k);
}

const orphans = [...zhKeys].filter((k) => {
  if (literal.has(k)) return false;
  if (templatePrefixes.some((p) => k.startsWith(p))) return false;
  return true;
}).sort();

if (orphans.length) {
  console.log(`\n没有任何地方用到 (${orphans.length}) —— 重构留下的孤儿，清掉或接回去：`);
  for (const k of orphans) console.log("  " + k);
}

if (missingInEn.length || missingInZh.length || missingInPack.length) process.exit(1);
console.log(`\n两个语言包完全对齐 ✓${orphans.length ? `（另有 ${orphans.length} 个孤儿 key，见上）` : "，且没有孤儿 key ✓"}`);
