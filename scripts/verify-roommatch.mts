// 重新导入户型图不能把人打的名字冲掉
//
// 背景：重新上传 DXF 走的是 room.deleteMany + createMany，新房间一律「房间 N」。
// 用户一个个手打的名字（卧室、书房…）全没 —— 而首页的 <SetupChecklist>
// 还一直在催他"把 13 个房间命名了"。命完名，改一次图纸全部打回原形。
import { matchRooms, isPlaceholderName, type ExistingRoom } from "../lib/roomMatch.ts";

let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${!ok && d ? "  —— " + d : ""}`);
  ok ? pass++ : fail++;
};

const rect = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as [number, number][];
const area = (x0: number, y0: number, x1: number, y1: number) => Math.abs((x1 - x0) * (y1 - y0));
const det = (x0: number, y0: number, x1: number, y1: number) =>
  ({ polygon: rect(x0, y0, x1, y1), areaMm2: area(x0, y0, x1, y1) });

console.log("\n=== 重新导入户型图 ===\n");

// A. 轮廓微调（挪了道墙）后，名字要跟过来
{
  const existing: ExistingRoom[] = [
    { id: "r1", name: "卧室", polygon: rect(0, 0, 3000, 4000) },
    { id: "r2", name: "书房", polygon: rect(3000, 0, 6000, 4000) },
  ];
  const m = matchRooms([det(0, 0, 3100, 4000), det(3100, 0, 6000, 4000)], existing);
  check("墙挪了 100mm，两个房间都认得出", m[0].existingId === "r1" && m[1].existingId === "r2",
    JSON.stringify(m.map((x) => x.existingId)));
  check("名字跟过来", m[0].keepName === "卧室" && m[1].keepName === "书房",
    JSON.stringify(m.map((x) => x.keepName)));
}

// B. 占位名不保留 —— 保留了反而会打乱新的编号
{
  const m = matchRooms([det(0, 0, 3000, 4000)],
    [{ id: "r1", name: "房间 7", polygon: rect(0, 0, 3000, 4000) }]);
  check("对上了旧房间（id 要留住，书柜关系靠它）", m[0].existingId === "r1");
  check("「房间 7」这种占位名不沿用", m[0].keepName === null, String(m[0].keepName));
}

// C. 新加的房间不能去认领别人的名字
{
  const m = matchRooms([det(0, 0, 3000, 4000), det(0, 5000, 3000, 9000)],
    [{ id: "r1", name: "卧室", polygon: rect(0, 0, 3000, 4000) }]);
  check("新出现的房间是全新的，不继承名字",
    m[0].existingId === "r1" && m[1].existingId === null,
    JSON.stringify(m.map((x) => x.existingId)));
}

// D. 一间被拆成两间：不该有一半冒领原来的名字
{
  const m = matchRooms([det(0, 0, 3000, 2000), det(0, 2000, 3000, 4000)],
    [{ id: "r1", name: "客厅", polygon: rect(0, 0, 3000, 4000) }]);
  check("大房间拆成两小间时，没有谁冒领「客厅」",
    m.every((x) => x.keepName === null), JSON.stringify(m.map((x) => x.keepName)));
}

// E. 一个旧房间只能被认领一次
{
  const m = matchRooms([det(0, 0, 3000, 4000), det(10, 10, 3010, 4010)],
    [{ id: "r1", name: "卧室", polygon: rect(0, 0, 3000, 4000) }]);
  const claimed = m.filter((x) => x.existingId === "r1").length;
  check("两个几乎重合的新房间，只有一个认领得到", claimed === 1, `认领了 ${claimed} 次`);
}

// F. 占位名判定
{
  check("认得出各种占位名",
    isPlaceholderName("房间 3") && isPlaceholderName("房间3") && isPlaceholderName("Room 12")
    && !isPlaceholderName("卧室") && !isPlaceholderName("3 号房间"));
}

console.log(`\n=== ${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
