// 中图法规则分类的回归测试。
//
// 起因：《百年孤独》被分成了「I247.5 中国当代长篇小说」。
// 中文版的 language=zh，主题词里也没有"哥伦比亚文学"字样，规则就一路掉进了中国文学——
// 而作者字段里明明白白写着 `[哥伦比亚] 加西亚·马尔克斯`。
//
// 这类错不是"不够准"，是**放错了书架**：一本拉美小说摆进中国文学区，
// 按索书号顺序去找它的人永远找不到。所以每条规则都得有个钉子钉住。
//
// 跑法：npm run verify:clc

import { readFileSync } from "node:fs";
import { assignClcManual } from "../lib/clcAssign";
import { assignDdcManual } from "../lib/ddcAssign";
import { inferClcByRules, isValidClc, CLC_CLASSES, type ClcInferInput } from "../lib/clc";

let pass = 0, fail = 0;

/**
 * expect 的三种写法：
 *   "I516"  → 号必须以这个开头（用前缀是因为规则只保证到纲目级，小数位交给模型）
 *   null    → 必须交给模型（规则不许硬猜）
 *   "!I"    → **不能**是这个大类；交给模型也算通过
 *             （工具书就属于这种：不是文学就对了，具体归 H 还是 Z 让模型定）
 */
function t(name: string, input: ClcInferInput, expect: string | null) {
  const got = inferClcByRules(input);
  const clc = got?.clc ?? null;
  const ok =
    expect === null ? clc === null
    : expect.startsWith("!") ? !clc || !clc.startsWith(expect.slice(1))
    : !!clc && clc.startsWith(expect);
  if (ok) { pass++; console.log(`  ✓ ${name}  → ${clc ?? "(交给模型)"}`); }
  else { fail++; console.log(`  ✗ ${name}  → ${clc ?? "(null)"}，期望 ${expect ?? "(交给模型)"}`); }
}

console.log("\n=== 中图法规则分类回归 ===\n");

console.log("A 作者国别方括号（中文书目里最可靠的原作国别证据）");
t("百年孤独 [哥伦比亚] → 拉美文学，不是中国文学", {
  title: "百年孤独", authors: ["[哥伦比亚] 加西亚·马尔克斯"],
  subjects: ["小说", "外国文学", "魔幻现实主义"], language: "zh",
}, "I73");

t("少年维特之烦恼 [德] → 德国文学", {
  title: "少年维特之烦恼", authors: ["[德]歌德"],
  subjects: ["小说", "外国文学"], language: "zh",
}, "I516");

t("挪威的森林 [日] → 日本文学", {
  title: "挪威的森林", authors: ["[日] 村上春树"],
  subjects: ["小说", "日本文学"], language: "zh",
}, "I313");

t("老人与海 [美] → 美国文学", {
  title: "老人与海", authors: ["[美] 海明威"],
  subjects: ["小说", "外国文学"], language: "zh",
}, "I712");

t("罪与罚 [俄] → 俄罗斯文学（哪怕拿的是英文版）", {
  title: "Crime and Punishment", authors: ["[俄] 陀思妥耶夫斯基"],
  subjects: ["fiction", "novel"], language: "en",
}, "I512");

t("半括号写法 (美) 也认", {
  title: "了不起的盖茨比", authors: ["(美) 菲茨杰拉德"],
  subjects: ["小说"], language: "zh",
}, "I712");

t("表里没有的国家 → 交给模型，绝不掉进中国文学", {
  title: "某本北欧小说", authors: ["[法罗群岛] 某人"],
  subjects: ["小说", "外国文学"], language: "zh",
}, null);

console.log("\nB 中国作者不受影响");
t("三体（无方括号）→ 中国当代小说", {
  title: "三体", authors: ["刘慈欣"], subjects: ["小说", "科幻", "中国文学"], language: "zh",
}, "I247");

t("活着（无方括号）→ 中国当代小说", {
  title: "活着", authors: ["余华"], subjects: ["小说", "中国当代"], language: "zh",
}, "I247");

t("作者带生卒年而非国别，不能误判成外国人", {
  title: "黄金时代", authors: ["王小波(1952-1997)"],
  subjects: ["小说", "中国当代"], language: "zh",
}, "I247");

