// 中国图书馆分类法（中图法 / CLC）
//
// 为什么换掉 DDC：这个家的藏书以中文为主，而 DDC 把**所有**中文文学压进 895.1x——
// 五百本中文小说拿到同一个号，索书号就失去了排序意义。
// 中图法是专为中文藏书设计的：光 I2（中国文学）下面就有上百个细目，
// 按时代、体裁、地区分得很开，正好落在这个家最厚的那一段。
//
// 代价（如实记下）：OpenLibrary 给的权威号是 DDC，中图法没有等价的免费权威源，
// 所以中图法号只能靠规则 + 模型推断。原来的 ddc 字段保留不删，详情页仍然展示。

export type ClcSource = "rules" | "ai" | "manual";

export interface ClcEntry {
  code: string;
  zh: string;
  en: string;
}

/** 22 个基本大类 */
export const CLC_CLASSES: ClcEntry[] = [
  { code: "A", zh: "马列主义、毛泽东思想", en: "Marxism-Leninism, Mao Zedong Thought" },
  { code: "B", zh: "哲学、宗教", en: "Philosophy & religion" },
  { code: "C", zh: "社会科学总论", en: "Social sciences (general)" },
  { code: "D", zh: "政治、法律", en: "Politics & law" },
  { code: "E", zh: "军事", en: "Military science" },
  { code: "F", zh: "经济", en: "Economics" },
  { code: "G", zh: "文化、科学、教育、体育", en: "Culture, education & sports" },
  { code: "H", zh: "语言、文字", en: "Language & writing" },
  { code: "I", zh: "文学", en: "Literature" },
  { code: "J", zh: "艺术", en: "Art" },
  { code: "K", zh: "历史、地理", en: "History & geography" },
  { code: "N", zh: "自然科学总论", en: "Natural sciences (general)" },
  { code: "O", zh: "数理科学和化学", en: "Mathematics, physics & chemistry" },
  { code: "P", zh: "天文学、地球科学", en: "Astronomy & earth sciences" },
  { code: "Q", zh: "生物科学", en: "Biology" },
  { code: "R", zh: "医药、卫生", en: "Medicine & health" },
  { code: "S", zh: "农业科学", en: "Agriculture" },
  { code: "T", zh: "工业技术", en: "Industrial technology" },
  { code: "U", zh: "交通运输", en: "Transportation" },
  { code: "V", zh: "航空、航天", en: "Aeronautics & astronautics" },
  { code: "X", zh: "环境科学、安全科学", en: "Environmental & safety science" },
  { code: "Z", zh: "综合性图书", en: "General works" },
];

/**
 * 二级/三级类目。
 * I（文学）刻意收得最细 —— 这个家的书主要堆在这里，分不开就等于没分类。
 */
