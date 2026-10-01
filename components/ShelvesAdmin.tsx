"use client";

// 书架结构管理 —— F3 的静态部分（尺寸录入）+ F5 的受保护区
//
// 这一页是"房子 → 房间 → 书柜 → 层"这条链的唯一编辑入口：
// 上面是整屋（平面图 / 3D 可切），下面是每个书柜的立面图和层尺寸。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiDelete, apiErrorKey, apiGet, apiPatch, apiPost } from "@/lib/client";
import { EmptyState, ErrorBanner, Labeled, Modal, PageHeader, Spinner } from "./ui";
import { LogoutButton } from "./AdminGate";
import { FloorPlanPanel } from "./FloorPlanPanel";
import { RoomsPanel } from "./RoomsPanel";
import { BookcaseElevation, type ElevationBook, type ElevationLevel } from "./BookcaseElevation";
import { IconEdit, IconPlus, IconTrash } from "./icons";

interface Level {
  id: string;
  levelIndex: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  note: string | null;
  _count?: { placements: number };
}

interface Bookcase {
  id: string;
  name: string;
  room: string | null;
  roomId: string | null;
  roomX: number;
  roomY: number;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  color: string;
  rotation: number;
  note: string | null;
  levels: Level[];
}

/** /api/map 里每层的占用情况，用来给立面图填内容 */
interface MapLevel {
  id: string;
  books: ElevationBook[];
  usage: {
    usableMm: number; usedMm: number; remainingMm: number;
    fillRatio: number; bookCount: number; estimatedCount: number;
  };
}

interface RoomOption {
  id: string;
  name: string;
  color: string;
  areaMm2: number;
}

const emptyBookcase = { name: "", roomId: "", note: "",
  widthMm: "800", depthMm: "300", heightMm: "2000", color: "#432DD7" };

// 和标签用同一组高饱和色，书柜在户型图/3D 里才好区分
const BC_COLORS = ["#432DD7", "#DC2626", "#16A34A", "#F97316", "#0EA5E9", "#EC4899", "#7C3AED"];
const emptyLevel = { levelIndex: "1", widthMm: "800", heightMm: "300", depthMm: "280", note: "" };

