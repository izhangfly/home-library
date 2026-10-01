import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCoefficients } from "@/lib/settings";
import { resolveLocale } from "@/i18n/request";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TagsManager } from "@/components/TagsManager";
import { CalibratePanel } from "@/components/CalibratePanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [admin, coefficients, locale, levels] = await Promise.all([
    isAdmin(),
    getCoefficients(),
    resolveLocale(),
    prisma.level.findMany({
      orderBy: [{ bookcase: { sortKey: "asc" } }, { levelIndex: "asc" }],
      select: {
        id: true,
        levelIndex: true,
        widthMm: true,
        bookcase: { select: { name: true } },
      },
    }),
  ]);

  const sources = {
    douban: process.env.DOUBAN_ENABLED !== "false",
    openLibrary: process.env.OPENLIBRARY_ENABLED !== "false",
    googleBooks: !!process.env.GOOGLE_BOOKS_API_KEY,
    wanzhou: !!process.env.WANZHOU_BASE_URL,
  };

  return (
    <>
      <SettingsPanel
        admin={admin}
        locale={locale}
        coefficients={coefficients}
        sources={sources}
      />
      {/* 容量模型的系数原本是猜的。这里让用户拿卷尺给出真实数据，反推系数。 */}
      <div className="mt-8">
        <CalibratePanel levels={levels} />
      </div>

      {/* 标签原来是一级菜单，但分类已经由中图法自动完成，标签只剩"状态、来源"
          这类分类法表达不了的事，放在设置里更合适 */}
      <div id="tags" className="mt-8 scroll-mt-8">
        <TagsManager levels={levels} />
      </div>
    </>
  );
}
