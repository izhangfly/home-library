// 杜威十进分类法（DDC）—— 给每本书一个像图书馆一样的索书号
//
// 关于精度的诚实说明（很重要）：
//   DDC 的完整类表是 OCLC 的版权资产，这里不可能也不应该复刻。
//   实测 8 本书里只有 1 本能从 OpenLibrary 拿到权威 DDC（891.73/3）。
//   所以绝大多数书的号是**推断**出来的。精度按来源区别对待：
//     * 权威来源(openLibrary) → 原样保留，可能带多位小数（891.733）
//     * 本地规则            → 保留本文件表里抄的公开纲目号（895.13 中国小说），
//                            因为这些号是查表来的，不是算出来的
//     * 模型(ai)            → 只允许三位整数，提示词里就写死了
//   编一个看起来很精确的 "895.1352" 比给一个诚实的 "895" 更糟糕：
//   前者会让你以为它可信。ddcSource 字段一路带到界面上，就是为了让这个区别可见。

export type DdcSource = "openLibrary" | "rules" | "ai" | "manual";

export interface DdcEntry {
  code: string;
  zh: string;
  en: string;
}

/** 十大类 */
export const DDC_CLASSES: DdcEntry[] = [
  { code: "000", zh: "总类 · 计算机与信息", en: "Computer science, information & general works" },
  { code: "100", zh: "哲学与心理学", en: "Philosophy & psychology" },
  { code: "200", zh: "宗教", en: "Religion" },
  { code: "300", zh: "社会科学", en: "Social sciences" },
  { code: "400", zh: "语言", en: "Language" },
  { code: "500", zh: "自然科学与数学", en: "Science" },
  { code: "600", zh: "技术与应用科学", en: "Technology" },
  { code: "700", zh: "艺术与休闲", en: "Arts & recreation" },
  { code: "800", zh: "文学", en: "Literature" },
  { code: "900", zh: "历史与地理", en: "History & geography" },
];

