"use client";

// 目录路径：房间 › 书柜 › 层 › 索书号 › 类目
// 用户要的是"像图书馆索引一样，一眼知道去哪儿拿"，所以这一串要在
// 检索结果、书目列表、详情页三处都出现，格式保持一致。

import { useTranslations } from "next-intl";
import { clcLabel } from "@/lib/clc";

export interface DirectoryInfo {
  room?: string | null;
  bookcaseName?: string | null;
  levelIndex?: number | null;
  callNumber?: string | null;
  clc?: string | null;
}

export function DirectoryPath({
  info,
  size = "sm",
}: {
  info: DirectoryInfo;
  size?: "sm" | "lg";
}) {
  const t = useTranslations();
  const label = clcLabel(info.clc, "zh");

  if (!info.bookcaseName) {
    return <span className="chip chip-warn">{t("book.notPlaced")}</span>;
  }

  const parts = [
    info.room || null,
    info.bookcaseName,
    info.levelIndex != null ? t("map.levelLabel", { index: info.levelIndex }) : null,
  ].filter(Boolean) as string[];

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 font-mono ${
        size === "lg" ? "text-xs" : "text-2xs"
      }`}
    >
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-text-faint">›</span>}
          <span className={i === parts.length - 1 ? "font-bold" : "text-text-muted"}>{p}</span>
        </span>
      ))}
      {label && (
        <>
          <span className="text-text-faint">·</span>
          <span className="text-text-muted">{label}</span>
        </>
      )}
    </span>
  );
}
