import { z } from "zod";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, createSession, destroySession, isAdmin, verifyPassword } from "@/lib/auth";
import { fail, ok, readJson, route } from "@/lib/api";
import { LIMITS, rateLimitCheck, rateLimitFailure } from "@/lib/ratelimit";
import { prisma } from "@/lib/prisma";

export const GET = route(async () => ok({ admin: await isAdmin() }));

const loginSchema = z.object({ password: z.string().min(1) });

export const POST = route(async (req: Request) => {
  // 先看额度（不计数），验完错了才记一笔 —— 成功登录不该占额度
  rateLimitCheck(req, "auth");
  const { password } = loginSchema.parse(await readJson(req));

  if (!(await verifyPassword(password))) {
    rateLimitFailure(req, "auth");
    // 挡住了还不够，得让人知道。**只在真被锁住的那一刻写一次** ——
    // 每次失败都写库等于把爆破放大成数据库写入。
    try {
      rateLimitCheck(req, "auth");
    } catch {
      await prisma.setting.upsert({
        where: { key: "ops.authLockout" },
        create: { key: "ops.authLockout", value: { at: new Date().toISOString(), limit: LIMITS.auth } },
        update: { value: { at: new Date().toISOString(), limit: LIMITS.auth } },
      });
    }
    return fail("wrong_password", 401);
  }

  const token = await createSession(req.headers.get("user-agent") ?? undefined);
  const store = await cookies();
  store.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 生产走 HTTPS（Caddy 终结 TLS），本地 http 时不能加 secure，否则 cookie 存不下
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });

  return ok({ admin: true });
});

export const DELETE = route(async () => {
  await destroySession();
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  return ok({ admin: false });
});
