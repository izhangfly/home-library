// 书柜外形尺寸 —— 能从层推出来的，就别再问用户一遍
//
// 用户量书架的时候，量的是**每一层**：宽 760、净空 260、深 280。
// 那才是真正要费事的部分，而且容量模型必须要它。
// 柜体的外廓尺寸（整个柜子多宽多深多高）其实是这些数的直接后果，
// 再让人拿尺子量一遍、再填一遍表，纯属重复劳动。
//
// 但以前 `Bookcase.widthMm/depthMm/heightMm` 空着的时候，
// 户型图和 3D 直接退回写死的 800×300 —— 于是 600mm 宽的书房矮柜
// 在一个 3.8 ㎡ 的房间里被画成 800mm，宽了三分之一。
// 明明手上有真实数据，却画了个假的。
//
// 所以：**优先用用户填的，没填就从层推**，两个渲染器共用同一套推法，
// 免得平面图和 3D 各推各的、画出两个不一样的柜子。

/** 层板厚度（毫米）。真实书架一般 18–25mm。 */
export const BOARD_MM = 20;
/** 侧板厚度：柜体比层板宽出来的那一点 */
const SIDE_MM = 20;
/** 背板 + 层板前后余量：柜体比层深多出来的那一点 */
const BACK_MM = 20;

/** 实在什么都没有时的兜底（连层都还没建） */
const FALLBACK = { widthMm: 800, depthMm: 300, heightMm: 2000 };

export interface GeometryLevel {
  widthMm: number;
  heightMm: number;
  depthMm: number;
}

export interface BookcaseGeometry {
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /** 这三个数是量出来的还是推出来的 —— 界面要能区分，别把推测说成事实 */
  derived: boolean;
}

export function bookcaseGeometry(
  bc: { widthMm?: number | null; depthMm?: number | null; heightMm?: number | null },
  levels: GeometryLevel[],
): BookcaseGeometry {
  const hasLevels = levels.length > 0;

  const derivedWidth = hasLevels ? Math.max(...levels.map((l) => l.widthMm)) + 2 * SIDE_MM : null;
  const derivedDepth = hasLevels ? Math.max(...levels.map((l) => l.depthMm)) + BACK_MM : null;
  const derivedHeight = hasLevels
    ? levels.reduce((s, l) => s + l.heightMm + BOARD_MM, 0) + BOARD_MM
    : null;

  const widthMm = bc.widthMm || derivedWidth || FALLBACK.widthMm;
  const depthMm = bc.depthMm || derivedDepth || FALLBACK.depthMm;
  const heightMm = bc.heightMm || derivedHeight || FALLBACK.heightMm;

  return {
    widthMm,
    depthMm,
    heightMm,
    derived: !(bc.widthMm && bc.depthMm && bc.heightMm),
  };
}
