// 从墙线里找出「房间」—— 平面图的面（face）提取
//
// 第一版只认闭合多段线，结果只找到 3 个房间：因为户型图里的墙绝大多数是
// 一根根独立的 LINE，房间是被这些线**围出来**的，本身并没有闭合多段线。
// 正确做法是把所有墙线当成平面图（planar graph），求它的最小环。
//
// 算法（教科书做法）：
//   1. 端点聚类合并，让"看起来相连"的线真正相连
//   2. 线段在落到它身上的每一个节点处打断 —— 墙经常是十字/丁字相交，
//      更常见的是两根共线的墙互相盖住一截
//   3. 每个节点按方位角排序出边
//   4. 从每条有向半边出发，每到一个节点就选"最靠右"的那条出边继续走，
//      走回起点即得到一个最小环 = 一个房间
//   5. 按绕向丢掉外轮廓，再滤掉明显不是房间的碎片

import type { Pt } from "./geometry";
import { polygonArea, signedArea } from "./geometry";

/** 端点聚类容差（毫米）。CAD 图里两根墙的端点常差几毫米到几厘米。 */
const SNAP_MM = 60;
/** 求交时的数值容差 */
const EPS = 1e-6;
/** 判定「节点落在某条线段上」的垂距容差（毫米） */
const ON_SEG_MM = 30;

type Seg = [Pt, Pt];

/**
 * 节点索引：把相距 SNAP_MM 以内的点合并成同一个节点。
 *
 * 之前用 `Math.round(x / SNAP)` 当哈希键，这是错的 —— 相距 1mm 的两点可能
 * 正好跨在格子边界两侧而被判成两个节点，相距 59mm 的两点却可能落进同一格。
 * 这里改成网格加速的贪心聚类：查邻近 3×3 格里有没有够近的已有节点。
 */
