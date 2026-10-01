// F1 —— 条码 → 元数据
//
// 一个入口把三件事做完：解析条码、查重、多源查询并合并。
// 前端拿到的响应足以决定下一步走哪条路（已存在 / 手动录入 / 冲突选择）。
import { parseBarcode } from "@/lib/isbn";
import { lookupByIsbn, searchAllProviders, PROVIDER_LABELS } from "@/lib/providers";
import { prisma } from "@/lib/prisma";
import { bookInclude } from "@/lib/books";
import { fail, ok, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";

export const GET = route(async (req: Request) => {
  rateLimit(req, "lookup");
  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  const q = url.searchParams.get("q")?.trim();

  // 书名/作者搜索 —— 给没有条码或条码磨损的书用
  if (!code && q) {
    const { results, candidates } = await searchAllProviders(q);
    return ok({ mode: "search", candidates, results, labels: PROVIDER_LABELS });
  }

  if (!code) return fail("missing_code", 400);

  const parsed = parseBarcode(code);

  if (!parsed.valid) {
    return ok({ mode: "barcode", parsed, existing: null, lookup: null });
  }

  // 期刊(ISSN)和乐谱(ISMN)：数据源不覆盖，直接引导手动录入，不浪费一次联网查询
  if (parsed.kind !== "isbn" || !parsed.isbn13) {
    // 期刊靠 (ISSN + 期号) 才能区分是哪一期。
    //
    // 但期号不一定读得到：EAN 后面那 2/5 位附加码只有 zxing 读得出来，
    // 浏览器原生的 BarcodeDetector 根本不支持附加码（见 components/Scanner.tsx）。
    // 于是在 Chrome/Android 上 addon 恒为 null，如果照旧拿
    // `{ issn, issnAddon: null }` 去查重，第二期就会被判成"已经在库里了"而拒收 ——
    // **一本杂志永远只能存进一期**，而且在 iPhone 上又是好的，同一个应用两种行为。
    //
    // 所以：期号读到了才算"同一期"；没读到只报"同一份刊物"，让人自己填期号。
    const existing =
      parsed.issn && parsed.addon
        ? await prisma.book.findFirst({
            where: { issn: parsed.issn, issnAddon: parsed.addon },
            include: bookInclude,
          })
        : null;
    const sameSeries =
      parsed.issn && !parsed.addon
        ? await prisma.book.findFirst({
            where: { issn: parsed.issn },
            select: { id: true, title: true, issnAddon: true },
            orderBy: { createdAt: "desc" },
          })
        : null;
    return ok({ mode: "barcode", parsed, existing, sameSeries, lookup: null });
  }

  const existing = await prisma.book.findUnique({
    where: { isbn13: parsed.isbn13 },
    include: bookInclude,
  });

  const lookup = await lookupByIsbn(parsed.isbn13, parsed.isbn10);

  return ok({ mode: "barcode", parsed, existing, lookup, labels: PROVIDER_LABELS });
});
