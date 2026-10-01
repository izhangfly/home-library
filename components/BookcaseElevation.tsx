"use client";

// 书柜立面图 —— 「这个柜子长什么样、每层放了什么、还能塞多少」一张图说完。
//
// 之前书架的可视化分散在两处：「书架地图」里是一层一条进度条，
// 「放书去哪」弹窗里是另一张按比例画的立面。两处画法不同、信息不同，
// 看完一处还得去另一处补。现在合成这一个组件，两边都用它。
//
// 画的是**真实几何**：层宽、层高、板厚、离地高度全部按毫米等比，
// 书按各自估算的书脊厚度切片，剩余空间就是图上剩下的那段空白 ——
// 「还剩多少」是看出来的，不是读数字读出来的。

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CLC_CLASS_COLOR, clcLabel, clcMainClass, clcPrefix } from "@/lib/clc";
import { readableOn } from "@/lib/contrast";
import { HOUSEHOLD, reachBand } from "@/lib/shelving";

/** 层板厚度，画图用的常数；真实书架一般 18-25mm */
const BOARD = 20;
/** 侧板厚度 */
const SIDE = 24;

export interface ElevationBook {
  id: string;
  title: string;
  spineMm: number;
  heightMm?: number | null;
  clc?: string | null;
  callNumber?: string | null;
  tagNames?: string[];
}

export interface ElevationLevel {
  id: string;
  levelIndex: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  note?: string | null;
  usage?: {
    usableMm: number;
    usedMm: number;
    remainingMm: number;
    fillRatio: number;
    bookCount: number;
    estimatedCount?: number;
  };
  books: ElevationBook[];
}

export interface ElevationBookcase {
  id: string;
  name: string;
  room?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  levels: ElevationLevel[];
}

interface BookGeom { book: ElevationBook; x: number; w: number }
interface LevelGeom {
  level: ElevationLevel;
  /** 离地高度（层板上表面） */
  floorMm: number;
  /** 该层在视口里的左边缘 */
  x0: number;
  books: BookGeom[];
  dom: string | null;
  ratio: number;
}

/** 装填率 → 颜色。超过 100% 是红的，超过目标是黄的。 */
function fillTone(ratio: number): string {
  if (ratio > 1) return "var(--color-danger)";
  if (ratio > 0.85) return "var(--color-warning)";
  return "var(--color-text-muted)";
}

