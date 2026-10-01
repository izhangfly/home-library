// 真正**有用**的那类标签 —— 分类号说不出来的事
//
// 背景：这个应用有两套分类。中图法（22 个大类，校验过，决定索书号和架上顺序），
// 以及 lib/tagSuggest.ts 里那张 16 个桶的 TAXONOMY（小说/历史/哲学/科普/技术…）。
// 两套读的是**同一个 subjects 字段**，于是标签只是把分类号又说了一遍，
// 而且用的是更粗的词。线上实测六本书：
//     三体 I247.5 → 标签「小说」        （重复）
//     极简欧洲史 K5 → 标签「历史」      （重复）
//     Sapiens N4 → 标签「历史、科普」   （既重复又**和分类号矛盾**）
// 用户的原话是"我不太喜欢这些标签"—— 它们确实只是噪音。
//
// 而标签唯一不可替代的用处，恰恰一个都没被提起过：
// **书和人的关系**。这是分类号永远表达不了的。
// lib/layout.ts 的 usageOf() 一直在读下面这四个词来决定书该放多高，
// 可全项目上下（界面、文案、建议）**没有任何一处告诉过用户它们存在** ——
// 一个没人知道的隐形约定。
//
// 所以：名字定义在这里一份，算法和界面都从这里取，不再各写各的。

export interface UsageTagDef {
  name: string;
  nameEn: string;
  /** 打上之后会发生什么 —— 界面要说出来，否则又是隐形约定 */
  effect: "frequent" | "rare";
}

export const USAGE_TAGS: UsageTagDef[] = [
  { name: "在读", nameEn: "Reading", effect: "frequent" },
  { name: "待读", nameEn: "To read", effect: "frequent" },
  { name: "常翻", nameEn: "Often used", effect: "frequent" },
  { name: "借出", nameEn: "Lent out", effect: "rare" },
];

const BY_EFFECT = (e: UsageTagDef["effect"]) =>
  USAGE_TAGS.filter((t) => t.effect === e).map((t) => t.name);

export const FREQUENT_TAGS = BY_EFFECT("frequent");
export const RARE_TAGS = BY_EFFECT("rare");
export const USAGE_TAG_NAMES = USAGE_TAGS.map((t) => t.name);