/** 一百个纲（divisions）—— 家庭藏书的主力精度就在这一层 */
export const DDC_DIVISIONS: DdcEntry[] = [
  { code: "000", zh: "计算机科学与知识总论", en: "Computer science, knowledge & systems" },
  { code: "010", zh: "目录学", en: "Bibliographies" },
  { code: "020", zh: "图书馆与信息科学", en: "Library & information sciences" },
  { code: "030", zh: "百科全书", en: "Encyclopedias & books of facts" },
  { code: "040", zh: "（未分配）", en: "(Unassigned)" },
  { code: "050", zh: "期刊与连续出版物", en: "Magazines, journals & serials" },
  { code: "060", zh: "团体与博物馆", en: "Associations, organizations & museums" },
  { code: "070", zh: "新闻与出版", en: "News media, journalism & publishing" },
  { code: "080", zh: "引语汇编", en: "Quotations" },
  { code: "090", zh: "手稿与善本", en: "Manuscripts & rare books" },

  { code: "100", zh: "哲学", en: "Philosophy" },
  { code: "110", zh: "形而上学", en: "Metaphysics" },
  { code: "120", zh: "认识论", en: "Epistemology" },
  { code: "130", zh: "神秘学与超心理学", en: "Parapsychology & occultism" },
  { code: "140", zh: "哲学流派", en: "Philosophical schools of thought" },
  { code: "150", zh: "心理学", en: "Psychology" },
  { code: "160", zh: "逻辑学", en: "Logic" },
  { code: "170", zh: "伦理学", en: "Ethics" },
  { code: "180", zh: "古代·中世纪·东方哲学", en: "Ancient, medieval & eastern philosophy" },
  { code: "190", zh: "近现代西方哲学", en: "Modern western philosophy" },

  { code: "200", zh: "宗教", en: "Religion" },
  { code: "210", zh: "宗教哲学", en: "Philosophy & theory of religion" },
  { code: "220", zh: "圣经", en: "The Bible" },
  { code: "230", zh: "基督教神学", en: "Christianity" },
  { code: "240", zh: "基督教实践", en: "Christian practice & observance" },
  { code: "250", zh: "教会与教团", en: "Christian orders & local church" },
  { code: "260", zh: "教会社会神学", en: "Social & ecclesiastical theology" },
  { code: "270", zh: "基督教史", en: "History of Christianity" },
  { code: "280", zh: "基督教派", en: "Christian denominations" },
  { code: "290", zh: "其他宗教", en: "Other religions" },

  { code: "300", zh: "社会科学与社会学", en: "Social sciences & sociology" },
  { code: "310", zh: "统计学", en: "Statistics" },
  { code: "320", zh: "政治学", en: "Political science" },
  { code: "330", zh: "经济学", en: "Economics" },
  { code: "340", zh: "法律", en: "Law" },
  { code: "350", zh: "公共管理与军事", en: "Public administration & military science" },
  { code: "360", zh: "社会问题与社会服务", en: "Social problems & services" },
  { code: "370", zh: "教育", en: "Education" },
  { code: "380", zh: "商业·交通·通信", en: "Commerce, communications & transportation" },
  { code: "390", zh: "风俗与民俗", en: "Customs, etiquette & folklore" },

  { code: "400", zh: "语言", en: "Language" },
  { code: "410", zh: "语言学", en: "Linguistics" },
  { code: "420", zh: "英语", en: "English & Old English" },
  { code: "430", zh: "德语", en: "German & related languages" },
  { code: "440", zh: "法语", en: "French & related languages" },
  { code: "450", zh: "意大利语·罗马尼亚语", en: "Italian, Romanian & related languages" },
  { code: "460", zh: "西班牙语·葡萄牙语", en: "Spanish, Portuguese, Galician" },
  { code: "470", zh: "拉丁语", en: "Latin & Italic languages" },
  { code: "480", zh: "希腊语", en: "Classical & modern Greek" },
  { code: "490", zh: "其他语言（含汉语）", en: "Other languages (incl. Chinese)" },

  { code: "500", zh: "自然科学", en: "Science" },
  { code: "510", zh: "数学", en: "Mathematics" },
  { code: "520", zh: "天文学", en: "Astronomy" },
  { code: "530", zh: "物理学", en: "Physics" },
  { code: "540", zh: "化学", en: "Chemistry" },
  { code: "550", zh: "地球科学与地质学", en: "Earth sciences & geology" },
  { code: "560", zh: "古生物学", en: "Fossils & prehistoric life" },
  { code: "570", zh: "生物学", en: "Biology" },
  { code: "580", zh: "植物", en: "Plants" },
  { code: "590", zh: "动物", en: "Animals (zoology)" },

  { code: "600", zh: "技术", en: "Technology" },
  { code: "610", zh: "医学与健康", en: "Medicine & health" },
  { code: "620", zh: "工程学", en: "Engineering" },
  { code: "630", zh: "农业", en: "Agriculture" },
  { code: "640", zh: "家政与烹饪", en: "Home & family management" },
  { code: "650", zh: "管理与公共关系", en: "Management & public relations" },
  { code: "660", zh: "化学工程", en: "Chemical engineering" },
  { code: "670", zh: "制造业", en: "Manufacturing" },
  { code: "680", zh: "特种产品制造", en: "Manufacture for specific uses" },
  { code: "690", zh: "建筑营造", en: "Building & construction" },

  { code: "700", zh: "艺术", en: "Arts" },
  { code: "710", zh: "景观与区域规划", en: "Landscaping & area planning" },
  { code: "720", zh: "建筑", en: "Architecture" },
  { code: "730", zh: "雕塑与陶瓷", en: "Sculpture, ceramics & metalwork" },
  { code: "740", zh: "绘画与装饰艺术", en: "Drawing & decorative arts" },
  { code: "750", zh: "油画", en: "Painting" },
  { code: "760", zh: "版画", en: "Graphic arts" },
  { code: "770", zh: "摄影", en: "Photography & computer art" },
  { code: "780", zh: "音乐", en: "Music" },
  { code: "790", zh: "体育·游戏·休闲", en: "Sports, games & entertainment" },

  { code: "800", zh: "文学", en: "Literature" },
  { code: "810", zh: "美国文学", en: "American literature in English" },
  { code: "820", zh: "英国文学", en: "English & Old English literatures" },
  { code: "830", zh: "德语文学", en: "German & related literatures" },
  { code: "840", zh: "法语文学", en: "French & related literatures" },
  { code: "850", zh: "意大利语文学", en: "Italian, Romanian & related literatures" },
  { code: "860", zh: "西班牙语·葡萄牙语文学", en: "Spanish, Portuguese literatures" },
  { code: "870", zh: "拉丁语文学", en: "Latin & Italic literatures" },
  { code: "880", zh: "希腊语文学", en: "Classical & modern Greek literatures" },
  { code: "890", zh: "其他语言文学（含中国文学）", en: "Other literatures (incl. Chinese)" },

  { code: "900", zh: "历史", en: "History" },
  { code: "910", zh: "地理与旅行", en: "Geography & travel" },
  { code: "920", zh: "传记与谱系", en: "Biography & genealogy" },
  { code: "930", zh: "古代世界史", en: "History of ancient world (to 499)" },
  { code: "940", zh: "欧洲史", en: "History of Europe" },
  { code: "950", zh: "亚洲史", en: "History of Asia" },
  { code: "960", zh: "非洲史", en: "History of Africa" },
  { code: "970", zh: "北美洲史", en: "History of North America" },
  { code: "980", zh: "南美洲史", en: "History of South America" },
  { code: "990", zh: "其他地区史", en: "History of other areas" },
];

