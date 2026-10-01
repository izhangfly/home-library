// PWA manifest —— F7
// 走 route handler 而不是静态文件，是为了让 name/description 跟随界面语言。
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const t = await getTranslations("app");

  const manifest = {
    name: t("name"),
    short_name: t("name"),
    description: t("tagline"),
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfbf9",
    theme_color: "#fbfbf9",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // 长按图标直接进扫码 —— 建库时最高频的入口
    shortcuts: [
      { name: t("name"), short_name: "Scan", url: "/scan" },
    ],
  };

  return Response.json(manifest, {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
