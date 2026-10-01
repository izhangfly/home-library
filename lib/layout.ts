// 整屋布局规划 —— 设计与取舍见 docs/shelving-v3.md
//
// 一句话概括：书有全序（索书号），所以"哪些书放哪一格"不是任意分组（NP 难），
// 而是"把一条有序序列切成连续段"（动态规划，多项式，可求全局最优）。
// 所有的可靠性都来自这一个建模决定。
//
// 三层：
//   第 0 层  货架带：把层排成人走过去依次看到的顺序
//   第 1 层  柜级 DP：有序书列 → 连续段 → 书柜
//   第 2 层  柜内 DP：一段 → 各层，这里管人体工学
// 在线插入（来一本书）走 lib/shelving.ts 的推挤路径，不跑这里。

import { clcCloseness, clcLabel, clcMainClass, clcPrefix, clcSortKey, normalizeClc } from "./clc";
import { estimateSpine, type CapacityCoefficients, DEFAULT_COEFFICIENTS } from "./capacity";
import { HOUSEHOLD, reachBand, type Person } from "./shelving";
import { FREQUENT_TAGS, RARE_TAGS } from "./usageTags";

// ---------------------------------------------------------------- 输入形状

export interface LayoutBook {
  id: string;
  title: string;
  clc: string | null;
  callSortKey: string;
  spineMm?: number | null;
  pageCount?: number | null;
  binding?: string | null;
  heightMm?: number | null;
  /** 当前所在层；null = 未上架。惯性项要用 */
  levelId: string | null;
  /** 标签名，用来判断"常翻/借出"这类分类号表达不了的事 */
  tagNames?: string[];
}

export interface LayoutLevel {
  id: string;
  bookcaseId: string;
  levelIndex: number;
  widthMm: number;
  /** 净空高度 */
  heightMm: number;
  /** 层板上表面离地高度 */
  floorMm: number;
}

export interface LayoutBookcase {
  id: string;
  name: string;
  roomId: string | null;
  roomName: string | null;
  /** 平面图坐标（毫米） */
  x: number;
  y: number;
  levels: LayoutLevel[];
}

export interface LayoutWeights {
  /** 装填率偏离目标的惩罚系数（二次） */
  fill: number;
  /** 目标装填率 —— 图书馆书库经验值 */
  fillTarget: number;
  /** 超过目标的惩罚倍数。装满一层的坏处远大于空着一层：
   *  空着只是没用上，装满则是下次插一本书就要推挤一整排。 */
  fillOver: number;
  /** 不足目标的惩罚倍数（很轻）。留白是必需品，不是浪费。 */
  fillUnder: number;
  /** 切口代价系数：在学科缝上断开才便宜 */
  cut: number;
  /** 搬一本书的代价（毫米当量）。调大 = 更保守 */
  move: number;
  /** 够不着（高于舒适区）的惩罚 */
  reach: number;
  /** 蹲下才够得着（低于舒适区）的惩罚系数，相对 reach 的折扣。
   *  弯腰只是麻烦，够不着是真拿不到 —— 两者不能同价，否则最底下两层会被算法空着 */
  crouchFactor: number;
  /** 高频书放高处 / 低频书占黄金区 的错位惩罚 */
  zone: number;
  /** 竖直距离相对水平距离的折扣 */
  vertical: number;
  /** 换一个柜子的固定代价（毫米当量） */
  bookcasePenalty: number;
  /** 换一个房间的固定代价（毫米当量） */
  roomPenalty: number;
}

export const DEFAULT_WEIGHTS: LayoutWeights = {
  fill: 1.0,
  fillTarget: 0.75,
  fillOver: 26,
  fillUnder: 0.3,
  cut: 0.6,
  move: 350,
  reach: 520,
  crouchFactor: 0.22,
  zone: 300,
  vertical: 0.3,
  bookcasePenalty: 1500,
  roomPenalty: 6000,
};

// ---------------------------------------------------------------- 读者与频次

/** 明显是给孩子看的类目。放不到孩子够得着的高度就是失败，不是"不够好"。 */
const CHILD_PREFIXES = ["I28", "G61", "G62", "J218", "Z228"];

const CHILD: Person = HOUSEHOLD.reduce((a, b) => (a.heightCm <= b.heightCm ? a : b));
/** 成人书按家里最矮的成年人算，这样谁都够得着 */
const ADULT: Person = HOUSEHOLD.filter((p) => p !== CHILD).reduce(
  (a, b) => (a.heightCm <= b.heightCm ? a : b),
  HOUSEHOLD[0],
);

export function readerOf(book: LayoutBook): Person {
  const clc = normalizeClc(book.clc) ?? "";
  return CHILD_PREFIXES.some((p) => clc.startsWith(p)) ? CHILD : ADULT;
}

export type Usage = "frequent" | "normal" | "rare";