class NodeIndex {
  readonly pts: Pt[] = [];
  private cells = new Map<string, number[]>();

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / SNAP_MM)},${Math.floor(y / SNAP_MM)}`;
  }

  find(p: Pt): number | null {
    const cx = Math.floor(p[0] / SNAP_MM);
    const cy = Math.floor(p[1] / SNAP_MM);
    let best: number | null = null;
    let bestD = SNAP_MM;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const id of this.cells.get(`${cx + i},${cy + j}`) ?? []) {
          const d = Math.hypot(this.pts[id][0] - p[0], this.pts[id][1] - p[1]);
          if (d <= bestD) {
            bestD = d;
            best = id;
          }
        }
      }
    }
    return best;
  }

  add(p: Pt): number {
    const hit = this.find(p);
    if (hit !== null) return hit;
    const id = this.pts.length;
    this.pts.push(p);
    const k = this.cellKey(p[0], p[1]);
    this.cells.set(k, [...(this.cells.get(k) ?? []), id]);
    return id;
  }
}

/** 线段交点（含 T 形相接）。平行或不相交返回 null。 */
function intersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
  const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < EPS) return null; // 平行

  const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
  const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return [a1[0] + t * d1x, a1[1] + t * d1y];
}

/** 打断后的图：节点表 + 以节点 id 表示的边 */
export interface PlanarGraph {
  index: NodeIndex;
  edges: [number, number][];
}

/**
 * 把所有线段在「落到它身上的每一个节点」处打断。
 *
 * 只两两求交是不够的。CAD 户型图里非常常见两种情况：
 *   * 共线重叠 —— 同一堵墙被画了两遍，或一段长墙盖住了一段短墙。
 *     平行线求交恒为空，长墙就不会在短墙的端点处断开。
 *   * 端点差几毫米的丁字接头 —— 求交虽然算得出来，但容差一紧就漏。
 * 结果是图上看着连通、拓扑上却断了，那一圈永远围不出面。
 * 右下角那间房丢掉正是这个原因：底墙 (12750,600)→(5350,600) 与
 * (5350,600)→(8350,600) 共线重叠，长墙没在 x=8350 处断开。
 *
 * 另一个坑：以前会把长度不足容差的碎段整条扔掉。墙角上那种 50mm 的小错台
 * （12700,1050)→(12750,1050)）就是这么消失的，一消失墙就断成了死胡同，
 * 走面的时候在死胡同里原路折返，把右下角那间房并进了外轮廓。
 * 现在改成：短边照留，只丢两端并进同一个节点的自环。
 */
function buildGraph(segs: Seg[]): PlanarGraph {
  const index = new NodeIndex();

  for (const [a, b] of segs) {
    index.add(a);
    index.add(b);
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const p = intersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
      if (p) index.add(p);
    }
  }

  const edges: [number, number][] = [];
  const seen = new Set<string>();

  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < EPS) continue;
    const loX = Math.min(a[0], b[0]) - ON_SEG_MM, hiX = Math.max(a[0], b[0]) + ON_SEG_MM;
    const loY = Math.min(a[1], b[1]) - ON_SEG_MM, hiY = Math.max(a[1], b[1]) + ON_SEG_MM;

    // 自己的两个端点无条件先放进去。它们可能已经被并到 SNAP_MM 外的簇代表点上，
    // 那时按垂距判会把自己的端点判成"不在线上"，整条边就凭空消失了
    // —— 墙角那个 50mm 小错台就是这么丢的。
    const onSeg: { id: number; t: number }[] = [
      { id: index.add(a), t: 0 },
      { id: index.add(b), t: 1 },
    ];
    for (let id = 0; id < index.pts.length; id++) {
      const p = index.pts[id];
      if (p[0] < loX || p[0] > hiX || p[1] < loY || p[1] > hiY) continue;
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
      if (t <= EPS || t >= 1 - EPS) continue;
      // 垂距：投影落在线上不代表点就在线上
      const px = a[0] + t * dx, py = a[1] + t * dy;
      if (Math.hypot(p[0] - px, p[1] - py) > ON_SEG_MM) continue;
      onSeg.push({ id, t });
    }

    onSeg.sort((p, q) => p.t - q.t);
    for (let k = 0; k < onSeg.length - 1; k++) {
      const u = onSeg[k].id, v = onSeg[k + 1].id;
      if (u === v) continue; // 两端聚成了同一个节点，自环，丢掉
      const key = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([u, v]);
    }
  }

  return { index, edges };
}

/** 仅供调试脚本查看打断结果 */
export function __graphForDebug(segs: Seg[]): PlanarGraph {
  return buildGraph(segs);
}

/**
 * 提取最小环。
 * 走法：进入节点 v 的方向是 u→v，下一条边取"相对 v→u 顺时针方向最近"的那条，
 * 这样一直走会沿着一个面的边界绕一圈。
 */
export function traceFaces(segments: Seg[]): Pt[][] {
  const { index, edges } = buildGraph(segments);
  const pts = index.pts;

  const out: { to: number; angle: number }[][] = pts.map(() => []);
  for (const [u, v] of edges) {
    out[u].push({ to: v, angle: Math.atan2(pts[v][1] - pts[u][1], pts[v][0] - pts[u][0]) });
    out[v].push({ to: u, angle: Math.atan2(pts[u][1] - pts[v][1], pts[u][0] - pts[v][0]) });
  }
  for (const list of out) list.sort((a, b) => a.angle - b.angle);

  const visited = new Set<string>();
  const faces: Pt[][] = [];

  for (let from = 0; from < pts.length; from++) {
    for (const edge of out[from]) {
      const startKey = `${from}>${edge.to}`;
      if (visited.has(startKey)) continue;

      const poly: Pt[] = [];
      let cu = from;
      let cv = edge.to;
      let guard = 0;

      while (guard++ < 20000) {
        visited.add(`${cu}>${cv}`);
        poly.push(pts[cu]);

        const idx = out[cv].findIndex((e) => e.to === cu);
        if (idx < 0) break;
        // 取顺时针方向的下一条（即数组里前一个），走出最小环
        const next = out[cv][(idx - 1 + out[cv].length) % out[cv].length];
        const nu = cv;
        const nv = next.to;

        if (nu === from && nv === edge.to) break; // 回到起点
        cu = nu;
        cv = nv;
      }

      if (poly.length >= 3) faces.push(poly);
    }
  }

  return faces;
}

export interface DetectedRoom {
  polygon: Pt[];
  areaMm2: number;
}

/**
 * 从墙线找房间。
 *
 * 外轮廓不靠面积猜，靠绕向：按上面的走法，内部的面和最外面那一圈的
 * 有向面积符号是相反的，这比"面积大于图幅的百分之多少"稳得多
 * —— 户型狭长或有大客厅时，按面积判会误杀。
 */
export function detectRoomsFromWalls(
  polys: { points: Pt[]; closed: boolean }[],
  opts: { minAreaMm2?: number; maxAreaMm2?: number } = {},
): DetectedRoom[] {
  const minArea = opts.minAreaMm2 ?? 1_500_000;    // 1.5 ㎡，小储藏间也要认
  const maxArea = opts.maxAreaMm2 ?? 200_000_000;  // 200 ㎡，纯粹兜底

  const segs: Seg[] = [];
  for (const p of polys) {
    const pts = p.points;
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    if (p.closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  }
  if (!segs.length) return [];

  const faces = traceFaces(segs);

  // 内部面的绕向占多数，跟着多数走就能把外轮廓那一圈挑出来
  let pos = 0, neg = 0;
  for (const f of faces) {
    const a = signedArea(f);
    if (Math.abs(a) < minArea) continue;
    if (a > 0) pos++;
    else neg++;
  }
  const innerSign = pos >= neg ? 1 : -1;

  const seen = new Set<string>();
  const rooms: DetectedRoom[] = [];

  for (const poly of faces) {
    const signed = signedArea(poly);
    if (Math.sign(signed) !== innerSign) continue; // 外轮廓
    const area = Math.abs(signed);
    if (area < minArea || area > maxArea) continue;

    // 去重：同一个面可能被两个方向各走一遍
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const k = `${Math.round(cx / 200)},${Math.round(cy / 200)},${Math.round(area / 100000)}`;
    if (seen.has(k)) continue;
    seen.add(k);

    rooms.push({ polygon: poly, areaMm2: polygonArea(poly) });
  }

  return rooms.sort((a, b) => b.areaMm2 - a.areaMm2);
}
