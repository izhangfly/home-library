"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { setLocale } from "@/app/actions";
import type { Locale } from "@/i18n/request";
import {
  IconBooks, IconGlobe, IconHome, IconMap, IconScan, IconSettings, IconShelf, IconTag, IconWarn,
} from "./icons";

interface NavItem {
  href: string;
  key: "home" | "scan" | "books" | "map" | "shelves" | "settings" | "reflow" | "space" | "labels";
  Icon: (p: { className?: string }) => React.ReactElement;
  /** 手机底栏只放最常用的几个，其余在桌面侧栏 */
  mobile?: boolean;
}

// 菜单里每一项对应一件独立的事，不重复：
//   书架地图 = 一个柜子一个柜子看（立面 + 装填）
//   3D 空间  = 整屋看（平面 ⇄ 3D，走进房间）
//   整理     = 盘点现状 + 按现状给搬动建议（原来是两个菜单项）
//   标签已并入设置，分类由中图法自动完成，不需要一级入口
const NAV: NavItem[] = [
  { href: "/", key: "home", Icon: IconHome, mobile: true },
  { href: "/scan", key: "scan", Icon: IconScan, mobile: true },
  { href: "/books", key: "books", Icon: IconBooks, mobile: true },
  { href: "/map", key: "map", Icon: IconMap, mobile: true },
  { href: "/space", key: "space", Icon: IconShelf, mobile: true },
  { href: "/reflow", key: "reflow", Icon: IconWarn },
  { href: "/labels", key: "labels", Icon: IconTag },
  { href: "/shelves", key: "shelves", Icon: IconShelf },
  { href: "/settings", key: "settings", Icon: IconSettings },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({
  children,
  admin,
  locale,
}: {
  children: React.ReactNode;
  admin: boolean;
  locale: Locale;
}) {
  const t = useTranslations();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const toggleLocale = () => {
    startTransition(() => {
      void setLocale(locale === "zh" ? "en" : "zh");
    });
  };

  return (
    <div className="min-h-dvh md:flex">
      {/* 桌面侧栏 —— 宽屏走管理后台布局，而不是把手机竖屏硬拉伸 (F7) */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:gap-1 md:border-r md:border-border md:bg-surface-1 md:p-4">
        <Link href="/" className="mb-6 block px-2">
          <div className="text-md font-black tracking-tight">{t("app.name")}</div>
          <div className="hint">{t("app.tagline")}</div>
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, key, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-xs font-black transition-colors ${
                  active
                    // 主色是黄的（#FDC800）：黄底白字只有 1.56:1，
                    // 而当前页那一项恰恰是每个页面都在的。用墨色，约 10:1。
                    ? "bg-primary text-text"
                    : "text-text-muted hover:bg-surface-2 hover:text-text"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {t(`nav.${key}`)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col items-start gap-2 pt-4">
          {admin && <span className="chip chip-info">{t("auth.loggedIn")}</span>}
          <button
            type="button"
            onClick={toggleLocale}
            disabled={pending}
            className="btn btn-ghost btn-sm w-full justify-start"
          >
            <IconGlobe className="h-4 w-4" />
            {locale === "zh" ? "English" : "中文"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 手机顶栏 */}
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 md:hidden">
          <Link href="/" className="text-sm font-black tracking-tight">
            {t("app.name")}
          </Link>
          <button
            type="button"
            onClick={toggleLocale}
            disabled={pending}
            aria-label={t("settings.language")}
            className="btn btn-ghost btn-sm"
          >
            <IconGlobe className="h-4 w-4" />
            {locale === "zh" ? "EN" : "中"}
          </button>
        </header>

        {/* pb-24 给底栏让位 */}
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-10 md:pt-8">
          {children}
        </main>
      </div>

      {/* 手机底栏 */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface-1/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV.filter((n) => n.mobile).map(({ href, key, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-2xs font-black ${
                active ? "text-primary" : "text-text-faint"
              }`}
            >
              <Icon className="h-5 w-5" />
              {t(`nav.${key}`)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
