"use client";

// 索书号标签 —— 做成书脊标签的样子（等宽字 + 色块），像图书馆那样。
// 颜色按 DDC 大类走，同类书在列表里会自然成片。
import { useTranslations } from "next-intl";
import { CLC_CLASS_COLOR, clcMainClass } from "@/lib/clc";
import { readableOn } from "@/lib/contrast";

export type DdcSourceValue = "openLibrary" | "rules" | "ai" | "manual" | null;
export type ClcSourceValue = "rules" | "ai" | "manual" | null;

export function CallNumber({
  callNumber,
  clc,
  source,
  size = "sm",
  showSource,
}: {
  callNumber?: string | null;
  /** 中图法号。以前这个参数叫 ddc —— 但传进来的一直是中图法，
   *  下面 clcMainClass() 就是证据。名字是 DDC 时代的遗留。 */
  clc?: string | null;
  source?: DdcSourceValue;
  size?: "sm" | "lg";
  showSource?: boolean;
}) {
  const t = useTranslations();
  if (!callNumber && !clc) {
    return <span className="chip">{t("callNumber.none")}</span>;
  }

  const main = clcMainClass(clc ?? callNumber);
  const color = (main && CLC_CLASS_COLOR[main]) || "#6B7280";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block rounded-sm border-2 border-border font-mono font-bold tabular-nums ${
          size === "lg" ? "px-2.5 py-1 text-sm" : "px-1.5 py-0.5 text-2xs"
        }`}
        style={{ background: color, color: readableOn(color) }}
        title={t("callNumber.callNumber")}
      >
        {callNumber ?? clc}
      </span>
      {showSource && source && (
        // 权威号和推断号必须能一眼分开 —— 推断的可能是错的
        <span className={`chip ${source === "openLibrary" ? "chip-ok" : "chip-warn"}`}>
          {t(`callNumber.source.${source}`)}
        </span>
      )}
    </span>
  );
}
