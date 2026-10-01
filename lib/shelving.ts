// 上架引擎 —— docs/shelving-design.md + docs/plan-v2.md 的实现
//
// 最重要的一条设计约束（用户原话大意）：
//   你不知道我一开始有多少书，我也不可能把所有书抽出来重新摆一遍，只能一架一架弄。
//
// 所以这里**不是**批处理最优化，而是在线增量算法：
//   * 每次只为一本书找位置，尽量不动别人
//   * 只有真放不下了才提迁移建议，且优先挪最小的那一组
//   * 任何搬动都先出预览，用户确认了才落库
//
// 顺序性是可算性的前提：书按索书号全序排列，问题就从"任意分组"（NP 难）
// 退化成"有序序列切成连续段"（多项式）。别为了省事打乱顺序。

import { clcCloseness, clcPrefix, clcSortKey, normalizeClc } from "./clc";
import { estimateSpine, type CapacityCoefficients, DEFAULT_COEFFICIENTS } from "./capacity";

// ---------------------------------------------------------------- 数据形状

export interface ShelfBook {
  id: string;
  title: string;
  clc: string | null;
  callSortKey: string;
  spineMm?: number | null;
  pageCount?: number | null;
  binding?: string | null;
  heightMm?: number | null;
  /** 当前所在层；null = 未上架 */
  levelId: string | null;
}

export interface ShelfLevel {
  id: string;
  bookcaseId: string;
  bookcaseName: string;
  roomName: string | null;
  levelIndex: number;
  widthMm: number;
  heightMm: number;
  /** 离地高度（该柜下方各层高度累加），可达性判断要用 */
  floorMm: number;
  /** 书柜在户型图上的位置，算物理距离用 */
  x: number;
  y: number;
}

// ---------------------------------------------------------------- 可达性

export interface Person {
  name: string;
  heightCm: number;
}

/** 家里的三个人，身高来自 spec §1 */
export const HOUSEHOLD: Person[] = [
  { name: "本人", heightCm: 183 },
  { name: "妈妈", heightCm: 160 },
  { name: "妹妹", heightCm: 140 },
];

/**
 * 舒适取书区间（毫米，离地）。
 * 经验公式：不用蹲下也不用踮脚 ≈ 身高的 0.25 到 1.15 倍；
 * 视线高度 ≈ 0.6 到 1.0 倍，一眼扫过去就能找到。
 */
export function reachBand(heightCm: number) {
  const h = heightCm * 10;
  return {
    comfortableMin: h * 0.25,
    comfortableMax: h * 1.15,
    idealMin: h * 0.6,
    idealMax: h * 1.0,
  };
}

export function reachScore(level: ShelfLevel, person: Person): number {
  const b = reachBand(person.heightCm);
  const z = level.floorMm;
  if (z < b.comfortableMin || z > b.comfortableMax) return 0;
  if (z >= b.idealMin && z <= b.idealMax) return 1;
  return 0.5;
}

// ---------------------------------------------------------------- 距离

export interface DistanceOptions {
  /** 垂直距离比水平距离便宜：伸手比走路容易 */
  verticalWeight: number;
  /** 换一个柜子的固定代价 */
  bookcasePenalty: number;
  /** 换一个房间的固定代价 */
  roomPenalty: number;
}

export const DEFAULT_DISTANCE: DistanceOptions = {
  verticalWeight: 0.3,
  bookcasePenalty: 1500,
  roomPenalty: 6000,
};

/** 两层之间的物理距离（毫米当量）。坐标来自户型图，所以是真实距离。 */
export function levelDistance(
  a: ShelfLevel,
  b: ShelfLevel,
  opt: DistanceOptions = DEFAULT_DISTANCE,
): number {
  if (a.id === b.id) return 0;
  const vertical = Math.abs(a.floorMm - b.floorMm) * opt.verticalWeight;
  if (a.bookcaseId === b.bookcaseId) return vertical;
  const horizontal = Math.hypot(a.x - b.x, a.y - b.y);
  const roomCost = (a.roomName ?? "") === (b.roomName ?? "") ? 0 : opt.roomPenalty;
  return horizontal + vertical + opt.bookcasePenalty + roomCost;
}

// ---------------------------------------------------------------- 层的状态

export interface LevelState {
  level: ShelfLevel;
  books: ShelfBook[];
  usedMm: number;
  usableMm: number;
  freeMm: number;
  /** 该层书籍的主类目（出现最多的中图法前缀） */
  dominantClass: string | null;
}

