"use client";

// F5 —— 只有改书架结构才需要密码。这个组件包住需要密码的界面，
// 未登录时展示登录框，并说明为什么这一块要密码。

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiDelete, apiPost, ApiError } from "@/lib/client";
import { ErrorBanner, Spinner } from "./ui";

export function AdminGate({
  admin,
  children,
}: {
  admin: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/auth", { password });
      setPassword("");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "wrong_password"
          ? t("auth.wrongPassword")
          : t("errors.generic"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (admin) return <>{children}</>;

  return (
    <div className="card mx-auto max-w-md p-6">
      <h2 className="mb-2 text-md">{t("auth.adminLogin")}</h2>
      <p className="hint mb-4">{t("auth.whyHint")}</p>

      <form onSubmit={login} className="flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        <input
          type="password"
          className="field"
          autoComplete="current-password"
          placeholder={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label={t("auth.password")}
        />
        <button type="submit" disabled={busy || !password} className="btn btn-primary">
          {busy ? <Spinner /> : null}
          {t("auth.login")}
        </button>
      </form>
    </div>
  );
}

export function LogoutButton() {
  const t = useTranslations();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await apiDelete("/api/auth");
        router.refresh();
      }}
    >
      {t("auth.logout")}
    </button>
  );
}
