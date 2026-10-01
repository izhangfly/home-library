import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  levelIndex: z.number().int().positive().optional(),
  widthMm: z.number().int().positive().optional(),
  heightMm: z.number().int().positive().optional(),
  depthMm: z.number().int().positive().optional(),
  note: z.string().trim().optional().nullable(),
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  const input = patchSchema.parse(await readJson(req));
  const level = await prisma.level.update({ where: { id }, data: input });
  return ok({ level });
});


/**
 * 有书就先拦一道 —— 和"放一本书到临界层"用的是同一套规矩。
 *
 * 这个应用为了**一本**书放进快满的层，会返回 409 让用户确认（spec 硬性要求）。
 * 而删一个书柜会级联删掉它所有层、所有上架关系 —— 一次可能是几百本 ——
 * 服务端却一道拦截都没有，界面上那句提示还是**不带数字**的：
 * 「层上的书会变成未上架」。柜子里是 0 本还是 200 本，这句话长得一模一样，
 * 而这两种情况一个是随手操作、一个是灾难。人只会一路点确定。
 *
 * 而且客户端的 confirm 挡不住任何东西：CLAUDE.md 里已经记着一次教训 ——
 * 只放在客户端的判断，换个调用方就没了。
 *
 * 拦截而不是禁止：柜子拆了重建是正常需求，只是要**知道自己在删什么**。
 */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  await requireAdmin();
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";

  const books = await prisma.placement.count({ where: { levelId: id } });
  if (books > 0 && !force) return fail("has_books", 409, { books });

  await prisma.level.delete({ where: { id } });
  return ok({ deleted: true, unshelved: books });
});