export const CLC_DIVISIONS: ClcEntry[] = [
  // ---- B 哲学、宗教
  { code: "B0", zh: "哲学理论", en: "Philosophical theory" },
  { code: "B2", zh: "中国哲学", en: "Chinese philosophy" },
  { code: "B22", zh: "先秦哲学（儒道诸子）", en: "Pre-Qin philosophy" },
  { code: "B5", zh: "欧洲哲学", en: "European philosophy" },
  { code: "B6", zh: "美洲哲学", en: "American philosophy" },
  { code: "B84", zh: "心理学", en: "Psychology" },
  { code: "B848", zh: "应用心理学·自我修养", en: "Applied psychology & self-help" },
  { code: "B9", zh: "宗教", en: "Religion" },
  { code: "B94", zh: "佛教", en: "Buddhism" },
  { code: "B97", zh: "伊斯兰教", en: "Islam" },
  { code: "B972", zh: "基督教", en: "Christianity" },

  // ---- C 社会科学总论
  { code: "C91", zh: "社会学", en: "Sociology" },
  { code: "C93", zh: "管理学", en: "Management" },

  // ---- D 政治、法律
  { code: "D5", zh: "世界政治", en: "World politics" },
  { code: "D6", zh: "中国政治", en: "Chinese politics" },
  { code: "D9", zh: "法律", en: "Law" },

  // ---- E 军事
  { code: "E1", zh: "世界军事", en: "World military" },
  { code: "E2", zh: "中国军事", en: "Chinese military" },

  // ---- F 经济
  { code: "F0", zh: "政治经济学", en: "Political economy" },
  { code: "F1", zh: "世界经济", en: "World economy" },
  { code: "F2", zh: "经济管理", en: "Economic management" },
  { code: "F27", zh: "企业经济", en: "Business management" },
  { code: "F8", zh: "财政、金融", en: "Finance & banking" },
  { code: "F81", zh: "财政·税收", en: "Public finance & taxation" },
  { code: "F83", zh: "金融、投资", en: "Finance & investment" },

  // ---- G 文化、教育、体育
  { code: "G0", zh: "文化理论", en: "Cultural theory" },
  { code: "G2", zh: "信息与传播", en: "Information & communication" },
  { code: "G25", zh: "图书馆学", en: "Library science" },
  { code: "G4", zh: "教育", en: "Education" },
  { code: "G61", zh: "学前教育·育儿", en: "Early childhood & parenting" },
  { code: "G62", zh: "初等教育", en: "Primary education" },
  { code: "G63", zh: "中等教育", en: "Secondary education" },
  { code: "G64", zh: "高等教育", en: "Higher education" },
  { code: "G8", zh: "体育", en: "Sports" },

  // ---- H 语言
  { code: "H1", zh: "汉语", en: "Chinese language" },
  { code: "H19", zh: "汉语教学", en: "Chinese language teaching" },
  { code: "H31", zh: "英语", en: "English language" },
  { code: "H32", zh: "法语", en: "French language" },
  { code: "H33", zh: "德语", en: "German language" },
  { code: "H36", zh: "日语", en: "Japanese language" },

  // ---- I 文学（重点细分）
  { code: "I0", zh: "文学理论", en: "Literary theory" },
  { code: "I1", zh: "世界文学", en: "World literature" },
  { code: "I2", zh: "中国文学", en: "Chinese literature" },
  { code: "I20", zh: "中国文学理论", en: "Chinese literary theory" },
  { code: "I21", zh: "中国文学作品集", en: "Chinese collected works" },
  { code: "I22", zh: "中国诗歌、韵文", en: "Chinese poetry" },
  { code: "I222", zh: "中国古代诗歌", en: "Classical Chinese poetry" },
  { code: "I222.7", zh: "唐诗", en: "Tang poetry" },
  { code: "I222.8", zh: "宋词", en: "Song ci poetry" },
  { code: "I226", zh: "中国现当代诗歌", en: "Modern Chinese poetry" },
  { code: "I23", zh: "中国戏剧", en: "Chinese drama" },
  { code: "I24", zh: "中国小说", en: "Chinese fiction" },
  { code: "I242", zh: "中国古代小说", en: "Classical Chinese fiction" },
  { code: "I242.4", zh: "章回小说（古典四大名著等）", en: "Classical chapter novels" },
  { code: "I246", zh: "中国近代小说", en: "Early modern Chinese fiction" },
  { code: "I247", zh: "中国现当代小说", en: "Modern & contemporary Chinese fiction" },
  { code: "I247.5", zh: "中国当代长篇小说", en: "Contemporary Chinese novels" },
  { code: "I247.57", zh: "中国当代长篇小说", en: "Contemporary Chinese full-length novels" },
  { code: "I247.7", zh: "中国当代中短篇小说", en: "Contemporary Chinese novellas & short stories" },
  { code: "I25", zh: "中国报告文学", en: "Chinese reportage" },
  { code: "I26", zh: "中国散文", en: "Chinese prose" },
  { code: "I266", zh: "中国现代散文", en: "Modern Chinese prose" },
  { code: "I267", zh: "中国当代散文", en: "Contemporary Chinese prose" },
  { code: "I27", zh: "中国民间文学", en: "Chinese folk literature" },
  { code: "I28", zh: "中国儿童文学", en: "Chinese children's literature" },
  { code: "I287", zh: "中国儿童文学作品", en: "Chinese children's works" },
  { code: "I3", zh: "亚洲文学", en: "Asian literature" },
  { code: "I312", zh: "朝鲜·韩国文学", en: "Korean literature" },
  { code: "I313", zh: "日本文学", en: "Japanese literature" },
  { code: "I313.45", zh: "日本小说", en: "Japanese fiction" },
  { code: "I351", zh: "印度文学", en: "Indian literature" },
  { code: "I4", zh: "非洲文学", en: "African literature" },
  { code: "I5", zh: "欧洲文学", en: "European literature" },
  { code: "I512", zh: "俄罗斯文学", en: "Russian literature" },
  { code: "I512.45", zh: "俄罗斯小说", en: "Russian fiction" },
  { code: "I516", zh: "德国文学", en: "German literature" },
  { code: "I516.45", zh: "德国小说", en: "German fiction" },
  { code: "I521", zh: "捷克·东欧文学", en: "Czech & eastern European literature" },
  { code: "I545", zh: "意大利文学", en: "Italian literature" },
  { code: "I551", zh: "西班牙文学", en: "Spanish literature" },
  { code: "I561", zh: "英国文学", en: "British literature" },
  { code: "I561.45", zh: "英国小说", en: "British fiction" },
  { code: "I565", zh: "法国文学", en: "French literature" },
  { code: "I565.45", zh: "法国小说", en: "French fiction" },
  { code: "I6", zh: "大洋洲文学", en: "Oceanian literature" },
  { code: "I7", zh: "美洲文学", en: "American literature" },
  { code: "I712", zh: "美国文学", en: "US literature" },
  { code: "I712.45", zh: "美国小说", en: "US fiction" },
  { code: "I73", zh: "拉丁美洲文学", en: "Latin American literature" },

  // ---- J 艺术
  { code: "J0", zh: "艺术理论", en: "Art theory" },
  { code: "J2", zh: "绘画", en: "Painting" },
  { code: "J4", zh: "摄影艺术", en: "Photography" },
  { code: "J5", zh: "工艺美术·设计", en: "Design & applied arts" },
  { code: "J6", zh: "音乐", en: "Music" },
  { code: "J9", zh: "电影、电视艺术", en: "Film & television" },

  // ---- K 历史、地理
  { code: "K1", zh: "世界史", en: "World history" },
  { code: "K2", zh: "中国史", en: "Chinese history" },
  { code: "K20", zh: "中国通史", en: "General Chinese history" },
  { code: "K23", zh: "汉—隋唐史", en: "Han to Tang history" },
  { code: "K24", zh: "宋元史", en: "Song & Yuan history" },
  { code: "K248", zh: "明史", en: "Ming history" },
  { code: "K249", zh: "清史", en: "Qing history" },
  { code: "K3", zh: "亚洲史", en: "Asian history" },
  { code: "K313", zh: "日本史", en: "Japanese history" },
  { code: "K5", zh: "欧洲史", en: "European history" },
  { code: "K56", zh: "英国史", en: "British history" },
  { code: "K7", zh: "美洲史", en: "American history" },
  { code: "K712", zh: "美国史", en: "US history" },
  { code: "K81", zh: "传记", en: "Biography" },
  { code: "K9", zh: "地理", en: "Geography" },
  { code: "K91", zh: "世界地理·游记", en: "World geography & travel" },
  { code: "K92", zh: "中国地理·游记", en: "Chinese geography & travel" },

  // ---- N/O/P/Q 自然科学
  { code: "N4", zh: "科普读物", en: "Popular science" },
  { code: "O1", zh: "数学", en: "Mathematics" },
  { code: "O13", zh: "高等数学", en: "Advanced mathematics" },
  { code: "O17", zh: "数学分析", en: "Mathematical analysis" },
  { code: "O4", zh: "物理学", en: "Physics" },
  { code: "O41", zh: "理论物理", en: "Theoretical physics" },
  { code: "O6", zh: "化学", en: "Chemistry" },
  { code: "P1", zh: "天文学", en: "Astronomy" },
  { code: "P5", zh: "地质学", en: "Geology" },
  { code: "Q1", zh: "普通生物学", en: "General biology" },
  { code: "Q3", zh: "遗传学", en: "Genetics" },
  { code: "Q6", zh: "生物物理学", en: "Biophysics" },
  { code: "Q91", zh: "古生物学", en: "Palaeontology" },
  { code: "Q94", zh: "植物学", en: "Botany" },
  { code: "Q95", zh: "动物学", en: "Zoology" },
  { code: "Q98", zh: "人类学", en: "Anthropology" },

  // ---- R 医药卫生
  { code: "R1", zh: "预防医学·卫生学", en: "Preventive medicine" },
  { code: "R15", zh: "营养卫生", en: "Nutrition" },
  { code: "R2", zh: "中国医学", en: "Traditional Chinese medicine" },
  { code: "R4", zh: "临床医学", en: "Clinical medicine" },

  // ---- T 工业技术
  { code: "TB", zh: "一般工业技术", en: "General industrial technology" },
  { code: "TH", zh: "机械、仪表工业", en: "Mechanical engineering" },
  { code: "TM", zh: "电工技术", en: "Electrical engineering" },
  { code: "TN", zh: "电子技术、通信", en: "Electronics & communication" },
  { code: "TP", zh: "自动化技术、计算机", en: "Automation & computing" },
  { code: "TP3", zh: "计算机技术", en: "Computer technology" },
  { code: "TP31", zh: "程序设计·软件", en: "Programming & software" },
  { code: "TP311", zh: "程序设计", en: "Programming" },
  { code: "TP18", zh: "人工智能", en: "Artificial intelligence" },
  { code: "TS", zh: "轻工业、手工业", en: "Light industry" },
  { code: "TS97", zh: "生活服务·烹饪", en: "Home economics & cooking" },
  { code: "TU", zh: "建筑科学", en: "Architecture" },

  // ---- U/V/X/Z
  { code: "U2", zh: "铁路运输", en: "Railway transport" },
  { code: "U4", zh: "公路运输", en: "Road transport" },
  { code: "U6", zh: "水路运输", en: "Water transport" },
  { code: "V2", zh: "航空", en: "Aviation" },
  { code: "V4", zh: "航天", en: "Astronautics" },
  { code: "X", zh: "环境科学", en: "Environmental science" },
  { code: "Z2", zh: "百科全书", en: "Encyclopedias" },
];

