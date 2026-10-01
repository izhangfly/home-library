import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // 不用 standalone：Prisma 7 的 query compiler 和 sharp 的原生二进制都要靠
  // 文件追踪才能进产物，出问题排查成本高。服务器磁盘够，直接带完整
  // node_modules 跑 `next start` 更省心。
  images: {
    // 封面图来自各数据源的 CDN
    remotePatterns: [
      { protocol: "https", hostname: "**.doubanio.com" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
    ],
  },
};

export default withNextIntl(nextConfig);
