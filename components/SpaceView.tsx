"use client";

// 3D 空间独立页 —— 整屋 → 点房间进去 → 左右翻书架。
// 画图交给 <MapPanel>（和「书架结构」「书架地图」是同一个组件），这里只管进入 3D。

import { useTranslations } from "next-intl";
import Link from "next/link";
import { MapPanel, useSpaceData } from "./MapPanel";
import { EmptyState, LoadFailed, PageHeader, Spinner } from "./ui";

export function SpaceView() {
  const t = useTranslations();
  const { data, failed, reload } = useSpaceData();

  if (failed) {
    return (
      <>
        <PageHeader title={t("scene.title")} />
        <LoadFailed onRetry={() => void reload()} />
      </>
    );
  }

  if (!data) {
    return <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  if (!data.plan && !data.bookcases.length) {
    return (
      <>
        <PageHeader title={t("scene.title")} />
        <EmptyState
          title={t("floorplan.none")}
          hint={t("floorplan.noneHint")}
          action={<Link href="/shelves" className="btn btn-primary">{t("nav.shelves")}</Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("scene.title")}
        subtitle={t("scene.pageHint", { rooms: data.rooms.length, shelves: data.bookcases.length })}
      />
      <MapPanel data={data} defaultView="3d" className="h-[78vh] min-h-[460px]" />
    </>
  );
}