/** 家庭藏书常用的细分（目/节）。只收真正用得上的，不追求完整。 */
export const DDC_SECTIONS: DdcEntry[] = [
  { code: "004", zh: "计算机与数据处理", en: "Data processing & computer science" },
  { code: "005", zh: "程序设计", en: "Computer programming" },
  { code: "133", zh: "占卜与神秘学", en: "Parapsychology & occultism" },
  { code: "152", zh: "感觉与情绪", en: "Perception, movement, emotions" },
  { code: "153", zh: "认知与智力", en: "Conscious mental processes" },
  { code: "155", zh: "发展心理学", en: "Differential & developmental psychology" },
  { code: "158", zh: "应用心理学·自助", en: "Applied psychology" },
  { code: "294", zh: "印度系宗教（佛教等）", en: "Religions of Indic origin" },
  { code: "296", zh: "犹太教", en: "Judaism" },
  { code: "297", zh: "伊斯兰教", en: "Islam" },
  { code: "302", zh: "社会互动", en: "Social interaction" },
  { code: "305", zh: "社会群体", en: "Groups of people" },
  { code: "306", zh: "文化与制度", en: "Culture & institutions" },
  { code: "327", zh: "国际关系", en: "International relations" },
  { code: "332", zh: "金融", en: "Financial economics" },
  { code: "338", zh: "生产与产业", en: "Production" },
  { code: "355", zh: "军事学", en: "Military science" },
  { code: "362", zh: "社会服务", en: "Social welfare problems" },
  { code: "372", zh: "小学教育", en: "Primary education" },
  { code: "398", zh: "民间传说", en: "Folklore" },
  { code: "495", zh: "汉语·东亚语言", en: "Languages of East & Southeast Asia" },
  { code: "512", zh: "代数", en: "Algebra" },
  { code: "515", zh: "分析学", en: "Analysis" },
  { code: "516", zh: "几何", en: "Geometry" },
  { code: "519", zh: "概率与应用数学", en: "Probabilities & applied mathematics" },
  { code: "523", zh: "天体", en: "Specific celestial bodies" },
  { code: "530", zh: "物理学", en: "Physics" },
  { code: "539", zh: "近代物理", en: "Modern physics" },
  { code: "551", zh: "地质·气象·水文", en: "Geology, hydrology, meteorology" },
  { code: "576", zh: "遗传与进化", en: "Genetics & evolution" },
  { code: "577", zh: "生态学", en: "Ecology" },
  { code: "590", zh: "动物", en: "Animals" },
  { code: "599", zh: "哺乳动物", en: "Mammals" },
  { code: "612", zh: "人体生理学", en: "Human physiology" },
  { code: "613", zh: "个人健康", en: "Personal health & safety" },
  { code: "616", zh: "疾病", en: "Diseases" },
  { code: "629", zh: "航空航天工程", en: "Other branches of engineering (aerospace)" },
  { code: "641", zh: "饮食与烹饪", en: "Food & drink" },
  { code: "650", zh: "管理", en: "Management" },
  { code: "746", zh: "纺织与服装设计", en: "Textile arts" },
  { code: "770", zh: "摄影", en: "Photography" },
  { code: "781", zh: "音乐理论", en: "General principles of music" },
  { code: "796", zh: "体育运动", en: "Athletic & outdoor sports" },
  { code: "813", zh: "美国小说", en: "American fiction" },
  { code: "823", zh: "英国小说", en: "English fiction" },
  { code: "833", zh: "德语小说", en: "German fiction" },
  { code: "843", zh: "法语小说", en: "French fiction" },
  { code: "853", zh: "意大利语小说", en: "Italian fiction" },
  { code: "863", zh: "西班牙语小说", en: "Spanish fiction" },
  { code: "891", zh: "俄语等印欧语文学", en: "East Indo-European literatures (Russian)" },
  { code: "895", zh: "中日韩文学", en: "Literatures of East Asia" },
  { code: "915", zh: "亚洲地理与游记", en: "Geography of & travel in Asia" },
  { code: "941", zh: "英国史", en: "History of British Isles" },
  { code: "943", zh: "德国史", en: "History of Germany" },
  { code: "944", zh: "法国史", en: "History of France" },
  { code: "947", zh: "俄国史", en: "History of Russia" },
  { code: "951", zh: "中国史", en: "History of China" },
  { code: "952", zh: "日本史", en: "History of Japan" },
  { code: "956", zh: "中东史", en: "History of Middle East" },
  { code: "973", zh: "美国史", en: "History of United States" },
];

