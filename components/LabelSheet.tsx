"use client";

// 书脊标签打印 —— 把索书号从屏幕上搬到书上
//
// 为什么这件事是必须的：整套上架算法建立在索书号的**全序**上 ——
// 哪本书该插在哪两本之间、一层装到哪儿断开、找书时该往哪扫，全靠它。
// 可这个号目前只活在屏幕里。站在书架前，书脊上什么都没有，
// 于是「按索书号排」这条规矩，人是执行不了的：
// 你既看不出眼前这排书是不是还有序，也不知道手里这本该插进哪儿。
// 图书馆的书脊上贴着号，正是为了让顺序变成**看得见**的东西。
//
// 打印用浏览器自带的打印功能：不引 PDF 库，@media print 直接排版，
// 家里那台打印机能出什么纸就用什么纸。

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CLC_CLASS_COLOR, clcMainClass } from "@/lib/clc";
import { readableOn } from "@/lib/contrast";
import { Labeled, PageHeader } from "./ui";

export interface LabelBook {
  id: string;
  title: string;
  authors: string[];
  callNumber: string | null;
  clc: string | null;
  levelId: string | null;
  bookcaseName: string | null;
  roomName: string | null;
  levelIndex: number | null;
}

export interface LabelLevelOption {
  id: string;
  levelIndex: number;
  bookcaseName: string;
  roomName: string | null;
}

/** 常见标签尺寸（毫米）。默认那个是国内图书馆书脊标签的常用规格。 */
const SIZES = {
  spine: { w: 26, h: 36, label: "书脊标签 26×36" },
  small: { w: 40, h: 20, label: "小标签 40×20" },
  wide: { w: 70, h: 25, label: "宽标签 70×25" },
} as const;
type SizeKey = keyof typeof SIZES;

export function LabelSheet({
  books,
  levels,
}: {
  books: LabelBook[];
  levels: LabelLevelOption[];
}) {
  const t = useTranslations();
  const [scope, setScope] = useState<string>("all");
  const [size, setSize] = useState<SizeKey>("spine");
  const [showTitle, setShowTitle] = useState(true);

  const chosen = useMemo(() => {
    // 没有索书号的书印不出标签 —— 印一张空白贴上去毫无意义
    const withNumber = books.filter((b) => b.callNumber);
    if (scope === "all") return withNumber;
    if (scope === "unshelved") return withNumber.filter((b) => !b.levelId);
    return withNumber.filter((b) => b.levelId === scope);
  }, [books, scope]);

  const missing = books.length - books.filter((b) => b.callNumber).length;
  const dim = SIZES[size];

  return (
    <>
      <PageHeader title={t("labels.title")} subtitle={t("labels.hint")} />

      {/* 打印时这一整块要消失，纸上只留标签 */}
      <section className="card mb-4 p-4 print:hidden">
        <div className="grid gap-3 sm:grid-cols-3">
          <Labeled label={t("labels.scope")} htmlFor="lb-scope">
            <select id="lb-scope" className="field" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">{t("labels.scopeAll")}</option>
              <option value="unshelved">{t("labels.scopeUnshelved")}</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.roomName ? `${l.roomName} › ` : ""}{l.bookcaseName} › {t("map.levelLabel", { index: l.levelIndex })}
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label={t("labels.size")} htmlFor="lb-size">
            <select id="lb-size" className="field" value={size} onChange={(e) => setSize(e.target.value as SizeKey)}>
              {Object.entries(SIZES).map(([k, v]) => (
                <option key={k} value={k}>{v.label} mm</option>
              ))}
            </select>
          </Labeled>

          <Labeled label={t("labels.options")}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
              <span>{t("labels.showTitle")}</span>
            </label>
          </Labeled>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => window.print()} className="btn btn-primary">
            {t("labels.print", { count: chosen.length })}
          </button>
          <span className="hint">{t("labels.tip")}</span>
        </div>

        {missing > 0 && (
          <p className="hint mt-2">{t("labels.missingNumber", { count: missing })}</p>
        )}
      </section>

      {chosen.length === 0 ? (
        <p className="hint print:hidden">{t("labels.nothing")}</p>
      ) : (
        <div
          className="spine-sheet"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${dim.w}mm, ${dim.w}mm))` }}
        >
          {chosen.map((b) => {
            const cls = clcMainClass(b.clc);
            const band = (cls && CLC_CLASS_COLOR[cls]) || "#e5e7eb";
            return (
              <div key={b.id} className="spine-label" style={{ width: `${dim.w}mm`, height: `${dim.h}mm` }}>
                {/* 顶端色条：同一大类在架上会连成一片，一眼看得出断在哪儿 */}
                <div className="spine-band" style={{ background: band, color: readableOn(band) }}>
                  {cls ?? "?"}
                </div>
                {/* 索书号竖排成几段，和图书馆书脊标签一样，窄条也放得下 */}
                <div className="spine-call">
                  {(b.callNumber ?? "").split(" ").map((part, i) => (
                    <span key={i}>{part}</span>
                  ))}
                </div>
                {showTitle && <div className="spine-title">{b.title}</div>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