/**
 * 这本书翻得勤不勤。
 * 没有借阅记录可依，只用手上确实有的证据；证据不足就是 normal —— 不瞎猜。
 */
export function usageOf(book: LayoutBook): Usage {
  // 名字定义在 lib/usageTags.ts 一份。以前这里写死了四个字符串，
  // 而界面上从来没有任何地方提过它们 —— 用户不可能猜到打个「常翻」
  // 会让这本书被排到黄金区。写成常量之后，界面能把同一份列表显示出来。
  const tags = book.tagNames ?? [];
  if (tags.some((t) => FREQUENT_TAGS.includes(t))) return "frequent";
  if (tags.some((t) => RARE_TAGS.includes(t))) return "rare";

  const clc = normalizeClc(book.clc) ?? "";
  // 工具书、字典、手册：要用的时候就得马上够到
  if (clc.startsWith("Z2") || clc.startsWith("H16")) return "frequent";
  // 期刊合订本、多卷本文集：翻得少，占地方
  if (book.binding === "期刊") return "rare";
  return "normal";
}

// ---------------------------------------------------------------- 距离

export function levelFloorRank(level: LayoutLevel): "low" | "golden" | "high" {
  const band = reachBand(ADULT.heightCm);
  if (level.floorMm < band.idealMin) return "low";
  if (level.floorMm > band.idealMax) return "high";
  return "golden";
}

/** 两个书柜之间的距离（毫米当量）—— 四个尺度里的后两个 */
export function bookcaseDistance(a: LayoutBookcase, b: LayoutBookcase, w = DEFAULT_WEIGHTS): number {
  if (a.id === b.id) return 0;
  const horizontal = Math.hypot(a.x - b.x, a.y - b.y);
  const roomCost = a.roomId && b.roomId && a.roomId === b.roomId ? 0 : w.roomPenalty;
  return horizontal + w.bookcasePenalty + roomCost;
}

/** 两层之间的距离，含同柜换层这个最便宜的尺度 */
export function levelDistanceIn(
  a: { level: LayoutLevel; bc: LayoutBookcase },
  b: { level: LayoutLevel; bc: LayoutBookcase },
  w = DEFAULT_WEIGHTS,
): number {
  if (a.level.id === b.level.id) return 0;
  const vertical = Math.abs(a.level.floorMm - b.level.floorMm) * w.vertical;
  if (a.bc.id === b.bc.id) return vertical;
  return vertical + bookcaseDistance(a.bc, b.bc, w);
}

// ---------------------------------------------------------------- 第 0 层：货架带

/**
 * 把书柜排成一条"人走过去会依次看到"的线。
 * 贪心最近邻，起点取离图纸左下角最近的柜子 —— 只依赖坐标，所以是确定性的：
 * 同一套户型永远得到同一条带。
 */
