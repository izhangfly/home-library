// 给一本书定 DDC 号的完整决策链。
//
// 优先级（越靠前越可信，ddcSource 会一路带到界面上）：
//   1. openLibrary —— 真实图书馆编目记录里的权威号，原样保留（可能带小数）
//   2. rules       —— 本地关键词规则，只到三位
//   3. ai          —— DeepSeek，只到三位，且它不确定时会说 unsure 而不是硬编
//   4. 都失败      —— 宁可不给号，也不给一个错号
import { classifyDdc } from "./deepseek";
import {
  buildCallNumber,
  callNumberSortKey,
  cutter,
  inferDdcByRules,
  isValidDdc,
  normalizeDdc,
  type DdcSource,
} from "./ddc";

export interface DdcAssignInput {
  title: string;
  subtitle?: string | null;
  authors?: string[];
  publisher?: string | null;
  language?: string | null;
  subjects?: string[];
  tags?: string[];
  summary?: string | null;
  /** 数据源给的权威 DDC（目前只有 OpenLibrary） */
  authoritativeDdc?: string | null;
}

export interface DdcAssignment {
  ddc: string | null;
  ddcSource: DdcSource | null;
  callNumber: string | null;
  callSortKey: string;
  /** 规则命中的关键词，便于解释"为什么是这个号" */
  matched?: string[];
}

const NO_SORT = "￿";

export function emptyAssignment(): DdcAssignment {
  return { ddc: null, ddcSource: null, callNumber: null, callSortKey: NO_SORT };
}

function finish(
  ddc: string,
  source: DdcSource,
  input: DdcAssignInput,
  matched?: string[],
): DdcAssignment {
  const norm = normalizeDdc(ddc);
  if (!norm) return emptyAssignment();
  return {
    ddc: norm,
    ddcSource: source,
    callNumber: buildCallNumber(norm, input.authors, input.title),
    callSortKey: callNumberSortKey(norm, cutter(input.authors, input.title)),
    matched,
  };
}

/**
 * 不联网的部分：权威号 + 规则。入库时同步跑这一段，快且免费。
 * 返回 null 表示这两步都没结果，要不要接着问模型由调用方决定。
 */
export function assignDdcOffline(input: DdcAssignInput): DdcAssignment | null {
  const authoritative = normalizeDdc(input.authoritativeDdc);
  if (authoritative) return finish(authoritative, "openLibrary", input);

  const byRules = inferDdcByRules({
    title: input.title,
    subtitle: input.subtitle,
    subjects: input.subjects,
    tags: input.tags,
    language: input.language,
    summary: input.summary,
  });
  if (byRules) {
    // 规则里的号都抄自 DDC 公开纲目表（895.13 中国小说这种），不是编出来的，
    // 所以保留原有精度。只有模型生成的号才需要砍到三位。
    return finish(byRules.ddc, "rules", input, byRules.matched);
  }
  return null;
}

/** 完整链路，含模型兜底。会联网，所以只在需要时调用。 */
export async function assignDdc(input: DdcAssignInput): Promise<DdcAssignment> {
  const offline = assignDdcOffline(input);
  if (offline) return offline;

  const ai = await classifyDdc({
    title: input.title,
    subtitle: input.subtitle,
    authors: input.authors,
    publisher: input.publisher,
    language: input.language,
    subjects: input.subjects,
    summary: input.summary,
  });

  if (ai.status === "ok" && ai.ddc) return finish(ai.ddc, "ai", input);
  // 模型说不确定 / 出错 —— 不给号。空着比错着好，界面上会提示可以手动填。
  return emptyAssignment();
}

/** 用户手动指定号 */
/** 同 assignClcManual：坏号返回 null，绝不静默抹掉已有的号 */
export function assignDdcManual(ddc: string, input: DdcAssignInput): DdcAssignment | null {
  if (!isValidDdc(ddc)) return null;
  return finish(ddc, "manual", input);
}
