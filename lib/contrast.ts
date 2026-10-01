// 标签颜色是用户自选的，不能假设它配深字还是浅字。
// neobrutalism 的标签是"实心色块 + 墨色描边"，所以必须按底色算出可读的文字色，
// 否则黄色标签配白字直接糊成一片（#FDC800 上的白字对比度只有 1.5:1）。

const INK = "#1c293c";
const PAPER = "#ffffff";

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.slice(0, 3).map((h) => channel(parseInt(h, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 在给定底色上选一个对比度更高的文字色（墨色或白） */
export function readableOn(background: string): string {
  return ratio(background, INK) >= ratio(background, PAPER) ? INK : PAPER;
}

/** 十六进制 → HSL 的明度调整（保持色相，只动明暗） */
function shiftLightness(hex: string, delta: number): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return hex;
  const [r, g, b] = m.slice(0, 3).map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const nl = Math.max(0, Math.min(1, l + delta));
  const c = (1 - Math.abs(2 * nl - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = nl - c / 2;
  const [rr, gg, bb] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [rr, gg, bb].map((v) => Math.round((v + mm) * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * 标签色块的完整内联样式：底色 + 可读文字色。描边由 .chip 类给。
 *
 * `readableOn` 只是在墨色和白色里挑较好的那个，**不保证达标**：
 * 绿色 #16A34A 上墨色是 4.45，AA 要求 4.5 —— 差一点点也是不合格，
 * 而且这种"差一点"最容易漏，因为看起来完全正常。
 * 所以够不到就顺着色相把底色调暗（或调亮）到够为止，色相不动，标签还是那个颜色。
 */
export function tagChipStyle(color: string): React.CSSProperties {
  let bg = color;
  let fg = readableOn(bg);
  for (let i = 0; i < 12 && ratio(bg, fg) < 4.5; i++) {
    // 文字是墨色就把底色调亮，文字是白色就把底色调暗
    bg = shiftLightness(bg, fg === INK ? 0.04 : -0.04);
    fg = readableOn(bg);
  }
  return { background: bg, color: fg };
}