export function orderBookcases(bookcases: LayoutBookcase[]): LayoutBookcase[] {
  if (bookcases.length <= 1) return [...bookcases];

  const rest = [...bookcases];
  const originX = Math.min(...rest.map((b) => b.x));
  const originY = Math.min(...rest.map((b) => b.y));
  let cur = rest.reduce((best, b) =>
    Math.hypot(b.x - originX, b.y - originY) < Math.hypot(best.x - originX, best.y - originY) ? b : best,
  );
  const out: LayoutBookcase[] = [];

  while (rest.length) {
    const i = rest.indexOf(cur);
    rest.splice(i, 1);
    out.push(cur);
    if (!rest.length) break;
    // 同房间的先走完，再跳房间 —— 否则会在两个房间之间来回横跳
    const sameRoom = rest.filter((b) => b.roomId && b.roomId === cur.roomId);
    const pool = sameRoom.length ? sameRoom : rest;
    const from = cur;
    cur = pool.reduce((best, b) =>
      Math.hypot(b.x - from.x, b.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? b : best,
    );
  }
  return out;
}

/** 柜内层的带顺序：从上到下，和图书馆一架书从左上读到右下的习惯一致 */
export function orderLevels(levels: LayoutLevel[]): LayoutLevel[] {
  return [...levels].sort((a, b) => b.levelIndex - a.levelIndex);
}

/**
 * 排架序列 —— 哪些书**不和主序混排**。
 *
 * 为什么需要这个：整套算法是"按索书号切成连续段，一段给一层"。
 * 于是任何**散落在索书号各处**的属性，都没法通过调权重来影响摆放 ——
 * 期刊占全库 4%，均匀撒在每一段里，每段还是 96% 的普通书说了算。
 *
 * 这不是权重不够大。实测把 zone 权重放大一千倍（scripts/measure-layout.mts
 * 的探针），冷门书的平均离地从 750mm 变成 584mm —— **反而更低**，
 * 而且全库平均同步下降，说明它只是把整柜书往下压，从来没有把冷门书**挑出来**。
 * 连续性和"按属性挑单本"在数学上就是冲突的，调参调不出来。
 *
 * 图书馆早就有答案：期刊合订本、超大开本、少儿读物**各排各的序**，
 * 不和主序插在一起。分开之后每个序列内部仍然按索书号连续，
 * 而整段序列同属一类，zone/ergo 的偏好第一次变成**全票通过**，能真的把它挪上去。
 *
 * 童书为什么也要单列：CHILD_PREFIXES 是 I28、G61、G62、J218、Z228 ——
 * 在中图法里散成五块，隔得很远。不单列的话童书同样是"散落属性"。
 */
export type Sequence = "child" | "general" | "periodical";

/**
 * 顺序本身**不能**用来控制高度 —— 试过了，不行。
 * 把期刊排到带子最前面，它照样落在 233mm（最底下两层）：
 * 每个柜子的上下方向是各自按成本翻转的（BayResult.direction），
 * 带子上的位置到物理高度这层映射，不由序列顺序说了算。
 * 这里的先后只影响"哪一段和哪一段挨着"，别指望它管高低。
 */
const SEQUENCE_RANK: Record<Sequence, string> = { periodical: "1", general: "2", child: "3" };

export function sequenceOf(book: LayoutBook): Sequence {
  if (book.binding === "期刊") return "periodical";
  const clc = normalizeClc(book.clc) ?? "";
  if (CHILD_PREFIXES.some((p) => clc.startsWith(p))) return "child";
  return "general";
}

/**
 * 排架键 = 序列 + 索书号。**这是排架顺序唯一的定义**。
 *
 * 必须只有一份：lib/insert.ts 以前自己维护了一份 `sortKeyOf`，
 * 只要这边加了序列而那边没加，插入算出来的邻居就和整屋规划排出来的架对不上 ——
 * 一本期刊会被指到某本专著旁边，而那层上根本没有期刊。
 */
export function shelvingKey(b: LayoutBook): string {
  const call = b.callSortKey || clcSortKey(normalizeClc(b.clc), "");
  return `${SEQUENCE_RANK[sequenceOf(b)]}\u0000${call}`;
}

/** 索书号全序（含排架序列） */
export function orderBooks(books: LayoutBook[]): LayoutBook[] {
  return [...books].sort((a, b) => {
    // 索书号相同时按 id 兜底，保证确定性
    return shelvingKey(a).localeCompare(shelvingKey(b)) || a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------- 输出形状

export interface LayoutAssignment {
  bookId: string;
  levelId: string;
  fromLevelId: string | null;
  moved: boolean;
}

export interface UnplacedBook {
  bookId: string;
  title: string;
  reason: "too_tall_anywhere" | "no_capacity";
}

export interface LevelPlan {
  levelId: string;
  bookcaseId: string;
  bookIds: string[];
  usedMm: number;
  usableMm: number;
  fill: number;
  dominantClass: string | null;
  /**
   * 这一层实际放了哪几个大类，按占用宽度从多到少。
   *
   * 只报 `dominantClass` 是不够的：一层上常常挤着三四个小类
   * （每类就三五本，各占不满一层），界面只显示最大的那个，
   * 另外几个就凭空消失了 —— 用户走到架子前才发现"这里怎么还有别的书"。
   * 用户明确要求过：小类合并到一层时要**告诉他合并了什么**。
   */
  classes: { clc: string; label: string | null; count: number; mm: number }[];
}

/** 人体工学上的妥协。放不下才妥协，但一定要说出来，不能悄悄将就。 */
export interface LayoutException {
  bookId: string;
  title: string;
  levelId: string;
  kind: "out_of_reach" | "frequent_too_high";
  /** 该层离地高度，和这本书的读者能够到的上限 */
  floorMm: number;
  limitMm: number;
}

/** 「这一层是几个小类拼起来的」—— 要主动说，不能等用户自己发现 */
export interface MergeNote {
  levelId: string;
  classes: { clc: string; label: string | null; count: number; mm: number }[];
}

export interface LayoutPlan {
  assignments: LayoutAssignment[];
  levels: LevelPlan[];
  unplaced: UnplacedBook[];
  exceptions: LayoutException[];
  /** 哪些层是多个小类拼起来的 */
  merges: MergeNote[];
  moves: number;
  /** 目标函数值，用来比较两套参数的优劣 */
  cost: number;
  /** 每个柜子拿到的书区间，用来向用户解释"这个柜子现在管哪一段" */
  bays: { bookcaseId: string; bookcaseName: string; from: number; to: number; label: string | null }[];
}

/** 同步跑完 —— 测试和脚本用这个，行为和以前完全一样 */
export function planLayout(
  bookcases: LayoutBookcase[],
  books: LayoutBook[],
  opts: { weights?: Partial<LayoutWeights>; coeffs?: CapacityCoefficients } = {},
): LayoutPlan {
  const gen = planLayoutGen(bookcases, books, opts);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

/**
 * 切片跑 —— **服务端一律用这个**。
 * 每片最多占用 sliceMs 毫秒，然后把事件循环还回去，别人的请求就能插进来。
 * 总耗时略有增加（多了几次让出），但换来的是"一个人规划不会把全家卡住"。
 */
export async function planLayoutAsync(
  bookcases: LayoutBookcase[],
  books: LayoutBook[],
  opts: { weights?: Partial<LayoutWeights>; coeffs?: CapacityCoefficients } = {},
  sliceMs = 40,
): Promise<LayoutPlan> {
  const gen = planLayoutGen(bookcases, books, opts);
  let last = Date.now();
  let step = gen.next();
  while (!step.done) {
    if (Date.now() - last >= sliceMs) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      last = Date.now();
    }
    step = gen.next();
  }
  return step.value;
}

// ---------------------------------------------------------------- 代价零件

function fillPenalty(usedMm: number, usableMm: number, w: LayoutWeights): number {
  if (usableMm <= 0) return usedMm > 0 ? Infinity : 0;
  const ratio = usedMm / usableMm;
  if (ratio > 1) return Infinity; // 硬约束：放不下就是放不下
  const d = ratio - w.fillTarget;
  // 二次惩罚：线性惩罚会把空隙全推到最后一格，二次才会摊匀。
  //
  // 但**必须不对称**。对称的二次惩罚下，塞满一层（偏离 0.25）比空一层
  // （偏离 0.75）便宜九倍，算法于是把够得着的那几层塞到 100%、把够不着的空着 ——
  // 每一层都塞满意味着以后插进一本书就得推挤一整排，等于把日常上架变成了搬家。
  // 图书馆的 70–75% 规矩，本质说的就是"宁可空着，别塞满"。
  const factor = d > 0 ? w.fillOver : w.fillUnder;
  return w.fill * usableMm * d * d * factor;
}

function ergoPenalty(book: LayoutBook, level: LayoutLevel, w: LayoutWeights): number {
  const person = readerOf(book);
  const band = reachBand(person.heightCm);
  const z = level.floorMm;

  // 够不着的代价要**按取用频次折算**。
  //
  // 这一条以前漏了，后果是把"冷门书上顶层"这个需求整个抵消掉：
  // 一本一年翻两次的期刊合订本，放顶层要付满额的 reach=520，
  // 和一本每周要查的工具书**一模一样**。于是 zone 矩阵那边说"冷门的去高处"，
  // ergo 这边说"谁都别去高处"，而 reach(520) 比 zone(300) 大，永远是后者赢。
  // 实测（scripts/measure-layout.mts）：冷门书平均离地 760mm，
  // 反而比全库平均的 846mm **更低** —— 和用户要的正好相反。
  //
  // 仓储 slotting 的标准算法本来就是 频次 × 取用代价，不是光算取用代价。
  // 够不着这件事，一年只发生两次就该只算两次。
  let cost = 0;
  const rw = REACH_WEIGHT[usageOf(book)];
  if (z > band.comfortableMax) {
    cost += w.reach * rw;                       // 踮脚也够不着
  } else if (z < band.comfortableMin) {
    cost += w.reach * w.crouchFactor * rw;      // 得蹲下，麻烦但拿得到
  } else if (z > band.idealMax) {
    cost += w.reach * 0.35 * rw;
  } else if (z < band.idealMin) {
    cost += w.reach * 0.35 * w.crouchFactor * rw;
  }

  // 货位偏好矩阵（仓储 slotting 的 golden zone 思路）：
  //   常翻的 → 黄金区最好，蹲一下也行，顶层最差   ← 这一半是**有效**的（实测 0/299 常翻书在高处）
  //   不常翻 → 顶层最好（把黄金区腾出来），黄金区最亏 ← 这一半**没有生效**，见下
  //   一般的 → 三格同值，真中性（原来 low<golden，把全库往下压）
  //
  // 「冷门书上顶层」目前做不到，而且不是权重不够大的问题。
  // scripts/measure-layout.mts 的探针把 zone 放大一千倍（300 → 300000），
  // 冷门书平均离地反而从 750mm 降到 584mm，且和全库平均同步移动 ——
  // 它只是把整柜书往下压，从头到尾没有把冷门书**挑出来**过。
  //
  // 原因是结构性的：整套算法按索书号切**连续段**，一段给一层。
  // 一段书的高度由它在货架带上的位置决定，而带子的顺序是索书号定的。
  // 借出/少翻的书均匀散在各段里（约 7%），每一段仍然是九成多的普通书说了算，
  // 罚分再大也挑不出散落的少数。把期刊单独排成一个序列（sequenceOf）
  // 解决了"散落"，但没解决高度：柜子的上下方向是按整柜成本翻转的。
  //
  // 真要做到，得让用户**指定**某个柜/某几层的用途（"顶层放合订本"），
  // 那是数据模型的事，不是这里能算出来的。在那之前别再往上加权重 ——
  // 加了只会把整库往下压，而且从数字上看还像是"在起作用"。
  cost += w.zone * ZONE_COST[usageOf(book)][levelFloorRank(level)];
  return cost;
}

/**
 * 取用频次折算系数：够不着的代价乘以"多久会够一次"。
 *
 * 不是拍脑袋的数：常翻 = 一周几次，冷门 = 一年一两次，差着一个数量级；
 * 这里收敛到 4.5 倍，是因为"够不着"除了频次还有一次性的心理门槛
 * （搬凳子这件事本身讨厌），不该按纯频次线性缩放。
 */
const REACH_WEIGHT: Record<Usage, number> = {
  frequent: 1.35,
  normal: 1,
  rare: 0.3,
};

const ZONE_COST: Record<Usage, Record<"low" | "golden" | "high", number>> = {
  frequent: { golden: 0, low: 0.4, high: 1.0 },
  // 这一行必须**真的中性**。原来写的是 low:0.15 < golden:0.2 ——
  // 想表达"别去抢黄金区"，实际表达的是"普通书优先往低处走"。
  // 而普通书是全库的绝大多数，于是整个藏书被系统性地往下压，
  // 且 zone 权重越大压得越狠（实测放大一千倍时全库平均离地从 858 掉到 641）。
  normal: { golden: 0.18, low: 0.18, high: 0.18 },
  rare: { golden: 1.0, low: 0.7, high: 0 },
};

// ---------------------------------------------------------------- 第 2 层：柜内 DP

interface BayResult {
  cost: number;
  /** 每层分到的书下标区间（相对传入的 books 数组） */
  slices: { level: LayoutLevel; from: number; to: number }[];
  /** 这一柜是从上往下读还是从下往上读 */
  direction: "down" | "up";
}

/**
 * 一个书柜内部：把它拿到的那一段书切给各层。
 *
 * 规模很小（层 ≤ 10，书 ≤ 几百），直接 O(层 × 书 × 每层最多本数) 的 DP。
 * 人体工学、层高可行性都在这一层判 —— 因为只有到了具体某一层，
 * "够不够得着""放不放得下"才有意义。
 */
export function planBay(
  bookcase: LayoutBookcase,
  books: LayoutBook[],
  spine: number[],
  w: LayoutWeights,
  coeffs: CapacityCoefficients,
): BayResult {
  // 一柜之内，上下两个方向都试一遍，取便宜的那个。
  //
  // 为什么允许翻转：柜与柜之间的顺序决定"你能不能找到"，一定要单调；
  // 但一个柜子站在跟前一眼全看得见，上下方向对找书几乎没影响。
  // 而它对人体工学影响极大 —— 童书排在常用书前面时，若强行从上往下读，
  // 童书就被顶到最高层去了。放开这一个自由度，"童书在下、冷门在上"才做得到。
  const down = planBayDirected(orderLevels(bookcase.levels), books, spine, w, coeffs, "down");
  const up = planBayDirected([...orderLevels(bookcase.levels)].reverse(), books, spine, w, coeffs, "up");
  return up.cost < down.cost ? up : down;
}

function planBayDirected(
  levels: LayoutLevel[],
  books: LayoutBook[],
  spine: number[],
  w: LayoutWeights,
  coeffs: CapacityCoefficients,
  direction: "down" | "up",
): BayResult {
  const n = books.length;
  const m = levels.length;
  if (!m) return { cost: n ? Infinity : 0, slices: [], direction };
  if (!n) return { cost: 0, slices: levels.map((level) => ({ level, from: 0, to: 0 })), direction };

  // 前缀和：任意区间的总厚度 O(1)
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + spine[i];

  // 每本书在每层的代价只和 (书, 层) 有关，先算好前缀和，区间求和就是 O(1)。
  // "书比层高"单独用计数表，不能把 Infinity 累进前缀和 —— Infinity 减 Infinity 是 NaN，
  // 一旦出现，这一层后面所有区间都会被误判成不可行。
  const ergoPre: Float64Array[] = levels.map((level) =>
    books.reduce((arr, b, i) => {
      arr[i + 1] = arr[i] + ergoPenalty(b, level, w);
      return arr;
    }, new Float64Array(n + 1)),
  );
  const tallPre: Int32Array[] = levels.map((level) =>
    books.reduce((arr, b, i) => {
      arr[i + 1] = arr[i] + ((b.heightMm ?? 0) > level.heightMm ? 1 : 0);
      return arr;
    }, new Int32Array(n + 1)),
  );

  const movePre: Float64Array[] = levels.map((level) => {
    const arr = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + (books[i].levelId === level.id ? 0 : 1);
    return arr;
  });

  const INF = Infinity;
  // dp[j][i] = 用前 j 层放完前 i 本的最小代价
  const dp: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF));
  const back: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1).fill(-1));
  dp[0][0] = 0;

  for (let j = 1; j <= m; j++) {
    const level = levels[j - 1];
    const usable = Math.max(0, level.widthMm - coeffs.levelMarginMm);
    for (let i = 0; i <= n; i++) {
      // k = 这一层之前已经放了多少本
      for (let k = i; k >= 0; k--) {
        if (dp[j - 1][k] === INF) continue;
        const used = pre[i] - pre[k];
        if (used > usable) break; // 再往前只会更宽
        if (tallPre[j - 1][i] - tallPre[j - 1][k] > 0) continue; // 这段里有书比层高还高
        const ergo = ergoPre[j - 1][i] - ergoPre[j - 1][k];
        const c =
          dp[j - 1][k] +
          fillPenalty(used, usable, w) +
          ergo +
          w.move * (movePre[j - 1][i] - movePre[j - 1][k]);
        if (c < dp[j][i]) {
          dp[j][i] = c;
          back[j][i] = k;
        }
      }
    }
  }

  if (dp[m][n] === INF) return { cost: INF, slices: [], direction };

  const slices: { level: LayoutLevel; from: number; to: number }[] = [];
  let i = n;
  for (let j = m; j >= 1; j--) {
    const k = back[j][i];
    slices.unshift({ level: levels[j - 1], from: k, to: i });
    i = k;
  }
  return { cost: dp[m][n], slices, direction };
}

