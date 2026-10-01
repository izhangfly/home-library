// 生成 PWA 图标。跑法：npm run icons
// 只需在改动图形时重跑一次，产物提交到 public/icons。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("public/icons");

const INK = "#1c293c";
const YELLOW = "#fdc800";
const BLUE = "#432dd7";
const RED = "#dc2626";
const PAPER = "#fbfbf9";

/**
 * neobrutalism 风格图标：黄底、粗墨边、三本立着的书。
 * 描边宽度随尺寸缩放，否则 192px 下边框会细到看不见。
 */
function svg(size: number, pad: number): string {
  const inner = size - pad * 2;
  const u = inner / 100;
  const x = (v: number) => pad + v * u;
  const stroke = Math.max(2, u * 4);

  const book = (left: number, top: number, width: number, fill: string) =>
    `<rect x="${x(left)}" y="${x(top)}" width="${u * width}" height="${x(74) - x(top)}" rx="${u * 1.5}"
       fill="${fill}" stroke="${INK}" stroke-width="${stroke}" stroke-linejoin="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${YELLOW}"/>
  ${book(14, 26, 18, PAPER)}
  ${book(37, 16, 20, BLUE)}
  ${book(62, 30, 22, RED)}
  <rect x="${x(8)}" y="${x(74)}" width="${u * 84}" height="${u * 10}" rx="${u * 1.5}"
        fill="${INK}"/>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const targets = [
    { file: "icon-192.png", size: 192, pad: 14 },
    { file: "icon-512.png", size: 512, pad: 38 },
    // maskable 要留出安全区，否则 Android 圆形裁切会切掉图形
    { file: "icon-maskable.png", size: 512, pad: 96 },
    { file: "apple-touch-icon.png", size: 180, pad: 14 },
  ];

  for (const { file, size, pad } of targets) {
    await sharp(Buffer.from(svg(size, pad))).png().toFile(path.join(OUT, file));
    console.log("wrote", file);
  }

  await writeFile(path.join(OUT, "icon.svg"), svg(512, 38), "utf8");
  console.log("wrote icon.svg");
}

await main();
