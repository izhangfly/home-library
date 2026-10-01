import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/request";
import { isAdmin } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  // neobrutalism 靠字重拉层级：正文 400/500，强调 700，标题 800/900
  weight: ["400", "500", "700", "800", "900"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: t("name"),
    description: t("tagline"),
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: t("name"),
    },
    icons: {
      icon: "/icons/icon.svg",
      apple: "/icons/apple-touch-icon.png",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#fbfbf9",
  width: "device-width",
  initialScale: 1,
  // 扫码时页面被意外缩放很烦，但完全禁止缩放不符合无障碍要求，
  // 所以只设初始比例，保留用户手动缩放的能力。
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale();
  const messages = await getMessages();
  const admin = await isAdmin();

  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"} className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <AppShell admin={admin} locale={locale}>{children}</AppShell>
          <ServiceWorkerRegistrar />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
