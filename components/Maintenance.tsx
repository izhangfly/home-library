"use client";

// 整理 —— 「盘点」和「整理建议」原来是两个菜单项，其实是同一件事的两半：
// 盘点是把书架的**现状**读进系统，整理建议是根据现状**算出该动什么**。
// 分成两个入口的结果是你得先去一个页面确认现状、再切到另一个页面看建议。
// 合成一页两个标签页，顺序就自然了：先盘点，再看建议。

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ReflowConsole } from "./ReflowConsole";
import { LayoutPlanner } from "./LayoutPlanner";
import { InventoryMode, type InventoryLevel } from "./InventoryMode";

const TABS = ["reflow", "layout", "inventory"] as const;
export type Tab = (typeof TABS)[number];

export function Maintenance({
  levels,
  defaultTab = "reflow",
}: {
  levels: InventoryLevel[];
  defaultTab?: Tab;
}) {
  const t = useTranslations();
  const [tab, setTab] = useState<Tab>(defaultTab);

  return (
    <>
      <div className="mb-4 flex gap-2">
        {(TABS).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`btn btn-sm ${tab === k ? "btn-primary" : "btn-ghost"}`}
          >
            {k === "reflow" ? t("reflow.title") : k === "layout" ? t("layout.title") : t("inventory.title")}
          </button>
        ))}
      </div>

      {tab === "reflow" ? <ReflowConsole /> : tab === "layout" ? <LayoutPlanner /> : <InventoryMode levels={levels} />}
    </>
  );
}