t("[中国] 显式写出来也走中国文学", {
  title: "某中文小说", authors: ["[中国] 某作者"], subjects: ["小说"], language: "zh",
}, "I2");

console.log("\nC 古今之分（中图法把古代和现当代分在完全不同的号段）");
t("唐诗三百首 → 唐诗", {
  title: "唐诗三百首", subjects: ["诗歌", "唐诗", "古典文学"], language: "zh",
}, "I222");

console.log("\nD 单字关键词的坑 —— 中文是子串匹配，单字会命中一堆无关词");
t("现代汉语词典 不是文学（「词」会命中「词典」）", {
  title: "现代汉语词典", subjects: ["词典", "汉语", "工具书"], language: "zh",
}, "H");
t("诗词大辞典 是工具书，不是诗集（交给模型也算对）", {
  title: "中国诗词大辞典", subjects: ["辞典", "诗词", "工具书"], language: "zh",
}, "!I");
t("作曲家传记 不该因为「曲」被判成戏曲", {
  title: "贝多芬传", authors: ["[法] 罗曼·罗兰"], subjects: ["传记", "音乐家", "作曲家"], language: "zh",
}, "K");
t("讲天赋的心理学书 不该因为「赋」被判成汉赋", {
  title: "刻意练习", authors: ["[美] 安德斯·艾利克森"],
  subjects: ["心理学", "天赋", "学习方法"], language: "zh",
}, "B");

console.log("\nE 非文学不受作者国别影响");
t("Sapiens [以色列] 是历史/人类学，不该被当成文学", {
  title: "Sapiens: A Brief History of Humankind", authors: ["[以色列] 尤瓦尔·赫拉利"],
  subjects: ["human evolution", "civilization", "history"], language: "en",
}, "");

t("极简欧洲史 → 世界史，不该被简介里的宗教词带偏", {
  title: "你一定爱读的极简欧洲史", authors: ["[澳] 约翰·赫斯特"],
  subjects: ["历史", "欧洲史", "世界史"], language: "zh",
  summary: "从古希腊罗马、基督教到文艺复兴，欧洲文明的来龙去脉……",
}, "K5");

