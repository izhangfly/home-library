// F9 —— AI 简介兜底
//
// 只在「所有数据源都没给简介」时才调用。两个必须避免的坏结果：
//   1. 模型编造作者/评价（幻觉）
//   2. 模型干巴巴回一句"我不知道"
// 做法：system 提示里给死两种输出格式，强制走 JSON，前端按 status 分别渲染。
// 生成结果永远写进 Book.aiSummary（不是 summary），前端视觉上必须能区分。

import { isValidClc } from "./clc";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

// 用户明确要求把 key 直接写进项目（该项目不上传 GitHub）。
// 环境变量优先，方便以后换 key 不用改代码。
const FALLBACK_KEY = "";

export type AiSummaryStatus = "ok" | "insufficient" | "error";

export interface AiSummaryResult {
  status: AiSummaryStatus;
  summary?: string;
  error?: string;
}

export interface AiSummaryInput {
  title: string;
  subtitle?: string | null;
  authors?: string[];
  translators?: string[];
  publisher?: string | null;
  pubDate?: string | null;
  language?: string | null;
  tags?: string[];
  /** 界面语言：中文界面出中文简介，英文界面出英文简介 */
  locale?: "zh" | "en";
}

const SYSTEM_PROMPT = `你是一个图书馆员，负责为家庭藏书写一句话定位说明。

严格规则：
1. 只依据你已有的可靠知识回答。不确定就说不确定，绝不推测、绝不编造。
2. 如果你对这本具体作品没有可靠信息（认不出这本书、只能从书名猜测内容、
   或者只知道作者不知道这本书），必须返回 status="insufficient"，不要硬写。
3. 认识这本书时，返回 status="ok"，simple 字段写 2-3 句话，不超过 100 字，
   只讲主题 / 领域 / 大致定位。
4. 禁止：剧透情节、复述目录、主观评价（"经典""必读""精彩"）、
   夸奖作者、编造获奖记录或销量数据。
5. 不要重复输入里已经给你的书名、作者、出版社等字段。

只输出 JSON，格式二选一：
{"status":"ok","summary":"……"}
{"status":"insufficient"}`;

const SYSTEM_PROMPT_EN = `You are a librarian writing a one-line positioning note for a home library.

Strict rules:
1. Rely only on reliable knowledge you already have. If unsure, say so. Never speculate or fabricate.
2. If you have no reliable information about this specific work (you don't recognise it, you could
   only guess from the title, or you know the author but not this book), you MUST return
   status="insufficient". Do not write something anyway.
3. If you do know the book, return status="ok" with 2-3 sentences, under 60 words, covering only
   subject / field / rough positioning.
4. Forbidden: plot spoilers, restating the table of contents, subjective praise ("classic",
   "must-read", "brilliant"), complimenting the author, inventing awards or sales figures.
5. Do not repeat the title, author or publisher already given in the input.

Output JSON only, one of:
{"status":"ok","summary":"…"}
{"status":"insufficient"}`;

function buildUserPrompt(book: AiSummaryInput): string {
  // 只喂已核实的结构化字段 —— 不带任何猜测性内容
  const lines: string[] = [];
  const push = (k: string, v?: string | null) => {
    if (v && v.trim()) lines.push(`${k}: ${v.trim()}`);
  };
  push("书名", book.title);
  push("副标题", book.subtitle);
  if (book.authors?.length) push("作者", book.authors.join("、"));
  if (book.translators?.length) push("译者", book.translators.join("、"));
  push("出版社", book.publisher);
  push("出版年", book.pubDate);
  push("语言", book.language);
  if (book.tags?.length) push("分类", book.tags.join("、"));
  return lines.join("\n");
}

function parseResponse(content: string): AiSummaryResult {
  try {
    const parsed = JSON.parse(content) as { status?: string; summary?: string };
    if (parsed.status === "ok" && parsed.summary?.trim()) {
      return { status: "ok", summary: parsed.summary.trim() };
    }
    if (parsed.status === "insufficient") return { status: "insufficient" };
    return { status: "insufficient" };
  } catch {
    // 万一没按 JSON 输出，宁可判成信息不足，也不把裸文本当简介展示
    return { status: "insufficient" };
  }
}