const BY_CODE = new Map<string, DdcEntry>();
for (const list of [DDC_CLASSES, DDC_DIVISIONS, DDC_SECTIONS]) {
  for (const e of list) BY_CODE.set(e.code, e);
}

/**
 * 清洗各来源给的 DDC。
 * OpenLibrary 会给 "891.73/3" 这种带斜杠的分段标记，斜杠只是"可截断处"的提示，不是数字。
 */
/**
 * 这个号是不是真的杜威号。
 * 三位整数，可带小数；`normalizeDdc` 太宽松（"9999" 会被截成 "999"、
 * "abc" 直接变 null），单独拿它当校验会出事。
 */
export function isValidDdc(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").replace(/\//g, "").trim();
  return /^\d{3}(\.\d+)?$/.test(v);
}

export function normalizeDdc(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/\//g, "").trim();
  const m = cleaned.match(/^(\d{1,3})(\.\d+)?/);
  if (!m) return null;
  const intPart = m[1].padStart(3, "0");
  return m[2] ? intPart + m[2] : intPart;
}

/** 推断出来的号不许太精确 —— 最多保留一位小数 */
export function limitPrecision(ddc: string, maxDecimals = 1): string {
  const [int, dec] = ddc.split(".");
  if (!dec) return int;
  const trimmed = dec.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

/** 逐级回退查标签：895.13 → 895 → 890 → 800 */
export function ddcLabel(ddc: string | null | undefined, locale: "zh" | "en" = "zh"): string | null {
  const norm = normalizeDdc(ddc);
  if (!norm) return null;
  const int = norm.split(".")[0];
  const candidates = [int, int[0] + int[1] + "0", int[0] + "00"];
  for (const c of candidates) {
    const hit = BY_CODE.get(c);
    if (hit) return locale === "zh" ? hit.zh : hit.en;
  }
  return null;
}

/** 该号属于哪个大类（用于筛选和配色） */
export function ddcMainClass(ddc: string | null | undefined): string | null {
  const norm = normalizeDdc(ddc);
  return norm ? norm[0] + "00" : null;
}

const LATIN = /^[\x20-\x7EÀ-ɏ]+$/;

/**
 * 著者号（Cutter 的简化版）：取姓的前三个字母大写。
 * 中文姓名没有"前三个字母"，取前两个汉字更符合中文书架的习惯。
 * 没有作者就退回用书名 —— 和真实图书馆的做法一致。
 */
export function cutter(authors: string[] | undefined, title: string): string {
  // 中文版外国作者常写成 "[德] 歌德"、"（美）海明威"，
  // 不剥掉国别前缀，著者号会变成 "[德" 这种没法排序的东西
  const raw = (authors?.[0] || title || "")
    .replace(/^[\[\(（【]\s*[^\]\)）】]{1,4}\s*[\]\)）】]\s*/, "")
    .trim();
  if (!raw) return "";
  if (LATIN.test(raw)) {
    // "Fyodor Dostoyevsky" → 取姓 "Dostoyevsky" → DOS
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    const surname = raw.includes(",") ? parts[0] : parts[parts.length - 1];
    return surname.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  }
  return raw.slice(0, 2);
}

