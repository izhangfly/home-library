"use client";

// 户型图渲染 + 书柜摆位
//
// 坐标系：DXF 的 Y 轴向上，SVG 的 Y 轴向下，所以整组图形做一次 Y 翻转
// （translate + scale(1,-1)），这样墙线的朝向才和实际户型一致。
// 单位统一是毫米，和书架层的尺寸同一套，将来算"从门口走到书柜"之类也不用换算。

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { readableOn } from "@/lib/contrast";
import { clampIntoPolygon, labelPoint, type Pt } from "@/lib/geometry";
import { bookcaseGeometry } from "@/lib/shelfGeometry";

export type PlanShape =
  | { kind: "polyline"; points: [number, number][]; closed: boolean; layer: string }
  | { kind: "circle"; cx: number; cy: number; r: number; layer: string }
  | { kind: "arc"; cx: number; cy: number; r: number; startDeg: number; endDeg: number; layer: string }
  | { kind: "text"; x: number; y: number; text: string; height: number; layer: string };

export interface PlanBookcase {
  id: string;
  name: string;
  room: string | null;
  /** 绑定的房间；拖动被限制在这个房间内，换房间要走「转移」 */
  roomId?: string | null;
  roomX: number;
  roomY: number;
  rotation: number;
  widthMm?: number | null;
  depthMm?: number | null;
  heightMm?: number | null;
  color?: string | null;
  /** 有层的话，柜体尺寸可以从层推出来，不必强求用户再填一遍 */
  levels?: { widthMm: number; heightMm: number; depthMm: number }[];
}

export interface PlanRoom {
  id: string;
  name: string;
  color: string;
  polygon: [number, number][];
}

