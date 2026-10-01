"use client";

// F2 标签管理 + F3 动态容量：标签空间压力与批量迁移
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiDelete, apiErrorKey, apiGet, apiPatch, apiPost } from "@/lib/client";
import { EmptyState, ErrorBanner, Labeled, LoadFailed, Modal, PageHeader, Spinner } from "./ui";
import { IconEdit, IconPlus, IconTrash, IconWarn } from "./icons";

interface Zone {
  levelId: string;
  level: { id: string; levelIndex: number; bookcase: { name: string } };
}
interface Tag {
  id: string;
  name: string;
  nameEn: string | null;
  color: string;
  _count: { books: number };
  zones: Zone[];
}
interface Pressure {
  tagId: string;
  tagName: string;
  color: string;
  totalSpineMm: number;
  allocatedMm: number;
  overflowMm: number;
  status: "ok" | "tight" | "overflow";
  bookCount: number;
  estimatedCount: number;
  zoneLevels: { id: string; bookcaseName: string; levelIndex: number; widthMm: number }[];
  freeLevels: { levelId: string; bookcaseName: string; levelIndex: number; remainingMm: number }[];
}
interface LevelOption {
  id: string;
  levelIndex: number;
  widthMm: number;
  bookcase: { name: string };
}

const PALETTE = ["#FDC800", "#432DD7", "#16A34A", "#DC2626", "#F97316", "#0EA5E9", "#EC4899"];