// ---------------------------------------------------------------- 第 1 层：柜级 DP

/** 一个书柜的可用总宽 */
function bayCapacity(bc: LayoutBookcase, coeffs: CapacityCoefficients): number {
  return bc.levels.reduce((s, l) => s + Math.max(0, l.widthMm - coeffs.levelMarginMm), 0);
}

/**
 * 整屋规划。
 *
 * 先用便宜的代价（装填 + 切口 + 惯性）把有序书列切给各个书柜，
 * 再对每个书柜跑一次柜内 DP。之所以分两步而不是一个大 DP：
 * 柜级要看的是"这个柜子该管哪一段"，柜内要看的是"齐不齐腰、放不放得下"，
 * 合在一起 DP 的状态数会乘起来，分开各自都是小问题。
 */
/**
 * 整屋规划的实现体，写成生成器。
 *
 * 为什么是生成器：这段是纯 CPU，而 Node 是单线程的 —— 它跑多久，
 * **整个服务就多久不响应别人**。实测柜级 DP 的耗时：
 *   2000 本 / 10 柜 → 464ms      5000 本 / 20 柜 → 1.6s      10000 本 / 40 柜 → 6.2s
 * 其中 98% 花在柜级 DP 上（柜内 DP 5000 本时只占 38ms）。
 * 一个人点一下「整屋规划」，全家其他人扫码的请求就要排队等这么久。
 *
 * 生成器让同一份逻辑既能同步跑（测试、脚本），又能在服务端切片跑
 * （`planLayoutAsync`，每 ~40ms 让出一次事件循环）。算法一个字没改，
 * 所以 68 条性质测试照样管用，另有一条断言两种跑法结果完全一致。
 */
