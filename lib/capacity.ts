// 容量模型 —— F3，本系统最有意思也最容易翻车的部分。
//
// 设计原则（来自 spec）：系统只做「决策辅助」，最终永远是人拍板。
// 所以每个判断都带 confidence，临界情况一律交给用户手动确认，
// 绝不出现「系统说放得下、实际放不下」而用户无从干预的情况。

export interface CapacityCoefficients {
  /** 每页纸的厚度(mm)。80g 胶版纸双面约 0.09mm/张 = 0.045mm/页，铜版纸更厚。 */
  mmPerPage: number;
  /** 平装封面 + 装订的额外厚度 */
  basePaperbackMm: number;
  /** 精装壳板更厚 */
  baseHardcoverMm: number;
  /** 完全没有页数信息时的兜底书脊宽度 */
  defaultSpineMm: number;
  /** 临界阈值：剩余空间与估算宽度之差在这个范围内 → 交给人确认 */
  tightThresholdMm: number;
  /** 每层两端留的余量，书架挡板/取书手指位置 */
  levelMarginMm: number;
  /**
   * 书高未知时的假定高度。
   *
   * 实测（2026-08）：Google Books 抽 8 本 `dimensions` 全为 null，
   * OpenLibrary 的 physical_dimensions 同样取不到，豆瓣压根没有这个字段。
   * 也就是说除非用户自己量，heightMm 永远是空的。
   * 那就别把"高度未知"当成拦人的理由 —— 层高比绝大多数书都高的时候直接放行，
   * 只有层矮到真有风险时才回头问用户。
   * 240mm 能覆盖常见的 32 开(约 203mm)和 16 开(约 260mm 以下的多数)。
   */
  assumedHeightMm: number;
  /** 按标签覆盖 mmPerPage，例如杂志纸薄、画册纸厚 */
  tagMmPerPage: Record<string, number>;
}

export const DEFAULT_COEFFICIENTS: CapacityCoefficients = {
  mmPerPage: 0.052,
  basePaperbackMm: 3,
  baseHardcoverMm: 6,
  defaultSpineMm: 20,
  tightThresholdMm: 15,
  levelMarginMm: 10,
  assumedHeightMm: 240,
  tagMmPerPage: {},
};

const HARDCOVER_HINTS = ["精装", "hardcover", "hardback", "boards"];

export type SpineSource = "measured" | "pages" | "default";

export interface SpineEstimate {
  mm: number;
  source: SpineSource;
  /** measured 最可信，default 最不可信 —— 前端据此决定要不要提示用户量一下 */
  confidence: "high" | "medium" | "low";
}

export interface SpineInput {
  spineMm?: number | null;
  pageCount?: number | null;
  binding?: string | null;
  tagNames?: string[];
}

export function estimateSpine(
  book: SpineInput,
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): SpineEstimate {
  if (book.spineMm && book.spineMm > 0) {
    return { mm: book.spineMm, source: "measured", confidence: "high" };
  }

  if (book.pageCount && book.pageCount > 0) {
    const override = (book.tagNames ?? [])
      .map((t) => coeffs.tagMmPerPage[t])
      .find((v) => typeof v === "number" && v > 0);
    const perPage = override ?? coeffs.mmPerPage;

    const binding = (book.binding ?? "").toLowerCase();
    const isHardcover = HARDCOVER_HINTS.some((h) => binding.includes(h));
    const base = isHardcover ? coeffs.baseHardcoverMm : coeffs.basePaperbackMm;

    return {
      mm: Math.round((book.pageCount * perPage + base) * 10) / 10,
      source: "pages",
      confidence: "medium",
    };
  }

  return { mm: coeffs.defaultSpineMm, source: "default", confidence: "low" };
}

// ---------------------------------------------------------------- 层容量

export interface LevelLike {
  id: string;
  levelIndex: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  bookcaseId: string;
}

export interface PlacedBookLike extends SpineInput {
  id: string;
  heightMm?: number | null;
}

