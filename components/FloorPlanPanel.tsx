"use client";

// 户型图管理：上传 DXF、在图上拖动书柜定位、随时切到 3D 看一眼。
// 放在「书架结构」页里，受管理员密码保护。
//
// 图本身由 <MapPanel> 画（平面/3D 共用同一份数据），这里只管上传、替换、删除。
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiDelete, apiPatch, ApiError } from "@/lib/client";
import { MapPanel, useSpaceData } from "./MapPanel";
import { ErrorBanner, LoadFailed, Spinner } from "./ui";
import { IconPlus, IconTrash } from "./icons";

interface UploadStats {
  shapes: number;
  widthMm: number;
  depthMm: number;
  sourceUnits: string;
  layers: string[];
}

export function FloorPlanPanel({
  onPlanLoaded,
  onChanged,
}: {
  onPlanLoaded?: (id: string | null) => void;
  /** 书柜被拖动/旋转后通知外层，让房间归属、立面图之类跟着刷新 */
  onChanged?: () => void;
} = {}) {
  const t = useTranslations();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, failed, reload } = useSpaceData();
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<UploadStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const plan = data?.plan ?? null;

  useEffect(() => {
    if (data) onPlanLoaded?.(data.plan?.id ?? null);
  }, [data, onPlanLoaded]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setStats(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (plan) form.append("replaceId", plan.id);
      const res = await fetch("/api/floorplan", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error === "no_geometry" ? t("floorplan.parseFailed") : t("errors.saveFailed"));
        return;
      }
      setStats(body.stats);
      await reload();
      onChanged?.();
    } catch {
      setError(t("errors.networkError"));
    } finally {
      setBusy(false);
    }
  };

  /** 拖完立刻存，不用再点保存 —— 摆位这种操作要即时反馈 */
  const moveBookcase = useCallback(
    async (id: string, x: number, y: number) => {
      try {
        await apiPatch(`/api/bookcases/${id}`, { roomX: x, roomY: y });
      } catch (err) {
        setError(err instanceof ApiError && err.code === "admin_required" ? t("auth.required") : t("errors.saveFailed"));
      }
      await reload();
      onChanged?.();
    },
    [reload, onChanged, t],
  );

  const rotateBookcase = useCallback(
    async (id: string, deg: number) => {
      try {
        await apiPatch(`/api/bookcases/${id}`, { rotation: deg });
      } catch {
        setError(t("errors.saveFailed"));
      }
      await reload();
    },
    [reload, t],
  );

  /** 在图上改房间名 —— 认图形一秒，对颜色一分钟 */
  const renameRoom = useCallback(
    async (id: string, name: string) => {
      try {
        await apiPatch(`/api/rooms/${id}`, { name });
      } catch {
        setError(t("errors.saveFailed"));
      }
      await reload();
      onChanged?.();
    },
    [reload, onChanged, t],
  );

  const remove = async () => {
    if (!plan || !confirm(t("floorplan.deleteConfirm"))) return;
    await apiDelete(`/api/floorplan?id=${plan.id}`);
    setStats(null);
    await reload();
    onChanged?.();
  };

  if (failed) {
    return <section className="card p-4"><LoadFailed onRetry={() => void reload()} /></section>;
  }

  if (!data) {
    return <div className="flex items-center gap-2 p-4 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-md">{t("floorplan.title")}</h2>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".dxf,application/dxf,image/vnd.dxf"
            className="sr-only"
            // 视觉上藏起来、靠上面那个按钮触发，但读屏软件照样会念到它
            aria-label={plan ? t("floorplan.replace") : t("floorplan.upload")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="btn btn-primary btn-sm"
          >
            {busy ? <Spinner /> : <IconPlus className="h-4 w-4" />}
            {plan ? t("floorplan.replace") : t("floorplan.upload")}
          </button>
          {plan && (
            <button type="button" onClick={() => void remove()} className="btn btn-ghost btn-sm" aria-label={t("common.delete")}>
              <IconTrash className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      {stats && (
        <p className="mono mb-3">
          {t("floorplan.stats", {
            shapes: stats.shapes,
            width: stats.widthMm,
            depth: stats.depthMm,
            units: stats.sourceUnits,
          })}
        </p>
      )}

      <MapPanel
        data={data}
        editable
        onMove={moveBookcase}
        onRotate={rotateBookcase}
        onRenameRoom={renameRoom}
        className="h-[460px]"
      />
    </section>
  );
}
