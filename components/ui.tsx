"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { IconX } from "./icons";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl">{title}</h1>
        {subtitle && <p className="hint mt-1 max-w-prose">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const color =
    tone === "ok" ? "text-success"
    : tone === "warn" ? "text-warning"
    : tone === "danger" ? "text-danger"
    : "text-text";
  return (
    <div className="card p-4">
      <div className="section-title">{label}</div>
      <div className={`mt-1 text-xl font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-md font-black">{title}</p>
      {hint && <p className="hint max-w-md">{hint}</p>}
      {action}
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 「取数失败」的统一落点，带重试。
 *
 * 为什么必须有：这些页面都是挂载时 fetch 一次、失败就把状态留在 null，
 * 于是界面永远停在「加载中…」。站在书架前 wifi 不好的时候，
 * 你看到的是一个转不完的圈，而不是"你现在离线了"。
 * 转圈让人以为是应用坏了，明说离线至少让人知道该往窗边走两步。
 *
 * service worker 有意不缓存 API（见 public/sw.js）——
 * 拿旧的位置信息去书架前找书，比打不开更糟。所以离线时**没有**数据可显示，
 * 能做的就是把话说清楚。
 */
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function LoadFailed({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations();
  // useSyncExternalStore 而不是 useState+useEffect：
  // 「在不在线」是浏览器的外部状态，这个 hook 就是为它设计的 ——
  // 首次渲染直接读到真实值（effect 版本会先渲染一帧"在线"，赶上这一帧就永远显示错的），
  // 服务端快照给 false 也不会有 hydration 不匹配。
  const offline = useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);

  return (
    <div role="alert" className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-md font-black">{offline ? t("errors.offlineTitle") : t("errors.loadFailed")}</p>
      <p className="hint max-w-md">{offline ? t("errors.offlineHint") : t("errors.loadFailedHint")}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="btn btn-primary btn-sm mt-1">
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border-2 border-border bg-danger-soft px-4 py-3 text-xs font-bold text-[#7f1d1d] shadow-[3px_3px_0_var(--color-border)]"
    >
      {message}
    </div>
  );
}

/**
 * 模态框：原生 <dialog> 自带焦点陷阱、Esc 关闭和惰性背景，
 * 比自己用 div 拼一个可访问性好得多。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      // 点击背板关闭：<dialog> 自身就是背板，内容包在里层 div 里
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`w-[calc(100vw-32px)] rounded-md border-2 border-border bg-surface-1 p-0 text-text shadow-[6px_6px_0_var(--color-border)] backdrop:bg-[#1c293c]/40 ${
        wide ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h2 className="text-md">{title}</h2>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="close">
          <IconX className="h-4 w-4" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
    </dialog>
  );
}

export function Labeled({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="hint mt-1">{hint}</p>}
    </div>
  );
}

/** 完整度条：颜色直接反映"这本书还差多少信息" */
export function CompletenessBar({ value, label }: { value: number; label?: string }) {
  const tone = value >= 80 ? "bg-success" : value >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div
      className="h-3 w-full overflow-hidden rounded-sm border-2 border-border bg-surface-3"
      role="progressbar"
      aria-label={label ?? `${value}%`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  );
}
