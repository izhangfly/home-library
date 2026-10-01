"use client";

/** 统一的前端请求封装：把 API 的 {error} 约定翻译成异常，调用点只管 try/catch */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public payload?: Record<string, unknown>,
  ) {
    super(code);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new ApiError(data.error ?? `http_${res.status}`, res.status, data);
  }
  return data as T;
}

/**
 * 把 API 的错误码翻译成文案 key。
 *
 * 服务端现在会把数据库约束翻成有意义的码（already_exists / not_found /
 * still_referenced，见 lib/api.ts），前端如果还统一报"保存失败"，
 * 那这层翻译就白做了 —— 用户依然不知道发生了什么。
 */
export function apiErrorKey(err: unknown, fallback = "errors.saveFailed"): string {
  if (!(err instanceof ApiError)) return "errors.networkError";
  switch (err.code) {
    case "already_exists": return "errors.alreadyExists";
    case "not_found": return "errors.goneAlready";
    case "still_referenced": return "errors.stillReferenced";
    case "admin_required": return "auth.required";
    // 请求体没到齐 —— 站在书架前 wifi 抖一下就会这样。
    // 说"服务器错误"会让人以为是站点坏了而放弃；说"重试一次"他就会重试。
    case "bad_body": return "errors.badBody";
    default: return fallback;
  }
}

export const apiGet = <T,>(url: string) => request<T>("GET", url);
export const apiPost = <T,>(url: string, body?: unknown) => request<T>("POST", url, body);
export const apiPatch = <T,>(url: string, body?: unknown) => request<T>("PATCH", url, body);
export const apiDelete = <T,>(url: string, body?: unknown) => request<T>("DELETE", url, body);

export async function uploadFile(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error ?? "upload_failed", res.status, data);
  return data;
}
