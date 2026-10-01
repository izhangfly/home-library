// 整库导出的内容 —— 路由和命令行脚本共用
//
// 放在 lib/ 而不是路由里，是因为每晚的备份要在**服务器上直接**生成一份 JSON，
// 走不了 HTTP（那条路现在要管理员登录）。两边共用一个函数，免得分叉：
// 哪天加了张表只在路由那边补上，备份里的 JSON 就静静地少一块。
import { prisma } from "./prisma";

/**
 * Setting 里**只导这些**。
 *
 * 原来是 `prisma.setting.findMany()` 整张表倒出来。Setting 是个键值表，
 * 什么都能往里塞 —— 于是"以后谁写进去一个密钥/令牌/webhook 地址，
 * 它就自动跟着导出走"。这不是假想：`ops.authLockout` 已经在里面了，
 * 而那条恰恰是**不能给外人看的** —— 它等于告诉正在爆破的人
 * "你刚才那轮把锁触发了没有"，是给攻击者的反馈信道。
 * `ops.lastBackup` / `ops.lastPull` 也一样，泄露备份时间表和文件名。
 *
 * 所以改成白名单：**默认不导**，要导的明写。
 * 判断标准是"这是不是用户的数据"——
 * ops.* 是服务端自己的运行状态，恢复回来也没有意义。
 */
export const EXPORTED_SETTINGS = ["calibration.samples", "capacity.coefficients"];

/** 导出的内容。路由和 scripts/export-json.mts 共用，免得两边分叉。 */
export async function buildExport() {
  const [books, bookcases, tags, floorPlans, rooms, settings] = await Promise.all([
    prisma.book.findMany({
      include: {
        tags: { include: { tag: { select: { name: true } } } },
        placement: { include: { level: { include: { bookcase: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.bookcase.findMany({
      include: { levels: { orderBy: { levelIndex: "asc" } } },
      orderBy: { sortKey: "asc" },
    }),
    prisma.tag.findMany({ include: { zones: true } }),
    // geometry 是整张 DXF 解析后的图元数组，体积不小但必须带上 ——
    // 少了它，房间轮廓、书柜摆位、3D 全部无从重建
    prisma.floorPlan.findMany({ orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }] }),
    prisma.room.findMany({ orderBy: [{ sortKey: "asc" }, { createdAt: "asc" }] }),
    prisma.setting.findMany({ where: { key: { in: EXPORTED_SETTINGS } } }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    version: 2,
    counts: {
      books: books.length,
      bookcases: bookcases.length,
      levels: bookcases.reduce((s, b) => s + b.levels.length, 0),
      placements: books.filter((b) => b.placement).length,
      tags: tags.length,
      floorPlans: floorPlans.length,
      rooms: rooms.length,
    },
    books,
    bookcases,
    tags,
    floorPlans,
    rooms,
    settings,
  };

  return payload;
}