export async function generateAiSummary(book: AiSummaryInput): Promise<AiSummaryResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY || FALLBACK_KEY;
  if (!apiKey) return { status: "error", error: "missing_api_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: book.locale === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(book) },
        ],
        response_format: { type: "json_object" },
        // 低温度：这个任务要的是保守，不是创意
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { status: "error", error: `http_${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { status: "error", error: "empty_response" };

    return parseResponse(content);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "error", error: "timeout" };
    }
    return { status: "error", error: err instanceof Error ? err.message : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- DDC 分类

const DDC_SYSTEM = `你是图书馆编目员，为一本书指定杜威十进分类法(DDC)的类号。

严格规则：
1. 只输出三位整数类号（如 823、895、530），**不要小数**。
   理由：你没有完整的 DDC 类表，编出 "895.1352" 这种精度是假的。
2. 认不出这本书、或只能靠书名猜测主题时，返回 status="unsure"，不要硬给一个号。
3. 按学科分类，不是按题材。例如讲服装心理的书归心理(155)，不是服装(391)。
4. 文学作品按**原作语言**分：
   中文文学 895、英国文学 823、美国文学 813、俄语文学 891、
   法语 843、德语 833、日本文学 895。
5. 只输出 JSON，二选一：
{"status":"ok","ddc":"823"}
{"status":"unsure"}`;

export interface DdcClassifyInput {
  title: string;
  subtitle?: string | null;
  authors?: string[];
  publisher?: string | null;
  language?: string | null;
  subjects?: string[];
  summary?: string | null;
}

export async function classifyDdc(
  book: DdcClassifyInput,
): Promise<{ status: "ok" | "unsure" | "error"; ddc?: string; error?: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY || FALLBACK_KEY;
  if (!apiKey) return { status: "error", error: "missing_api_key" };

  const lines = [
    `书名: ${book.title}`,
    book.subtitle ? `副标题: ${book.subtitle}` : "",
    book.authors?.length ? `作者: ${book.authors.join("、")}` : "",
    book.publisher ? `出版社: ${book.publisher}` : "",
    book.language ? `语言: ${book.language}` : "",
    book.subjects?.length ? `主题词: ${book.subjects.slice(0, 8).join("、")}` : "",
    book.summary ? `简介: ${book.summary.slice(0, 300)}` : "",
  ].filter(Boolean);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: DDC_SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 100,
      }),
    });
    if (!res.ok) return { status: "error", error: `http_${res.status}` };

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { status: "error", error: "empty_response" };

    const parsed = JSON.parse(content) as { status?: string; ddc?: string };
    if (parsed.status === "ok" && /^\d{3}$/.test(String(parsed.ddc ?? ""))) {
      return { status: "ok", ddc: String(parsed.ddc) };
    }
    return { status: "unsure" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { status: "error", error: "timeout" };
    return { status: "error", error: err instanceof Error ? err.message : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- 中图法分类

const CLC_SYSTEM = `你是中文图书馆编目员，为一本书指定《中国图书馆分类法》(中图法/CLC)的分类号。

严格规则：
1. 输出标准中图法号，例如 I247.57、TP311、K248、B848、O13。
   字母大类 + 数字细目。最多到小数点后两位。
2. 认不出这本书就返回 status="unsure"，不要硬凑一个号。
3. 按**学科**归类，不按题材。中文教材归教育或对应学科，不要归文学。
4. 文学作品按语言+体裁+时代：
   中国当代长篇小说 I247.57 / 中短篇 I247.7 / 现当代诗歌 I226 /
   当代散文 I267 / 儿童文学 I287 / 古典章回小说 I242.4 /
   日本小说 I313.45 / 英国小说 I561.45 / 美国小说 I712.45 / 俄罗斯小说 I512.45
5. 常用：计算机程序设计 TP311、人工智能 TP18、心理学 B84、励志 B848、
   世界史 K1、中国通史 K20、经济 F、金融投资 F83、数学 O1、物理 O4、
   天文 P1、生物 Q1、医学健康 R1、烹饪 TS97、航空 V2。

只输出 JSON，二选一：
{"status":"ok","clc":"I247.57"}
{"status":"unsure"}`;


export async function classifyClc(
  book: DdcClassifyInput,
): Promise<{ status: "ok" | "unsure" | "error"; clc?: string; error?: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY || FALLBACK_KEY;
  if (!apiKey) return { status: "error", error: "missing_api_key" };

  const lines = [
    `书名: ${book.title}`,
    book.subtitle ? `副标题: ${book.subtitle}` : "",
    book.authors?.length ? `作者: ${book.authors.join("、")}` : "",
    book.publisher ? `出版社: ${book.publisher}` : "",
    book.language ? `语言: ${book.language}` : "",
    book.subjects?.length ? `主题词: ${book.subjects.slice(0, 8).join("、")}` : "",
    book.summary ? `简介: ${book.summary.slice(0, 300)}` : "",
  ].filter(Boolean);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: CLC_SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 100,
      }),
    });
    if (!res.ok) return { status: "error", error: `http_${res.status}` };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { status: "error", error: "empty_response" };
    const parsed = JSON.parse(content) as { status?: string; clc?: string };
    // 只卡形状是不够的：M5 / W3 / I..5 / I247.5.3 都能过形状检查，
    // 但它们不是合法的中图法号，存进去会把书排到不存在的区段里。
    if (parsed.status === "ok" && isValidClc(parsed.clc)) {
      return { status: "ok", clc: String(parsed.clc).trim().toUpperCase() };
    }
    return { status: "unsure" };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { status: "error", error: "timeout" };
    return { status: "error", error: err instanceof Error ? err.message : "unknown" };
  } finally {
    clearTimeout(timer);
  }
}