console.log("\nF 模型返回的号必须真的是中图法号");
// 模型的输出会直接变成 callNumber 和 callSortKey，而 callSortKey 决定整条货架带的顺序。
// 以前只用 /^[A-Z]{1,2}[\d.]*$/ 卡形状 —— 形状对不等于号对。
function v(name: string, clc: string, want: boolean) {
  const got = isValidClc(clc);
  if (got === want) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} —— isValidClc(${JSON.stringify(clc)}) = ${got}，期望 ${want}`); }
}
v("I247.5 是正常的号", "I247.5", true);
v("K5 是正常的号", "K5", true);
v("TP3（T 类下的字母细分）", "TP3", true);
v("Z 单独一个大类字母", "Z", true);
// 中图法根本没有 L M W Y 这四个大类：放行了就会把书排进不存在的区段，界面还查不到名字
for (const bad of ["L2", "M5", "W3", "Y9"]) v(`${bad} 的大类不存在，必须拒`, bad, false);
v("I... 小数点乱来，必须拒", "I...", false);
v("I..5 小数点乱来，必须拒", "I..5", false);
v("I247.5.3 两个小数点，必须拒", "I247.5.3", false);
v("空串必须拒", "", false);
v("22 个大类字母都认", CLC_CLASSES.map((c) => c.code).join("") .slice(0, 1), true);

console.log("\nG 写入 clc 的每一扇门都要校验");
// 模型那条路补上校验之后，还有两扇门是敞着的：
//   POST /api/books/[id]/clc  手工填号 —— 填个 M5，normalizeClc 返回 null，
//     整条赋值变空，**把这本书原来那个好好的号抹掉了**，接口还回 200
//   PATCH /api/books/[id]     编辑书本 —— clc 是 z.string()，"随便写" 原样入库，
//     callSortKey 退化成兜底值，那本书直接掉到货架带末尾
// 校验漏在任何一扇门上，前面做的都白搭。
{
  const books = readFileSync("lib/books.ts", "utf8");
  const clcRoute = readFileSync("app/api/books/[id]/clc/route.ts", "utf8");
  const deepseek = readFileSync("lib/deepseek.ts", "utf8");
  const gate = (name: string, ok: boolean, detail = "") => {
    if (ok) { pass++; console.log(`  ✓ ${name}`); }
    else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
  };
  gate("G · 书本创建/编辑的 clc 过 isValidClc", /clc:[\s\S]{0,120}?isValidClc/.test(books));
  gate("G · 书本创建/编辑的 ddc 限定三位数字", /ddc:[\s\S]{0,120}?\\d\{3\}/.test(books));
  gate("G · 手工设分类接口先校验再动库", /isValidClc\(manual\)/.test(clcRoute));
  gate("G · 模型返回的号过 isValidClc", /isValidClc\(parsed\.clc\)/.test(deepseek));
}

console.log("\nH 坏号绝不能变成「悄悄清空」");
// 这是最阴的一种失败：`assignClcManual("M5")` 以前返回的是**空赋值**，
// 调用方分不清"填了个坏号"和"这本书本来就没号"，
// 于是把这本书原来那个好好的号抹掉了，接口还回 200。
// 关口放在赋值函数里，换一个调用方也不会重蹈覆辙。
{
  const inp = { title: "三体", authors: ["刘慈欣"] };
  const gate = (name: string, ok: boolean) => {
    if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}`); }
  };
  for (const bad of ["随便写", "M5", "abc", "9999", ""]) {
    gate(`H · assignClcManual(${JSON.stringify(bad)}) 返回 null`, assignClcManual(bad, inp) === null);
    gate(`H · assignDdcManual(${JSON.stringify(bad)}) 返回 null`, assignDdcManual(bad, inp) === null);
  }
  gate("H · 合法的 clc 照常返回赋值", assignClcManual("I247.5", inp)?.callNumber === "I247.5 刘慈");
  gate("H · 合法的 ddc 照常返回赋值", assignDdcManual("823", inp)?.callNumber === "823 刘慈");
}

const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  —— " + detail : ""}`); }
};

console.log("\n界面用的是中图法号，不是杜威号");
// 这个项目从 DDC 迁到中图法，但界面上的名字没跟着改，`Book.ddc` 又**确实存在**
// （OpenLibrary 给的杜威号，只作参考）。于是扫码流程通篇在用 ddc：
// 补号判断看 `!book.ddc`、调 /api/books/[id]/ddc、把杜威号显示在索书号位置。
// 而整套上架跑的是中图法 —— callSortKey 由它算、货架带按它排、书脊标签印它。
// 最阴的是那个补号判断：规则给得出杜威号、给不出中图法号时，AI 补号不触发，
// 这本书就没有 callSortKey，直接掉到货架带末尾。
{
  // 去掉注释再查。第一版没去，结果我写在注释里**解释这个 bug** 的那句
  // "调 /api/books/[id]/ddc" 自己把检查触发了 —— 记录一个坑不该等于再犯一次。
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const scan = stripComments(readFileSync("components/ScanFlow.tsx", "utf8"));
  check("扫码流程补号调的是 /clc 而不是 /ddc",
    /\/clc`/.test(scan) && !/\/ddc`/.test(scan), "ScanFlow 里还有 /api/books/[id]/ddc");
  check("扫码补号的触发条件看的是 clc",
    /if \(!book\.clc\)/.test(scan), "应该是 if (!book.clc)");
  const cn = readFileSync("components/CallNumber.tsx", "utf8");
  check("索书号组件的入参叫 clc（它一直收的就是中图法）",
    /clc\?: string \| null/.test(cn) && !/ddc\?: string/.test(cn));
  const zh = JSON.parse(readFileSync("messages/zh.json", "utf8"));
  check("书目页的分类筛选不再写「杜威」",
    !/杜威/.test(zh.callNumber?.filterClass ?? ""), zh.callNumber?.filterClass);
  check("详情页的精度说明不再拿杜威的位数讲中图法",
    !/三位/.test(zh.callNumber?.precisionNote ?? ""), zh.callNumber?.precisionNote);
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
if (fail) process.exit(1);