export interface LevelUsage {
  levelId: string;
  /** 扣掉两端余量后的可用宽度 */
  usableMm: number;
  usedMm: number;
  remainingMm: number;
  bookCount: number;
  /** 有多少本书的宽度是猜的 —— 越多，usedMm 越不可信 */
  estimatedCount: number;
  fillRatio: number;
}

export function levelUsage(
  level: LevelLike,
  books: PlacedBookLike[],
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): LevelUsage {
  const usableMm = Math.max(0, level.widthMm - coeffs.levelMarginMm);
  let usedMm = 0;
  let estimatedCount = 0;

  for (const book of books) {
    const est = estimateSpine(book, coeffs);
    usedMm += est.mm;
    if (est.source !== "measured") estimatedCount++;
  }

  usedMm = Math.round(usedMm * 10) / 10;
  return {
    levelId: level.id,
    usableMm,
    usedMm,
    remainingMm: Math.round((usableMm - usedMm) * 10) / 10,
    bookCount: books.length,
    estimatedCount,
    fillRatio: usableMm > 0 ? usedMm / usableMm : 1,
  };
}

// ---------------------------------------------------------------- 放置判定

export type WidthVerdict = "fits" | "tight" | "overflow";
/**
 * ok         —— 量过书高，确定放得下
 * assumed_ok —— 书高未知，但这层比假定高度还高，风险低到不值得打断用户
 * unknown    —— 书高未知，且这层不够高，说不准 → 交给用户看一眼
 * too_tall   —— 量过书高，确定放不下
 */
export type HeightVerdict = "ok" | "assumed_ok" | "too_tall" | "unknown";

export interface FitResult {
  levelId: string;
  width: WidthVerdict;
  height: HeightVerdict;
  spine: SpineEstimate;
  remainingAfterMm: number;
  usage: LevelUsage;
  /** true 表示系统不敢自己下结论，必须用户手动确认（spec F3 验收条件 2） */
  needsManualConfirm: boolean;
  headroomMm?: number;
}

export function checkFit(
  book: PlacedBookLike,
  level: LevelLike,
  existing: PlacedBookLike[],
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): FitResult {
  const usage = levelUsage(level, existing, coeffs);
  const spine = estimateSpine(book, coeffs);
  const remainingAfterMm = Math.round((usage.remainingMm - spine.mm) * 10) / 10;

  let width: WidthVerdict;
  if (remainingAfterMm >= coeffs.tightThresholdMm) width = "fits";
  else if (remainingAfterMm >= -coeffs.tightThresholdMm) width = "tight";
  else width = "overflow";

  let height: HeightVerdict;
  let headroomMm: number | undefined;
  if (book.heightMm && book.heightMm > 0) {
    headroomMm = level.heightMm - book.heightMm;
    height = headroomMm >= 0 ? "ok" : "too_tall";
  } else if (level.heightMm >= coeffs.assumedHeightMm) {
    // 数据源一律不给书高（见 assumedHeightMm 的说明）。层高比绝大多数书都富余时，
    // 拿"高度未知"去拦每一本书只会让确认框变成噪音，那就等于没有确认。
    height = "assumed_ok";
  } else {
    height = "unknown";
  }

  // 系统不敢拍板的情况：宽度临界、这层矮到书高未知会出事、宽度靠猜且几乎占满
  const needsManualConfirm =
    width === "tight" ||
    height === "unknown" ||
    (spine.source === "default" && usage.fillRatio > 0.8);

  return {
    levelId: level.id,
    width,
    height,
    spine,
    remainingAfterMm,
    usage,
    needsManualConfirm,
    headroomMm,
  };
}

// ---------------------------------------------------------------- 上架建议

export interface Suggestion extends FitResult {
  bookcaseId: string;
  levelIndex: number;
  score: number;
  reasons: string[];
}

export interface SuggestInput {
  book: PlacedBookLike & { tagIds?: string[] };
  levels: LevelLike[];
  /** levelId → 该层现有书 */
  occupancy: Map<string, PlacedBookLike[]>;
  /** tagId → 该标签已分配的 levelId 列表 */
  tagZones: Map<string, string[]>;
  coeffs?: CapacityCoefficients;
}