/** 索书号 = DDC + 著者号，例如 "823 TOL"、"895.1 刘慈" */
export function buildCallNumber(
  ddc: string | null | undefined,
  authors: string[] | undefined,
  title: string,
): string | null {
  const norm = normalizeDdc(ddc);
  if (!norm) return null;
  const c = cutter(authors, title);
  return c ? `${norm} ${c}` : norm;
}

/**
 * 排序键：DDC 要按小数大小排（331 在 331.01 前面，331.041 在 331.042 前面），
 * 直接按字符串排会错。补零到定长再拼著者号即可正确排序。
 */
export function callNumberSortKey(ddc: string | null | undefined, cutterCode: string): string {
  const norm = normalizeDdc(ddc);
  if (!norm) return "￿"; // 没有号的排最后
  const [int, dec = ""] = norm.split(".");
  return `${int.padStart(3, "0")}.${dec.padEnd(6, "0")} ${cutterCode}`;
}

// ---------------------------------------------------------------- 规则推断

interface Rule {
  ddc: string;
  keywords: string[];
}

/**
 * 关键词 → DDC。命中越具体的规则越优先（按 ddc 长度和关键词长度排序）。
 * 这一层只做"有把握"的映射，拿不准就交给上层去问模型。
 */
const RULES: Rule[] = [
  { ddc: "005", keywords: ["编程", "程序设计", "算法", "软件", "programming", "algorithm", "software", "javascript", "python"] },
  { ddc: "004", keywords: ["计算机", "computer science", "computing", "人工智能", "artificial intelligence"] },
  { ddc: "895", keywords: ["中国文学", "chinese literature", "chinese fiction", "日本文学", "japanese literature"] },
  { ddc: "891", keywords: ["russian literature", "俄国文学", "俄罗斯文学", "russian fiction"] },
  { ddc: "823", keywords: ["english fiction", "british fiction", "英国小说"] },
  { ddc: "813", keywords: ["american fiction", "美国小说"] },
  { ddc: "398", keywords: ["民间", "传说", "神话", "folklore", "mythology", "fairy tale"] },
  { ddc: "951", keywords: ["中国历史", "中国史", "history of china", "chinese history"] },
  { ddc: "952", keywords: ["日本史", "history of japan"] },
  { ddc: "973", keywords: ["american history", "united states history", "美国史"] },
  { ddc: "940", keywords: ["欧洲史", "european history", "history of europe", "world war"] },
  { ddc: "909", keywords: ["世界史", "world history", "human history", "civilization", "文明史", "人类简史"] },
  { ddc: "930", keywords: ["古代史", "ancient history", "古典时代"] },
  { ddc: "920", keywords: ["传记", "自传", "回忆录", "biography", "autobiography", "memoir"] },
  { ddc: "910", keywords: ["旅行", "游记", "地理", "travel", "geography"] },
  { ddc: "796", keywords: ["体育", "运动", "sports", "athletic", "football", "baseball"] },
  { ddc: "780", keywords: ["音乐", "music", "乐理"] },
  { ddc: "770", keywords: ["摄影", "photography"] },
  { ddc: "750", keywords: ["绘画", "油画", "painting"] },
  { ddc: "720", keywords: ["建筑", "architecture"] },
  { ddc: "700", keywords: ["艺术", "art history", "fine arts", "设计", "graphic design"] },
  { ddc: "641", keywords: ["烹饪", "食谱", "美食", "cooking", "cookbook", "food", "recipe"] },
  { ddc: "629", keywords: ["航空", "飞机", "航天", "aviation", "aircraft", "aerospace", "spaceflight"] },
  { ddc: "620", keywords: ["工程学", "engineering", "机械工程"] },
  { ddc: "616", keywords: ["疾病", "医学", "disease", "medicine", "medical"] },
  { ddc: "613", keywords: ["健康", "养生", "health", "fitness", "nutrition"] },
  { ddc: "599", keywords: ["哺乳", "mammal"] },
  { ddc: "590", keywords: ["动物", "zoology", "animal"] },
  { ddc: "580", keywords: ["植物", "botany", "plant"] },
  { ddc: "577", keywords: ["生态", "ecology", "environment", "气候", "climate"] },
  { ddc: "576", keywords: ["进化", "遗传", "evolution", "genetics", "dna"] },
  { ddc: "570", keywords: ["生物", "biology", "life science"] },
  { ddc: "551", keywords: ["地质", "气象", "geology", "meteorology", "weather"] },
  { ddc: "540", keywords: ["化学", "chemistry"] },
  { ddc: "539", keywords: ["量子", "粒子", "quantum", "particle physics", "relativity", "相对论"] },
  { ddc: "530", keywords: ["物理", "physics"] },
  { ddc: "523", keywords: ["天文", "宇宙", "astronomy", "cosmology", "universe", "space"] },
  { ddc: "510", keywords: ["数学", "mathematics", "math"] },
  { ddc: "495", keywords: ["汉语", "chinese language", "普通话", "mandarin"] },
  { ddc: "420", keywords: ["英语", "english language", "grammar", "语法"] },
  { ddc: "372", keywords: ["小学", "primary education", "启蒙"] },
  { ddc: "370", keywords: ["教育", "education", "teaching", "教材", "textbook"] },
  { ddc: "362", keywords: ["社会服务", "social welfare", "social problems"] },
  { ddc: "355", keywords: ["军事", "military", "战争", "warfare"] },
  { ddc: "340", keywords: ["法律", "law", "legal"] },
  { ddc: "338", keywords: ["产业", "industry", "production"] },
  { ddc: "332", keywords: ["金融", "投资", "finance", "investment", "banking"] },
  { ddc: "330", keywords: ["经济", "economics", "economy"] },
  { ddc: "327", keywords: ["国际关系", "international relations", "diplomacy", "外交"] },
  { ddc: "320", keywords: ["政治", "politics", "political"] },
  { ddc: "306", keywords: ["文化人类学", "cultural anthropology", "customs"] },
  { ddc: "305", keywords: ["社会群体", "gender", "女性", "feminism", "race"] },
  { ddc: "302", keywords: ["社会学", "sociology", "social interaction"] },
  { ddc: "297", keywords: ["伊斯兰", "islam", "muslim", "quran"] },
  { ddc: "296", keywords: ["犹太", "judaism", "jewish"] },
  { ddc: "294", keywords: ["佛教", "buddhism", "hindu", "印度教"] },
  { ddc: "230", keywords: ["基督教", "christianity", "christian"] },
  { ddc: "220", keywords: ["圣经", "bible"] },
  { ddc: "200", keywords: ["宗教", "religion"] },
  { ddc: "170", keywords: ["伦理", "道德", "ethics", "moral"] },
  { ddc: "160", keywords: ["逻辑", "logic"] },
  { ddc: "158", keywords: ["自助", "励志", "self-help", "success", "habits", "习惯"] },
  { ddc: "155", keywords: ["发展心理", "儿童心理", "developmental psychology"] },
  { ddc: "153", keywords: ["认知", "思维", "cognition", "thinking", "intuition", "reasoning", "memory"] },
  { ddc: "150", keywords: ["心理学", "psychology", "psychological"] },
  { ddc: "180", keywords: ["东方哲学", "eastern philosophy", "儒", "道家", "confucian", "taoism"] },
  { ddc: "100", keywords: ["哲学", "philosophy"] },
  { ddc: "030", keywords: ["百科", "encyclopedia"] },
  { ddc: "050", keywords: ["杂志", "期刊", "magazine", "periodical", "journal"] },
];

