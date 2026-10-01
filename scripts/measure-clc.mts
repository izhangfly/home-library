// 规则分类的覆盖率与准确度测量
//
// 为什么值得量：规则分不出来的书会**落到模型**（lib/clcAssign.ts）。
// 每一次落模型都要花钱、要等一次网络往返，而且在国内那次往返还不一定顺。
// 所以"规则覆盖率"不是学术指标，它直接等于扫一架书要花多少钱、等多久。
//
// 同时量准确度：覆盖率靠乱猜也能刷到 100%，那比不分还糟 ——
// 分错的号会把书摆到错误的书架区，按索书号去找的人永远找不到。
//
// 样本用的是家庭书架上真实会出现的书，且**只断言大类**（I 文学 / K 历史 / B 哲学…）。
// 大类是能确定的事实：《三体》属于中国文学，《百年孤独》属于美洲文学。
// 小数位那几级留给模型，规则本来也只保证到纲目级。
//
// 跑法：npm run measure:clc

import { inferClcByRules, clcMainClass, clcLabel, type ClcInferInput } from "../lib/clc";

interface Case extends ClcInferInput {
  /**
   * 可以接受的大类字母。多数书只有一个答案，少数确实横跨两类 ——
   * 《时间简史》讲的是相对论和黑洞，归 O 物理学或 P 天文学都站得住，
   * 硬指定一个只会把测量变成"和我的偏好对不对齐"。
   */
  expect: string | string[];
  note?: string;
}