const BY_CODE = new Map<string, ClcEntry>();
for (const e of [...CLC_CLASSES, ...CLC_DIVISIONS]) BY_CODE.set(e.code, e);

/** 中图法号形如 I247.57 / TP311 / K248 —— 字母段 + 数字段 */
export function normalizeClc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().toUpperCase().match(/^([A-Z]{1,2})([\d.]*)/);
  if (!m) return null;
  const letters = m[1];
  if (!CLC_CLASSES.some((c) => c.code === letters[0])) return null;
  const digits = (m[2] || "").replace(/\.$/, "");
  return letters + digits;
}

/** 逐级回退查中文名：I247.57 → I247.5 → I247 → I24 → I2 → I */
export function clcLabel(clc: string | null | undefined, locale: "zh" | "en" = "zh"): string | null {
  const norm = normalizeClc(clc);
  if (!norm) return null;
  let probe = norm;
  while (probe.length > 0) {
    const hit = BY_CODE.get(probe);
    if (hit) return locale === "zh" ? hit.zh : hit.en;
    probe = probe.endsWith(".") ? probe.slice(0, -1) : probe.slice(0, -1);
  }
  return null;
}

/** 大类字母，用于筛选和配色 */
/**
 * 这个号是不是**真的**中图法号。
 *
 * 模型返回的号会直接变成 `callNumber` 和 `callSortKey`，而 `callSortKey`
 * 决定整条货架带的顺序。以前只用 `/^[A-Z]{1,2}[\d.]*$/` 卡形状，放行了一堆假号：
 *   M5 / W3 / L2 / Y9  —— 中图法**没有** L M W Y 这四个大类，
 *                          书会被排进一个根本不存在的区段，而且界面查不到名字
 *   I... / I..5 / I.   —— 小数点乱来
 *   I247.5.3           —— 两个小数点
 * 形状对不等于号对。这里按真实的 22 个基本大类校验，小数位只允许一段。
 */
