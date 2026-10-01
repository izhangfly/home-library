"use client";

// F2 —— 标签选择 + 建议
// 建议来自 lib/tagSuggest 的关键词规则；用户一键接受或无视，永远可以自己改。

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/client";
import { tagChipStyle } from "@/lib/contrast";
import { IconPlus, IconSpark } from "./icons";

export interface TagOption {
  id: string;
  name: string;
  nameEn: string | null;
  color: string;
}

/**
 * 直接用服务端那份定义，不在这儿再抄一遍。
 *
 * 原来这里自己写了一个同名 interface，和 lib/tagSuggest.ts 的那个各写各的。
 * 加 `usage` 字段时就分叉了：服务端发得出来，客户端类型里没有，编译器报错 ——
 * 这次是运气好，编译器抓到了；要是加的是可选字段而客户端只是**没读**，
 * 那就是静默丢功能。（同一种分叉在这个项目里已经修过 shelvingKey、
 * buildExport、insert 的 sortKeyOf 三次了。）
 */
import type { TagSuggestion } from "@/lib/tagSuggest";
export type { TagSuggestion };

export function TagPicker({
  tags,
  selected,
  onChange,
  suggestions,
  onTagCreated,
}: {
  tags: TagOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  suggestions?: TagSuggestion[];
  onTagCreated?: (tag: TagOption) => void;
}) {
  const t = useTranslations();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const createTag = async (name: string, nameEn?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find((x) => x.name === trimmed);
    if (existing) {
      if (!selected.includes(existing.id)) toggle(existing.id);
      return;
    }
    const { tag } = await apiPost<{ tag: TagOption }>("/api/tags", {
      name: trimmed,
      nameEn: nameEn ?? null,
    });
    onTagCreated?.(tag);
    onChange([...selected, tag.id]);
    setNewName("");
    setCreating(false);
  };

  // 已经选中的、以及库里已存在的建议不再重复展示
  const fresh = (suggestions ?? []).filter((s) => !s.tagId || !selected.includes(s.tagId));
  // 主题建议和用途标签分开显示。
  //
  // 它们是**两种东西**：主题建议只是把分类号换个说法（而且现在只在这本书
  // 还没有分类号时才会出现）；用途标签说的是书和你的关系 ——
  // 分类号永远表达不了，而且它真的会改变这本书摆在多高。
  // 混在一排里，后者就淹没了 —— 这也正是它此前从没被人用过的原因之一。
  const freshSuggestions = fresh.filter((s) => !s.usage);
  const usageSuggestions = fresh.filter((s) => s.usage);

  return (
    <div className="flex flex-col gap-3">
      {usageSuggestions.length > 0 && (
        <div className="rounded-md border-2 border-border bg-surface-2 p-3">
          <div className="mb-1 text-2xs font-black">{t("tags.usageTitle")}</div>
          <p className="hint mb-2">{t("tags.usageHint")}</p>
          <div className="flex flex-wrap gap-2">
            {usageSuggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => (s.tagId ? toggle(s.tagId) : createTag(s.name, s.nameEn))}
                className="chip"
                title={t(s.usage === "frequent" ? "tags.usageFrequent" : "tags.usageRare")}
              >
                <IconPlus className="h-3 w-3" />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {freshSuggestions.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary-soft/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-2xs font-black text-primary">
            <IconSpark className="h-4 w-4" />
            {t("tags.suggestions")}
          </div>
          <div className="flex flex-wrap gap-2">
            {freshSuggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => (s.tagId ? toggle(s.tagId) : createTag(s.name, s.nameEn))}
                className="chip chip-info"
                title={s.matched.join(", ")}
              >
                <IconPlus className="h-3 w-3" />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const active = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => toggle(tag.id)}
              aria-pressed={active}
              className="chip transition-colors"
              style={active ? tagChipStyle(tag.color) : undefined}
            >
              {!active && (
                <span
                  className="h-2.5 w-2.5 rounded-full border-2 border-border"
                  style={{ background: tag.color }}
                  aria-hidden="true"
                />
              )}
              {tag.name}
            </button>
          );
        })}

        {creating ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createTag(newName);
                }
                if (e.key === "Escape") setCreating(false);
              }}
              className="field h-9 min-h-0 w-32 py-1"
              placeholder={t("tags.name")}
            />
            <button type="button" onClick={() => void createTag(newName)} className="btn btn-primary btn-sm">
              {t("common.add")}
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="chip">
            <IconPlus className="h-3 w-3" /> {t("tags.addTag")}
          </button>
        )}
      </div>
    </div>
  );
}
