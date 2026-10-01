"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiPatch } from "@/lib/client";
import { setLocale } from "@/app/actions";
import { AdminGate, LogoutButton } from "./AdminGate";
import { ErrorBanner, Labeled, PageHeader, Spinner } from "./ui";
import type { Locale } from "@/i18n/request";

export interface Coefficients {
  mmPerPage: number;
  basePaperbackMm: number;
  baseHardcoverMm: number;
  defaultSpineMm: number;
  tightThresholdMm: number;
  levelMarginMm: number;
  assumedHeightMm: number;
}

const SOURCE_LABEL: Record<string, string> = {
  douban: "豆瓣 (Douban)",
  openLibrary: "OpenLibrary",
  googleBooks: "Google Books",
  wanzhou: "万舟 (wanzhou)",
};

export function SettingsPanel({
  admin,
  locale,
  coefficients,
  sources,
}: {
  admin: boolean;
  locale: Locale;
  coefficients: Coefficients;
  sources: Record<string, boolean>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(coefficients);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch("/api/settings", {
        mmPerPage: Number(values.mmPerPage),
        basePaperbackMm: Number(values.basePaperbackMm),
        baseHardcoverMm: Number(values.baseHardcoverMm),
        defaultSpineMm: Number(values.defaultSpineMm),
        tightThresholdMm: Number(values.tightThresholdMm),
        levelMarginMm: Number(values.levelMarginMm),
        assumedHeightMm: Number(values.assumedHeightMm),
      });
      setSaved(true);
      router.refresh();
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const num = (key: keyof Coefficients, label: string, hint?: string, step = "0.001") => (
    <Labeled label={label} hint={hint} htmlFor={`c-${key}`}>
      <input
        id={`c-${key}`}
        className="field"
        type="number"
        step={step}
        value={values[key]}
        onChange={(e) => setValues({ ...values, [key]: e.target.value as unknown as number })}
      />
    </Labeled>
  );

  return (
    <>
      <PageHeader title={t("settings.title")} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 界面语言 —— F6 */}
        <section className="card p-4">
          <h2 className="mb-2 text-md">{t("settings.language")}</h2>
          <p className="hint mb-3">{t("settings.languageHint")}</p>
          <div className="flex gap-2">
            {(["zh", "en"] as Locale[]).map((code) => (
              <button
                key={code}
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => { void setLocale(code); })}
                className={`btn btn-sm ${locale === code ? "btn-primary" : "btn-ghost"}`}
              >
                {code === "zh" ? "简体中文" : "English"}
              </button>
            ))}
          </div>
        </section>

        {/* 数据源状态 */}
        <section className="card p-4">
          <h2 className="mb-3 text-md">{t("settings.dataSources")}</h2>
          <ul className="flex flex-col gap-2">
            {Object.entries(sources).map(([key, enabled]) => (
              <li key={key} className="flex items-center justify-between gap-2">
                <span>{SOURCE_LABEL[key] ?? key}</span>
                <span className={`chip ${enabled ? "chip-ok" : ""}`}>
                  {enabled ? t("settings.sourceEnabled") : t("settings.sourceDisabled")}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 备份 */}
        <section className="card p-4">
          <h2 className="mb-2 text-md">{t("settings.backup")}</h2>
          <p className="hint mb-3">{t("settings.backupHint")}</p>
          <a href="/api/export" download className="btn btn-ghost btn-sm">
            {t("settings.exportJson")}
          </a>
        </section>

        {/* 容量系数 —— 会改变所有层的判断，所以要管理员 */}
        <section className="card p-4 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-md">{t("settings.coefficients")}</h2>
            {admin && <LogoutButton />}
          </div>
          <p className="hint mb-4">{t("settings.coefficientsHint")}</p>

          <AdminGate admin={admin}>
            <form onSubmit={save} className="flex flex-col gap-4">
              {error && <ErrorBanner message={error} />}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {num("mmPerPage", t("settings.mmPerPage"))}
                {num("basePaperbackMm", t("settings.basePaperback"), undefined, "0.5")}
                {num("baseHardcoverMm", t("settings.baseHardcover"), undefined, "0.5")}
                {num("defaultSpineMm", t("settings.defaultSpine"), undefined, "1")}
                {num("tightThresholdMm", t("settings.tightThreshold"), t("settings.tightThresholdHint"), "1")}
                {num("levelMarginMm", t("settings.levelMargin"), undefined, "1")}
                {num("assumedHeightMm", t("settings.assumedHeight"), t("settings.assumedHeightHint"), "5")}
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy} className="btn btn-primary">
                  {busy ? <Spinner /> : null}{t("common.save")}
                </button>
                {saved && <span className="chip chip-ok">{t("book.saved")}</span>}
              </div>
            </form>
          </AdminGate>
        </section>
      </div>
    </>
  );
}