export function buildLevelStates(
  levels: ShelfLevel[],
  books: ShelfBook[],
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): Map<string, LevelState> {
  const byLevel = new Map<string, ShelfBook[]>();
  for (const b of books) {
    if (!b.levelId) continue;
    byLevel.set(b.levelId, [...(byLevel.get(b.levelId) ?? []), b]);
  }

  const states = new Map<string, LevelState>();
  for (const level of levels) {
    const list = (byLevel.get(level.id) ?? []).sort((a, b) =>
      a.callSortKey.localeCompare(b.callSortKey),
    );
    const usedMm = list.reduce((sum, b) => sum + estimateSpine(b, coeffs).mm, 0);
    const usableMm = Math.max(0, level.widthMm - coeffs.levelMarginMm);

    // 主类目：取出现次数最多的中图法前缀（到"目"这一级）
    const counts = new Map<string, number>();
    for (const b of list) {
      const p = clcPrefix(b.clc, 4);
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    let dominantClass: string | null = null;
    let best = 0;
    for (const [k, v] of counts) if (v > best) { best = v; dominantClass = k; }

    states.set(level.id, {
      level,
      books: list,
      usedMm: Math.round(usedMm * 10) / 10,
      usableMm,
      freeMm: Math.round((usableMm - usedMm) * 10) / 10,
      dominantClass,
    });
  }
  return states;
}

// ---------------------------------------------------------------- 单本放置

export interface PlacementOption {
  levelId: string;
  score: number;
  freeAfterMm: number;
  reasons: string[];
  /** 该层放完这本还剩多少余量比例，用于留白控制 */
  fillAfter: number;
}

export interface SuggestOptions {
  coeffs?: CapacityCoefficients;
  distance?: DistanceOptions;
  /** 目标装填率：图书馆书库经验值 70–75%，留出的空间是日常上架必需的 */
  fillTarget?: number;
  /** 这本书主要给谁读 —— 决定可达性偏好 */
  reader?: Person;
}

/**
 * 给一本书找位置。
 *
 * 打分维度（权重按重要性）：
 *   1. 学科邻近：和该层主类目的中图法接近度 —— 这是分类法的全部意义
 *   2. 可达性：儿童书必须落在孩子够得着的高度
 *   3. 留白：优先放进"还没到目标装填率"的层，别把某层塞爆
 *   4. 高度可行性：书比层高就直接淘汰
 */
export function suggestPlacement(
  book: ShelfBook,
  states: Map<string, LevelState>,
  opts: SuggestOptions = {},
): PlacementOption[] {
  const coeffs = opts.coeffs ?? DEFAULT_COEFFICIENTS;
  const fillTarget = opts.fillTarget ?? 0.75;
  const spine = estimateSpine(book, coeffs);
  const out: PlacementOption[] = [];

  for (const st of states.values()) {
    const reasons: string[] = [];

    // 硬约束：书比层高就是放不进去
    if (book.heightMm && book.heightMm > st.level.heightMm) continue;

    const freeAfter = Math.round((st.freeMm - spine.mm) * 10) / 10;
    // 完全放不下的层不进候选（留一点负容差给估算误差）
    if (freeAfter < -coeffs.tightThresholdMm) continue;

    let score = 0;

    // 1) 学科邻近
    const closeness = clcCloseness(book.clc, st.dominantClass);
    if (st.dominantClass === null) {
      score += 20; // 空层：可以开一个新类目，比塞进无关类目好
      reasons.push("empty_level");
    } else {
      score += closeness * 100;
      if (closeness >= 0.7) reasons.push("same_topic");
      else if (closeness >= 0.25) reasons.push("related_topic");
      else reasons.push("unrelated_topic");
    }

    // 2) 可达性
    if (opts.reader) {
      const r = reachScore(st.level, opts.reader);
      score += r * 40;
      if (r === 1) reasons.push("ideal_reach");
      else if (r === 0) { score -= 60; reasons.push("out_of_reach"); }
    }

    // 3) 留白：低于目标装填率的层加分，超过的扣分
    const fillAfter = st.usableMm > 0 ? (st.usedMm + spine.mm) / st.usableMm : 1;
    if (fillAfter <= fillTarget) {
      score += 25;
      reasons.push("has_slack");
    } else {
      score -= (fillAfter - fillTarget) * 120;
      reasons.push("over_fill_target");
    }

    // 4) 高度确定可行的略微加分
    if (book.heightMm) { score += 8; reasons.push("height_ok"); }

    out.push({
      levelId: st.level.id,
      score: Math.round(score * 10) / 10,
      freeAfterMm: freeAfter,
      fillAfter: Math.round(fillAfter * 100) / 100,
      reasons,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- 迁移

export interface MovePlan {
  bookId: string;
  title: string;
  fromLevelId: string | null;
  toLevelId: string;
  distance: number;
}

export interface ReflowResult {
  needed: boolean;
  reason: string;
  moves: MovePlan[];
  /** 涉及的类目段，用于给用户解释"为什么要动" */
  affectedClass: string | null;
  totalDistance: number;
}

/**
 * 某层溢出时的最小扰动重排。
 *
 * 策略：**挪最小的那一组**。
 * 一层上通常有若干个类目段，把书目最少的那一段整体搬到别处，
 * 比把整层往后平移便宜得多，也更符合直觉（搬 3 本 vs 搬 40 本）。
 */
export function planReflow(
  overflowLevelId: string,
  states: Map<string, LevelState>,
  opts: SuggestOptions & { distance?: DistanceOptions } = {},
): ReflowResult {
  const coeffs = opts.coeffs ?? DEFAULT_COEFFICIENTS;
  const dist = opts.distance ?? DEFAULT_DISTANCE;
  const src = states.get(overflowLevelId);

  if (!src) return { needed: false, reason: "level_not_found", moves: [], affectedClass: null, totalDistance: 0 };
  if (src.freeMm >= 0) {
    return { needed: false, reason: "no_overflow", moves: [], affectedClass: null, totalDistance: 0 };
  }

  // 按类目段分组
  const groups = new Map<string, ShelfBook[]>();
  for (const b of src.books) {
    const key = clcPrefix(b.clc, 4) ?? "?";
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  const overflow = -src.freeMm;
  // 候选组：能腾出足够空间的最小组；腾不够就选最小的那个先挪
  const ranked = Array.from(groups.entries())
    .map(([cls, books]) => ({
      cls,
      books,
      widthMm: books.reduce((s, b) => s + estimateSpine(b, coeffs).mm, 0),
    }))
    .sort((a, b) => a.books.length - b.books.length);

  const chosen = ranked.find((g) => g.widthMm >= overflow) ?? ranked[0];
  if (!chosen) {
    return { needed: false, reason: "nothing_to_move", moves: [], affectedClass: null, totalDistance: 0 };
  }

  // 给这一组找新家：优先同类目已有的层，其次空层，且要装得下整组
  const targets = Array.from(states.values())
    .filter((s) => s.level.id !== overflowLevelId)
    .filter((s) => s.freeMm >= chosen.widthMm)
    .filter((s) => {
      const tallest = Math.max(0, ...chosen.books.map((b) => b.heightMm ?? 0));
      return tallest === 0 || s.level.heightMm >= tallest;
    })
    .map((s) => ({
      state: s,
      // 同类目优先，其次物理距离近
      score:
        clcCloseness(chosen.cls, s.dominantClass) * 100 +
        (s.dominantClass === null ? 30 : 0) -
        levelDistance(src.level, s.level, dist) / 1000,
    }))
    .sort((a, b) => b.score - a.score);

  if (!targets.length) {
    return {
      needed: true,
      reason: "no_space_anywhere",
      moves: [],
      affectedClass: chosen.cls,
      totalDistance: 0,
    };
  }

  const target = targets[0].state;
  const moves: MovePlan[] = chosen.books.map((b) => ({
    bookId: b.id,
    title: b.title,
    fromLevelId: b.levelId,
    toLevelId: target.level.id,
    distance: Math.round(levelDistance(src.level, target.level, dist)),
  }));

  return {
    needed: true,
    reason: "overflow_relocate_smallest_group",
    moves,
    affectedClass: chosen.cls,
    totalDistance: moves.reduce((s, m) => s + m.distance, 0),
  };
}

/** 全库体检：哪些层溢出了、哪些快满了 */
export function auditShelves(states: Map<string, LevelState>, fillTarget = 0.75) {
  const overflow: string[] = [];
  const nearFull: string[] = [];
  for (const st of states.values()) {
    if (st.freeMm < 0) overflow.push(st.level.id);
    else if (st.usableMm > 0 && st.usedMm / st.usableMm > fillTarget) nearFull.push(st.level.id);
  }
  return { overflow, nearFull };
}

/** 排序：书架上的物理顺序 = 索书号顺序 */
export function shelfOrder(books: ShelfBook[]): ShelfBook[] {
  return [...books].sort((a, b) => {
    const ka = a.callSortKey || clcSortKey(normalizeClc(a.clc), "");
    const kb = b.callSortKey || clcSortKey(normalizeClc(b.clc), "");
    return ka.localeCompare(kb);
  });
}
