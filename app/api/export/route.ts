// 备份导出 —— F8 验收条件 3 的"简单导出"部分。
// 整库 JSON：书目、书架结构、标签、上架关系、**户型图与房间**、设置。
// 封面图不在这里，由 deploy/backup.sh 单独打包。
//
// 这份导出的定位是「把你的数据带走」：换个系统、或者另存一份到网盘。
// 想把数据恢复回本系统请用 pg_restore（见 DEPLOY.md），那条路是验证过的。
//
// 曾经漏掉过 FloorPlan 和 Room：DXF 户型图和十几个手工命名过的房间
// 一个字都没导出来，而它们恰恰是最难重建的数据 —— 书还能照着 ISBN 重扫一遍，
// 房间的名字和轮廓只存在这一处。所以下面有一张**覆盖表**，
// scripts/verify-export.mts 会拿它和 prisma schema 对账：
// 新加了表却没在这里登记，测试就红。
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { buildExport } from "@/lib/export";

/**
 * 每张表要么被导出，要么写明为什么不导。
 * 不允许"没想到"这种状态存在。
 */
export const TABLE_COVERAGE: Record<string, string> = {
  Book: "books",
  Bookcase: "bookcases",
  Level: "bookcases[].levels",
  Placement: "books[].placement",
  Tag: "tags",
  BookTag: "books[].tags",
  TagZone: "tags[].zones",
  FloorPlan: "floorPlans",
  Room: "rooms",
  Setting: "settings（只导白名单里的，见 EXPORTED_SETTINGS）",
  // 会话令牌属于凭证，导出等于把后台钥匙一起给出去
  AdminSession: "__excluded__:登录会话是凭证，不导出",
};


export const GET = route(async () => {
  // 这份东西是"整个家里有什么书 + 户型图 + 每个房间叫什么"。
  // 户型轮廓等于自家平面图，公开在互联网上任人下载不合适。
  // 而且它本来就只在 /settings 页面上有入口，那页本来就要管理员 ——
  // 以前接口没拦，纯粹是漏了，不是有意开放。
  //
  // 注意这不违反两级权限那条：要放开的是"妹妹拿手机扫码加书"那条路
  // （/api/books、/api/upload、/api/placements），不包括整库导出。
  await requireAdmin();
  const payload = await buildExport();

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="home-library-${stamp}.json"`,
    },
  });
});
