// 在线插入 —— docs/shelving-v3.md §7
//
// 日常最常走的一条路：扫进来一本书，它该插到哪。
//
// 关键在于**不要为了塞下它而破坏顺序**。这本书按索书号属于某一层的中间，
// 那一层满了，正确做法不是把它丢到别的空层去（那样这本书就永远找不到了），
// 而是把那一层最后一本推到下一层，级联下去，直到遇到有空隙的层 ——
// 这正是 list-labeling / 文件维护问题的标准做法，也是人站在书架前实际会做的动作。
//
// 「分区自己涨大缩小」就是这么实现的：分区边界随着推挤自然移动，
// 没有人需要维护一张"哪个类目占哪几层"的表。
//
// 级联超过预算就不再自作主张：出一份预览交给用户，或者请他跑整屋规划。

import { estimateSpine, type CapacityCoefficients, DEFAULT_COEFFICIENTS } from "./capacity";
import { clcCloseness, clcPrefix, clcSortKey, normalizeClc } from "./clc";
import { orderBookcases, orderLevels, shelvingKey, type LayoutBook, type LayoutBookcase, type LayoutLevel } from "./layout";

/** 一本书被推到别处 */
export interface Shift {
  bookId: string;
  title: string;
  fromLevelId: string;
  toLevelId: string;
}

export interface InsertPlan {
  /** 新书落在哪一层 */
  targetLevelId: string | null;
  /** 它在该层里的位置（第几本，0 起） */
  positionInLevel: number;
  /** 为了给它腾地方，需要顺次推走的书 */
  shifts: Shift[];
  outcome:
    | "fits"           // 直接放得下，什么都不用动
    | "cascade"        // 推挤了几本，顺序完好
    | "needs_review"   // 推不动了（推到头 / 超预算 / 高度不合），交给用户
    ;
  /** 说清楚为什么，界面直接用 */
  reason:
    | "direct"
    | "pushed"
    | "budget_exceeded"
    | "ran_out_of_shelves"
    | "too_tall"
    | "no_shelves";
  /** 目标层所属书柜，界面要显示"客厅大书柜 › 第 3 层" */
  bookcaseId: string | null;
}

export interface InsertOptions {
  coeffs?: CapacityCoefficients;
  /** 最多推挤多少本。超了就不再自作主张 */
  budget?: number;
}

/**
 * 排架顺序只有一个定义，在 lib/layout.ts。
 * 这里以前自己拼了一份（只用索书号），加了排架序列之后两边就会分叉：
 * 整屋规划把期刊单独排一段，而插入还按纯索书号找邻居，
 * 结果把一本期刊指到某本专著旁边 —— 那层上一本期刊都没有。
 */
const sortKeyOf = shelvingKey;

/**
 * 货架带 —— 人走过去会依次看到的层顺序。
 *
 * 柜与柜之间按走位（和 planLayout 同一套）；**柜内的上下方向要看架上实际是怎么摆的**。
 *
 * 一开始这里写死了"从上往下"（图书馆惯例），线上立刻出了错答案：
 * 用户的书是从最下层往上摆的（第 1 层 I247 → 第 4 层 N4），
 * 于是一本 I516 被算成该放在装着 N4 的最上层。带的方向和现实相反，
 * 「按索书号该放这儿」就变成了胡说。
 *
 * planLayout 本来就允许每个柜子整体翻转（两个方向各跑一遍 DP 取便宜的），
 * 所以柜内方向本就不是固定的，插入这边必须照着**架上现在的样子**来读。
 */
export function shelfTape(
  bookcases: LayoutBookcase[],
  shelved: LayoutBook[] = [],
): { level: LayoutLevel; bookcaseId: string }[] {
  // 每层现有书里最小的索书号，用来判断这个柜子是从上往下还是从下往上排的
  const minKey = new Map<string, string>();
  for (const b of shelved) {
    if (!b.levelId) continue;
    const k = sortKeyOf(b);
    const cur = minKey.get(b.levelId);
    if (cur === undefined || k.localeCompare(cur) < 0) minKey.set(b.levelId, k);
  }

  return orderBookcases(bookcases).flatMap((bc) => {
    const topDown = orderLevels(bc.levels);           // levelIndex 降序
    const bottomUp = [...topDown].reverse();

    // 沿某个方向走一遍，数一数索书号"该升却降了"多少次，逆序少的那个方向就是实际方向
    const inversions = (order: LayoutLevel[]) => {
      const keys = order.map((l) => minKey.get(l.id)).filter((k): k is string => !!k);
      let bad = 0;
      for (let i = 1; i < keys.length; i++) if (keys[i - 1].localeCompare(keys[i]) > 0) bad++;
      return bad;
    };
    const order = inversions(bottomUp) < inversions(topDown) ? bottomUp : topDown;
    return order.map((level) => ({ level, bookcaseId: bc.id }));
  });
}