/**
 * 文学作品按「原作语言 + 体裁」定号。
 *
 * 用户提的问题很对：所有中文书一股脑丢进 895 等于没分类 —— 一个书架上全是 895 开头，
 * 索书号就失去了排序意义。DDC 本身是有细分的，这里用上：
 *   895.1 中国文学 / 895.13 中国小说 / 895.11 中国诗歌 / 895.6 日本文学
 * 这些号来自 DDC 公开的纲目表（不是模型编的），所以可以保留小数位。
 *
 * 注意：**只有真正的文学作品才走这条路**。中文教材、中文科普、中文历史
 * 都应该按学科归类（370 / 5xx / 951），和英文书一视同仁。
 */
type Genre = "fiction" | "poetry" | "drama" | "essay" | "general";

const LITERATURE_BY_LANG: Record<string, Partial<Record<Genre, string>> & { general: string }> = {
  zh: { general: "895.1", fiction: "895.13", poetry: "895.11", drama: "895.12", essay: "895.14" },
  ja: { general: "895.6", fiction: "895.63", poetry: "895.61" },
  ko: { general: "895.7", fiction: "895.73" },
  en: { general: "820", fiction: "823", poetry: "821", drama: "822", essay: "824" },
  ru: { general: "891.7", fiction: "891.73", poetry: "891.71" },
  fr: { general: "840", fiction: "843", poetry: "841" },
  de: { general: "830", fiction: "833", poetry: "831" },
  es: { general: "860", fiction: "863" },
  it: { general: "850", fiction: "853" },
};