/** 中文家庭书架上的典型构成：译作、本土小说、历史、科普、工具书、童书 */
const CASES: Case[] = [
  // ---- 中国文学 ----
  { title: "三体", authors: ["刘慈欣"], subjects: ["小说", "科幻", "中国文学"], language: "zh", expect: "I" },
  { title: "活着", authors: ["余华"], subjects: ["小说", "中国当代文学"], language: "zh", expect: "I" },
  { title: "围城", authors: ["钱锺书"], subjects: ["小说", "中国现代文学"], language: "zh", expect: "I" },
  { title: "红楼梦", authors: ["曹雪芹"], subjects: ["古典小说", "章回小说", "中国古代文学"], language: "zh", expect: "I" },
  { title: "唐诗三百首", subjects: ["诗歌", "唐诗", "古典文学"], language: "zh", expect: "I" },
  // ---- 外国文学（作者带国别方括号，中文版的通例）----
  { title: "百年孤独", authors: ["[哥伦比亚] 加西亚·马尔克斯"], subjects: ["小说", "外国文学"], language: "zh", expect: "I" },
  { title: "1984", authors: ["[英] 乔治·奥威尔"], subjects: ["小说", "外国文学"], language: "zh", expect: "I" },
  { title: "挪威的森林", authors: ["[日] 村上春树"], subjects: ["小说", "日本文学"], language: "zh", expect: "I" },
  { title: "老人与海", authors: ["[美] 海明威"], subjects: ["小说", "外国文学"], language: "zh", expect: "I" },
  { title: "小王子", authors: ["[法] 圣埃克苏佩里"], subjects: ["童话", "外国文学"], language: "zh", expect: "I" },
  // ---- 历史 ----
  { title: "万历十五年", authors: ["黄仁宇"], subjects: ["历史", "中国history", "明史"], language: "zh", expect: "K" },
  { title: "全球通史", authors: ["[美] 斯塔夫里阿诺斯"], subjects: ["历史", "世界史"], language: "zh", expect: "K" },
  { title: "枪炮、病菌与钢铁", authors: ["[美] 贾雷德·戴蒙德"], subjects: ["历史", "人类文明", "世界史"], language: "zh", expect: "K" },
  { title: "明朝那些事儿", authors: ["当年明月"], subjects: ["历史", "明史", "中国历史"], language: "zh", expect: "K" },
  // ---- 哲学·心理 ----
  { title: "被讨厌的勇气", authors: ["[日] 岸见一郎"], subjects: ["心理学", "阿德勒", "自我提升"], language: "zh", expect: "B" },
  { title: "沉思录", authors: ["[古罗马] 马可·奥勒留"], subjects: ["哲学", "西方哲学"], language: "zh", expect: "B" },
  { title: "思考，快与慢", authors: ["[美] 丹尼尔·卡尼曼"], subjects: ["心理学", "认知科学", "行为经济学"], language: "zh", expect: "B" },
  // ---- 经济·管理 ----
  { title: "国富论", authors: ["[英] 亚当·斯密"], subjects: ["经济学", "政治经济学"], language: "zh", expect: "F" },
  { title: "穷查理宝典", authors: ["[美] 查理·芒格"], subjects: ["投资", "经济", "商业"], language: "zh", expect: "F" },
  // ---- 自然科学 ----
  { title: "时间简史", authors: ["[英] 霍金"], subjects: ["物理学", "宇宙学", "科普"], language: "zh",
    expect: ["O", "P"], note: "相对论/黑洞，归物理或天文都合理" },
  { title: "物种起源", authors: ["[英] 达尔文"], subjects: ["生物学", "进化论"], language: "zh", expect: "Q" },
  { title: "自私的基因", authors: ["[英] 理查德·道金斯"], subjects: ["生物学", "进化论", "遗传学"], language: "zh", expect: "Q" },
  // ---- 技术 ----
  { title: "深入理解计算机系统", subjects: ["计算机", "计算机系统", "编程"], language: "zh", expect: "T" },
  { title: "人月神话", authors: ["[美] 布鲁克斯"], subjects: ["软件工程", "项目管理", "计算机"], language: "zh", expect: "T" },
  // ---- 语言·工具书 ----
  { title: "现代汉语词典", subjects: ["词典", "汉语", "工具书"], language: "zh", expect: "H" },
  // ---- 艺术 ----
  { title: "艺术的故事", authors: ["[英] 贡布里希"], subjects: ["艺术史", "绘画", "艺术"], language: "zh", expect: "J" },
  // ---- 医药卫生 ----
  { title: "众病之王：癌症传", authors: ["[美] 悉达多·穆克吉"], subjects: ["医学", "癌症", "医学史"], language: "zh", expect: "R" },
  // ---- 儿童 ----
  { title: "窗边的小豆豆", authors: ["[日] 黑柳彻子"], subjects: ["儿童文学", "小说", "教育"], language: "zh", expect: "I" },
  // ================= 难例集 =================
  // 上面那 28 本大多是当初修 bug 时顺手加的，等于"考自己出过的题"。
  // 下面这些是专门挑的坑：标题像甲、内容是乙；单字关键词；传记 vs 本行；
  // 科普 vs 学科；英文书名。期望值按中图法的结构定，不是按代码现在的输出定。

  // ---- 标题很文艺，其实是技术书 ----
  { title: "代码大全", authors: ["[美] 史蒂夫·迈克康奈尔"], subjects: ["软件开发", "程序设计"], language: "zh", expect: "T", note: "书名像文学" },
  { title: "编程珠玑", authors: ["[美] Jon Bentley"], subjects: ["算法", "程序设计"], language: "zh", expect: "T", note: "「珠玑」像古典文集" },
  { title: "数学之美", authors: ["吴军"], subjects: ["数学", "信息技术", "科普"], language: "zh", expect: ["O", "T"], note: "数学与信息处理都说得通" },
  { title: "黑客与画家", authors: ["[美] Paul Graham"], subjects: ["计算机", "随笔"], language: "zh", expect: ["T", "I"], note: "文集但主题是编程" },

  // ---- 单字关键词的陷阱（词/曲/赋/传）----
  { title: "宋词鉴赏辞典", subjects: ["宋词", "鉴赏", "辞典"], language: "zh", expect: ["I", "Z", "H"], note: "「词」+「辞典」双重歧义" },
  { title: "中国古代歌曲作法", subjects: ["音乐", "作曲"], language: "zh", expect: "J", note: "「曲」不等于文学" },
  { title: "天赋基因", subjects: ["遗传学", "基因"], language: "zh", expect: "Q", note: "「赋」不等于辞赋" },
  { title: "赋税制度史", subjects: ["财政", "赋税", "经济史"], language: "zh", expect: ["F", "K"], note: "「赋」的另一个坑" },
  { title: "现代汉语词典", subjects: ["汉语", "词典"], language: "zh", expect: "H", note: "曾被判成中国文学" },

  // ---- 传记：归 K，不归传主的本行 ----
  { title: "史蒂夫·乔布斯传", authors: ["[美] 艾萨克森"], subjects: ["传记", "企业家"], language: "zh", expect: "K", note: "不该进 F 经济" },
  { title: "苏东坡传", authors: ["林语堂"], subjects: ["传记", "人物"], language: "zh", expect: "K", note: "传主是文学家，最容易误进 I" },
  { title: "居里夫人传", subjects: ["传记", "科学家"], language: "zh", expect: "K", note: "不该进 O 物理化学" },

  // ---- 科普：归学科，不归"科普" ----
  { title: "自私的基因", authors: ["[英] 理查德·道金斯"], subjects: ["进化论", "生物学", "科普"], language: "zh", expect: "Q" },
  { title: "枪炮、病菌与钢铁", authors: ["[美] 贾雷德·戴蒙德"], subjects: ["人类史", "文明"], language: "zh", expect: ["K", "C"], note: "书名像军事/医学" },
  { title: "寂静的春天", authors: ["[美] 蕾切尔·卡逊"], subjects: ["环境保护", "生态"], language: "zh", expect: ["X", "Q"], note: "书名像散文" },
  { title: "上帝掷骰子吗", subjects: ["量子物理", "科普"], language: "zh", expect: "O", note: "书名像宗教" },

  // ---- 心理 / 社科 ----
  { title: "思考，快与慢", authors: ["[美] 丹尼尔·卡尼曼"], subjects: ["心理学", "行为经济学"], language: "zh", expect: ["B", "F"] },
  { title: "非暴力沟通", authors: ["[美] 马歇尔·卢森堡"], subjects: ["沟通", "人际关系", "心理学"], language: "zh", expect: ["B", "C"] },
  { title: "乌合之众", authors: ["[法] 勒庞"], subjects: ["群体心理", "社会心理学"], language: "zh", expect: ["B", "C"] },

  // ---- 经管 ----
  { title: "穷爸爸富爸爸", authors: ["[美] 罗伯特·清崎"], subjects: ["理财", "投资"], language: "zh", expect: "F" },
  { title: "国富论", authors: ["[英] 亚当·斯密"], subjects: ["经济学", "古典经济学"], language: "zh", expect: "F", note: "书名像政治" },

  // ---- 育儿 / 教育 ----
  { title: "好妈妈胜过好老师", subjects: ["家庭教育", "育儿"], language: "zh", expect: "G" },
  { title: "西尔斯亲密育儿百科", authors: ["[美] 西尔斯"], subjects: ["育儿", "婴幼儿护理"], language: "zh", expect: ["G", "R"], note: "育儿跨教育与保健" },

  // ---- 童书 ----
  { title: "窗边的小豆豆", authors: ["[日] 黑柳彻子"], subjects: ["儿童文学", "小说"], language: "zh", expect: "I" },
  { title: "不一样的卡梅拉", subjects: ["儿童文学", "绘本", "图画书"], language: "zh", expect: "I" },
  { title: "十万个为什么", subjects: ["少儿读物", "百科", "科普"], language: "zh", expect: ["Z", "N"], note: "少儿百科" },

  // ---- 历史 / 地理 ----
  { title: "万历十五年", authors: ["黄仁宇"], subjects: ["明史", "中国历史"], language: "zh", expect: "K" },
  { title: "枢纽：3000年的中国", authors: ["施展"], subjects: ["中国历史", "地缘"], language: "zh", expect: "K" },

  // ---- 艺术 / 语言 ----
  { title: "艺术的故事", authors: ["[英] 贡布里希"], subjects: ["艺术史", "美术"], language: "zh", expect: "J" },
  { title: "汉语语法分析问题", authors: ["吕叔湘"], subjects: ["汉语", "语法"], language: "zh", expect: "H" },

  // ---- 医药 / 法律 ----
  { title: "中华人民共和国民法典", subjects: ["法律", "民法"], language: "zh", expect: "D" },

  // ---- 英文书名 ----
  { title: "Clean Code", authors: ["Robert C. Martin"], subjects: ["software engineering", "programming"], language: "en", expect: "T" },
  { title: "Sapiens: A Brief History of Humankind", authors: ["Yuval Noah Harari"], subjects: ["human history", "anthropology"], language: "en", expect: ["K", "C", "Q"] },
  { title: "Thinking, Fast and Slow", authors: ["Daniel Kahneman"], subjects: ["psychology", "decision making"], language: "en", expect: ["B", "F"] },

  // ---- 反例：不能因为标题里有"艺术"就归 J ----
  // 加 J0 规则时特意没收裸的"艺术"，这三本就是那个决定的护栏。
  { title: "领导的艺术", subjects: ["管理", "领导力"], language: "zh", expect: ["F", "C"], note: "「艺术」是修辞" },
  { title: "沟通的艺术", subjects: ["人际沟通", "心理学"], language: "zh", expect: ["B", "C", "H"], note: "「艺术」是修辞" },
  { title: "战争的艺术", authors: ["孙武"], subjects: ["兵法", "军事"], language: "zh", expect: ["E", "B"], note: "「艺术」是修辞" },
];

