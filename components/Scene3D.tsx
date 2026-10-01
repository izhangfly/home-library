"use client";

// 3D 空间 —— 外视（整屋）与内视（进到房间里看某个书架）
//
// 墙的表现：地面射灯往上打，越高越淡，不封顶。
// 用 SVG 线性渐变实现，比在 three.js 里配 shader 简单得多，而且矢量、能选中、
// 天然继承网站的粗描边风格。
//
// 为什么不用 three.js：要画的全是轴对齐盒子和竖直面，用不上材质光照。
// 投影 + 画家算法（远的先画）就够了，还省掉几百 KB 依赖。
//
// 所有坐标单位都是毫米，与户型图、层高完全同一套。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CLC_CLASS_COLOR, clcLabel, clcMainClass } from "@/lib/clc";
import { readableOn } from "@/lib/contrast";
import { labelPoint, type Pt } from "@/lib/geometry";
import { bookcaseGeometry } from "@/lib/shelfGeometry";
import type { FloorPlanData } from "./FloorPlanView";

export interface SceneBook {
  id: string;
  title: string;
  spineMm: number;
  clc?: string | null;
  callNumber?: string | null;
}

export interface SceneLevel {
  id: string;
  levelIndex: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  books: SceneBook[];
}

export interface SceneBookcase {
  id: string;
  name: string;
  room: string | null;
  roomId?: string | null;
  roomX: number;
  roomY: number;
  rotation: number;
  widthMm?: number | null;
  depthMm?: number | null;
  heightMm?: number | null;
  color?: string | null;
  levels: SceneLevel[];
}

export interface SceneRoom {
  id: string;
  name: string;
  color: string;
  polygon: [number, number][];
}

const BOARD = 20;
const WALL_H = 2600;
// 尺寸统一走 lib/shelfGeometry，和平面图用同一套推法 ——
// 否则平面图和 3D 会画出两个不一样大的柜子
/** 指针位移超过这个像素数才算拖拽，否则当点击 */
const DRAG_THRESHOLD = 5;

type P3 = { x: number; y: number; z: number };

interface Face {
  pts: P3[];
  fill: string;
  stroke?: string;
  strokeW?: number;
  opacity?: number;
  depth: number;
  gradient?: string;
  label?: string;
  labelSize?: number;
  labelFill?: string;
  /** 标签落点。不给就用面的形心 —— L 形房间的形心可能在房间外，得显式指定 */
  labelAt?: P3;
  bookId?: string;
  roomId?: string;
  bookcaseId?: string;
  title?: string;
  /** 只有可交互的面才接收指针事件；墙体纯装饰，挡住房间就点不进去了 */
  pickable?: boolean;
}

function makeProjector(az: number, el: number, pan: { x: number; y: number }) {
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const se = Math.sin(e), ce = Math.cos(e);
  return {
    project(p: P3) {
      const px = p.x - pan.x;
      const py = p.y - pan.y;
      const rx = px * ca - py * sa;
      const ry = px * sa + py * ca;
      return { X: rx, Y: ry * se - p.z * ce };
    },
    depth(p: P3) {
      return (p.x - pan.x) * sa + (p.y - pan.y) * ca;
    },
  };
}

function centroid3(pts: P3[]): P3 {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
    z: pts.reduce((s, p) => s + p.z, 0) / n,
  };
}

function localToWorld(bc: SceneBookcase, lx: number, ly: number, lz: number): P3 {
  const r = ((bc.rotation || 0) * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: bc.roomX + lx * c - ly * s, y: bc.roomY + lx * s + ly * c, z: lz };
}

