// 书脊估算的自校准 —— 用用户量出来的真实数据反推系数
//
// 为什么需要这个：
// 整个容量模型（装填率、能不能放得下、上架算法的每一步）都建在
// `spineMm ≈ pageCount × mmPerPage + base` 这一个公式上。而这两个系数
// 目前是**猜的**（0.052 / 3mm，按 80g 胶版纸推的），既没有真实数据支撑，
// 也没有任何办法知道它偏了多少。
//
// 而且偏的方向要命：纸厚一点的书（铜版、轻型纸、精装）会被**低估**，
// 于是系统说"这层还能放 5 本"，你抱着书走过去发现塞不进——
// 这正是这个应用最该避免的那种错。
//
// 好消息是真实数据极其容易拿到：站在书架前，拿卷尺量一下这一层的书占了多宽。
// 十秒钟一层。有两三层就能把系数拟合出来。
//
// 模型（对整层求和，逐本的误差会相互抵消，比逐本量准得多）：
//   量出来的宽度 = mmPerPage × Σ页数 + base × (平装数 + 2×精装数) + Σ已知书脊
// 两个未知数，最小二乘。精装/平装的比例锁死在 2:1（6mm / 3mm），
// 不然三个未知数配上两三个样本，拟合出来的东西纯属噪声。

import { DEFAULT_COEFFICIENTS, type CapacityCoefficients } from "./capacity";

export interface CalibrationBook {
  pageCount?: number | null;
  binding?: string | null;
  /** 已经量过的书：它不参与拟合，但要从量出来的总宽里扣掉 */
  spineMm?: number | null;
}

export interface CalibrationSample {
  levelId: string;
  /** 用户量出来的这一层实际被书占掉的宽度（毫米） */
  measuredMm: number;
  books: CalibrationBook[];
  at?: string;
}

export interface CalibrationResult {
  mmPerPage: number;
  basePaperbackMm: number;
  baseHardcoverMm: number;
  /** 用了几层的数据 */
  samples: number;
  /** 参与拟合的书本数 */
  booksUsed: number;
  /** 拟合后平均每层还差多少毫米 —— 这套系数有多可信，看这个 */
  residualMm: number;
  /** 沿用默认系数的话平均每层差多少，用来说明"校准前 vs 校准后" */
  baselineResidualMm: number;
  status: "ok" | "not_enough_data" | "implausible";
  note?: string;
}

const HARDCOVER_HINTS = ["精装", "hardcover", "hardback", "boards"];

function isHardcover(binding: string | null | undefined): boolean {
  const b = (binding ?? "").toLowerCase();
  return HARDCOVER_HINTS.some((h) => b.includes(h));
}

/** 合理范围。超出就说明样本有问题（量错了、或者这层混了非书的东西） */
const PLAUSIBLE = {
  mmPerPage: [0.02, 0.15] as const,
  base: [0, 20] as const,
};

/** 一层在给定系数下的估算宽度 */
function predict(books: CalibrationBook[], mmPerPage: number, base: number): number {
  let sum = 0;
  for (const b of books) {
    if (b.spineMm && b.spineMm > 0) { sum += b.spineMm; continue; }
    if (b.pageCount && b.pageCount > 0) {
      sum += b.pageCount * mmPerPage + base * (isHardcover(b.binding) ? 2 : 1);
    } else {
      sum += DEFAULT_COEFFICIENTS.defaultSpineMm;
    }
  }
  return sum;
}

function meanAbsResidual(samples: CalibrationSample[], mmPerPage: number, base: number): number {
  if (!samples.length) return 0;
  const total = samples.reduce(
    (s, x) => s + Math.abs(predict(x.books, mmPerPage, base) - x.measuredMm),
    0,
  );
  return Math.round((total / samples.length) * 10) / 10;
}

/**
 * 最小二乘拟合 mmPerPage 与 base。
 *
 * 每层给一个方程：
 *   measured − Σ(已量过的书脊) − Σ(没页数的书按默认宽)
 *     = mmPerPage × Σ页数  +  base × (平装数 + 2×精装数)
 * 记左边为 y，右边两个系数分别为 p 和 q，解正规方程组。
 */