let covered = 0, correct = 0;
const misses: string[] = [];
const wrong: string[] = [];

console.log("\n=== 规则分类：覆盖率与准确度 ===\n");

for (const c of CASES) {
  const got = inferClcByRules(c);
  if (!got) {
    misses.push(`${c.title}（期望 ${c.expect}）`);
    continue;
  }
  covered++;
  const cls = clcMainClass(got.clc);
  const ok = Array.isArray(c.expect) ? c.expect.includes(cls ?? "") : cls === c.expect;
  if (ok) correct++;
  else wrong.push(`${c.title}: 得到 ${got.clc} ${clcLabel(got.clc, "zh") ?? ""}，期望大类 ${[c.expect].flat().join("/")}`);
}

const n = CASES.length;
console.log(`样本 ${n} 本（中文家庭书架的典型构成）\n`);
console.log(`  规则覆盖  ${covered}/${n} = ${Math.round((covered / n) * 100)}%   ← 没覆盖的每本都要花一次模型调用`);
console.log(`  大类正确  ${correct}/${covered} = ${covered ? Math.round((correct / covered) * 100) : 0}%（在覆盖到的里面）`);
console.log(`  整体正确  ${correct}/${n} = ${Math.round((correct / n) * 100)}%`);

// ---------------------------------------------------------------- 底线
//
// 这个脚本以前只"量"不"卡"，CLAUDE.md 里写的是"改规则时顺手跑一下" ——
// 那是习惯不是机制，这个项目在这上面栽过好几次。
//
// 两条线的松紧**故意不一样**：
//   · 准确度必须 100%。分错比分不出来糟得多：分不出来会落到模型（花钱、等一下），
//     分错了是把书摆进错误的书架区，按索书号去找的人永远找不到，而且没人会发现。
//   · 覆盖率只卡 85%。卡太死会挡住语料本身的扩充 —— 我加那批难例时
//     覆盖率就从 96% 掉到 90%，那不是退步，是题变难了。
const accuracy = covered ? correct / covered : 1;
const coverage = CASES.length ? covered / CASES.length : 1;
let gateFail = 0;
if (accuracy < 1) { console.log(`\n✗ 准确度 ${(accuracy * 100).toFixed(0)}%，必须 100%`); gateFail++; }
if (coverage < 0.85) { console.log(`\n✗ 覆盖率 ${(coverage * 100).toFixed(0)}%，低于 85% 下限`); gateFail++; }

if (wrong.length) {
  console.log(`\n分错的 ${wrong.length} 本 —— 这些比没分出来更糟，会把书摆到错误的书架区：`);
  for (const w of wrong) console.log(`  ✗ ${w}`);
}
if (misses.length) {
  console.log(`\n规则没覆盖的 ${misses.length} 本（会落到模型）：`);
  for (const m of misses) console.log(`  · ${m}`);
}
console.log();

process.exit(gateFail ? 1 : 0);