function shade(hex: string, f: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  return (
    "#" +
    [0, 2, 4]
      .map((i) => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) * f))))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function Scene3D({
  plan,
  bookcases,
  rooms = [],
  highlightBookId,
  className = "h-[520px]",
}: {
  plan: FloorPlanData | null;
  bookcases: SceneBookcase[];
  rooms?: SceneRoom[];
  highlightBookId?: string;
  className?: string;
}) {
  const t = useTranslations();

  // 默认：从墙角斜上方 45° 看下去
  const [az, setAz] = useState(45);
  const [el, setEl] = useState(38);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoverRoom, setHoverRoom] = useState<string | null>(null);
  const [insideRoom, setInsideRoom] = useState<string | null>(null);
  const [shelfIdx, setShelfIdx] = useState(0);
  const [tip, setTip] = useState<string | null>(null);
  // 记下按下时的位置：位移很小就当成"点击"，超过阈值才算拖拽旋转。
  // 之所以要自己判，是因为 SVG 上做了 setPointerCapture，
  // 子元素（房间色块）的 click 事件会被吞掉，只靠 onClick 点不进房间。
  const drag = useRef<{ x: number; y: number; az: number; el: number; moved: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);

  /** 内视模式下，当前房间里的书柜 */
  const roomBookcases = useMemo(() => {
    if (!insideRoom) return [];
    const rm = roomById.get(insideRoom);
    if (!rm) return [];
    // 优先按绑定关系，老数据没有 roomId 才退回按名字匹配
    return bookcases.filter((b) => (b.roomId ? b.roomId === rm.id : b.room === rm.name));
  }, [insideRoom, roomById, bookcases]);

  const focusBookcase = roomBookcases[shelfIdx] ?? null;

  // 进入房间 / 切换书架时，把相机移到正对该柜正面
  useEffect(() => {
    if (!insideRoom) return;
    const bc = focusBookcase;
    if (!bc) {
      const rm = roomById.get(insideRoom);
      if (rm) {
        const [cx, cy] = labelPoint(rm.polygon as Pt[]);
        setPan({ x: cx, y: cy });
      }
      return;
    }
    setPan({ x: bc.roomX, y: bc.roomY });
    // 柜子正面朝 -y（局部坐标），转到正对它需要抵消柜子自身旋转
    setAz(-(bc.rotation || 0));
    setEl(12);
  }, [insideRoom, focusBookcase, roomById]);

  // WASD 平移
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = 400;
      const a = (az * Math.PI) / 180;
      const fwd = { x: -Math.sin(a), y: -Math.cos(a) };
      const right = { x: Math.cos(a), y: -Math.sin(a) };
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(k)) return;
      // 输入框里按 WASD 不该移动相机
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      setPan((p) => ({
        x: p.x + (k === "w" ? fwd.x : k === "s" ? -fwd.x : k === "d" ? right.x : -right.x) * step,
        y: p.y + (k === "w" ? fwd.y : k === "s" ? -fwd.y : k === "d" ? right.y : -right.y) * step,
      }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [az]);

  const built = useMemo(() => {
    const proj = makeProjector(az, el, pan);
    const faces: Face[] = [];
    const inside = !!insideRoom;

    // ---- 房间地块（半透明色块，能看穿到书架）----
    for (const rm of rooms) {
      const dimmed = inside && rm.id !== insideRoom;
      faces.push({
        pts: rm.polygon.map(([x, y]) => ({ x, y, z: 0 })),
        fill: rm.color,
        // 0.28 太淡：自动分配的十几个颜色铺在白底上几乎一个样，
        // 房间就分不出来了。0.4 还能看穿到书架，但颜色读得出来。
        opacity: dimmed ? 0.08 : hoverRoom === rm.id ? 0.62 : 0.4,
        stroke: "var(--color-border)",
        strokeW: hoverRoom === rm.id ? 2.5 : 1,
        depth: Number.POSITIVE_INFINITY,
        roomId: rm.id,
        pickable: true,
        label: inside ? undefined : rm.name,
        labelSize: 260,
        labelFill: readableOn(rm.color),
        labelAt: (() => {
          const [lx, ly] = labelPoint(rm.polygon as Pt[]);
          return { x: lx, y: ly, z: 0 };
        })(),
      });
    }

    // ---- 墙 ----
    // 内视时只画当前房间附近的墙，否则整屋的墙都堆在画面里，像走进了迷宫
    const activeRoom = inside ? rooms.find((r) => r.id === insideRoom) : null;
    const near = (x: number, y: number) => {
      if (!activeRoom) return true;
      const xs = activeRoom.polygon.map((p) => p[0]);
      const ys = activeRoom.polygon.map((p) => p[1]);
      const pad = 600;
      return (
        x >= Math.min(...xs) - pad && x <= Math.max(...xs) + pad &&
        y >= Math.min(...ys) - pad && y <= Math.max(...ys) + pad
      );
    };

    if (plan) {
      for (const s of plan.geometry) {
        if (s.kind !== "polyline") continue;
        if (s.closed && !rooms.length) {
          faces.push({
            pts: s.points.map(([x, y]) => ({ x, y, z: 0 })),
            fill: "var(--color-surface-2)",
            stroke: "var(--color-border-soft)",
            depth: Number.POSITIVE_INFINITY,
          });
        }
        for (let i = 0; i < s.points.length - 1; i++) {
          const [x1, y1] = s.points[i];
          const [x2, y2] = s.points[i + 1];
          if (!near((x1 + x2) / 2, (y1 + y2) / 2)) continue;
          const quad: P3[] = [
            { x: x1, y: y1, z: 0 },
            { x: x2, y: y2, z: 0 },
            { x: x2, y: y2, z: WALL_H },
            { x: x1, y: y1, z: WALL_H },
          ];
          faces.push({
            pts: quad,
            // 外视：地灯向上打、越高越淡；内视：实墙
            fill: inside ? "#ffffff" : "url(#wallGlow)",
            gradient: inside ? undefined : "wallGlow",
            stroke: inside ? "var(--color-border)" : "none",
            strokeW: inside ? 1.5 : 0,
            depth: proj.depth(centroid3(quad)),
          });
          // 地灯本身：墙脚一条亮线
          if (!inside) {
            faces.push({
              pts: [
                { x: x1, y: y1, z: 0 },
                { x: x2, y: y2, z: 0 },
                { x: x2, y: y2, z: 60 },
                { x: x1, y: y1, z: 60 },
              ],
              fill: "#FDC800",
              opacity: 0.9,
              depth: proj.depth({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: 30 }) - 0.5,
            });
          }
        }
      }
    }

    // ---- 书柜 ----
    const visible = inside ? roomBookcases : bookcases;
    for (const bc of visible) {
      const levels = [...bc.levels].sort((a, b) => a.levelIndex - b.levelIndex);
      const geo = bookcaseGeometry(bc, levels);
      const W = geo.widthMm;
      const D = geo.depthMm;
      const H = geo.heightMm;
      const base = bc.color || "#432DD7";
      const isFocus = inside && focusBookcase?.id === bc.id;

      const corners = (lz: number) =>
        [
          localToWorld(bc, -W / 2, -D / 2, lz),
          localToWorld(bc, W / 2, -D / 2, lz),
          localToWorld(bc, W / 2, D / 2, lz),
          localToWorld(bc, -W / 2, D / 2, lz),
        ] as P3[];
      const bot = corners(0);
      const top = corners(H);

      const back = [bot[2], bot[3], top[3], top[2]];
      faces.push({
        pts: back, fill: shade(base, 0.5), stroke: "var(--color-border)", strokeW: 1.5,
        depth: proj.depth(centroid3(back)), bookcaseId: bc.id,
      });
      for (const [a, b] of [[bot[1], bot[2]], [bot[3], bot[0]]] as [P3, P3][]) {
        const q = [a, b, { ...b, z: H }, { ...a, z: H }];
        faces.push({
          pts: q, fill: shade(base, 0.72), stroke: "var(--color-border)", strokeW: 1.5,
          depth: proj.depth(centroid3(q)), bookcaseId: bc.id,
        });
      }
      faces.push({
        pts: top, fill: shade(base, isFocus ? 1.15 : 1.0), stroke: "var(--color-border)", strokeW: 1.5,
        depth: proj.depth(centroid3(top)), bookcaseId: bc.id,
        label: inside ? undefined : bc.name, labelSize: Math.max(150, D * 0.42),
        labelFill: readableOn(shade(base, 1.0)),
      });

      let z = BOARD;
      for (const level of levels) {
        const lw = Math.min(level.widthMm, W);
        const ld = Math.min(level.depthMm || D, D);

        const board = [
          localToWorld(bc, -lw / 2, -ld / 2, z),
          localToWorld(bc, lw / 2, -ld / 2, z),
          localToWorld(bc, lw / 2, ld / 2, z),
          localToWorld(bc, -lw / 2, ld / 2, z),
        ];
        faces.push({
          pts: board, fill: shade(base, 0.88), stroke: "var(--color-border)", strokeW: 1.2,
          depth: proj.depth(centroid3(board)), bookcaseId: bc.id,
        });

        // 该层主类目标签 —— 用户明确要求网格上带类目
        const counts = new Map<string, number>();
        for (const b of level.books) {
          const m = clcMainClass(b.clc);
          const key = (b.clc ?? "").slice(0, 4);
          if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
          void m;
        }
        let dom: string | null = null, best = 0;
        for (const [k, v] of counts) if (v > best) { best = v; dom = k; }

        if (dom && (inside || level.books.length > 0)) {
          const labelPts = [
            localToWorld(bc, -lw / 2, -ld / 2 - 2, z + BOARD),
            localToWorld(bc, lw / 2, -ld / 2 - 2, z + BOARD),
            localToWorld(bc, lw / 2, -ld / 2 - 2, z + BOARD + 90),
            localToWorld(bc, -lw / 2, -ld / 2 - 2, z + BOARD + 90),
          ];
          const cls = clcMainClass(dom);
          const col = (cls && CLC_CLASS_COLOR[cls]) || "#9aa3af";
          faces.push({
            pts: labelPts, fill: col, stroke: "var(--color-border)", strokeW: 1,
            depth: proj.depth(centroid3(labelPts)) - 2,
            label: inside ? `${dom} ${clcLabel(dom, "zh") ?? ""}` : dom,
            labelSize: inside ? 70 : 60,
            labelFill: readableOn(col),
          });
        }

        // 书脊
        let cursor = -lw / 2 + 5;
        for (const book of level.books) {
          const w = Math.max(4, book.spineMm);
          if (cursor + w > lw / 2) break;
          const bh = Math.min(level.heightMm * 0.92, level.heightMm - 8);
          const cls = clcMainClass(book.clc);
          const col = (cls && CLC_CLASS_COLOR[cls]) || "#9aa3af";
          const hot = highlightBookId === book.id;
          const q = [
            localToWorld(bc, cursor, -ld / 2, z + BOARD / 2),
            localToWorld(bc, cursor + w, -ld / 2, z + BOARD / 2),
            localToWorld(bc, cursor + w, -ld / 2, z + BOARD / 2 + bh),
            localToWorld(bc, cursor, -ld / 2, z + BOARD / 2 + bh),
          ];
          faces.push({
            pts: q,
            fill: hot ? "#FDC800" : col,
            stroke: "var(--color-border)",
            strokeW: hot ? 2.5 : 0.8,
            depth: proj.depth(centroid3(q)) - 3,
            bookId: book.id,
            pickable: true,
            title: `${book.callNumber ?? ""} ${book.title}`.trim(),
          });
          cursor += w + 1.5;
        }
        z += level.heightMm + BOARD;
      }
    }

    faces.sort((a, b) => b.depth - a.depth);
    return { faces, proj };
  }, [plan, bookcases, rooms, az, el, pan, hoverRoom, insideRoom, roomBookcases, focusBookcase, highlightBookId]);

  const vb = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const bump = (p: P3) => {
      const { X, Y } = built.proj.project(p);
      if (X < minX) minX = X;
      if (Y < minY) minY = Y;
      if (X > maxX) maxX = X;
      if (Y > maxY) maxY = Y;
    };

    // 内视：视野只框住当前房间和它的书柜，否则整屋都在画面里，
    // "走进房间"就没有走进去的感觉（点了以后画面几乎没变）。
    const rm = insideRoom ? roomById.get(insideRoom) : null;
    if (rm) {
      for (const [x, y] of rm.polygon) {
        bump({ x, y, z: 0 });
        bump({ x, y, z: WALL_H });
      }
      for (const bc of roomBookcases) {
        // 取景框也要按真实尺寸算，否则内视时画面框不准
        const { widthMm: W, depthMm: D, heightMm: H } = bookcaseGeometry(bc, bc.levels);
        for (const dx of [-W / 2, W / 2]) {
          for (const dy of [-D / 2, D / 2]) {
            bump(localToWorld(bc, dx, dy, 0));
            bump(localToWorld(bc, dx, dy, H));
          }
        }
      }
    } else {
      for (const f of built.faces) for (const p of f.pts) bump(p);
    }

    if (!Number.isFinite(minX)) return "0 0 100 100";
    const px = (maxX - minX) * 0.08 + 300;
    const py = (maxY - minY) * 0.08 + 300;
    return `${minX - px} ${minY - py} ${maxX - minX + px * 2} ${maxY - minY + py * 2}`;
  }, [built, insideRoom, roomById, roomBookcases]);

  const path = useCallback(
    (pts: P3[]) =>
      pts
        .map((p, i) => {
          const { X, Y } = built.proj.project(p);
          return `${i === 0 ? "M" : "L"} ${X.toFixed(1)} ${Y.toFixed(1)}`;
        })
        .join(" ") + " Z",
    [built],
  );

  return (
    <div className={`relative w-full overflow-hidden rounded-md border-2 border-border bg-surface-1 ${className}`}>
      <svg
        ref={svgRef}
        viewBox={vb}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label={t("scene.title")}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, az, el, moved: 0 };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dx = e.clientX - drag.current.x;
          const dy = e.clientY - drag.current.y;
          drag.current.moved = Math.max(drag.current.moved, Math.hypot(dx, dy));
          if (drag.current.moved < DRAG_THRESHOLD) return;
          setAz(drag.current.az + dx * 0.4);
          setEl(Math.max(4, Math.min(88, drag.current.el + dy * 0.25)));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          // 几乎没动 = 点击。进入当前悬停的房间。
          if (d && d.moved < DRAG_THRESHOLD && hoverRoom && !insideRoom) {
            setInsideRoom(hoverRoom);
            setShelfIdx(0);
          }
        }}
        onPointerLeave={() => { drag.current = null; setHoverRoom(null); }}
      >
        <defs>
          {/* 地灯往上打：底部实、顶部全透明，不封顶 */}
          <linearGradient id="wallGlow" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#FDC800" stopOpacity="0.95" />
            <stop offset="18%" stopColor="#FDC800" stopOpacity="0.45" />
            <stop offset="55%" stopColor="#432DD7" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#432DD7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {built.faces.map((f, i) => (
          <g key={i}>
            <path
              d={path(f.pts)}
              fill={f.fill}
              fillOpacity={f.opacity ?? 1}
              stroke={f.stroke ?? "none"}
              strokeWidth={f.strokeW ?? 1.5}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              // 墙和柜体不接收指针事件，否则会盖住下面的房间色块，房间就点不进去
              pointerEvents={f.pickable ? "auto" : "none"}
              style={{ cursor: f.roomId && !insideRoom ? "pointer" : undefined }}
              onPointerEnter={() => {
                if (f.roomId && !insideRoom) setHoverRoom(f.roomId);
                if (f.bookId) setTip(f.title ?? null);
              }}
              onPointerLeave={() => {
                if (f.bookId) setTip(null);
              }}
              onClick={() => {
                if (f.roomId && !insideRoom) { setInsideRoom(f.roomId); setShelfIdx(0); }
              }}
            >
              {f.title && <title>{f.title}</title>}
            </path>
            {f.label && (() => {
              const c = built.proj.project(f.labelAt ?? centroid3(f.pts));
              return (
                <text
                  x={c.X} y={c.Y}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={f.labelSize ?? 160} fontWeight="900"
                  fill={f.labelFill ?? "#1c293c"}
                  pointerEvents="none"
                >
                  {f.label}
                </text>
              );
            })()}
          </g>
        ))}
      </svg>

      {/* 控件 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 border-t-2 border-border bg-surface-1/95 px-2 py-1">
        <span className="hint truncate">
          {tip ?? (insideRoom
            ? `${roomById.get(insideRoom)?.name ?? ""}${focusBookcase ? ` › ${focusBookcase.name}` : ""} · ${t("scene.wasd")}`
            : hoverRoom
              ? roomById.get(hoverRoom)?.name ?? ""
              : t("scene.dragHint"))}
        </span>
        <span className="pointer-events-auto flex flex-wrap gap-1">
          {insideRoom ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setShelfIdx((i) => Math.max(0, i - 1))}
                disabled={shelfIdx === 0}>←</button>
              <span className="chip">{roomBookcases.length ? `${shelfIdx + 1}/${roomBookcases.length}` : "0"}</span>
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setShelfIdx((i) => Math.min(roomBookcases.length - 1, i + 1))}
                disabled={shelfIdx >= roomBookcases.length - 1}>→</button>
              <button type="button" className="btn btn-primary btn-sm"
                onClick={() => { setInsideRoom(null); setPan({ x: 0, y: 0 }); setAz(45); setEl(38); }}>
                {t("scene.exitRoom")}
              </button>
            </>
          ) : (
            [
              { label: t("scene.viewIso"), a: 45, e: 38 },
              { label: t("scene.viewTop"), a: 0, e: 88 },
              { label: t("scene.viewFront"), a: 0, e: 10 },
            ].map((v) => (
              <button key={v.label} type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setAz(v.a); setEl(v.e); setPan({ x: 0, y: 0 }); }}>
                {v.label}
              </button>
            ))
          )}
        </span>
      </div>

      {!insideRoom && rooms.length > 0 && (
        <span className="pointer-events-none absolute left-2 top-2 chip chip-info">
          {t("scene.clickRoom")}
        </span>
      )}
    </div>
  );
}