export function planInsert(
  book: LayoutBook,
  bookcases: LayoutBookcase[],
  shelved: LayoutBook[],
  opts: InsertOptions = {},
): InsertPlan {
  const coeffs = opts.coeffs ?? DEFAULT_COEFFICIENTS;
  const budget = opts.budget ?? 8;
  const tape = shelfTape(bookcases, shelved);

  const empty = (reason: InsertPlan["reason"]): InsertPlan => ({
    targetLevelId: null, positionInLevel: 0, shifts: [],
    outcome: "needs_review", reason, bookcaseId: null,
  });

  if (!tape.length) return empty("no_shelves");
  if (book.heightMm && !tape.some((t) => book.heightMm! <= t.level.heightMm)) return empty("too_tall");

  // 每层当前的书，按索书号排好
  const byLevel = new Map<string, LayoutBook[]>();
  for (const b of shelved) {
    if (!b.levelId || b.id === book.id) continue;
    byLevel.set(b.levelId, [...(byLevel.get(b.levelId) ?? []), b]);
  }
  for (const list of byLevel.values()) list.sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)));

  const usable = (l: LayoutLevel) => Math.max(0, l.widthMm - coeffs.levelMarginMm);
  const width = (list: LayoutBook[]) => list.reduce((s, b) => s + estimateSpine(b, coeffs).mm, 0);

  // 工作副本：级联要反复改，不能动调用方的数据
  const work = new Map<string, LayoutBook[]>(
    tape.map((t) => [t.level.id, [...(byLevel.get(t.level.id) ?? [])]]),
  );

  // ---- 该插到哪一层 ----
  // 沿着带往下走，第一层"最后一本的索书号 ≥ 新书"的就是它的位置。
  // 都比它小说明它排在最后，落到最后一个非空层（或第一个空层）。
  const key = sortKeyOf(book);
  let target = -1;
  for (let i = 0; i < tape.length; i++) {
    const list = work.get(tape[i].level.id)!;
    if (!list.length) continue;
    if (sortKeyOf(list[list.length - 1]).localeCompare(key) >= 0) { target = i; break; }
  }
  if (target < 0) {
    const lastUsed = tape.map((t, i) => (work.get(t.level.id)!.length ? i : -1)).filter((i) => i >= 0).pop();
    target = lastUsed ?? 0;
    // 排在全部之后：如果本层已经满了，直接用下一个空层更自然
    const l = tape[target].level;
    if (width(work.get(l.id)!) + estimateSpine(book, coeffs).mm > usable(l) && target + 1 < tape.length) {
      target += 1;
    }
  }

  // 边界情形：这本书正好落在「上一层的最后一本」和「这一层的第一本」之间。
  // 接在上一层末尾、或插在这一层开头，两种都不破坏顺序。
  // 那就挑不用推挤的那个；都不用推就挑余量大的 —— 少动书，也顺手把两层拉平。
  const prev = (() => {
    for (let i = target - 1; i >= 0; i--) if (work.get(tape[i].level.id)!.length) return i;
    return -1;
  })();
  if (prev >= 0) {
    const spine = estimateSpine(book, coeffs).mm;
    const fitsIn = (i: number) => {
      const l = tape[i].level;
      if (book.heightMm && book.heightMm > l.heightMm) return false;
      return width(work.get(l.id)!) + spine <= usable(l);
    };
    const freeIn = (i: number) => {
      const l = tape[i].level;
      return usable(l) - width(work.get(l.id)!);
    };
    // 都放得下时，跟谁是一类就跟谁 —— 这正是"学科近的放得近"在插入这一侧的体现。
    // 只比余量是不够的：两层余量常常差不多，谁大谁小纯属偶然，
    // 结果就是同一类的书被随机切成两半。
    const dominant = (i: number) => {
      const counts = new Map<string, number>();
      for (const b of work.get(tape[i].level.id)!) {
        const k = clcPrefix(b.clc, 4);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      let best: string | null = null, n = 0;
      for (const [k, v] of counts) if (v > n) { n = v; best = k; }
      return best;
    };

    const prevOk = fitsIn(prev);
    const targetOk = fitsIn(target);
    if (prevOk && !targetOk) {
      target = prev;
    } else if (prevOk && targetOk) {
      const cp = clcCloseness(book.clc, dominant(prev));
      const ct = clcCloseness(book.clc, dominant(target));
      if (cp > ct || (cp === ct && freeIn(prev) > freeIn(target))) target = prev;
    }
  }

  // 目标层高度不够就往后找第一层放得下的 —— 这是硬约束，让不了
  while (target < tape.length && book.heightMm && book.heightMm > tape[target].level.heightMm) target++;
  if (target >= tape.length) return empty("too_tall");

  // ---- 插入 + 级联 ----
  const shifts: Shift[] = [];
  const targetLevel = tape[target].level;
  const targetList = work.get(targetLevel.id)!;
  const pos = targetList.findIndex((b) => sortKeyOf(b).localeCompare(key) > 0);
  const insertAt = pos < 0 ? targetList.length : pos;
  targetList.splice(insertAt, 0, book);

  let i = target;
  while (i < tape.length) {
    const level = tape[i].level;
    const list = work.get(level.id)!;
    if (width(list) <= usable(level)) {
      return {
        targetLevelId: targetLevel.id,
        positionInLevel: insertAt,
        shifts,
        outcome: shifts.length ? "cascade" : "fits",
        reason: shifts.length ? "pushed" : "direct",
        bookcaseId: tape[target].bookcaseId,
      };
    }

    // 这一层挤爆了：把最后一本推到下一层的开头
    if (i + 1 >= tape.length) {
      return { ...empty("ran_out_of_shelves"), targetLevelId: targetLevel.id, shifts };
    }
    const pushed = list.pop();
    if (!pushed) return { ...empty("ran_out_of_shelves"), targetLevelId: targetLevel.id, shifts };

    const next = tape[i + 1].level;
    // 推过去的书必须放得进下一层的净空，否则这条路走不通
    if (pushed.heightMm && pushed.heightMm > next.heightMm) {
      return { ...empty("too_tall"), targetLevelId: targetLevel.id, shifts };
    }

    work.get(next.id)!.unshift(pushed);
    if (pushed.id !== book.id) {
      shifts.push({
        bookId: pushed.id,
        title: pushed.title,
        fromLevelId: level.id,
        toLevelId: next.id,
      });
    }
    if (shifts.length > budget) {
      return { ...empty("budget_exceeded"), targetLevelId: targetLevel.id, shifts };
    }
    i++;
  }

  return { ...empty("ran_out_of_shelves"), targetLevelId: targetLevel.id, shifts };
}