function* planLayoutGen(
  bookcases: LayoutBookcase[],
  books: LayoutBook[],
  opts: { weights?: Partial<LayoutWeights>; coeffs?: CapacityCoefficients } = {},
): Generator<void, LayoutPlan> {
  const w = { ...DEFAULT_WEIGHTS, ...opts.weights };
  const coeffs = opts.coeffs ?? DEFAULT_COEFFICIENTS;

  const bays = orderBookcases(bookcases).filter((b) => b.levels.length > 0);
  const ordered = orderBooks(books);
  const spine = ordered.map((b) => estimateSpine(b, coeffs).mm);

  const empty: LayoutPlan = {
    assignments: [], levels: [], unplaced: [], exceptions: [], merges: [], moves: 0, cost: 0, bays: [],
  };
  if (!bays.length) {
    return {
      ...empty,
      unplaced: ordered.map((b) => ({ bookId: b.id, title: b.title, reason: "no_capacity" as const })),
    };
  }

  const n = ordered.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + spine[i];

  // 每个柜子的"当前有多少本不在这儿"，惯性用
  const movePre: Float64Array[] = bays.map((bc) => {
    const own = new Set(bc.levels.map((l) => l.id));
    const arr = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      arr[i + 1] = arr[i] + (ordered[i].levelId && own.has(ordered[i].levelId!) ? 0 : 1);
    }
    return arr;
  });

  const cap = bays.map((b) => bayCapacity(b, coeffs));
  const INF = Infinity;
  const m = bays.length;

  const dp: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n + 1).fill(INF));
  const back: Int32Array[] = Array.from({ length: m + 1 }, () => new Int32Array(n + 1).fill(-1));
  dp[0][0] = 0;

  // 前 j 个柜子最多能装多少本 —— 超过这个数的状态一定是 INF，不用算。
  // 少了这个界，5000 本 × 20 柜要跑 1900 万次内层循环。
  const maxI: number[] = [0];
  for (let j = 1; j <= m; j++) {
    let cnt = 0, acc = 0;
    for (let p = maxI[j - 1]; p < n; p++) {
      if (acc + spine[p] > cap[j - 1]) break;
      acc += spine[p];
      cnt++;
    }
    maxI.push(Math.min(n, maxI[j - 1] + cnt));
  }

  for (let j = 1; j <= m; j++) {
    yield;
    for (let i = 0; i <= maxI[j]; i++) {
      // 只在柜子之间让出还不够细：藏书上千之后，**单个柜子**那一轮就要一百多毫秒。
      // 所以柜内每 256 个状态也让一次，让出的粒度才真正落在切片预算上。
      if ((i & 0xff) === 0) yield;
      for (let k = i; k >= 0; k--) {
        if (dp[j - 1][k] === INF) continue;
        const used = pre[i] - pre[k];
        if (used > cap[j - 1]) break;

        let c = dp[j - 1][k] + fillPenalty(used, cap[j - 1], w) + w.move * (movePre[j - 1][i] - movePre[j - 1][k]);

        // 切口代价：在第 k 本和第 k+1 本之间换柜子贵不贵
        if (j > 1 && k > 0 && k < n) {
          const close = clcCloseness(ordered[k - 1].clc, ordered[k].clc);
          c += w.cut * close * bookcaseDistance(bays[j - 2], bays[j - 1], w);
        }
        if (c < dp[j][i]) {
          dp[j][i] = c;
          back[j][i] = k;
        }
      }
    }
  }

  // 全都放得下最好；放不下就取"能放进去最多本"的那个前缀，剩下的诚实报告
  let end = n;
  while (end >= 0 && dp[m][end] === INF) end--;
  if (end < 0) {
    return {
      ...empty,
      unplaced: ordered.map((b) => ({ bookId: b.id, title: b.title, reason: "no_capacity" as const })),
    };
  }

  const cuts: number[] = [];
  let i = end;
  for (let j = m; j >= 1; j--) {
    const k = back[j][i];
    cuts.unshift(k);
    i = k;
  }
  cuts.push(end);

  // ---- 逐柜跑柜内 DP ----
  //
  // 柜级 DP 用的是"这个柜子所有层的可用宽度之和"，这是个**乐观**的容量：
  // 总宽够不等于切得开 —— 书是整本的，不能把一本书劈成两半分到两层。
  // 总量刚好卡在容量上时柜内 DP 会直接判不可行，那一柜的书就全丢了。
  // 所以这里按柜子顺序逐个落实：装不下就把区间末尾往回缩，剩下的顺延给下一个柜子。

  const assignments: LayoutAssignment[] = [];
  const levelPlans: LevelPlan[] = [];
  const unplaced: UnplacedBook[] = [];
  let total = 0;
  const bayRanges: LayoutPlan["bays"] = [];

  let cursor = 0;
  for (let j = 0; j < m; j++) {
    yield;
    const from = cursor;
    // 最后一个柜子把剩下的都接过去，前面的柜子按 DP 给的切口
    const want = j === m - 1 ? end : Math.max(from, cuts[j + 1]);

    // 这一柜里有没有哪本书比它所有层都高？有就先摘出来，否则它会把整柜卡死
    const tooTall = new Set<string>();
    for (let p = from; p < want; p++) {
      const b = ordered[p];
      if (!bays[j].levels.some((l) => (b.heightMm ?? 0) <= l.heightMm)) {
        tooTall.add(b.id);
        unplaced.push({ bookId: b.id, title: b.title, reason: "too_tall_anywhere" });
      }
    }

    const idxs: number[] = [];
    for (let p = from; p < want; p++) if (!tooTall.has(ordered[p].id)) idxs.push(p);
    let slice = idxs.map((p) => ordered[p]);
    let sliceSpine = idxs.map((p) => spine[p]);
    let bay = planBay(bays[j], slice, sliceSpine, w, coeffs);

    if (!Number.isFinite(bay.cost)) {
      // 总宽够但切不开 —— 二分找出真正装得下的本数，多出来的顺延
      const keep = (() => {
        let lo = 0, hi = slice.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          const r = planBay(bays[j], slice.slice(0, mid), sliceSpine.slice(0, mid), w, coeffs);
          if (Number.isFinite(r.cost)) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      })();
      slice = slice.slice(0, keep);
      sliceSpine = sliceSpine.slice(0, keep);
      bay = planBay(bays[j], slice, sliceSpine, w, coeffs);
      cursor = keep ? idxs[keep - 1] + 1 : from;
    } else {
      cursor = want;
    }
    if (!Number.isFinite(bay.cost)) { cursor = from; continue; }

    total += bay.cost;
    for (const s of bay.slices) {
      const ids: string[] = [];
      let used = 0;
      for (let p = s.from; p < s.to; p++) {
        const b = slice[p];
        ids.push(b.id);
        used += sliceSpine[p];
        assignments.push({
          bookId: b.id,
          levelId: s.level.id,
          fromLevelId: b.levelId,
          moved: b.levelId !== s.level.id,
        });
      }
      const usable = Math.max(0, s.level.widthMm - coeffs.levelMarginMm);
      const counts = new Map<string, number>();
      for (let p = s.from; p < s.to; p++) {
        const k = clcPrefix(slice[p].clc, 4);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let dom: string | null = null, best = 0;
      for (const [k, v] of counts) if (v > best) { best = v; dom = k; }

      // 按**大类**（中图法首字母）统计这一层的构成 —— 人读的是"文学/历史/科普"，
      // 不是 I247.5 和 I512.45 的差别
      const byMain = new Map<string, { count: number; mm: number }>();
      for (let p = s.from; p < s.to; p++) {
        const main = clcMainClass(slice[p].clc) ?? "?";
        const cur = byMain.get(main) ?? { count: 0, mm: 0 };
        cur.count += 1;
        cur.mm += sliceSpine[p];
        byMain.set(main, cur);
      }
      const classes = Array.from(byMain.entries())
        .map(([clc, v]) => ({ clc, label: clcLabel(clc, "zh"), count: v.count, mm: Math.round(v.mm) }))
        .sort((a, b) => b.mm - a.mm);

      levelPlans.push({
        levelId: s.level.id,
        bookcaseId: bays[j].id,
        bookIds: ids,
        usedMm: Math.round(used * 10) / 10,
        usableMm: usable,
        fill: usable > 0 ? Math.round((used / usable) * 100) / 100 : 0,
        dominantClass: dom,
        classes,
      });
    }

    bayRanges.push({
      bookcaseId: bays[j].id,
      bookcaseName: bays[j].name,
      from,
      to: cursor,
      label: slice.length ? clcPrefix(slice[0].clc, 2) : null,
    });
  }

  // 一路顺延之后还没安排上的，诚实报告
  const placed = new Set(assignments.map((a) => a.bookId));
  const flagged = new Set(unplaced.map((u) => u.bookId));
  for (const b of ordered) {
    if (!placed.has(b.id) && !flagged.has(b.id)) {
      unplaced.push({ bookId: b.id, title: b.title, reason: "no_capacity" });
    }
  }

  // 挤不下的时候人体工学只能让步，但让步了就得报出来 —— 用户至少知道
  // "这本童书在最高一层"是算法权衡的结果，而不是它没考虑过
  const levelIndex = new Map(bays.flatMap((bc) => bc.levels.map((l) => [l.id, l] as const)));
  const bookIndex = new Map(ordered.map((b) => [b.id, b]));
  const exceptions: LayoutException[] = [];
  for (const a of assignments) {
    const b = bookIndex.get(a.bookId);
    const l = levelIndex.get(a.levelId);
    if (!b || !l) continue;
    const band = reachBand(readerOf(b).heightCm);
    if (l.floorMm > band.comfortableMax) {
      exceptions.push({
        bookId: b.id, title: b.title, levelId: l.id,
        kind: "out_of_reach", floorMm: l.floorMm, limitMm: Math.round(band.comfortableMax),
      });
    } else if (usageOf(b) === "frequent" && levelFloorRank(l) === "high") {
      exceptions.push({
        bookId: b.id, title: b.title, levelId: l.id,
        kind: "frequent_too_high", floorMm: l.floorMm, limitMm: Math.round(band.idealMax),
      });
    }
  }

  // 一层上挤着两个以上大类，而且其中有占不满四成的小类 —— 这就是"合并"，要说出来。
  // 两个都挺大的类共用一层是正常的分段边界，不值得提醒。
  const merges: MergeNote[] = levelPlans
    .filter((l) => l.classes.length >= 2 && l.usableMm > 0 &&
                   l.classes.some((c) => c.mm / l.usableMm < 0.4))
    .map((l) => ({ levelId: l.levelId, classes: l.classes }));

  return {
    assignments,
    levels: levelPlans,
    unplaced,
    exceptions,
    merges,
    moves: assignments.filter((a) => a.moved).length,
    cost: Math.round(total),
    bays: bayRanges,
  };
}