/**
 * 排序逻辑，从重到轻：
 *   1. 高度放不下 → 直接淘汰（物理不可能）
 *   2. 同标签已有分区 → 强加分（"同标签的书尽量挨得近"，F2）
 *   3. 宽度确定放得下 > 临界 > 溢出
 *   4. 同等条件下优先填得比较满的层，避免把书摊得到处都是
 */
export function suggestPlacements(input: SuggestInput): Suggestion[] {
  const coeffs = input.coeffs ?? DEFAULT_COEFFICIENTS;
  const zoneLevelIds = new Set(
    (input.book.tagIds ?? []).flatMap((tagId) => input.tagZones.get(tagId) ?? []),
  );

  const results: Suggestion[] = [];

  for (const level of input.levels) {
    const existing = input.occupancy.get(level.id) ?? [];
    const fit = checkFit(input.book, level, existing, coeffs);

    if (fit.height === "too_tall") continue; // 物理上塞不进去，不用建议

    let score = 0;
    const reasons: string[] = [];

    if (zoneLevelIds.has(level.id)) {
      score += 100;
      reasons.push("same_tag_zone");
    }
    if (fit.width === "fits") {
      score += 50;
      reasons.push("width_ok");
    } else if (fit.width === "tight") {
      score += 15;
      reasons.push("width_tight");
    } else {
      score -= 40;
      reasons.push("width_overflow");
    }
    if (fit.height === "ok") {
      score += 10;
      reasons.push("height_ok");
    } else if (fit.height === "assumed_ok") {
      // 比量过的低一档，但不该和"完全说不准"同等对待
      score += 6;
      reasons.push("height_assumed");
    } else {
      reasons.push("height_unknown");
    }
    // 优先把已经用起来的层填满，但别挑那种刚好卡死的
    score += Math.min(20, fit.usage.fillRatio * 20);

    results.push({
      ...fit,
      bookcaseId: level.bookcaseId,
      levelIndex: level.levelIndex,
      score: Math.round(score * 10) / 10,
      reasons,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- 标签分区容量

export interface TagPressure {
  tagId: string;
  tagName: string;
  /** 该标签所有书的估算总宽度 */
  totalSpineMm: number;
  /** 该标签已分配层的可用总宽度 */
  allocatedMm: number;
  overflowMm: number;
  status: "ok" | "tight" | "overflow";
  levelIds: string[];
}

export function tagPressure(
  tag: { id: string; name: string },
  books: PlacedBookLike[],
  zoneLevels: LevelLike[],
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): TagPressure {
  const totalSpineMm =
    Math.round(books.reduce((sum, b) => sum + estimateSpine(b, coeffs).mm, 0) * 10) / 10;
  const allocatedMm = zoneLevels.reduce(
    (sum, l) => sum + Math.max(0, l.widthMm - coeffs.levelMarginMm),
    0,
  );
  const overflowMm = Math.round((totalSpineMm - allocatedMm) * 10) / 10;

  let status: TagPressure["status"] = "ok";
  if (zoneLevels.length === 0) {
    status = "ok"; // 还没划分区，谈不上溢出
  } else if (overflowMm > 0) {
    status = "overflow";
  } else if (Math.abs(overflowMm) < coeffs.tightThresholdMm) {
    status = "tight";
  }

  return {
    tagId: tag.id,
    tagName: tag.name,
    totalSpineMm,
    allocatedMm,
    overflowMm,
    status,
    levelIds: zoneLevels.map((l) => l.id),
  };
}

/** 找空层：给「建议迁移到哪」用。泛型保留调用方附加的字段（书柜名等）。 */
export function findFreeLevels<T extends LevelLike>(
  needMm: number,
  levels: T[],
  occupancy: Map<string, PlacedBookLike[]>,
  minHeightMm: number,
  coeffs: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): { level: T; usage: LevelUsage }[] {
  return levels
    .filter((l) => l.heightMm >= minHeightMm)
    .map((level) => ({ level, usage: levelUsage(level, occupancy.get(level.id) ?? [], coeffs) }))
    .filter((r) => r.usage.remainingMm >= needMm)
    .sort((a, b) => a.usage.remainingMm - b.usage.remainingMm); // 优先塞得刚好的层
}
