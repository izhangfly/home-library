"use client";

// 空间面板 —— 户型平面与 3D 是同一份数据的两种画法，所以合成一个组件。
//
// 之前平面图在「书架结构」里、3D 在「3D 空间」页里、「书架地图」里又各有一份，
// 三处各自取数、各自渲染，改一处另外两处就不同步。现在只有这一个入口，
// 哪个页面要地图就摆一个 <MapPanel />，带不带编辑能力由 props 决定。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/client";
import { FloorPlanView, type FloorPlanData, type PlanRoom } from "./FloorPlanView";
import { Scene3D, type SceneBookcase } from "./Scene3D";
import { LoadFailed, Spinner } from "./ui";

export type SpaceView = "plan" | "3d";

export interface SpaceData {
  plan: FloorPlanData | null;
  rooms: PlanRoom[];
  bookcases: SceneBookcase[];
}

/** 整屋数据：户型图 + 房间 + 书柜（含每层的书）。三个页面共用同一次取数逻辑。 */
export function useSpaceData() {
  const [data, setData] = useState<SpaceData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      // /api/map 以前没有 catch —— 它一挂，Promise.all 整个挂掉，
      // data 永远停在 null，界面就永远转圈。离线时必然触发。
      const [m, p, r] = await Promise.all([
        apiGet<{ bookcases: SceneBookcase[] }>("/api/map"),
        apiGet<{ plans: FloorPlanData[] }>("/api/floorplan").catch(() => ({ plans: [] })),
        apiGet<{ rooms: PlanRoom[] }>("/api/rooms").catch(() => ({ rooms: [] })),
      ]);
      setData({ plan: p.plans[0] ?? null, rooms: r.rooms, bookcases: m.bookcases });
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, failed, reload: load };
}

export function MapPanel({
  data,
  defaultView = "plan",
  editable = false,
  onMove,
  onRotate,
  onSelect,
  onRenameRoom,
  highlightId,
  highlightBookId,
  className = "h-[420px]",
  /** 顶栏右侧再挂几个按钮（上传户型图之类） */
  extraActions,
}: {
  data: SpaceData;
  defaultView?: SpaceView;
  editable?: boolean;
  onMove?: (id: string, x: number, y: number) => void;
  onRotate?: (id: string, deg: number) => void;
  onSelect?: (id: string) => void;
  /** 在图上直接给房间改名（只有编辑态的地方传） */
  onRenameRoom?: (id: string, name: string) => void;
  highlightId?: string;
  highlightBookId?: string;
  className?: string;
  extraActions?: React.ReactNode;
}) {
  const t = useTranslations();
  const [view, setView] = useState<SpaceView>(defaultView);
  const { plan, rooms, bookcases } = data;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={t("scene.title")}>
          {(["plan", "3d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`btn btn-sm ${view === v ? "btn-primary" : "btn-ghost"}`}
            >
              {v === "plan" ? t("map.roomView") : t("scene.open")}
            </button>
          ))}
        </div>
        {extraActions}
      </div>

      {!plan && !bookcases.length ? (
        <div className="rounded-md border-2 border-dashed border-border p-6 text-center">
          <p className="font-black">{t("floorplan.none")}</p>
          <p className="hint mt-1">{t("floorplan.noneHint")}</p>
        </div>
      ) : view === "3d" ? (
        <Scene3D plan={plan} bookcases={bookcases} rooms={rooms} highlightBookId={highlightBookId} className={className} />
      ) : plan ? (
        <FloorPlanView
          plan={plan}
          bookcases={bookcases}
          rooms={rooms}
          highlightId={highlightId}
          onMove={editable ? onMove : undefined}
          onRotate={editable ? onRotate : undefined}
          onSelect={onSelect}
          onRenameRoom={onRenameRoom}
          className={className}
        />
      ) : (
        // 没有户型图时平面图无从画起，直接给 3D —— 书柜坐标本身还是有的
        <Scene3D plan={null} bookcases={bookcases} rooms={rooms} highlightBookId={highlightBookId} className={className} />
      )}
    </div>
  );
}

/** 自己取数的版本，页面里一行就能用 */
export function MapPanelAuto(props: Omit<React.ComponentProps<typeof MapPanel>, "data">) {
  const t = useTranslations();
  const { data, failed, reload } = useSpaceData();
  if (failed) return <LoadFailed onRetry={() => void reload()} />;
  if (!data) {
    return <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }
  return <MapPanel {...props} data={data} />;
}