export function BookcaseElevation({
  bookcase,
  targetLevelId,
  highlightBookId,
  /** 高亮某个中图法前缀所在的书（书架地图的"高亮分类"） */
  highlightClc,
  onSelectLevel,
  className = "h-72",
  showReachBand = true,
}: {
  bookcase: ElevationBookcase;
  targetLevelId?: string;
  highlightBookId?: string;
  highlightClc?: string | null;
  onSelectLevel?: (level: ElevationLevel) => void;
  className?: string;
  showReachBand?: boolean;
}) {
  const t = useTranslations();

  // 整张图的几何一次算完：每层的离地高度、每本书在层上的横坐标。
  // 放在 useMemo 里而不是渲染时边画边累加 —— 渲染期间改变量会在重渲染时串味。
  const geom = useMemo(() => {
    const levels = [...bookcase.levels].sort((a, b) => a.levelIndex - b.levelIndex);
    const maxWidth = Math.max(600, ...levels.map((l) => l.widthMm));
    const vbW = maxWidth + 2 * SIDE;

    const rows = levels.reduce<{ rows: LevelGeom[]; z: number }>(
      (acc, level) => {
        const floorMm = acc.z + BOARD;
        const x0 = (vbW - level.widthMm) / 2;

        // 书脊按各自估算厚度依次排开，排不下的就不画（图上剩余空间才是真的剩余）
        const laid = level.books.reduce<{ items: BookGeom[]; cursor: number }>(
          (bacc, b) => {
            const w = Math.max(6, b.spineMm);
            if (bacc.cursor + w > x0 + level.widthMm - 4) return bacc;
            return {
              items: [...bacc.items, { book: b, x: bacc.cursor, w }],
              cursor: bacc.cursor + w + 2,
            };
          },
          { items: [], cursor: x0 + 4 },
        );

        const usable = level.usage?.usableMm ?? level.widthMm;
        const used = level.usage?.usedMm ?? level.books.reduce((s, b) => s + b.spineMm, 0);

        // 该层的主类目：出现最多的中图法前缀
        const counts = new Map<string, number>();
        for (const b of level.books) {
          const k = clcPrefix(b.clc, 4);
          if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        let dom: string | null = null, best = 0;
        for (const [k, v] of counts) if (v > best) { best = v; dom = k; }

        return {
          rows: [...acc.rows, {
            level, floorMm, x0, books: laid.items, dom,
            ratio: usable > 0 ? used / usable : 0,
          }],
          z: acc.z + level.heightMm + BOARD,
        };
      },
      { rows: [], z: 0 },
    );

    return { rows: rows.rows, maxWidth, totalH: Math.max(rows.z + BOARD, 300), vbW };
  }, [bookcase.levels]);

  const { rows, maxWidth, totalH } = geom;
  const VB_W = maxWidth + 2 * SIDE;
  const VB_H = totalH;
  // 左侧留一条标尺的位置
  const RULER = Math.max(220, VB_W * 0.12);

  if (!rows.length) {
    return <p className="hint">{t("shelves.noLevels")}</p>;
  }

  // 舒适取书区：家里最矮的人够得到、最高的人不用蹲 —— 取交集里比较宽松的一段
  const bands = HOUSEHOLD.map((p) => reachBand(p.heightCm));
  const comfMin = Math.min(...bands.map((b) => b.idealMin));
  const comfMax = Math.max(...bands.map((b) => b.idealMax));

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`${-RULER} 0 ${VB_W + RULER} ${VB_H}`}
        className={`w-full ${className}`}
        role="img"
        aria-label={`${bookcase.name} ${t("map.shelfView")}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* 空位用斜纹表示，一眼区别于"这里有书" */}
          <pattern id="bc-empty" width="60" height="60" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="60" height="60" fill="var(--color-surface-2)" />
            <line x1="0" y1="0" x2="0" y2="60" stroke="var(--color-border-soft)" strokeWidth="14" />
          </pattern>
        </defs>

        {/* 柜体 */}
        <rect
          x="0" y="0" width={VB_W} height={VB_H}
          fill="var(--color-surface-1)" stroke="var(--color-border)" strokeWidth="10" rx="8"
        />

        {rows.map(({ level, floorMm, x0: x, books, dom, ratio }) => {
          const y = VB_H - floorMm - level.heightMm;
          const isTarget = level.id === targetLevelId;
          const domClass = clcMainClass(dom);
          const domColor = (domClass && CLC_CLASS_COLOR[domClass]) || "#9aa3af";

          return (
            <g
              key={level.id}
              onClick={onSelectLevel ? () => onSelectLevel(level) : undefined}
              style={{ cursor: onSelectLevel ? "pointer" : undefined }}
            >
              {/* 层内空间（空位斜纹打底） */}
              <rect x={x} y={y} width={level.widthMm} height={level.heightMm} fill="url(#bc-empty)" />

              {/* 书脊：按各自估算厚度，按真实书高（不知道就按层高的 88%） */}
              {books.map(({ book: b, x: bx, w }) => {
                const bh = Math.min(level.heightMm - 6, b.heightMm || level.heightMm * 0.88);
                const cls = clcMainClass(b.clc);
                const col = (cls && CLC_CLASS_COLOR[cls]) || "#9aa3af";
                const hot =
                  highlightBookId === b.id ||
                  (!!highlightClc && (b.clc ?? "").startsWith(highlightClc));
                const dim = !!highlightClc && !hot;
                return (
                  <rect
                    key={b.id}
                    x={bx} y={y + level.heightMm - bh} width={w} height={bh}
                    fill={highlightBookId === b.id ? "var(--color-primary)" : col}
                    fillOpacity={dim ? 0.28 : 1}
                    stroke="var(--color-border)"
                    strokeWidth={highlightBookId === b.id ? 12 : 4}
                  >
                    <title>{`${b.callNumber ?? ""} ${b.title}`.trim()}</title>
                  </rect>
                );
              })}

              {/* 层板 */}
              <rect
                x={x - SIDE / 2} y={y + level.heightMm} width={level.widthMm + SIDE} height={BOARD}
                fill="var(--color-border)"
              />

              {/* 目标层加一圈粗框 */}
              {isTarget && (
                <rect
                  x={x - 6} y={y - 6} width={level.widthMm + 12} height={level.heightMm + 12}
                  fill="none" stroke="var(--color-primary)" strokeWidth="16"
                />
              )}

              {/* 主类目色条贴在层的前沿 */}
              {dom && (() => {
                const text = `${dom} ${clcLabel(dom, "zh") ?? ""}`.trim();
                // 宽度跟着文字走。横贯整层的色条会被读成"这层满了"，
                // 而它其实只是一张架标。
                const wLabel = Math.min(level.widthMm, 40 + text.length * 62);
                return (
                  <g>
                    <rect x={x} y={y + level.heightMm - 74} width={wLabel} height={74} fill={domColor}
                      stroke="var(--color-border)" strokeWidth="4" />
                    <text
                      x={x + 20} y={y + level.heightMm - 20}
                      fontSize={58} fontWeight="900" fill={readableOn(domColor)}
                    >
                      {text}
                    </text>
                  </g>
                );
              })()}

              {/* 左侧标尺：层号 + 离地高度 */}
              <text
                x={-24} y={y + level.heightMm / 2}
                textAnchor="end" dominantBaseline="central"
                fontSize={96} fontWeight="900" fill="var(--color-text)"
              >
                {level.levelIndex}
              </text>
              <text
                x={-24} y={y + level.heightMm / 2 + 100}
                textAnchor="end" dominantBaseline="central"
                fontSize={72} fill="var(--color-text-muted)"
              >
                {Math.round(floorMm / 10)}cm
              </text>

              {/* 右上角：装填率 */}
              <text
                x={VB_W - 18} y={y + 76}
                textAnchor="end"
                fontSize={72} fontWeight="900" fill={fillTone(ratio)}
              >
                {Math.round(ratio * 100)}%
              </text>
            </g>
          );
        })}

        {/* 舒适取书区 —— 说明为什么儿童书在下、冷门书在上。
            画在最后：柜体和层底纹都是不透明的，画在前面会被盖掉。 */}
        {showReachBand && (
          <g pointerEvents="none">
            <rect
              x={-RULER} y={VB_H - comfMax} width={VB_W + RULER} height={Math.max(0, comfMax - comfMin)}
              fill="var(--color-primary)" fillOpacity={0.14}
            />
            <text
              x={-RULER + 20} y={VB_H - comfMax + 90}
              fontSize={86} fontWeight="700" fill="var(--color-text-muted)"
            >
              {t("shelving.comfortBand")}
            </text>
          </g>
        )}

        {/* 地面 */}
        <line x1={-RULER} y1={VB_H} x2={VB_W} y2={VB_H} stroke="var(--color-border)" strokeWidth="16" />
      </svg>

      <p className="hint">
        {t("shelves.elevationHint", {
          width: maxWidth,
          height: Math.round(bookcase.heightMm || totalH),
          levels: rows.length,
        })}
      </p>
    </div>
  );
}