export function calibrate(
  samples: CalibrationSample[],
  current: CapacityCoefficients = DEFAULT_COEFFICIENTS,
): CalibrationResult {
  const rows: { y: number; p: number; q: number; books: number }[] = [];

  for (const s of samples) {
    let y = s.measuredMm;
    let p = 0;
    let q = 0;
    let counted = 0;
    for (const b of s.books) {
      if (b.spineMm && b.spineMm > 0) { y -= b.spineMm; continue; }
      if (b.pageCount && b.pageCount > 0) {
        p += b.pageCount;
        q += isHardcover(b.binding) ? 2 : 1;
        counted++;
      } else {
        y -= DEFAULT_COEFFICIENTS.defaultSpineMm; // 没页数的按兜底宽扣掉
      }
    }
    if (counted > 0) rows.push({ y, p, q, books: counted });
  }

  const booksUsed = rows.reduce((s, r) => s + r.books, 0);
  const baseline = meanAbsResidual(samples, current.mmPerPage, current.basePaperbackMm);

  // 两个未知数至少要两层；而且两层的"页数/本数"比例不能一样，否则方程组退化
  if (rows.length < 2 || booksUsed < 10) {
    return {
      mmPerPage: current.mmPerPage,
      basePaperbackMm: current.basePaperbackMm,
      baseHardcoverMm: current.baseHardcoverMm,
      samples: rows.length,
      booksUsed,
      residualMm: baseline,
      baselineResidualMm: baseline,
      status: "not_enough_data",
      note: "至少要量两层、合计十本以上的书",
    };
  }

  // 正规方程：[Σp² Σpq; Σpq Σq²] [mmPerPage; base] = [Σpy; Σqy]
  let spp = 0, spq = 0, sqq = 0, spy = 0, sqy = 0;
  for (const r of rows) {
    spp += r.p * r.p;
    spq += r.p * r.q;
    sqq += r.q * r.q;
    spy += r.p * r.y;
    sqy += r.q * r.y;
  }
  const det = spp * sqq - spq * spq;

  let mmPerPage: number;
  let base: number;

  if (Math.abs(det) < 1e-6) {
    // 各层的构成太像，解不出两个未知数 —— 退一步只拟合 mmPerPage，base 用现值
    const yAdj = rows.reduce((s, r) => s + (r.y - current.basePaperbackMm * r.q) * r.p, 0);
    if (spp < 1e-6) {
      return {
        mmPerPage: current.mmPerPage, basePaperbackMm: current.basePaperbackMm,
        baseHardcoverMm: current.baseHardcoverMm, samples: rows.length, booksUsed,
        residualMm: baseline, baselineResidualMm: baseline,
        status: "not_enough_data", note: "样本里没有带页数的书",
      };
    }
    mmPerPage = yAdj / spp;
    base = current.basePaperbackMm;
  } else {
    mmPerPage = (spy * sqq - sqy * spq) / det;
    base = (sqy * spp - spy * spq) / det;
  }

  const okRange =
    mmPerPage >= PLAUSIBLE.mmPerPage[0] && mmPerPage <= PLAUSIBLE.mmPerPage[1] &&
    base >= PLAUSIBLE.base[0] && base <= PLAUSIBLE.base[1];

  if (!okRange) {
    // 拟合出了不合物理的数 —— 几乎一定是量错了或者这层混进了非书物件。
    // 这种时候**保留原系数**，绝不能把一个荒唐的值推到全库去。
    return {
      mmPerPage: current.mmPerPage,
      basePaperbackMm: current.basePaperbackMm,
      baseHardcoverMm: current.baseHardcoverMm,
      samples: rows.length,
      booksUsed,
      residualMm: baseline,
      baselineResidualMm: baseline,
      status: "implausible",
      note: `拟合结果 ${mmPerPage.toFixed(3)}mm/页、底 ${base.toFixed(1)}mm 不在合理范围内，已保留原系数`,
    };
  }

  const rounded = {
    mmPerPage: Math.round(mmPerPage * 10000) / 10000,
    basePaperbackMm: Math.round(base * 10) / 10,
    baseHardcoverMm: Math.round(base * 2 * 10) / 10,
  };

  return {
    ...rounded,
    samples: rows.length,
    booksUsed,
    residualMm: meanAbsResidual(samples, rounded.mmPerPage, rounded.basePaperbackMm),
    baselineResidualMm: baseline,
    status: "ok",
  };
}