function detectGenre(text: string): Genre {
  if (/(诗集|诗歌|诗选|poetry|poems|verse)/i.test(text)) return "poetry";
  if (/(戏剧|剧本|话剧|drama|play(s)?\b|theatre)/i.test(text)) return "drama";
  if (/(散文|随笔|杂文|essays?)/i.test(text)) return "essay";
  if (/(小说|长篇|短篇|fiction|novel)/i.test(text)) return "fiction";
  return "general";
}

function literatureNumber(language: string | null | undefined, text: string): string {
  const table = LITERATURE_BY_LANG[language ?? ""] ?? null;
  if (!table) return "800";
  const genre = detectGenre(text);
  return table[genre] ?? table.general;
}

export interface DdcInferInput {
  title?: string | null;
  subtitle?: string | null;
  subjects?: string[];
  tags?: string[];
  language?: string | null;
  summary?: string | null;
}

export interface DdcInference {
  ddc: string;
  matched: string[];
  /** 证据强度，低于阈值的结果不该直接采用 */
  confidence: number;
}

const CJK = /[一-鿿]/;

/**
 * 关键词匹配。
 *
 * 拉丁词必须按**词边界**匹配 —— 一开始图省事用了子串包含，结果
 * "art" 命中了 Sapiens 主题词里的 "…civilization" 之类，
 * 把一本人类简史判成了艺术类(700)。中文没有词边界，只能用子串。
 */
