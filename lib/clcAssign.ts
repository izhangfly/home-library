// 中图法号的决策链：规则 → 模型 → 空着（不给错号）
import { classifyClc } from "./deepseek";
import { clcSortKey, inferClcByRules, isValidClc, normalizeClc, type ClcSource } from "./clc";
import { cutter } from "./ddc";

export interface ClcAssignInput {
  title: string;
  subtitle?: string | null;
  authors?: string[];
  publisher?: string | null;
  language?: string | null;
  subjects?: string[];
  tags?: string[];
  summary?: string | null;
}

export interface ClcAssignment {
  clc: string | null;
  clcSource: ClcSource | null;
  callNumber: string | null;
  callSortKey: string;
  matched?: string[];
}

export function emptyClcAssignment(): ClcAssignment {
  return { clc: null, clcSource: null, callNumber: null, callSortKey: "￿" };
}

function finish(clc: string, source: ClcSource, input: ClcAssignInput, matched?: string[]): ClcAssignment {
  const norm = normalizeClc(clc);
  if (!norm) return emptyClcAssignment();
  const cut = cutter(input.authors, input.title);
  return {
    clc: norm,
    clcSource: source,
    callNumber: cut ? `${norm} ${cut}` : norm,
    callSortKey: clcSortKey(norm, cut),
    matched,
  };
}

/** 不联网那一段，入库时同步跑 */
export function assignClcOffline(input: ClcAssignInput): ClcAssignment | null {
  const byRules = inferClcByRules(input);
  return byRules ? finish(byRules.clc, "rules", input, byRules.matched) : null;
}

/** 完整链路，含模型兜底 */
export async function assignClc(input: ClcAssignInput): Promise<ClcAssignment> {
  const offline = assignClcOffline(input);
  if (offline) return offline;
  const ai = await classifyClc({
    title: input.title, subtitle: input.subtitle, authors: input.authors,
    publisher: input.publisher, language: input.language,
    subjects: input.subjects, summary: input.summary,
  });
  if (ai.status === "ok" && ai.clc) return finish(ai.clc, "ai", input);
  return emptyClcAssignment();
}

/**
 * 手工指定分类号。**号不合法就返回 null，不要返回一个空的赋值。**
 *
 * 以前返回的是 `emptyClcAssignment()`，调用方看不出区别，于是
 * "手工填了个 M5" 和 "这本书本来就没有号" 变成同一件事 ——
 * 结果是把这本书原来那个好好的号**抹掉**，接口还回 200。
 * 把关口放在这里而不是只放在路由上：换一个调用方就不会重蹈覆辙。
 */
export function assignClcManual(clc: string, input: ClcAssignInput): ClcAssignment | null {
  if (!isValidClc(clc)) return null;
  return finish(clc, "manual", input);
}
