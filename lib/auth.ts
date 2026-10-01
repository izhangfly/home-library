// 管理员会话 —— F5
//
// 权限只有两级，刻意做得很浅：
//   加书 / 删书 / 上架   → 任何人，不需要密码（妹妹也要能扫码）
//   改书架和层的结构     → 需要管理员密码（避免误改把整个容量模型带偏）

import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";

export const ADMIN_COOKIE = "hl_admin";
const SESSION_DAYS = 30;

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

function constantTimeEquals(a: string, b: string): boolean {
  // 先 hash 成等长再比，避免长度不同时 timingSafeEqual 抛异常
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function verifyPassword(password: string): Promise<boolean> {
  return constantTimeEquals(password, adminPassword());
}

/**
 * 同时最多保留几个有效会话。
 *
 * 只清过期的是不够的：会话有效期 30 天，每登录一次就多一把钥匙，
 * 30 天内全都有效。实测这个库里攒到过 32 条，其中 31 条是自动化测试留下的 ——
 * 也就是三十多把管理员钥匙散在外面，没人记得它们存在。
 * 家里三个人几台设备，10 把够用了；超出就把最老的挤掉。
 */
const MAX_LIVE_SESSIONS = 10;

export async function createSession(userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000);
  await prisma.adminSession.create({ data: { token, expiresAt, userAgent } });

  // 过期的直接清掉
  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  // 还有效但超出上限的，把最老的挤掉 —— 钥匙的数量必须有个头
  const extra = await prisma.adminSession.findMany({
    orderBy: { createdAt: "desc" },
    skip: MAX_LIVE_SESSIONS,
    select: { token: true },
  });
  if (extra.length) {
    await prisma.adminSession.deleteMany({ where: { token: { in: extra.map((e) => e.token) } } });
  }
  return token;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const session = await prisma.adminSession.findUnique({ where: { token } });
  return !!session && session.expiresAt > new Date();
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;
  if (token) await prisma.adminSession.deleteMany({ where: { token } });
}

/** 在 route handler 里用：非管理员直接抛出 401 响应 */
export class AdminRequiredError extends Error {
  constructor() {
    super("admin_required");
  }
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new AdminRequiredError();
}