export function isValidClc(raw: string | null | undefined): boolean {
  const clc = (raw ?? "").trim().toUpperCase();
  if (!clc) return false;
  // 首字母必须是真实存在的大类
  if (!CLC_CLASSES.some((c) => c.code === clc[0])) return false;
  // 大类字母 + 可选的第二个字母（T 类下面有 TP/TN/TU 这种）+ 数字 + 最多一段小数
  return /^[A-Z][A-Z]?\d*(\.\d+)?$/.test(clc);
}

export function clcMainClass(clc: string | null | undefined): string | null {
  const norm = normalizeClc(clc);
  return norm ? norm[0] : null;
}

/**
 * 排序键：字母段按字典序，数字段按数值。
 * 直接排字符串会把 I247.7 排到 I247.57 前面（'7' > '5'），书架顺序就错了。
 */
export function clcSortKey(clc: string | null | undefined, cutterCode: string): string {
  const norm = normalizeClc(clc);
  if (!norm) return "￿";
  const m = norm.match(/^([A-Z]{1,2})([\d.]*)$/);
  if (!m) return "￿";
  const letters = m[1].padEnd(2, " ");
  const [int = "", dec = ""] = (m[2] || "").split(".");
  return `${letters}${int.padEnd(4, "0")}.${dec.padEnd(4, "0")} ${cutterCode}`;
}

/** 大类配色 —— 书脊标签和 3D 里按大类分色 */
export const CLC_CLASS_COLOR: Record<string, string> = {
  A: "#9333EA", B: "#8B5CF6", C: "#6366F1", D: "#3B82F6", E: "#64748B",
  F: "#0EA5E9", G: "#14B8A6", H: "#10B981", I: "#FDC800", J: "#EC4899",
  K: "#DC2626", N: "#84CC16", O: "#16A34A", P: "#0891B2", Q: "#22C55E",
  R: "#F43F5E", S: "#A3A635", T: "#F97316", U: "#78716C", V: "#7C3AED",
  X: "#059669", Z: "#6B7280",
};

// ---------------------------------------------------------------- 主题接近度

/**
 * 两个中图法号有多近。
 *
 * 中图法本身是层级编码，**共同前缀越长 = 学科越近**，
 * 所以不需要另外维护一张"主题相似度表"，编码结构本身就是距离度量：
 *   I247.5 vs I247.7 → 共同前缀 "I247." → 很近（都是中国当代小说）
 *   I247.5 vs I226   → 共同前缀 "I2"    → 中等（都是中国文学）
 *   I247.5 vs TP311  → 共同前缀 ""      → 无关
 *
 * 返回 0..1，1 表示同一类。上架算法用它决定"哪些书该挨着放"。
 */
