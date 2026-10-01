// 上架 / 移架 / 取下 —— 不需要管理员密码（F5）
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok, readJson, route } from "@/lib/api";
import { PlaceRejected, placeOne } from "@/lib/placeService";
import { refreshBookDerived } from "@/lib/books";

const placeSchema = z.object({
  bookId: z.string().min(1),
  levelId: z.string().min(1),
  /** 用户已经确认过"确实放得下" */
  confirmedByUser: z.boolean().optional(),
  /** 用户标注"勉强塞下" */
  isNearFull: z.boolean().optional(),
  /** true = 明知临界也要放，跳过服务端拦截 */
  force: z.boolean().optional(),
});

export const POST = route(async (req: Request) => {
  const input = placeSchema.parse(await readJson(req));
  try {
    const { placement, fit } = await placeOne(input);
    return ok({ placement, fit });
  } catch (e) {
    // 业务上的拒绝翻成原来的状态码；别的错继续往上抛给 handleError
    if (e instanceof PlaceRejected) return fail(e.code, e.status, e.fit ? { fit: e.fit } : undefined);
    throw e;
  }
});

export const DELETE = route(async (req: Request) => {
  const bookId = new URL(req.url).searchParams.get("bookId");
  if (!bookId) return fail("missing_bookId", 400);
  await prisma.placement.deleteMany({ where: { bookId } });
  await refreshBookDerived(bookId);
  return ok({ deleted: true });
});