function hits(keyword: string, text: string): boolean {
  if (CJK.test(keyword)) return text.includes(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 允许复数：编目主题词几乎都是复数（"Computer algorithms"、"Mammals"），
  // 而关键词表写的是单数。不放宽的话 algorithm 匹配不上 algorithms。
  return new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?([^a-z0-9]|$)`, "i").test(text);
}

/**
 * 证据分场合计权：主题词是编目员给的，最可信；书名次之；
 * 简介最不可信（一段话里出现"心理""文化"太容易了，罪与罚就是这么被判成心理学的）。
 */
const FIELD_WEIGHT = { subject: 5, title: 3, tag: 3, summary: 1 } as const;

/** 只靠简介里一个词就下结论太草率，要求总证据达到这个强度 */
const MIN_CONFIDENCE = 3;

export function inferDdcByRules(input: DdcInferInput): DdcInference | null {
  const fields: { text: string; weight: number }[] = [];
  const push = (v: string | null | undefined, weight: number) => {
    if (v && v.trim()) fields.push({ text: v.toLowerCase(), weight });
  };

  push(input.title, FIELD_WEIGHT.title);
  push(input.subtitle, FIELD_WEIGHT.title);
  for (const s of input.subjects ?? []) push(s, FIELD_WEIGHT.subject);
  for (const s of input.tags ?? []) push(s, FIELD_WEIGHT.tag);
  push(input.summary?.slice(0, 300), FIELD_WEIGHT.summary);

  if (!fields.length) return null;

  let best: { rule: Rule; matched: string[]; score: number } | null = null;
  for (const rule of RULES) {
    const matched: string[] = [];
    let score = 0;
    for (const kw of rule.keywords) {
      let hitWeight = 0;
      for (const f of fields) if (hits(kw, f.text)) hitWeight = Math.max(hitWeight, f.weight);
      if (hitWeight) {
        matched.push(kw);
        // 长关键词更具体（"russian literature" 比 "art" 靠谱得多）
        score += hitWeight * (1 + Math.min(kw.length, 24) / 12);
      }
    }
    if (!matched.length) continue;
    if (!best || score > best.score) best = { rule, matched, score };
  }

  // 文学作品单独走一条路：按**原作语言**定类，别让"文化""社会"这类泛词抢走。
  // 判定依据只认主题词和书名，不认简介 —— 简介里出现"小说"两个字太常见。
  const strongText = fields
    .filter((f) => f.weight >= FIELD_WEIGHT.title)
    .map((f) => f.text)
    .join(" ");
  const isFiction = ["fiction", "novel", "小说", "literature", "文学", "poetry", "诗"].some((k) =>
    hits(k, strongText),
  );
  if (isFiction) {
    const byLang = literatureNumber(input.language, strongText);
    if (best && best.rule.ddc.startsWith("8")) {
      // 语言+体裁号如果是命中号的细化（895 → 895.13），用细的那个：
      // 一屋子中文书全是 895 的话，索书号就失去排序意义了
      const finer = byLang.startsWith(best.rule.ddc) && byLang.length > best.rule.ddc.length;
      return {
        ddc: finer ? byLang : best.rule.ddc,
        matched: finer ? [...best.matched, detectGenre(strongText)] : best.matched,
        confidence: best.score,
      };
    }
    return {
      ddc: byLang,
      matched: ["literature", detectGenre(strongText)],
      confidence: FIELD_WEIGHT.title,
    };
  }

  if (best && best.score >= MIN_CONFIDENCE) {
    return { ddc: best.rule.ddc, matched: best.matched, confidence: best.score };
  }
  // 证据不够就别硬给号，交给模型 —— 错号比没号更难发现
  return null;
}

/** 大类配色 —— 书架地图和索书号标签用，让同类书视觉上聚在一起 */
export const DDC_CLASS_COLOR: Record<string, string> = {
  "000": "#6B7280",
  "100": "#8B5CF6",
  "200": "#A855F7",
  "300": "#0EA5E9",
  "400": "#14B8A6",
  "500": "#16A34A",
  "600": "#F97316",
  "700": "#EC4899",
  "800": "#FDC800",
  "900": "#DC2626",
};