export function clcCloseness(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeClc(a);
  const y = normalizeClc(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  let common = 0;
  const n = Math.min(x.length, y.length);
  while (common < n && x[common] === y[common]) common++;
  if (common === 0) return 0;

  // 用较长那个作分母：I2 和 I247.57 的共同前缀虽短，但前者是后者的祖先，
  // 仍算比较近；纯靠绝对长度会低估这种包含关系。
  const denom = Math.max(x.length, y.length);
  const base = common / denom;

  // 大类相同至少给 0.25 的底分（同在 I 类的书总比跨到 T 类近）
  return x[0] === y[0] ? Math.max(0.25, base) : base * 0.5;
}

/** 取到指定层级的前缀，用于把书按"类目段"分组：I247.57 → I247（depth=4） */
export function clcPrefix(clc: string | null | undefined, depth = 4): string | null {
  const norm = normalizeClc(clc);
  if (!norm) return null;
  return norm.slice(0, Math.min(depth, norm.length));
}

// ---------------------------------------------------------------- 规则推断

const CJK = /[一-鿿]/;

function hits(keyword: string, text: string): boolean {
  if (CJK.test(keyword)) return text.includes(keyword);
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}(e?s)?([^a-z0-9]|$)`, "i").test(text);
}

interface ClcRule {
  clc: string;
  keywords: string[];
  /**
   * 弱规则：只有在**没有任何别的规则命中**时才采用。
   *
   * 「科普」「popular science」描述的是**写法**，不是**学科**。
   * 一本讲历史的科普书属于 K，不属于"科普"。可打分是按关键词长度加权的
   * （`1 + len/12`），于是 "popular science"（15 字符）能盖过 "history"（7 字符）——
   * 线上真发生了：Sapiens 的 subjects 是 science / popular science / history，
   * 规则给出 N4 科普，而它是本人类史。
   *
   * 和工具书那道否决是同一类道理：有些词说的是这本书**长什么样**，
   * 不是它**讲什么**，不能拿来和真正的学科词平起平坐地比分。
   */
  weak?: boolean;
}

/** 关键词 → 中图法号。中文优先，因为这个家的书以中文为主。 */
const RULES: ClcRule[] = [
  { clc: "TP311", keywords: ["编程", "程序设计", "算法", "软件工程", "programming", "algorithm", "python", "javascript", "java语言"] },
  { clc: "TP18", keywords: ["人工智能", "机器学习", "深度学习", "artificial intelligence", "machine learning", "neural network"] },
  { clc: "TP3", keywords: ["计算机", "computer science", "computing", "数据库", "database"] },
  { clc: "V2", keywords: ["航空", "飞机", "aviation", "aircraft", "飞行"] },
  { clc: "V4", keywords: ["航天", "火箭", "spaceflight", "spacecraft", "astronautics"] },
  { clc: "TS97", keywords: ["烹饪", "食谱", "菜谱", "美食", "cooking", "cookbook", "recipe"] },
  { clc: "TU", keywords: ["建筑设计", "architecture", "建筑学"] },
  { clc: "O13", keywords: ["高等数学", "微积分", "calculus"] },
  { clc: "O17", keywords: ["数学分析", "mathematical analysis"] },
  { clc: "O1", keywords: ["数学", "mathematics", "代数", "几何", "algebra", "geometry"] },
  { clc: "O41", keywords: ["理论物理", "量子", "相对论", "quantum", "relativity", "particle physics"] },
  { clc: "O4", keywords: ["物理", "physics"] },
  { clc: "O6", keywords: ["化学", "chemistry"] },
  { clc: "P1", keywords: ["天文", "宇宙", "astronomy", "cosmology", "universe"] },
  { clc: "P5", keywords: ["地质", "geology"] },
  { clc: "Q3", keywords: ["遗传", "进化", "基因", "genetics", "evolution", "dna"] },
  { clc: "Q91", keywords: ["古生物", "恐龙", "化石", "palaeontology", "dinosaur", "fossil"] },
  { clc: "Q95", keywords: ["动物", "zoology", "animal"] },
  { clc: "Q94", keywords: ["植物", "botany", "plant"] },
  { clc: "Q98", keywords: ["人类学", "人类简史", "anthropology", "human evolution"] },
  { clc: "Q1", keywords: ["生物学", "biology", "生命科学"] },
  { clc: "N4", keywords: ["科普", "popular science"], weak: true },
  { clc: "R15", keywords: ["营养", "nutrition", "膳食"] },
  { clc: "R2", keywords: ["中医", "中药", "traditional chinese medicine"] },
  { clc: "R1", keywords: ["养生", "健康", "卫生", "health", "fitness"] },
  { clc: "R4", keywords: ["临床", "疾病", "medicine", "disease"] },
  { clc: "X", keywords: ["环境保护", "生态", "气候变化", "environment", "ecology", "climate"] },
  { clc: "F81", keywords: ["财政", "税收", "赋税", "taxation", "public finance"] },
  { clc: "F83", keywords: ["金融", "投资", "股票", "理财", "finance", "investment", "banking"] },
  { clc: "F27", keywords: ["企业管理", "创业", "management", "startup", "entrepreneur"] },
  { clc: "F1", keywords: ["世界经济", "全球化", "world economy"] },
  { clc: "F0", keywords: ["经济学", "economics", "政治经济学"] },
  { clc: "C91", keywords: ["社会学", "sociology", "社会研究"] },
  { clc: "C93", keywords: ["管理学", "组织行为"] },
  { clc: "D9", keywords: ["法律", "宪法", "民法", "law", "legal"] },
  { clc: "D5", keywords: ["国际关系", "地缘政治", "international relations", "diplomacy"] },
  { clc: "D6", keywords: ["中国政治", "国情"] },
  { clc: "E", keywords: ["军事", "战争史", "military", "warfare"] },
  { clc: "G64", keywords: ["高等教育", "大学教育"] },
  { clc: "G63", keywords: ["中学", "高考", "中等教育"] },
  { clc: "G62", keywords: ["小学", "primary education"] },
  // 育儿书在家庭书架上是一大块，而"育儿"里没有"教育"两个字，
  // 以前只能靠 G4 的"教育"子串蒙对一部分（"家庭教育"能中，"育儿"中不了）。
  { clc: "G61", keywords: ["育儿", "婴幼儿", "早教", "亲子", "parenting", "child care"] },
  { clc: "G4", keywords: ["教育", "教学", "education", "teaching", "教材", "textbook"] },
  { clc: "G8", keywords: ["体育", "运动", "健身", "sports", "athletic"] },
  { clc: "G25", keywords: ["图书馆", "library science"] },
  { clc: "H31", keywords: ["英语", "english language", "英语语法", "toefl", "ielts"] },
  { clc: "H36", keywords: ["日语", "japanese language"] },
  { clc: "H1", keywords: ["汉语", "现代汉语", "古汉语", "chinese language"] },
  { clc: "J6", keywords: ["音乐", "乐理", "music"] },
  { clc: "J4", keywords: ["摄影", "photography"] },
  { clc: "J2", keywords: ["绘画", "画册", "painting", "drawing"] },
  { clc: "J5", keywords: ["设计", "工艺美术", "design"] },
  // 通用美术/艺术理论。**故意不收裸的"艺术"** —— 它是"领导的艺术"、
  // "沟通的艺术"、"说话的艺术"的子串，那些都不是 J 类。
  // 和单字关键词是同一类教训：关键词越泛，命中的越可能是修辞而不是学科。
  { clc: "J0", keywords: ["美术", "艺术史", "艺术理论", "art history", "fine art"] },
  { clc: "J9", keywords: ["电影", "影视", "film", "cinema"] },
  { clc: "B84", keywords: ["心理学", "psychology", "psychological", "认知"] },
  { clc: "B848", keywords: ["自我修养", "励志", "自助", "self-help", "habits", "成功学"] },
  { clc: "B94", keywords: ["佛教", "禅", "buddhism"] },
  { clc: "B972", keywords: ["基督教", "圣经", "christianity", "bible"] },
  { clc: "B97", keywords: ["伊斯兰", "islam", "古兰经"] },
  { clc: "B22", keywords: ["论语", "老子", "庄子", "孔子", "儒家", "道家", "诸子"] },
  { clc: "B2", keywords: ["中国哲学", "chinese philosophy"] },
  { clc: "B5", keywords: ["西方哲学", "western philosophy", "存在主义", "现象学"] },
  { clc: "B0", keywords: ["哲学", "philosophy", "形而上学"] },
  { clc: "K248", keywords: ["明朝", "明史", "ming dynasty"] },
  { clc: "K249", keywords: ["清朝", "清史", "qing dynasty"] },
  { clc: "K20", keywords: ["中国通史", "中国历史", "chinese history"] },
  { clc: "K2", keywords: ["中国史", "国史"] },
  { clc: "K313", keywords: ["日本史", "japanese history"] },
  { clc: "K56", keywords: ["英国史", "british history"] },
  { clc: "K5", keywords: ["欧洲史", "european history", "history of europe"] },
  { clc: "K712", keywords: ["美国史", "american history", "united states history"] },
  { clc: "K1", keywords: ["世界史", "world history", "人类史", "文明史", "global history"] },
  { clc: "K81", keywords: ["传记", "自传", "回忆录", "biography", "autobiography", "memoir"] },
  { clc: "K91", keywords: ["世界地理", "游记", "旅行", "travel", "geography"] },
  // 兜底的"历史"。上面十来条全是具体的（明史、欧洲史、world history…），
  // 唯独漏了最常见的那个词本身 —— 一本 subjects 只写 "history" 的书，
  // 之前一条都命中不了。线上 Sapiens 就是这么落到 N4 科普去的。
  // 放在最后：更具体的号（K248 明史）本来就会靠号长赢过它。
  { clc: "K", keywords: ["历史", "history", "历史学"] },
  { clc: "K92", keywords: ["中国地理", "中国游记"] },
  { clc: "Z2", keywords: ["百科全书", "encyclopedia"] },
];

/** 文学：按语言 + 体裁 + 时代定号，这是中图法相对 DDC 最大的优势区 */
type Genre = "fiction" | "novel_long" | "short" | "poetry" | "drama" | "essay" | "children" | "general";

function detectGenre(text: string): Genre {
  if (/(儿童|童话|绘本|少儿|children|picture book|juvenile)/i.test(text)) return "children";
  if (/(诗集|诗歌|诗选|poetry|poems|verse)/i.test(text)) return "poetry";
  if (/(戏剧|剧本|话剧|drama|theatre)/i.test(text)) return "drama";
  if (/(散文|随笔|杂文|essays?)/i.test(text)) return "essay";
  if (/(中短篇|短篇|short stor)/i.test(text)) return "short";
  if (/(长篇)/i.test(text)) return "novel_long";
  if (/(小说|fiction|novel)/i.test(text)) return "fiction";
  return "general";
}

const LIT_BY_LANG: Record<string, Partial<Record<Genre, string>> & { general: string }> = {
  zh: {
    general: "I2", fiction: "I247.5", novel_long: "I247.57", short: "I247.7",
    poetry: "I226", drama: "I23", essay: "I267", children: "I287",
  },
  ja: { general: "I313", fiction: "I313.45", children: "I313.8" },
  ko: { general: "I312", fiction: "I312.45" },
  en: { general: "I561", fiction: "I561.45", poetry: "I561.2", children: "I561.88" },
  ru: { general: "I512", fiction: "I512.45", poetry: "I512.2" },
  fr: { general: "I565", fiction: "I565.45" },
  de: { general: "I516", fiction: "I516.45" },
  es: { general: "I551", fiction: "I551.45" },
  it: { general: "I545", fiction: "I545.45" },
};

/** 美国作家要单独挑出来，否则会和英国文学混在 I561 */
const US_HINTS = ["american", "美国", "u.s.", "united states"];

/**
 * 从主题词/书名里认出**原作语言**。
 * 不能直接用 Book.language —— 那是手上这个版本的语言：
 * 《罪与罚》的英译本 language=en，但它是俄国文学，中图法要归 I512。
 */
const ORIGIN_HINTS: [RegExp, string][] = [
  [/(russian literature|俄国文学|俄罗斯文学|苏联文学)/i, "ru"],
  [/(chinese literature|中国文学|中国当代|中国现代)/i, "zh"],
  [/(japanese literature|日本文学|日本小说)/i, "ja"],
  [/(korean literature|韩国文学|朝鲜文学)/i, "ko"],
  [/(french literature|法国文学)/i, "fr"],
  [/(german literature|德国文学|德语文学)/i, "de"],
  [/(italian literature|意大利文学)/i, "it"],
  [/(spanish literature|西班牙文学)/i, "es"],
  [/(american literature|美国文学)/i, "us"],
  [/(english literature|british literature|英国文学)/i, "en"],
];

function originLanguage(text: string, fallback: string | null | undefined): { lang: string; explicit: boolean } {
  for (const [re, lang] of ORIGIN_HINTS) if (re.test(text)) return { lang, explicit: true };
  return { lang: fallback ?? "zh", explicit: false };
}

/**
 * 中文版译作，作者名前面几乎一定带国别方括号：
 *   `[哥伦比亚] 加西亚·马尔克斯`、`[德]歌德`、`(美) 海明威`
 * 这是中文书目里判断**原作国别**最可靠的信号，而且它一直就躺在 authors 里没人用。
 *
 * 不看它会出真错：《百年孤独》的中文版 language=zh，主题词里也没有"哥伦比亚文学"
 * 这种字样，于是规则一路掉进"中国当代长篇小说 I247.5"——
 * 一本哥伦比亚小说被摆进了中国文学区。
 */
const AUTHOR_COUNTRY_RE = /[[［(（]\s*([\u4e00-\u9fa5]{1,6})\s*[\]］)）]/;

/** 有细分号的国家 → 直接给语种键，后面还能按体裁细化 */
const COUNTRY_LANG: [RegExp, string][] = [
  [/^(中国|中國|中)$/, "zh"],
  [/^(日本|日)$/, "ja"],
  [/^(韩国|韓國|韩|朝鲜|朝)$/, "ko"],
  [/^(美国|美)$/, "us"],
  [/^(英国|英)$/, "en"],
  [/^(法国|法)$/, "fr"],
  [/^(德国|德)$/, "de"],
  [/^(俄罗斯|俄国|俄|苏联|苏)$/, "ru"],
  [/^(意大利|意)$/, "it"],
  [/^(西班牙|西)$/, "es"],
];

/**
 * 没有细分号的国家 → 至少把**大洲/语区**判对。
 * I2（中国文学）和 I73（拉丁美洲文学）差着十万八千里；
 * 与其猜错成中国文学，不如给一个粗一点但确实对的号，小数位交给模型去补。
 * 这和详情页那句"推断的号只精确到三位，编出更多小数位只会显得准"是同一个原则。
 */
const COUNTRY_REGION: [RegExp, string][] = [
  [/^(哥伦比亚|阿根廷|智利|秘鲁|巴西|墨西哥|古巴|乌拉圭|委内瑞拉|玻利维亚|厄瓜多尔|巴拉圭)$/, "I73"],
  [/^(加拿大)$/, "I7"],
  [/^(澳大利亚|澳|新西兰)$/, "I6"],
  [/^(印度|巴基斯坦|孟加拉|斯里兰卡|尼泊尔)$/, "I351"],
  [/^(越南|泰国|泰|印尼|印度尼西亚|菲律宾|马来西亚|新加坡|缅甸|柬埔寨|蒙古)$/, "I3"],
  [/^(伊朗|波斯|土耳其|以色列|黎巴嫩|叙利亚|伊拉克|阿拉伯|沙特)$/, "I3"],
  [/^(埃及|尼日利亚|南非|肯尼亚|摩洛哥|阿尔及利亚|苏丹)$/, "I4"],
  [/^(奥地利|瑞士|捷克|斯洛伐克|波兰|匈牙利|罗马尼亚|保加利亚|塞尔维亚|克罗地亚|乌克兰|白俄罗斯)$/, "I5"],
  [/^(挪威|瑞典|丹麦|芬兰|冰岛)$/, "I5"],
  [/^(荷兰|比利时|葡萄牙|希腊|爱尔兰|爱沙尼亚|拉脱维亚|立陶宛)$/, "I5"],
];

type AuthorOrigin =
  | { kind: "lang"; lang: string }
  | { kind: "region"; clc: string }
  | { kind: "foreign_unknown" }
  | null;

function authorOrigin(authors: string[] | undefined): AuthorOrigin {
  for (const raw of authors ?? []) {
    const m = AUTHOR_COUNTRY_RE.exec(raw ?? "");
    if (!m) continue;
    const country = m[1];
    for (const [re, lang] of COUNTRY_LANG) if (re.test(country)) return { kind: "lang", lang };
    for (const [re, clc] of COUNTRY_REGION) if (re.test(country)) return { kind: "region", clc };
    // 方括号里是个国名模样的东西，但表里没有 —— 只能确定"不是中国"。
    // 这时宁可交给模型，也不要顺着 language=zh 掉进中国文学。
    if (/[国国家亚洲]/.test(country) || country.length >= 2) return { kind: "foreign_unknown" };
  }
  return null;
}

/**
 * 中国文学要先判时代 —— 中图法把古代和现当代分在完全不同的号段。
 * 不判时代的话《唐诗三百首》会掉进"现当代诗歌 I226"，《红楼梦》会掉进
 * "当代长篇小说 I247.5"，两个都离谱。
 */
function classicalChinese(text: string, genre: Genre): string | null {
  const isClassical =
    /(古代|古典|先秦|汉赋|唐诗|宋词|唐|宋|元曲|明清|章回|文言|诗经|楚辞|乐府)/.test(text);
  if (!isClassical) return null;
  if (/唐诗/.test(text)) return "I222.7";
  if (/(宋词|词选|花间集)/.test(text)) return "I222.8";
  if (genre === "poetry") return "I222";
  if (genre === "drama") return "I23";
  // 章回小说、四大名著这类
  if (genre === "fiction" || genre === "novel_long" || genre === "short") return "I242.4";
  return "I2";
}

export interface ClcInferInput {
  title?: string | null;
  subtitle?: string | null;
  /** 译作的作者名带国别方括号，是判断原作国别最可靠的证据 */
  authors?: string[];
  subjects?: string[];
  tags?: string[];
  language?: string | null;
  summary?: string | null;
  publisher?: string | null;
}

export interface ClcInference {
  clc: string;
  matched: string[];
  confidence: number;
}

const W = { subject: 5, title: 3, tag: 3, summary: 1 } as const;
const MIN_CONFIDENCE = 3;

export function inferClcByRules(input: ClcInferInput): ClcInference | null {
  const fields: { text: string; weight: number }[] = [];
  const push = (v: string | null | undefined, w: number) => {
    if (v && v.trim()) fields.push({ text: v.toLowerCase(), weight: w });
  };
  push(input.title, W.title);
  push(input.subtitle, W.title);
  for (const s of input.subjects ?? []) push(s, W.subject);
  for (const s of input.tags ?? []) push(s, W.tag);
  push(input.summary?.slice(0, 300), W.summary);
  if (!fields.length) return null;

  let best: { rule: ClcRule; matched: string[]; score: number } | null = null;
  let weakBest: { rule: ClcRule; matched: string[]; score: number } | null = null;
  for (const rule of RULES) {
    const matched: string[] = [];
    let score = 0;
    let bestFieldWeight = 0;
    for (const kw of rule.keywords) {
      let hw = 0;
      for (const f of fields) if (hits(kw, f.text)) hw = Math.max(hw, f.weight);
      if (hw) {
        matched.push(kw);
        bestFieldWeight = Math.max(bestFieldWeight, hw);
        score += hw * (1 + Math.min(kw.length, 24) / 12);
      }
    }
    if (!matched.length) continue;
    // 号越长越具体：K248(明史) 该赢过 K20(中国通史)。
    // 但这个加分必须按证据强度缩放 —— 否则简介里偶然出现一个"基督教"，
    // B972 靠号长就能压过主题词命中的 K5，《极简欧洲史》就成了基督教读物。
    score += rule.clc.length * 1.2 * (bestFieldWeight / W.subject);
    // 弱规则单独收着，只有一个真学科都没命中时才拿出来用
    if (rule.weak) {
      if (!weakBest || score > weakBest.score) weakBest = { rule, matched, score };
    } else if (!best || score > best.score) {
      best = { rule, matched, score };
    }
  }
  best ??= weakBest;

  // 文学判定只看主题词和书名，不看简介（简介里出现"小说"两个字太常见）
  const strong = fields.filter((f) => f.weight >= W.title).map((f) => f.text).join(" ");
  // 中文关键词是**子串**匹配（见 hits），所以单字关键词非常危险：
  //   「词」→ 命中 词典 / 辞典 / 词汇 / 歌词 / 名词
  //   「曲」→ 命中 歌曲 / 作曲 / 曲线 / 弯曲
  //   「赋」→ 命中 赋税 / 天赋 / 赋值
  // 《现代汉语词典》就这么被判成了中国文学（I2）—— 一本字典摆进了小说区。
  // 所以这里一律用词组，不留单字。
  const isLit = [
    "小说", "文学", "fiction", "novel", "poetry", "verse",
    "诗歌", "诗集", "诗选", "唐诗", "宋词", "词集", "元曲", "戏曲", "汉赋", "楚辞", "乐府", "史诗",
    "散文", "随笔", "essays", "童话", "绘本", "戏剧", "drama",
  ].some((k) => hits(k, strong));

  // 工具书永远不是文学，哪怕书名里带着"诗词"两个字（《诗词大辞典》是 Z 类工具书）。
  // 这一条要在 isLit 之后否决，因为上面的词组照样可能命中。
  const isReference = ["词典", "辞典", "字典", "辞书", "工具书", "百科全书", "年鉴", "手册", "图鉴"]
    .some((k) => hits(k, strong));

  if (isLit && !isReference) {
    const genre = detectGenre(strong);

    // 作者国别优先于一切：它说的是**原作**是哪国的，
    // 而 language / 主题词说的往往只是手上这个版本。
    const byAuthor = authorOrigin(input.authors);
    if (byAuthor?.kind === "region") {
      return { clc: byAuthor.clc, matched: ["author_country"], confidence: 4 };
    }
    if (byAuthor?.kind === "foreign_unknown") return null; // 交给模型

    const origin = byAuthor?.kind === "lang"
      ? { lang: byAuthor.lang, explicit: true }
      : originLanguage(strong, input.language);
    const lang = origin.lang;

    // 没有原作语言的直接证据、而且这本不是中文书时，**不要猜**。
    // 手上这本 language=en 只说明它是英文版：《罪与罚》的企鹅版也是 en，
    // 但它是俄国文学，该进 I512 而不是英国文学 I561。
    // 这种情况交给模型 —— 它知道陀思妥耶夫斯基是俄国人，规则不知道。
    if (!origin.explicit && lang !== "zh") return null;

    if (lang === "us" || (lang === "en" && US_HINTS.some((h) => strong.includes(h)))) {
      const table = { general: "I712", fiction: "I712.45" };
      return { clc: table[genre === "fiction" ? "fiction" : "general"] ?? table.general,
               matched: ["literature", genre, "us"], confidence: W.title };
    }
    // 中文先看是不是古典，古典和现当代在中图法里号段完全不同
    if (lang === "zh") {
      const classical = classicalChinese(strong, genre);
      if (classical) {
        return { clc: classical, matched: ["literature", genre, "classical"], confidence: W.subject };
      }
    }
    const table = LIT_BY_LANG[lang] ?? LIT_BY_LANG.zh;
    // 规则命中的文学号更具体就用它
    if (best && best.rule.clc.startsWith("I") && best.score >= MIN_CONFIDENCE) {
      return { clc: best.rule.clc, matched: best.matched, confidence: best.score };
    }
    return { clc: table[genre] ?? table.general, matched: ["literature", genre], confidence: W.title };
  }

  if (best && best.score >= MIN_CONFIDENCE) {
    return { clc: best.rule.clc, matched: best.matched, confidence: best.score };
  }
  return null;
}
