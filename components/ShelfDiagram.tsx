"use client";

// 「这本书该放哪」的几何图。
//
// 光说"客厅大书柜 第 3 层"还不够 —— 站在屋里你得知道是哪个柜子、柜子在哪面墙、
// 第 3 层大概齐腰还是齐眼。所以并排画两张：
//   1. 书柜立面（<BookcaseElevation>）：目标层高亮，标出离地高度和舒适取书区
//   2. 整屋（<MapPanel>）：平面/3D 可切，目标柜子高亮
// 两张图都不是这里自己画的 —— 和「书架地图」「书架结构」用的是同一套组件，
// 免得三处画法各写一遍、各自跑偏。

import { useTranslations } from "next-intl";
import { BookcaseElevation, type ElevationBookcase } from "./BookcaseElevation";
import { MapPanel, type SpaceData } from "./MapPanel";

export function ShelfDiagram({
  space,
  targetBookcaseId,
  targetLevelId,
  highlightBookId,
}: {
  space: SpaceData;
  targetBookcaseId: string;
  targetLevelId: string;
  highlightBookId?: string;
}) {
  const t = useTranslations();
  const target = space.bookcases.find((b) => b.id === targetBookcaseId);
  if (!target) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <figure className="card p-3">
        <figcaption className="mb-2">
          <span className="section-title">{t("map.shelfView")}</span>
          <p className="font-black">{target.name}</p>
        </figcaption>
        <BookcaseElevation
          bookcase={target as unknown as ElevationBookcase}
          targetLevelId={targetLevelId}
          highlightBookId={highlightBookId}
          className="h-72"
        />
      </figure>

      <figure className="card p-3">
        <figcaption className="mb-2">
          <span className="section-title">{t("floorplan.title")}</span>
          <p className="font-black">{target.room || target.name}</p>
        </figcaption>
        <MapPanel
          data={space}
          highlightId={targetBookcaseId}
          highlightBookId={highlightBookId}
          className="h-72"
        />
      </figure>
    </div>
  );
}