export function TagsManager({ levels }: { levels: LevelOption[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [pressure, setPressure] = useState<Pressure[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<{ id?: string; name: string; nameEn: string; color: string }>({
    name: "", nameEn: "", color: PALETTE[0],
  });
  const [formOpen, setFormOpen] = useState(false);
  const [zoneTag, setZoneTag] = useState<Tag | null>(null);
  const [zoneSelection, setZoneSelection] = useState<string[]>([]);

  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [tagRes, pressureRes] = await Promise.all([
        apiGet<{ tags: Tag[] }>("/api/tags"),
        apiGet<{ pressure: Pressure[] }>("/api/tags/pressure"),
      ]);
      setTags(tagRes.tags);
      setPressure(pressureRes.pressure);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { name: form.name.trim(), nameEn: form.nameEn.trim() || null, color: form.color };
      if (form.id) await apiPatch(`/api/tags/${form.id}`, payload);
      else await apiPost("/api/tags", payload);
      setFormOpen(false);
      await load();
      router.refresh();
    } catch (err) {
      // 重名是最容易撞上的：服务端已经把唯一约束翻成 already_exists 了，
      // 这里要把它说出来，而不是笼统一句"保存失败"
      setError(t(apiErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t("tags.deleteConfirm"))) return;
    await apiDelete(`/api/tags/${id}`);
    await load();
    router.refresh();
  };

  const saveZones = async () => {
    if (!zoneTag) return;
    setBusy(true);
    try {
      await apiPatch(`/api/tags/${zoneTag.id}`, { levelIds: zoneSelection });
      setZoneTag(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const migrate = async (tagId: string, levelId: string, count: number, tagName: string) => {
    if (!confirm(t("capacity.migrationConfirm", { tag: tagName, count }))) return;
    setBusy(true);
    try {
      await apiPost(`/api/tags/${tagId}/migrate`, { levelId });
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (failed) {
    return (
      <>
        <PageHeader title={t("tags.title")} />
        <LoadFailed onRetry={() => void load()} />
      </>
    );
  }

  if (!tags) {
    return <div className="flex items-center gap-2 p-6 text-text-muted"><Spinner /> {t("common.loading")}</div>;
  }

  const pressureById = new Map(pressure.map((p) => [p.tagId, p]));

  return (
    <>
      <PageHeader
        title={t("tags.title")}
        subtitle={t("tags.hint")}
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => { setForm({ name: "", nameEn: "", color: PALETTE[tags.length % PALETTE.length] }); setFormOpen(true); }}
          >
            <IconPlus className="h-4 w-4" /> {t("tags.addTag")}
          </button>
        }
      />

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {tags.length === 0 ? (
        <EmptyState title={t("common.empty")} hint={t("tags.hint")} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {tags.map((tag) => {
            const p = pressureById.get(tag.id);
            const statusChip =
              p?.status === "overflow" ? "chip-danger"
              : p?.status === "tight" ? "chip-warn"
              : "chip-ok";
            return (
              <section key={tag.id} className="card p-4">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-5 w-5 shrink-0 rounded-sm border-2 border-border"
                      style={{ background: tag.color }}
                      aria-hidden="true"
                    />
                    <div>
                      <h2 className="text-md">{tag.name}</h2>
                      <p className="hint">{t("tags.bookCount", { count: tag._count.books })}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setForm({ id: tag.id, name: tag.name, nameEn: tag.nameEn ?? "", color: tag.color });
                        setFormOpen(true);
                      }}
 aria-label={t("common.edit")}>
                      <IconEdit className="h-4 w-4" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(tag.id)} aria-label={t("common.delete")}>
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* 分区 */}
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="section-title">{t("tags.zones")}</span>
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      onClick={() => { setZoneTag(tag); setZoneSelection(tag.zones.map((z) => z.levelId)); }}
                    >
                      {t("tags.assignLevel")}
                    </button>
                  </div>
                  {tag.zones.length === 0 ? (
                    <p className="hint">{t("tags.noZones")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {tag.zones.map((z) => (
                        <span key={z.levelId} className="chip">
                          {z.level.bookcase.name} · {t("map.levelLabel", { index: z.level.levelIndex })}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 空间压力 */}
                {p && p.zoneLevels.length > 0 && (
                  <div className="rounded-md border border-border bg-surface-2 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="section-title">{t("tags.pressure")}</span>
                      <span className={`chip ${statusChip}`}>
                        {p.status === "overflow" ? t("tags.pressureOverflow")
                          : p.status === "tight" ? t("tags.pressureTight")
                          : t("tags.pressureOk")}
                      </span>
                    </div>
                    <p className="mono">
                      {t("tags.totalWidth")}: {p.totalSpineMm} mm ·{" "}
                      {t("tags.allocatedWidth")}: {p.allocatedMm} mm
                    </p>

                    {p.status === "overflow" && (
                      <div className="mt-2">
                        <p className="mb-2 text-2xs font-black text-danger">
                          <IconWarn className="mr-1 inline h-3.5 w-3.5" />
                          {t("capacity.migrationBody", {
                            tag: p.tagName,
                            total: p.totalSpineMm,
                            allocated: p.allocatedMm,
                            overflow: p.overflowMm,
                          })}
                        </p>
                        {p.freeLevels.length === 0 ? (
                          <p className="hint">{t("capacity.noSuggestion")}</p>
                        ) : (
                          <>
                            <p className="section-title mb-1">{t("capacity.freeLevels")}</p>
                            <div className="flex flex-col gap-1.5">
                              {p.freeLevels.slice(0, 3).map((fl) => (
                                <div key={fl.levelId} className="flex items-center gap-2">
                                  <span className="mono flex-1">
                                    {fl.bookcaseName} · {t("map.levelLabel", { index: fl.levelIndex })} ·{" "}
                                    {t("map.free")} {fl.remainingMm} mm
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => void migrate(p.tagId, fl.levelId, p.bookCount, p.tagName)}
                                  >
                                    {t("capacity.moveHere")}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={form.id ? t("tags.editTag") : t("tags.addTag")}>
        <form onSubmit={save} className="flex flex-col gap-4">
          <Labeled label={t("tags.name")} htmlFor="tag-name">
            <input id="tag-name" className="field" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Labeled>
          <Labeled label={t("tags.nameEn")} htmlFor="tag-name-en">
            <input id="tag-name-en" className="field" value={form.nameEn}
              onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          </Labeled>
          <Labeled label={t("tags.color")}>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((color) => (
                <button
                  key={color} type="button" aria-label={color}
                  onClick={() => setForm({ ...form, color })}
                  className={`h-9 w-9 rounded-md border-2 border-border ${form.color === color ? "ring-3 ring-secondary ring-offset-2" : ""}`}
                  style={{ background: color }}
                />
              ))}
            </div>
          </Labeled>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? <Spinner /> : null}{t("common.save")}
          </button>
        </form>
      </Modal>

      <Modal open={!!zoneTag} onClose={() => setZoneTag(null)} title={t("tags.zones")} wide>
        <p className="hint mb-3">{t("tags.zonesHint")}</p>
        <div className="flex flex-col gap-1.5">
          {levels.map((level) => {
            const checked = zoneSelection.includes(level.id);
            return (
              <label
                key={level.id}
                className="flex cursor-pointer items-center gap-3 rounded-sm border border-border bg-surface-2 p-2"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setZoneSelection((prev) =>
                      checked ? prev.filter((x) => x !== level.id) : [...prev, level.id],
                    )
                  }
                />
                <span className="flex-1">
                  {level.bookcase.name} · {t("map.levelLabel", { index: level.levelIndex })}
                </span>
                <span className="mono">{level.widthMm} mm</span>
              </label>
            );
          })}
        </div>
        <button type="button" onClick={() => void saveZones()} disabled={busy} className="btn btn-primary mt-4 w-full">
          {busy ? <Spinner /> : null}{t("common.save")}
        </button>
      </Modal>
    </>
  );
}
