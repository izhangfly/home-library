"use client";

// 房间命名 —— 户型图导入时自动切出房间，这里给它们起名字。
// 名字会一路带到检索路径里（房间 › 书柜 › 层），所以起得清楚很重要。
//
// 颜色不给选：十几个房间手动配色又慢又容易撞色，改成按序号自动分配
// （黄金角转色相，见 lib/roomColors.ts），任何时候相邻房间都不同色。

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/client";
import { ErrorBanner, LoadFailed, Spinner } from "./ui";
import { IconEdit } from "./icons";

interface Room {
  id: string;
  name: string;
  color: string;
  areaMm2: number;
  bookcases: { id: string; name: string }[];
}

export function RoomsPanel({ floorPlanId, onChanged }: { floorPlanId: string | null; onChanged?: () => void }) {
  const t = useTranslations();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const d = await apiGet<{ rooms: Room[] }>("/api/rooms");
      setRooms(d.rooms);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const redetect = async () => {
    if (!floorPlanId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/rooms", { floorPlanId });
      await load();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "no_rooms_detected"
          ? t("rooms.noneDetected")
          : t("errors.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const save = async (id: string, patch: { name?: string }) => {
    setRooms((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? prev);
    try {
      await apiPatch(`/api/rooms/${id}`, patch);
      await load();
      // 户型图和 3D 都要跟着改名
      onChanged?.();
    } catch {
      setError(t("errors.saveFailed"));
      void load();
    }
  };

  if (failed) {
    return <section className="card p-4"><LoadFailed onRetry={() => void load()} /></section>;
  }

  if (!rooms) {
    return <div className="flex items-center gap-2 p-4 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  const totalM2 = rooms.reduce((s, r) => s + r.areaMm2, 0) / 1e6;
  const empty = rooms.filter((r) => !r.bookcases.length).length;

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-md">{t("rooms.title")}</h2>
          <p className="hint">
            {rooms.length
              ? t("rooms.summary", { count: rooms.length, area: totalM2.toFixed(1), empty })
              : t("rooms.hint")}
          </p>
        </div>
        <button type="button" onClick={() => void redetect()} disabled={busy || !floorPlanId}
          className="btn btn-ghost btn-sm">
          {busy ? <Spinner /> : null}{t("rooms.redetect")}
        </button>
      </div>

      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}

      {rooms.length === 0 ? (
        <p className="hint">{t("rooms.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rooms.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border-2 border-border bg-surface-2 p-2">
              <span className="h-6 w-6 shrink-0 rounded-sm border-2 border-border" style={{ background: r.color }} />

              {editing === r.id ? (
                <input
                  autoFocus
                  className="field h-9 min-h-0 flex-1 py-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { if (draft.trim()) void save(r.id, { name: draft.trim() }); setEditing(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { if (draft.trim()) void save(r.id, { name: draft.trim() }); setEditing(null); }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button type="button" className="flex-1 text-left font-black"
                  onClick={() => { setEditing(r.id); setDraft(r.name); }}>
                  {r.name} <IconEdit className="ml-1 inline h-3.5 w-3.5 text-text-faint" />
                </button>
              )}

              <span className="mono">{(r.areaMm2 / 1e6).toFixed(1)} ㎡</span>
              <span className="hint truncate">
                {r.bookcases.length ? r.bookcases.map((b) => b.name).join("、") : t("rooms.noBookcase")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