export interface FloorPlanData {
  id: string;
  name: string;
  geometry: PlanShape[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 尺寸统一走 lib/shelfGeometry：用户填了就用填的，没填就从层推出来。
// 以前这里直接退回 800×300，于是 600mm 宽的柜子被画成 800 —— 数据明明有。

/** 柜子颜色可能是 CSS 变量，这时没法算对比度，退回白字 */
function readable(fill: string): string {
  return fill.startsWith("#") ? readableOn(fill) : "#ffffff";
}

/** 标签随柜体旋转；超过 ±90° 就翻半圈，免得字是倒的 */
function labelFlip(rot: number): number {
  const n = ((rot % 360) + 540) % 360 - 180; // 归一到 (-180, 180]
  return Math.abs(n) > 90 ? 180 : 0;
}

function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a1));
  const y1 = cy + r * Math.sin(rad(a1));
  const x2 = cx + r * Math.cos(rad(a2));
  const y2 = cy + r * Math.sin(rad(a2));
  const sweep = ((a2 - a1 + 360) % 360) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${sweep} 1 ${x2} ${y2}`;
}

export function FloorPlanView({
  plan,
  bookcases,
  rooms = [],
  highlightId,
  onMove,
  onRotate,
  onSelect,
  onRenameRoom,
  className = "h-[420px]",
}: {
  plan: FloorPlanData;
  bookcases: PlanBookcase[];
  /** 房间色块与名称 —— 和 3D 用同一份数据，颜色/名字改了两边同步 */
  rooms?: PlanRoom[];
  highlightId?: string;
  /** 传了就可以拖动书柜（需要管理员），拖完回调真实平面坐标（毫米） */
  onMove?: (id: string, x: number, y: number) => void;
  /** 传了就显示旋转手柄，回调角度（度） */
  onRotate?: (id: string, deg: number) => void;
  onSelect?: (id: string) => void;
  /**
   * 传了就能在图上直接给房间改名。
   *
   * 为什么要做在图上：名字原本只能在旁边那张列表里改，而列表里除了一块色块
   * 什么都看不出来 —— 十三个「房间 N」，你得先在图上找出哪块是哪块，
   * 再回列表里对着颜色找那一行。认图形是一秒的事，对颜色是一分钟的事。
   */
  onRenameRoom?: (id: string, name: string) => void;
  className?: string;
}) {
  // 这次渲染有没有可聚焦的后代 —— 决定 role 该用 group 还是 img
  const interactive = Boolean(onRenameRoom || onMove || onRotate || onSelect);

  const t = useTranslations();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [roomDraft, setRoomDraft] = useState("");
  const [ghostRot, setGhostRot] = useState<{ id: string; deg: number } | null>(null);

  const pad = Math.max(300, (plan.maxX - plan.minX) * 0.04);
  const vbW = plan.maxX - plan.minX + pad * 2;
  const vbH = plan.maxY - plan.minY + pad * 2;

  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  // 房间名的落点用「最难被够到的点」而不是质心：L 形、凹形房间的质心
  // 可能压根不在房间里，名字就飘到走廊上去了（书房那间正是如此）。
  const roomLabels = useMemo(
    () => new Map(rooms.map((r) => [r.id, labelPoint(r.polygon as Pt[])])),
    [rooms],
  );
  /** 正在拖的书柜所属房间 —— 拖动时把它描出来，让人知道边界在哪 */
  const activeRoom = useMemo(() => {
    const bc = bookcases.find((b) => b.id === (dragging ?? ""));
    return bc?.roomId ? roomById.get(bc.roomId) ?? null : null;
  }, [dragging, bookcases, roomById]);

  /** 屏幕坐标 → 图纸坐标（含 Y 翻转） */
  const toPlan = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      // viewBox 用 preserveAspectRatio=meet，实际绘制区可能有留白，要算出真实缩放
      const scale = Math.min(rect.width / vbW, rect.height / vbH);
      const drawW = vbW * scale;
      const drawH = vbH * scale;
      const offX = rect.left + (rect.width - drawW) / 2;
      const offY = rect.top + (rect.height - drawH) / 2;
      const vx = (clientX - offX) / scale; // 0..vbW
      const vy = (clientY - offY) / scale; // 0..vbH
      return {
        x: plan.minX - pad + vx,
        // Y 翻转：视口顶部对应图纸最大 Y
        y: plan.maxY + pad - vy,
      };
    },
    [plan.minX, plan.maxY, pad, vbW, vbH],
  );

  const handlePointerMove = (e: React.PointerEvent) => {
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;

    if (rotating) {
      const bc = bookcases.find((b) => b.id === rotating);
      if (!bc) return;
      // 手柄相对柜子中心的方位角就是旋转角。图纸 Y 向上，所以用 atan2(dy, dx) 直接得数学角
      const deg = (Math.atan2(p.y - bc.roomY, p.x - bc.roomX) * 180) / Math.PI;
      // 按住时吸附到 15° 一档，摆正墙边容易得多
      const snapped = Math.round(deg / 15) * 15;
      setGhostRot({ id: rotating, deg: snapped });
      return;
    }
    if (dragging) {
      // 绑定了房间就不许拖出去 —— 贴着墙停下，而不是让它飞到别的屋
      const poly = activeRoom?.polygon as Pt[] | undefined;
      const [x, y] = poly ? clampIntoPolygon([p.x, p.y], poly) : [p.x, p.y];
      setGhost({ id: dragging, x: Math.round(x), y: Math.round(y) });
    }
  };

  const endDrag = () => {
    if (dragging && ghost && ghost.id === dragging) onMove?.(dragging, ghost.x, ghost.y);
    if (rotating && ghostRot && ghostRot.id === rotating) onRotate?.(rotating, ghostRot.deg);
    setDragging(null);
    setGhost(null);
    setRotating(null);
    setGhostRot(null);
  };

  return (
    <div className={`w-full overflow-hidden rounded-md border-2 border-border bg-surface-1 ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full touch-none"
        // 能交互的时候**不能**用 role="img"。
        //
        // role="img" 的意思是"这整块是一张图"，读屏软件会把它当成一个整体念出来、
        // 并把内部当装饰忽略。可这张图里有能聚焦的东西：房间是"点一下改名"
        // （上一版特意补的 role/tabIndex），改名时还会冒出一个 <input>。
        // 结果就是：我上一版把房间做成键盘可达，却又把它们关在一个
        // 声明为"图片"的盒子里 —— axe 报的 nested-interactive
        // 「Element has focusable descendants」说的就是这件事，
        // 那个无障碍修复等于只做了一半。
        //
        // 只读的时候（地图页、书架地图）确实就是一张图，role="img" 才是对的。
        // 所以按**这次渲染到底能不能交互**来定，而不是写死一个。
        role={interactive ? "group" : "img"}
        aria-label={plan.name}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        {/* 一次性把图纸坐标搬进视口并翻转 Y */}
        <g transform={`translate(${-(plan.minX - pad)} ${plan.maxY + pad}) scale(1 -1)`}>
          {/* 房间色块 —— 画在墙下面，名字和颜色跟 3D 保持一致 */}
          {rooms.map((rm) => {
            const [cx, cy] = roomLabels.get(rm.id) ?? [0, 0];
            const isActive = activeRoom?.id === rm.id;
            const editing = editingRoom === rm.id;
            const commit = () => {
              const v = roomDraft.trim();
              if (v && v !== rm.name) onRenameRoom?.(rm.id, v);
              setEditingRoom(null);
            };
            return (
              <g key={rm.id}>
                <path
                  d={rm.polygon.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ") + " Z"}
                  fill={rm.color}
                  fillOpacity={isActive ? 1 : 0.85}
                  stroke={isActive || editing ? "var(--color-secondary)" : "var(--color-border)"}
                  style={{ strokeWidth: isActive || editing ? 4 : 1, cursor: onRenameRoom ? "text" : undefined }}
                  vectorEffect="non-scaling-stroke"
                  // SVG 的 <path> 默认不可聚焦：上一版把房间做成"点一下改名"之后，
                  // 用键盘的人完全够不到这个功能。补上 role/tabIndex/回车空格，
                  // 别让新加的交互只服务鼠标。
                  role={onRenameRoom ? "button" : undefined}
                  tabIndex={onRenameRoom ? 0 : undefined}
                  aria-label={onRenameRoom ? t("rooms.renameAria", { name: rm.name }) : undefined}
                  onClick={onRenameRoom ? () => { setEditingRoom(rm.id); setRoomDraft(rm.name); } : undefined}
                  onKeyDown={
                    onRenameRoom
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingRoom(rm.id);
                            setRoomDraft(rm.name);
                          }
                        }
                      : undefined
                  }
                >
                  {onRenameRoom && <title>{t("rooms.clickToRename")}</title>}
                </path>

                {editing ? (
                  // 用 foreignObject 把输入框放在房间正中：坐标跟着 viewBox 走，
                  // 不用自己算缩放和留白，缩放/翻转都自动对齐
                  <foreignObject
                    x={cx - 900} y={cy - 160} width={1800} height={320}
                    transform={`translate(0 ${2 * cy}) scale(1 -1)`}
                  >
                    <input
                      autoFocus
                      value={roomDraft}
                      onChange={(e) => setRoomDraft(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commit();
                        if (e.key === "Escape") setEditingRoom(null);
                      }}
                      style={{
                        width: "100%", height: "100%", boxSizing: "border-box",
                        fontSize: "200px", fontWeight: 900, textAlign: "center",
                        border: "8px solid #1c293c", borderRadius: 24, padding: 0,
                        background: "#fff", color: "#1c293c",
                      }}
                    />
                  </foreignObject>
                ) : (
                  <text
                    x={cx} y={cy}
                    transform={`translate(0 ${2 * cy}) scale(1 -1)`}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={260} fontWeight="900"
                    fill={readableOn(rm.color)}
                    pointerEvents="none"
                  >
                    {rm.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* 墙体与轮廓 */}
          {plan.geometry.map((s, i) => {
            if (s.kind === "polyline") {
              const d =
                s.points.map(([x, y], j) => `${j === 0 ? "M" : "L"} ${x} ${y}`).join(" ") +
                (s.closed ? " Z" : "");
              return (
                <path
                  key={i}
                  d={d}
                  // 有房间色块时，闭合多段线不能再填底色 —— 否则会盖住下面的房间颜色
                  fill={s.closed && rooms.length === 0 ? "var(--color-surface-2)" : "none"}
                  stroke="var(--color-border)"
                  strokeWidth={40}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: 2 }}
                />
              );
            }
            if (s.kind === "circle") {
              return (
                <circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="none"
                  stroke="var(--color-border)" style={{ strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
              );
            }
            if (s.kind === "arc") {
              return (
                <path key={i} d={arcPath(s.cx, s.cy, s.r, s.startDeg, s.endDeg)} fill="none"
                  stroke="var(--color-border)" style={{ strokeWidth: 2 }} vectorEffect="non-scaling-stroke" />
              );
            }
            // 图纸里的文字（房间名之类）要再翻回来，不然是镜像的
            return (
              <text
                key={i}
                x={s.x}
                y={s.y}
                transform={`translate(0 ${2 * s.y}) scale(1 -1)`}
                fontSize={s.height || 200}
                fill="var(--color-text-muted)"
                fontWeight="700"
              >
                {s.text}
              </text>
            );
          })}

          {/* 书柜 */}
          {bookcases.map((b) => {
            const pos = ghost && ghost.id === b.id ? ghost : { x: b.roomX, y: b.roomY };
            const rot = ghostRot && ghostRot.id === b.id ? ghostRot.deg : b.rotation || 0;
            const geo = bookcaseGeometry(b, b.levels ?? []);
            const w = geo.widthMm;
            const d = geo.depthMm;
            const active = highlightId === b.id;
            const fill = active ? "var(--color-primary)" : b.color || "var(--color-secondary)";
            const handleR = Math.max(90, d * 0.28);
            return (
              <g key={b.id} transform={`translate(${pos.x} ${pos.y}) rotate(${rot})`}>
                <g
                  style={{ cursor: onMove ? "grab" : onSelect ? "pointer" : "default" }}
                  onPointerDown={(e) => {
                    onSelect?.(b.id);
                    if (!onMove) return;
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setDragging(b.id);
                    setGhost({ id: b.id, x: b.roomX, y: b.roomY });
                  }}
                >
                  <rect
                    x={-w / 2} y={-d / 2} width={w} height={d}
                    fill={fill}
                    stroke="var(--color-border)"
                    style={{ strokeWidth: 2 }}
                    vectorEffect="non-scaling-stroke"
                    rx={20}
                  />
                  {/* 正面朝向标记：书是从这一面取的 */}
                  <line
                    x1={-w / 2} y1={-d / 2} x2={w / 2} y2={-d / 2}
                    stroke="var(--color-border)" strokeDasharray="60 40"
                    style={{ strokeWidth: 3 }} vectorEffect="non-scaling-stroke"
                  />
                  {/* 文字要翻回来并抵消旋转，否则倒着看不清 */}
                  <text
                    x={0} y={0}
                    // 标签跟着柜子一起转（用户要求）。
                    // labelFlip 只在转过头、字会倒过来时补 180°，保证还读得出来 —— CAD 标注的通行做法。
                    transform={`rotate(${labelFlip(rot)}) scale(1 -1)`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(160, d * 0.45)}
                    fontWeight="900"
                    fill={readable(fill)}
                  >
                    {b.name}
                  </text>
                </g>

                {onRotate && (
                  // 旋转手柄：从柜子正面伸出来的一个把手，拖它转
                  <g
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.target as Element).setPointerCapture?.(e.pointerId);
                      setRotating(b.id);
                      setGhostRot({ id: b.id, deg: rot });
                    }}
                  >
                    <line
                      x1={w / 2} y1={0} x2={w / 2 + handleR * 1.6} y2={0}
                      stroke="var(--color-border)" style={{ strokeWidth: 2 }}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={w / 2 + handleR * 1.6} cy={0} r={handleR}
                      fill="var(--color-surface-1)" stroke="var(--color-border)"
                      style={{ strokeWidth: 2 }} vectorEffect="non-scaling-stroke"
                    />
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {onMove && (
        <p className="hint border-t-2 border-border px-2 py-1">{t("floorplan.dragHint")}</p>
      )}
    </div>
  );
}
