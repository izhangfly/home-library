import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AdminRequiredError } from "./auth";
import { RateLimitError } from "./ratelimit";
import { Prisma } from "@/app/generated/prisma/client";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(code: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: code, ...extra }, { status });
}

/**
 * 请求体压根没解析成功 —— 这是**客户端/网络**的问题，不是服务端崩了。
 *
 * `req.json()` 碰上坏 JSON、`req.formData()` 碰上不是 multipart 的 body，
 * 都会直接抛。以前没人接，于是一路冒成 500 internal_error，
 * 用户看到"服务器错误"—— 而真实情况往往是：站在书架前 wifi 抖了一下，
 * 那张 3MB 的封面传到一半断了。那是该**重试**的，不是该放弃的。
 *
 * 为什么不在 handleError 里按错误类型猜：`formData()` 失败抛的是 TypeError，
 * 而 TypeError 也正是我自己代码里写错时最常抛的东西 ——
 * 一律当 400 处理，等于把真 bug 伪装成"你的请求有问题"，比 500 更难查。
 * 所以在**解析那一行**就地包起来，不猜。
 */
export class BadBodyError extends Error {
  constructor(readonly kind: "json" | "form") {
    super("bad_body");
  }
}

/** 读 JSON body。解析失败 → 400，不是 500。 */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadBodyError("json");
  }
}

/** 读 multipart body。解析失败（body 断了、根本不是表单）→ 400，不是 500。 */
export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw new BadBodyError("form");
  }
}

/** 统一错误出口：route handler 里直接 throw，这里翻译成合适的状态码 */
export function handleError(err: unknown) {
  if (err instanceof AdminRequiredError) return fail("admin_required", 401);
  if (err instanceof RateLimitError) {
    return NextResponse.json(
      { error: "rate_limited", bucket: err.bucket, retryAfter: err.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSec) } },
    );
  }
  if (err instanceof BadBodyError) return fail("bad_body", 400, { kind: err.kind });
  if (err instanceof ZodError) {
    return fail("validation", 422, { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
  }

  // 数据库约束不是"出错了"，是**数据库替我们挡住了一次真实的冲突**。
  // 让它以 500 internal_error 冒出来，用户看到的是"服务器错误"，
  // 而实际情况是"这本书已经在库里了"——后者他能处理，前者只能干瞪眼。
  //
  // 这在家里是常态而不是边角：两个人同时扫同一本书，两边的查重都通过了，
  // 数据库的 isbn13 唯一约束挡住第二次写入 —— 那一刻该说的是"已经有了"。
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        // 哪个字段重了，回传给前端好指出是哪一项。
        // 注意：用了 driver adapter（@prisma/adapter-pg）之后，meta 里**没有** target，
        // 只有 modelName 和一个包着 Postgres 原始错误的 driverAdapterError。
        // 照文档写 `meta.target` 会拿到 undefined —— 实测过，fields 一直是空数组。
        return fail("already_exists", 409, uniqueMeta(err.meta));
      
      case "P2025":
        // 要改/要删的行不在了 —— 多半是别人刚刚删掉的
        return fail("not_found", 404);
      case "P2003":
        // 外键还被别处引用着，删不掉
        return fail("still_referenced", 409);
    }
  }

  console.error("[api]", err);
  return fail("internal_error", 500);
}

/** 从 P2002 的 meta 里尽力挖出「哪个模型、哪个字段」 */
function uniqueMeta(meta: unknown): { model?: string; fields: string[] } {
  const m = (meta ?? {}) as Record<string, unknown>;
  const model = typeof m.modelName === "string" ? m.modelName : undefined;

  // 1) 没有 driver adapter 时 Prisma 给的标准形状
  const target = m.target;
  if (Array.isArray(target)) return { model, fields: target.map(String) };
  if (typeof target === "string") return { model, fields: [target] };

  // 2) driver adapter 下，字段名藏在 Postgres 的约束名里：Book_isbn13_key → isbn13
  const nested = m.driverAdapterError as { cause?: { constraint?: unknown } } | undefined;
  const constraint = nested?.cause?.constraint;
  const name =
    typeof constraint === "string" ? constraint
    : constraint && typeof constraint === "object" && "fields" in constraint
      ? undefined
      : undefined;
  if (constraint && typeof constraint === "object" && Array.isArray((constraint as { fields?: unknown }).fields)) {
    return { model, fields: ((constraint as { fields: unknown[] }).fields).map(String) };
  }
  if (name && model) {
    const stripped = name.replace(new RegExp(`^${model}_`), "").replace(/_key$/, "");
    if (stripped && stripped !== name) return { model, fields: stripped.split("_") };
  }
  // 挖不出来就只报模型 —— 空着也比编一个字段名强
  return { model, fields: [] };
}

export function route<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (err) {
      return handleError(err);
    }
  };
}
