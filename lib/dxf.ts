// DXF 户型图解析 —— spec §8 说的"以后可能提供整个房子的 DXF"，现在提前到了。
//
// 只做只读解析，不做 CAD：目标是把墙线和房间轮廓变成一张能在浏览器里画出来的图，
// 好让「这本书在哪个书柜」落到真实的平面位置上。
//
// DXF 是成对出现的 (组码, 值) 文本流。这里只认家用户型图里真正会出现的实体：
// LINE / LWPOLYLINE / POLYLINE+VERTEX / CIRCLE / ARC / POINT / TEXT / MTEXT。
// 认不出来的实体直接跳过，不会让整个文件解析失败。

export type DxfShape =
  | { kind: "polyline"; points: [number, number][]; closed: boolean; layer: string }
  | { kind: "circle"; cx: number; cy: number; r: number; layer: string }
  | { kind: "arc"; cx: number; cy: number; r: number; startDeg: number; endDeg: number; layer: string }
  | { kind: "text"; x: number; y: number; text: string; height: number; layer: string };

export interface DxfPlan {
  /** 所有几何，单位已统一换算成毫米 */
  shapes: DxfShape[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 原图单位（$INSUNITS）和换算到毫米的系数，存下来方便排查 */
  sourceUnits: string;
  unitScale: number;
  layers: string[];
}

/** $INSUNITS → 毫米换算系数 */
const UNIT_TO_MM: Record<number, { name: string; scale: number }> = {
  0: { name: "unitless", scale: 1 },
  1: { name: "inches", scale: 25.4 },
  2: { name: "feet", scale: 304.8 },
  4: { name: "millimeters", scale: 1 },
  5: { name: "centimeters", scale: 10 },
  6: { name: "meters", scale: 1000 },
};

type Pair = [string, string];

function toPairs(text: string): Pair[] {
  // DXF 允许 \r\n，值里也可能有前后空格
  const lines = text.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([lines[i].trim(), lines[i + 1].trim()]);
  }
  return pairs;
}

interface RawEntity {
  type: string;
  codes: Pair[];
}

function firstNum(codes: Pair[], code: string): number | undefined {
  for (const [c, v] of codes) {
    if (c === code) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function firstStr(codes: Pair[], code: string): string | undefined {
  for (const [c, v] of codes) if (c === code) return v;
  return undefined;
}

/** 组码 10/20 会成对重复出现（多个顶点），要按出现顺序配对 */
function collectVertices(codes: Pair[]): [number, number][] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [c, v] of codes) {
    if (c === "10") xs.push(Number(v));
    else if (c === "20") ys.push(Number(v));
  }
  const out: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) out.push([xs[i], ys[i]]);
  }
  return out;
}

