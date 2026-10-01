// 平面几何小工具 —— 房间识别、书柜归属判定都要用。
// 单位统一毫米，坐标系与户型图一致。

export type Pt = [number, number];

/** 多边形有向面积的两倍（鞋带公式）。正负表示绕向。 */
function shoelace(poly: Pt[]): number {
  let sum = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

export function polygonArea(poly: Pt[]): number {
  return Math.abs(shoelace(poly)) / 2;
}

/** 有向面积。符号表示绕向：识别外轮廓时要用。 */
export function signedArea(poly: Pt[]): number {
  return shoelace(poly) / 2;
}

export function centroid(poly: Pt[]): Pt {
  const a = shoelace(poly);
  if (Math.abs(a) < 1e-9) {
    // 退化多边形（共线）就用顶点平均值兜底
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % n];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** 射线法判点是否在多边形内 */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 点到线段的距离 */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** 点到多边形边界的有符号距离：内部为正 */
function signedDistToPolygon(p: Pt, poly: Pt[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    min = Math.min(min, distToSeg(p, poly[j], poly[i]));
  }
  return pointInPolygon(p, poly) ? min : -min;
}

/**
 * 「最难被够到的点」（pole of inaccessibility）—— 放标签用。
 *
 * 为什么不用质心：L 形、凹形的房间，质心可能根本不在房间里，
 * 名字就飘到了走廊上（书房那间就是这样）。这个算法找的是房间内部
 * 离墙最远的那个点，形状再怪也一定落在房间内。
 *
 * 做法是 Mapbox polylabel 的四叉树细分：把包围盒切成格子，
 * 每格用「格心到边界的距离 + 半对角线」作为该格可能达到的上界，
 * 优先细分上界最大的格子，上界不超过当前最优就整格剪掉。
 */
export function poleOfInaccessibility(poly: Pt[], precision?: number): Pt {
  if (poly.length < 3) return poly[0] ?? [0, 0];
  const { minX, minY, maxX, maxY } = bbox(poly);
  const w = maxX - minX, h = maxY - minY;
  const cell = Math.min(w, h);
  if (cell === 0) return [minX, minY];
  const prec = precision ?? Math.max(1, cell / 100);

  interface Box { x: number; y: number; half: number; d: number; max: number }
  const makeBox = (x: number, y: number, half: number): Box => {
    const d = signedDistToPolygon([x, y], poly);
    return { x, y, half, d, max: d + half * Math.SQRT2 };
  };

  const queue: Box[] = [];
  const size = cell / 2;
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) {
      queue.push(makeBox(x + size / 2, y + size / 2, size / 2));
    }
  }

  // 质心先当初值；它在多边形内时往往已经很好了
  let best = makeBox(...(centroid(poly) as [number, number]), 0);
  const bboxCenter = makeBox(minX + w / 2, minY + h / 2, 0);
  if (bboxCenter.d > best.d) best = bboxCenter;

  let guard = 0;
  while (queue.length && guard++ < 20000) {
    // 取上界最大的格子（数量不大，线性挑比维护堆更省事）
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
    const box = queue.splice(bi, 1)[0];

    if (box.d > best.d) best = box;
    if (box.max - best.d <= prec) continue;

    const half = box.half / 2;
    queue.push(makeBox(box.x - half, box.y - half, half));
    queue.push(makeBox(box.x + half, box.y - half, half));
    queue.push(makeBox(box.x - half, box.y + half, half));
    queue.push(makeBox(box.x + half, box.y + half, half));
  }

  return [best.x, best.y];
}

/** 房间名该画在哪 —— 缓存友好的薄封装，语义比 poleOfInaccessibility 直白 */
export function labelPoint(poly: Pt[]): Pt {
  return poleOfInaccessibility(poly);
}

/** 线段上离 p 最近的点 */
function closestOnSeg(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * 把点收进多边形内。
 * 书柜被绑定到房间之后，拖动不能越界 —— 与其拒绝落点让人一头雾水，
 * 不如贴着墙停下：先找到边界上最近的点，再朝房间"最深处"挪一小步，
 * 保证严格落在房间内部而不是压在墙线上。
 */
export function clampIntoPolygon(p: Pt, poly: Pt[]): Pt {
  if (poly.length < 3 || pointInPolygon(p, poly)) return p;

  let best: Pt = poly[0];
  let bestD = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const q = closestOnSeg(p, poly[j], poly[i]);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }

  const pole = poleOfInaccessibility(poly);
  for (const t of [0.03, 0.08, 0.16, 0.3, 0.5, 1]) {
    const c: Pt = [best[0] + (pole[0] - best[0]) * t, best[1] + (pole[1] - best[1]) * t];
    if (pointInPolygon(c, poly)) return [Math.round(c[0]), Math.round(c[1])];
  }
  return [Math.round(pole[0]), Math.round(pole[1])];
}

export function bbox(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 从户型图的闭合多段线里挑出「房间」。
 *
 * 判据（都是经验值，宁可少认也不要乱认）：
 *   * 面积在 2㎡ 到 60㎡ 之间 —— 太小的是柱子/门垛，太大的是整栋轮廓
 *   * 不包含其它候选房间 —— 包着别人的那个多半是外墙轮廓
 */
export function detectRooms(
  polys: { points: Pt[]; closed: boolean }[],
): { polygon: Pt[]; areaMm2: number }[] {
  const MIN_AREA = 2_000_000;   // 2 ㎡
  const MAX_AREA = 60_000_000;  // 60 ㎡

  const candidates = polys
    .filter((p) => p.closed && p.points.length >= 3)
    .map((p) => ({ polygon: p.points, areaMm2: polygonArea(p.points) }))
    .filter((c) => c.areaMm2 >= MIN_AREA && c.areaMm2 <= MAX_AREA);

  // 剔掉「包住了另一个候选」的那些外框
  return candidates.filter((c) => {
    const others = candidates.filter((o) => o !== c);
    const containsOther = others.some(
      (o) => o.areaMm2 < c.areaMm2 * 0.9 && pointInPolygon(centroid(o.polygon), c.polygon),
    );
    return !containsOther;
  });
}
