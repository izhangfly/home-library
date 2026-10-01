// 重新导入户型图时，把旧房间和新识别出来的房间对上号
//
// 为什么必须对上号：重新上传一份 DXF（改了个墙、补了个门）走的是
// `room.deleteMany` + `room.createMany`，新房间一律叫「房间 N」。
// 于是用户一个个手打的名字（卧室、书房、儿童房…）**全没了** ——
// 而这恰恰是最难重建的数据：书还能照 ISBN 重扫一遍，
// 房间的名字只存在这一处，重建全靠人重新想一遍、重新打一遍。
// 首页的 <SetupChecklist> 还一直在催用户"把 13 个房间命名了"，
// 结果他辛辛苦苦命完名，改一次图纸全部打回「房间 N」。
//
// 顺带还有第二笔：书柜是**按坐标**落进房间的。
// 用户在界面上手动「转移」过的书柜（平面图上拖不出房间，换房间只能走转移），
// 重新导入时会被几何位置覆盖回去。保住房间的 id 就能保住这条关系。
import { centroid, pointInPolygon, polygonArea, type Pt } from "./geometry";

export interface ExistingRoom {
  id: string;
  name: string;
  polygon: Pt[];
}

export interface DetectedRoom {
  polygon: Pt[];
  areaMm2: number;
}

export interface RoomMatch {
  /** 对上的旧房间；null = 这是新出现的房间 */
  existingId: string | null;
  /** 该沿用的名字；null = 用默认的「房间 N」 */
  keepName: string | null;
}

/** 「房间 3」这种系统给的占位名不值得保留 —— 保留它反而会把新的编号顺序搞乱 */
export function isPlaceholderName(name: string): boolean {
  return /^\s*(房间|Room)\s*\d+\s*$/.test(name);
}

/**
 * 把每个新识别的房间匹配到一个旧房间。
 *
 * 判据用「质心落在对方多边形里」而不是「质心距离最近」：
 * 前者对轮廓微调（挪了道墙、门洞画法变了）稳定，
 * 后者在两个小房间挨着时会互相抢。面积差太多的不认 ——
 * 一个大厅被拆成两间时，不该让其中一间继承大厅的名字。
 *
 * 一对一：一个旧房间只能被认领一次，先来先得（按面积从大到小，
 * 大房间的匹配更可靠，让它先挑）。
 */
export function matchRooms(detected: DetectedRoom[], existing: ExistingRoom[]): RoomMatch[] {
  const taken = new Set<string>();
  const order = detected
    .map((d, i) => ({ i, area: d.areaMm2 || polygonArea(d.polygon) }))
    .sort((a, b) => b.area - a.area);

  const out: RoomMatch[] = detected.map(() => ({ existingId: null, keepName: null }));

  for (const { i } of order) {
    const d = detected[i];
    const dc = centroid(d.polygon);
    const dArea = d.areaMm2 || polygonArea(d.polygon);

    const hit = existing.find((e) => {
      if (taken.has(e.id)) return false;
      const eArea = polygonArea(e.polygon);
      // 面积比超过 1.5 倍就不认。
      //
      // 这个数字是往**安全**的方向选的，不是随手定的。两种错各有代价：
      //   认不出来 → 名字丢了，用户重打一遍，烦但看得见；
      //   认错了   → 「客厅」这个名字挂到了一个储藏间上，而**用户不会发现**。
      // 后者更糟：整个应用的价值就是告诉你书在哪儿，
      // 房间名字错了，检索路径就在骗人。所以宁可丢名字也不要错名字。
      // 1.5 倍能放过挪墙、补门洞这类微调（实测挪 100mm 是 1.03 倍），
      // 又能挡住"一间拆成两间"（正好 2 倍）——后者本来就该当成新房间。
      const ratio = dArea > 0 && eArea > 0 ? Math.max(dArea, eArea) / Math.min(dArea, eArea) : Infinity;
      if (ratio > 1.5) return false;
      // 互相包含质心 —— 只要一边成立就够，轮廓凹的时候质心可能落在外面
      return pointInPolygon(dc, e.polygon) || pointInPolygon(centroid(e.polygon), d.polygon);
    });

    if (hit) {
      taken.add(hit.id);
      out[i] = { existingId: hit.id, keepName: isPlaceholderName(hit.name) ? null : hit.name };
    }
  }
  return out;
}
