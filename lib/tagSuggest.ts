import { clcMainClass } from "./clc";
import { USAGE_TAGS } from "./usageTags";

// F2 —— 标签建议
//
// 刻意做成规则匹配而不是调模型：分类只有十几个桶，规则又快又免费又可预测，
// 而且用户随时能改。目标是"少打几次字"，不是"全自动分类"。

/**
 * 内置的朴素分类：关键词 → 标签。中英文关键词都收，数据源给什么语言都能命中。
 *
 * `clc` 那一栏是**这个标签其实在重复中图法的哪个大类**。
 * 这张表和中图法规则读的是同一个 subjects 字段，于是绝大多数时候
 * 它只是把分类号又说了一遍，而且用的是更粗的词。线上六本书全中：
 * 三体 I247.5→「小说」、极简欧洲史 K5→「历史」、Sapiens N4→「历史、科普」。
 * 用户说"我不太喜欢这些标签"，说的就是这个 —— 它们不带新信息。
 *
 * 所以建议的时候要拿它和这本书已经定下的大类比一比：一样就别建议了。
 * 分类号已经写在书脊标签上、决定了它摆在哪一段，标签再说一遍纯属占地方。
 */
const TAXONOMY: { zh: string; en: string; keywords: string[]; clc?: string }[] = [
  { clc: "I", zh: "小说", en: "Fiction", keywords: ["小说", "长篇", "短篇", "fiction", "novel", "novels", "stories"] },
  { clc: "I", zh: "科幻", en: "Sci-Fi", keywords: ["科幻", "science fiction", "sci-fi", "fantasy", "奇幻"] },
  { clc: "I", zh: "推理", en: "Mystery", keywords: ["推理", "悬疑", "侦探", "mystery", "detective", "thriller", "crime"] },
  { clc: "K", zh: "历史", en: "History", keywords: ["历史", "史", "history", "historical", "ancient", "medieval"] },
  { clc: "K", zh: "传记", en: "Biography", keywords: ["传记", "自传", "回忆录", "biography", "autobiography", "memoir"] },
  { clc: "B", zh: "哲学", en: "Philosophy", keywords: ["哲学", "思想", "philosophy", "ethics", "logic"] },
  { clc: "C", zh: "社科", en: "Social science", keywords: ["社会", "政治", "经济", "法律", "人类学", "social", "politic", "econom", "law", "sociology"] },
  { clc: "N", zh: "科普", en: "Science", keywords: ["科普", "科学", "物理", "化学", "生物", "天文", "science", "physics", "chemistry", "biology", "astronomy", "mathematics", "数学"] },
  { clc: "T", zh: "技术", en: "Technology", keywords: ["计算机", "编程", "工程", "技术", "航空", "computer", "programming", "engineering", "technology", "software", "aviation"] },
  { clc: "G", zh: "教材", en: "Textbook", keywords: ["教材", "教程", "课本", "习题", "考试", "辅导", "textbook", "study guide", "exam", "coursebook", "workbook"] },
  { clc: "J", zh: "艺术", en: "Art", keywords: ["艺术", "绘画", "设计", "摄影", "音乐", "art", "painting", "design", "photography", "music"] },
  { zh: "儿童", en: "Children", keywords: ["儿童", "童话", "绘本", "少儿", "juvenile", "children", "picture book"] },
  { clc: "H", zh: "语言", en: "Language", keywords: ["语言", "英语", "词典", "语法", "language", "dictionary", "grammar", "english"] },
  { zh: "杂志", en: "Magazine", keywords: ["杂志", "期刊", "magazine", "periodical", "journal"] },
  { clc: "K", zh: "旅行", en: "Travel", keywords: ["旅行", "游记", "地理", "travel", "geography", "guide"] },
  { clc: "I", zh: "文学", en: "Literature", keywords: ["文学", "散文", "诗", "随笔", "literature", "essays", "poetry", "poems"] },
];

export interface TagSuggestionInput {
  title?: string | null;
  subtitle?: string | null;
  /** 数据源给的主题词 / 分类 */
  subjects?: string[];
  publisher?: string | null;
  /** 条码类型：期刊直接建议"杂志" */
  isPeriodical?: boolean;
  /** 这本书已经定下的中图法号 —— 用来剔掉只是重复分类号的建议 */
  clc?: string | null;
  language?: string | null;
}

export interface TagSuggestion {
  /** 已存在的标签就带 id，前端一键勾选；没有的话带名字，前端可一键新建 */
  tagId?: string;
  name: string;
  nameEn: string;
  /** 命中的关键词，让用户知道为什么这么建议 */
  matched: string[];
  /**
   * 这是个"用途标签"，打上会影响这本书排在多高。
   * frequent → 黄金区优先；rare → 让出黄金区。
   * 界面要把这件事说出来，不能又变成隐形约定。
   */
  usage?: "frequent" | "rare";
}

export function suggestTags(
  input: TagSuggestionInput,
  existingTags: { id: string; name: string; nameEn: string | null }[],
): TagSuggestion[] {
  const haystack = [
    input.title,
    input.subtitle,
    input.publisher,
    ...(input.subjects ?? []),
  ]
    .filter((v): v is string => !!v)
    .join(" ")
    .toLowerCase();

  const byName = new Map<string, { id: string; name: string; nameEn: string | null }>();
  for (const tag of existingTags) {
    byName.set(tag.name.toLowerCase(), tag);
    if (tag.nameEn) byName.set(tag.nameEn.toLowerCase(), tag);
  }

  const out: TagSuggestion[] = [];

  if (input.isPeriodical) {
    const entry = TAXONOMY.find((t) => t.zh === "杂志")!;
    const existing = byName.get("杂志") ?? byName.get("magazine");
    out.push({ tagId: existing?.id, name: entry.zh, nameEn: entry.en, matched: ["ISSN"] });
  }

  // 这本书已经定下的大类。建议里凡是只重复它的，一律不给。
  const mainClass = clcMainClass(input.clc ?? null);

  for (const entry of TAXONOMY) {
    if (out.some((s) => s.name === entry.zh)) continue;
    // 分类号已经说过的事，标签别再说一遍。
    // 《三体》的号是 I247.5，书脊标签上印着 I，架上也按 I 排 ——
    // 再挂一个「小说」除了占地方没有任何作用。
    if (mainClass && entry.clc === mainClass) continue;
    const matched = entry.keywords.filter((k) => haystack.includes(k.toLowerCase()));
    if (!matched.length) continue;
    const existing = byName.get(entry.zh.toLowerCase()) ?? byName.get(entry.en.toLowerCase());
    out.push({ tagId: existing?.id, name: entry.zh, nameEn: entry.en, matched });
  }

  // 命中关键词多的排前面；最多给 4 个，多了就成噪音了
  const subjectTags = out.sort((a, b) => b.matched.length - a.matched.length).slice(0, 4);

  // 用途标签永远给 —— 这是标签唯一不可替代的用处（书和人的关系），
  // 而它在此之前**从未在界面上出现过**：usageOf() 一直在读这几个词
  // 决定书该放多高，用户却无从知道它们存在。
  // 已经打过的不再建议。
  const usage = USAGE_TAGS.filter((u) => !byName.has(u.name.toLowerCase()) || true)
    .map<TagSuggestion>((u) => ({
      tagId: byName.get(u.name.toLowerCase())?.id,
      name: u.name,
      nameEn: u.nameEn,
      matched: [],
      usage: u.effect,
    }));

  return [...subjectTags, ...usage];
}