export function parseDxf(text: string): DxfPlan {
  const pairs = toPairs(text);

  // 单位
  let insunits = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === "9" && pairs[i][1] === "$INSUNITS") {
      insunits = Number(pairs[i + 1][1]) || 0;
      break;
    }
  }
  const unit = UNIT_TO_MM[insunits] ?? { name: `code_${insunits}`, scale: 1 };
  const k = unit.scale;

  // 切出 ENTITIES 段
  let start = -1;
  let end = pairs.length;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === "2" && v === "ENTITIES") start = i;
    else if (start >= 0 && c === "0" && v === "ENDSEC") {
      end = i;
      break;
    }
  }
  if (start < 0) {
    return { shapes: [], minX: 0, minY: 0, maxX: 0, maxY: 0, sourceUnits: unit.name, unitScale: k, layers: [] };
  }

  // 拆成一个个实体
  const entities: RawEntity[] = [];
  let cur: RawEntity | null = null;
  for (let i = start; i < end; i++) {
    const [c, v] = pairs[i];
    if (c === "0") {
      if (cur) entities.push(cur);
      cur = { type: v, codes: [] };
    } else if (cur) {
      cur.codes.push([c, v]);
    }
  }
  if (cur) entities.push(cur);

  const shapes: DxfShape[] = [];
  const layers = new Set<string>();

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const layer = firstStr(e.codes, "8") ?? "0";
    layers.add(layer);

    switch (e.type) {
      case "LINE": {
        const x1 = firstNum(e.codes, "10");
        const y1 = firstNum(e.codes, "20");
        const x2 = firstNum(e.codes, "11");
        const y2 = firstNum(e.codes, "21");
        if ([x1, y1, x2, y2].every((n) => n !== undefined)) {
          shapes.push({
            kind: "polyline",
            points: [[x1! * k, y1! * k], [x2! * k, y2! * k]],
            closed: false,
            layer,
          });
        }
        break;
      }

      case "LWPOLYLINE": {
        const pts = collectVertices(e.codes).map(([x, y]) => [x * k, y * k] as [number, number]);
        // 组码 70 的 bit0 = 闭合
        const flags = firstNum(e.codes, "70") ?? 0;
        if (pts.length >= 2) {
          shapes.push({ kind: "polyline", points: pts, closed: (flags & 1) === 1, layer });
        }
        break;
      }

      case "POLYLINE": {
        // 老式 POLYLINE：顶点在后面一串独立的 VERTEX 实体里，直到 SEQEND
        const flags = firstNum(e.codes, "70") ?? 0;
        const pts: [number, number][] = [];
        let j = i + 1;
        for (; j < entities.length && entities[j].type === "VERTEX"; j++) {
          const vx = firstNum(entities[j].codes, "10");
          const vy = firstNum(entities[j].codes, "20");
          if (vx !== undefined && vy !== undefined) pts.push([vx * k, vy * k]);
        }
        i = j - 1; // 跳过已消费的 VERTEX
        if (pts.length >= 2) {
          shapes.push({ kind: "polyline", points: pts, closed: (flags & 1) === 1, layer });
        }
        break;
      }

      case "CIRCLE": {
        const cx = firstNum(e.codes, "10");
        const cy = firstNum(e.codes, "20");
        const r = firstNum(e.codes, "40");
        if (cx !== undefined && cy !== undefined && r !== undefined) {
          shapes.push({ kind: "circle", cx: cx * k, cy: cy * k, r: r * k, layer });
        }
        break;
      }

      case "ARC": {
        const cx = firstNum(e.codes, "10");
        const cy = firstNum(e.codes, "20");
        const r = firstNum(e.codes, "40");
        const a1 = firstNum(e.codes, "50");
        const a2 = firstNum(e.codes, "51");
        if ([cx, cy, r, a1, a2].every((n) => n !== undefined)) {
          shapes.push({
            kind: "arc", cx: cx! * k, cy: cy! * k, r: r! * k,
            startDeg: a1!, endDeg: a2!, layer,
          });
        }
        break;
      }

      case "TEXT":
      case "MTEXT": {
        const x = firstNum(e.codes, "10");
        const y = firstNum(e.codes, "20");
        const h = firstNum(e.codes, "40") ?? 200 / k;
        const raw = firstStr(e.codes, "1");
        if (x !== undefined && y !== undefined && raw) {
          // MTEXT 里有 \P 换行和 {\f...} 格式码，清掉只留文字
          const text = raw.replace(/\\P/g, " ").replace(/\{[^}]*\}/g, "").replace(/\\[A-Za-z][^;]*;/g, "").trim();
          if (text) shapes.push({ kind: "text", x: x * k, y: y * k, text, height: h * k, layer });
        }
        break;
      }

      default:
        break; // 认不出的实体跳过，不影响其余部分
    }
  }

  // 包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bump = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of shapes) {
    if (s.kind === "polyline") for (const [x, y] of s.points) bump(x, y);
    else if (s.kind === "circle" || s.kind === "arc") {
      bump(s.cx - s.r, s.cy - s.r);
      bump(s.cx + s.r, s.cy + s.r);
    } else bump(s.x, s.y);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }

  return {
    shapes,
    minX, minY, maxX, maxY,
    sourceUnits: unit.name,
    unitScale: k,
    layers: Array.from(layers).sort(),
  };
}
