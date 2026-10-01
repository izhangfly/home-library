import { prisma } from "@/lib/prisma";
import { bookInclude, bookInputSchema, updateBook } from "@/lib/books";
import { fail, ok, readJson, route } from "@/lib/api";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id }, include: bookInclude });
  if (!book) return fail("not_found", 404);
  return ok({ book });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const input = bookInputSchema.partial().parse(await readJson(req));
  const book = await updateBook(id, input);
  return ok({ book });
});

// 删书同样不需要密码（F5：卖书/送人时随手删）
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await prisma.book.delete({ where: { id } });
  return ok({ deleted: true });
});