export function ShelvesAdmin() {
  const t = useTranslations();
  const router = useRouter();
  const [bookcases, setBookcases] = useState<Bookcase[] | null>(null);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  // 立面图要画装填情况，得知道每层实际放了哪些书 —— /api/bookcases 只给结构
  const [occupancy, setOccupancy] = useState<Map<string, MapLevel>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const [bcForm, setBcForm] = useState<typeof emptyBookcase & { id?: string }>(emptyBookcase);
  const [bcOpen, setBcOpen] = useState(false);
  const [lvForm, setLvForm] = useState<typeof emptyLevel & { id?: string; bookcaseId?: string }>(emptyLevel);
  const [lvOpen, setLvOpen] = useState(false);
  const [transfer, setTransfer] = useState<Bookcase | null>(null);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [planNonce, setPlanNonce] = useState(0);

  const load = useCallback(async () => {
    const [data, roomRes, mapRes] = await Promise.all([
      apiGet<{ bookcases: Bookcase[] }>("/api/bookcases"),
      apiGet<{ rooms: RoomOption[] }>("/api/rooms").catch(() => ({ rooms: [] })),
      apiGet<{ bookcases: { levels: MapLevel[] }[] }>("/api/map").catch(() => ({ bookcases: [] })),
    ]);
    setBookcases(data.bookcases);
    setRooms(roomRes.rooms);
    setOccupancy(new Map(mapRes.bookcases.flatMap((bc) => bc.levels.map((l) => [l.id, l]))));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roomName = useMemo(
    () => new Map(rooms.map((r) => [r.id, r.name])),
    [rooms],
  );

  const refreshAll = useCallback(async () => {
    await load();
    setPlanNonce((n) => n + 1);
    router.refresh();
  }, [load, router]);

  const saveBookcase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bcForm.name.trim()) return setError(t("errors.validation"));
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: bcForm.name.trim(),
        roomId: bcForm.roomId || null,
        widthMm: Number(bcForm.widthMm) || null,
        depthMm: Number(bcForm.depthMm) || null,
        heightMm: Number(bcForm.heightMm) || null,
        color: bcForm.color,
        note: bcForm.note.trim() || null,
      };
      if (bcForm.id) await apiPatch(`/api/bookcases/${bcForm.id}`, payload);
      else await apiPost("/api/bookcases", payload);
      setBcOpen(false);
      setBcForm(emptyBookcase);
      await refreshAll();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 转移到另一个房间 —— 平面图上拖不出房间，换房间只能走这里 */
  const doTransfer = async (roomId: string) => {
    if (!transfer) return;
    setBusy(true);
    try {
      await apiPatch(`/api/bookcases/${transfer.id}`, { roomId });
      setTransfer(null);
      await refreshAll();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const saveLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    const width = Number(lvForm.widthMm);
    const height = Number(lvForm.heightMm);
    if (!(width > 0) || !(height > 0)) return setError(t("errors.levelDimensionsRequired"));

    setBusy(true);
    setError(null);
    try {
      const payload = {
        levelIndex: Number(lvForm.levelIndex) || 1,
        widthMm: width,
        heightMm: height,
        depthMm: Number(lvForm.depthMm) || 280,
        note: lvForm.note.trim() || null,
      };
      if (lvForm.id) await apiPatch(`/api/levels/${lvForm.id}`, payload);
      else await apiPost("/api/levels", { ...payload, bookcaseId: lvForm.bookcaseId });
      setLvOpen(false);
      await refreshAll();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 删之前先问服务端"这里面有多少本书"。
   *
   * 以前是本地 confirm 一句「层上的书会变成未上架」就删了 ——
   * 柜子里是 0 本还是 200 本，那句话长得一模一样，人只会一路点确定。
   * 现在第一次请求不带 force：服务端有书就回 409 并带上本数，
   * 拿到真实数字再问一次，用户确认了才带 force 重发。
   */
  const removeWithCount = async (url: string, emptyKey: string, countKey: string) => {
    try {
      await apiDelete(url);
      await refreshAll();
    } catch (err) {
      const books = err instanceof ApiError && err.code === "has_books"
        ? (err.payload as { books?: number } | undefined)?.books ?? 0
        : -1;
      if (books < 0) { setError(t(apiErrorKey(err))); return; }
      if (!confirm(t(countKey, { count: books }))) return;
      await apiDelete(`${url}?force=1`);
      await refreshAll();
    }
  };

  const removeBookcase = async (id: string) => {
    if (!confirm(t("shelves.deleteBookcaseConfirm"))) return;
    await removeWithCount(`/api/bookcases/${id}`, "", "shelves.deleteBookcaseHasBooks");
  };

  const removeLevel = async (id: string) => {
    if (!confirm(t("shelves.deleteLevelConfirm"))) return;
    await removeWithCount(`/api/levels/${id}`, "", "shelves.deleteLevelHasBooks");
  };

  if (!bookcases) {
    return <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  return (
    <>
      <PageHeader
        title={t("shelves.title")}
        subtitle={t("shelves.adminOnly")}
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => { setBcForm(emptyBookcase); setBcOpen(true); }}
            >
              <IconPlus className="h-4 w-4" /> {t("shelves.addBookcase")}
            </button>
            <LogoutButton />
          </>
        }
      />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      <div className="mb-4 flex flex-col gap-4">
        <FloorPlanPanel key={planNonce} onPlanLoaded={setPlanId} onChanged={refreshAll} />
        <RoomsPanel floorPlanId={planId} onChanged={refreshAll} />
      </div>

      {bookcases.length === 0 ? (
        <EmptyState title={t("map.noBookcases")} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {bookcases.map((bc) => (
            <section key={bc.id} className="card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-md">{bc.name}</h2>
                  <p className="hint">
                    {(bc.roomId && roomName.get(bc.roomId)) || bc.room || t("shelves.noRoom")} ·{" "}
                    {t("shelves.levelCount", { count: bc.levels.length })} ·{" "}
                    {t("shelves.totalWidth")}{" "}
                    {bc.levels.reduce((sum, l) => sum + l.widthMm, 0)} mm
                  </p>
                </div>
                <div className="flex gap-1">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTransfer(bc)}>
                    {t("shelves.transfer")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setBcForm({
                        id: bc.id,
                        name: bc.name,
                        roomId: bc.roomId ?? "",
                        widthMm: String(bc.widthMm ?? 800),
                        depthMm: String(bc.depthMm ?? 300),
                        heightMm: String(bc.heightMm ?? 2000),
                        color: bc.color ?? "#432DD7",
                        note: bc.note ?? "",
                      });
                      setBcOpen(true);
                    }}
 aria-label={t("common.edit")}>
                    <IconEdit className="h-4 w-4" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeBookcase(bc.id)} aria-label={t("common.delete")}>
                    <IconTrash className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 立面图 —— 层的真实几何一眼可见，比一行行数字好核对得多 */}
              {bc.levels.length > 0 && (
                <div className="mb-3">
                  <BookcaseElevation
                    bookcase={{
                      id: bc.id,
                      name: bc.name,
                      widthMm: bc.widthMm,
                      heightMm: bc.heightMm,
                      // 结构来自 /api/bookcases，装填来自 /api/map ——
                      // 少了后者，立面图会把每一层都画成空的（明明下面写着"1 本"）
                      levels: bc.levels.map((l) => ({
                        ...l,
                        books: occupancy.get(l.id)?.books ?? [],
                        usage: occupancy.get(l.id)?.usage,
                      })) as ElevationLevel[],
                    }}
                    className="h-56"
                    showReachBand
                  />
                </div>
              )}

              <div className="flex flex-col-reverse gap-1.5">
                {bc.levels.map((level) => (
                  <div
                    key={level.id}
                    className="flex items-center gap-2 rounded-sm border border-border bg-surface-2 p-2"
                  >
                    <span className="chip">{t("map.levelLabel", { index: level.levelIndex })}</span>
                    <span className="mono flex-1">
                      {level.widthMm} × {level.heightMm} × {level.depthMm} mm
                      {level._count ? ` · ${t("map.levelBooks", { count: level._count.placements })}` : ""}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setLvForm({
                          id: level.id,
                          bookcaseId: bc.id,
                          levelIndex: String(level.levelIndex),
                          widthMm: String(level.widthMm),
                          heightMm: String(level.heightMm),
                          depthMm: String(level.depthMm),
                          note: level.note ?? "",
                        });
                        setLvOpen(true);
                      }}
 aria-label={t("common.edit")}>
                      <IconEdit className="h-4 w-4" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void removeLevel(level.id)} aria-label={t("common.delete")}>
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                className="btn btn-ghost btn-sm mt-3"
                onClick={() => {
                  // 新层默认接在最上面，并沿用上一层的尺寸，省得每层都重填
                  const top = bc.levels[bc.levels.length - 1];
                  setLvForm({
                    bookcaseId: bc.id,
                    levelIndex: String((top?.levelIndex ?? 0) + 1),
                    widthMm: String(top?.widthMm ?? 800),
                    heightMm: String(top?.heightMm ?? 300),
                    depthMm: String(top?.depthMm ?? 280),
                    note: "",
                  });
                  setLvOpen(true);
                }}
              >
                <IconPlus className="h-4 w-4" /> {t("shelves.addLevel")}
              </button>
            </section>
          ))}
        </div>
      )}

      <Modal open={bcOpen} onClose={() => setBcOpen(false)} title={bcForm.id ? t("shelves.editBookcase") : t("shelves.addBookcase")}>
        <form onSubmit={saveBookcase} className="flex flex-col gap-4">
          <Labeled label={t("shelves.bookcaseName")} htmlFor="bc-name">
            <input id="bc-name" className="field" value={bcForm.name}
              onChange={(e) => setBcForm({ ...bcForm, name: e.target.value })} />
          </Labeled>

          {/* 书柜必须住在某个房间里 —— 房间来自户型图，不再手打 */}
          <Labeled label={t("shelves.room")} hint={t("shelves.roomBoundHint")} htmlFor="bc-room">
            <select id="bc-room" className="field" value={bcForm.roomId}
              onChange={(e) => setBcForm({ ...bcForm, roomId: e.target.value })}>
              <option value="">{t("shelves.noRoom")}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}（{(r.areaMm2 / 1e6).toFixed(1)} ㎡）
                </option>
              ))}
            </select>
          </Labeled>

          <Labeled label={t("shelves.bodySize")} hint={t("shelves.bodySizeHint")}>
            <div className="grid grid-cols-3 gap-2">
              <input className="field" type="number" aria-label={t("shelves.width")} value={bcForm.widthMm}
                onChange={(e) => setBcForm({ ...bcForm, widthMm: e.target.value })} />
              <input className="field" type="number" aria-label={t("shelves.depth")} value={bcForm.depthMm}
                onChange={(e) => setBcForm({ ...bcForm, depthMm: e.target.value })} />
              <input className="field" type="number" aria-label={t("shelves.height")} value={bcForm.heightMm}
                onChange={(e) => setBcForm({ ...bcForm, heightMm: e.target.value })} />
            </div>
          </Labeled>

          <Labeled label={t("tags.color")}>
            <div className="flex flex-wrap gap-2">
              {BC_COLORS.map((c) => (
                <button key={c} type="button" aria-label={c}
                  onClick={() => setBcForm({ ...bcForm, color: c })}
                  className={`h-9 w-9 rounded-md border-2 border-border ${bcForm.color === c ? "ring-3 ring-secondary ring-offset-2" : ""}`}
                  style={{ background: c }} />
              ))}
            </div>
          </Labeled>

          <p className="hint">{t("shelves.positionHint")}</p>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? <Spinner /> : null}{t("common.save")}
          </button>
        </form>
      </Modal>

      <Modal open={!!transfer} onClose={() => setTransfer(null)} title={t("shelves.transferTitle", { name: transfer?.name ?? "" })}>
        <p className="hint mb-3">{t("shelves.transferHint")}</p>
        <ul className="flex flex-col gap-2">
          {rooms.map((r) => {
            const current = transfer?.roomId === r.id;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={busy || current}
                  onClick={() => void doTransfer(r.id)}
                  className="flex w-full items-center gap-2 rounded-md border-2 border-border bg-surface-1 p-2 text-left hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="h-6 w-6 shrink-0 rounded-sm border-2 border-border" style={{ background: r.color }} />
                  <span className="flex-1 font-black">{r.name}</span>
                  <span className="mono">{(r.areaMm2 / 1e6).toFixed(1)} ㎡</span>
                  {current && <span className="chip chip-info">{t("shelves.currentRoom")}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>

      <Modal open={lvOpen} onClose={() => setLvOpen(false)} title={lvForm.id ? t("shelves.editLevel") : t("shelves.addLevel")}>
        <form onSubmit={saveLevel} className="flex flex-col gap-4">
          <Labeled label={t("shelves.levelIndex")} hint={t("shelves.levelIndexHint")} htmlFor="lv-index">
            <input id="lv-index" className="field" type="number" min="1" value={lvForm.levelIndex}
              onChange={(e) => setLvForm({ ...lvForm, levelIndex: e.target.value })} />
          </Labeled>
          <div className="grid gap-4 sm:grid-cols-3">
            <Labeled label={t("shelves.width")} htmlFor="lv-w">
              <input id="lv-w" className="field" type="number" value={lvForm.widthMm}
                onChange={(e) => setLvForm({ ...lvForm, widthMm: e.target.value })} />
            </Labeled>
            <Labeled label={t("shelves.height")} htmlFor="lv-h">
              <input id="lv-h" className="field" type="number" value={lvForm.heightMm}
                onChange={(e) => setLvForm({ ...lvForm, heightMm: e.target.value })} />
            </Labeled>
            <Labeled label={t("shelves.depth")} htmlFor="lv-d">
              <input id="lv-d" className="field" type="number" value={lvForm.depthMm}
                onChange={(e) => setLvForm({ ...lvForm, depthMm: e.target.value })} />
            </Labeled>
          </div>
          <p className="hint">{t("shelves.heightHint")}</p>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? <Spinner /> : null}{t("common.save")}
          </button>
        </form>
      </Modal>
    </>
  );
}
