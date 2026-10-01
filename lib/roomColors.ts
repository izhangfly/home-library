// 房间配色 —— 自动分配，不让用户挑。
//
// 十几个房间手动配色是件苦差事，而且人手挑出来的颜色相邻房间往往撞色。
// 这里用黄金角（137.508°）转色相：任意前 N 个取值在色轮上都分得最开，
// 这是排布互不相邻色的经典办法（和向日葵籽的排列同一个道理）。
// 只转色相还不够 —— 色相差在浅色区不明显，所以再让明度/饱和度以 3、5 为周期
// 错开，相邻序号一定在某个维度上拉开距离。
//
// 明度压在 70–84 之间：底色要浅到能压深色文字（WCAG AA），
// 又要在 3D 里以 0.28 不透明度铺在地面上还看得出区别。

const GOLDEN_ANGLE = 137.508;

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return (
    "#" +
    [f(0), f(8), f(4)]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** 第 index 个房间的颜色。同一个序号永远得到同一个颜色，重新识别也不会跳色。 */
export function roomColor(index: number): string {
  const hue = (index * GOLDEN_ANGLE + 26) % 360;
  const light = [82, 75, 79][index % 3];
  const sat = [70, 58, 84][index % 3 === 0 ? (index % 2 === 0 ? 0 : 1) : index % 3];
  return hslToHex(hue, sat, light);
}

/** 一次要 n 个颜色时的便捷写法 */
export function roomPalette(n: number): string[] {
  return Array.from({ length: n }, (_, i) => roomColor(i));
}
