"use client";

// 浏览器端条码扫描 —— F1
//
// 两条实现路径：
//   1. 原生 BarcodeDetector（Android Chrome、桌面 Chrome）—— 快、省电、由系统解码
//   2. ZXing wasm/JS 兜底（iOS Safari 至今没有 BarcodeDetector）
// iPhone 是主力扫码设备，所以第 2 条路径必须能独立跑通。

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { IconCamera, IconX } from "./icons";
import { ErrorBanner, Spinner } from "./ui";

type ScannerState = "idle" | "starting" | "running" | "error";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const ZXING_HINTS = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E],
  ],
  // 期刊条码后面跟的 2 位/5 位附加码就是期号，必须一起读出来（spec §3.4）
  [DecodeHintType.ALLOWED_EAN_EXTENSIONS, [2, 5]],
  [DecodeHintType.TRY_HARDER, true],
]);

export function Scanner({ onDetected }: { onDetected: (code: string) => void }) {
  const t = useTranslations();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });

  const [state, setState] = useState<ScannerState>("idle");
  const [error, setError] = useState<string | null>(null);

  const secure = typeof window !== "undefined" && window.isSecureContext;

  // 同一本书在取景框里会被连续识别很多次，1.5 秒内的重复直接忽略
  const emit = useCallback(
    (code: string) => {
      const now = Date.now();
      if (lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1500) return;
      lastCodeRef.current = { code, at: now };
      navigator.vibrate?.(60);
      onDetected(code);
    },
    [onDetected],
  );

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    zxingControlsRef.current?.stop();
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      // iOS 不加 playsInline 会强制全屏播放，整个扫码界面就废了
      video.setAttribute("playsinline", "true");
      await video.play();
      setState("running");

      if (window.BarcodeDetector) {
        const detector = new window.BarcodeDetector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e"],
        });
        const tick = async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          try {
            const found = await detector.detect(videoRef.current);
            if (found.length) emit(found[0].rawValue);
          } catch {
            // 单帧解码失败无所谓，下一帧继续
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } else {
        const reader = new BrowserMultiFormatReader(ZXING_HINTS);
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) emit(result.getText());
        });
        zxingControlsRef.current = controls;
      }
    } catch (err) {
      setState("error");
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotFoundError" || name === "OverconstrainedError"
          ? t("scan.noCamera")
          : t("scan.cameraDenied"),
      );
    }
  }, [emit, t]);

  useEffect(() => stop, [stop]);

  if (!secure) {
    return <ErrorBanner message={t("scan.insecureContext")} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-md border border-border bg-black">
        <video
          ref={videoRef}
          className="aspect-[4/3] w-full object-cover"
          muted
          playsInline
          aria-label={t("scan.cameraHint")}
        />

        {state === "running" && (
          // 取景框：只是视觉引导，解码用的是整帧
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-4/5 rounded-md border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}

        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-1/80 p-6 text-center">
            {state === "starting" ? (
              <Spinner className="h-6 w-6 text-primary" />
            ) : (
              <>
                <IconCamera className="h-8 w-8 text-text-faint" />
                <p className="hint">{t("scan.cameraHint")}</p>
              </>
            )}
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex gap-2">
        {state === "running" ? (
          <button type="button" onClick={stop} className="btn btn-ghost flex-1">
            <IconX className="h-4 w-4" /> {t("scan.stopCamera")}
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={state === "starting"}
            className="btn btn-primary flex-1"
          >
            <IconCamera className="h-4 w-4" /> {t("scan.startCamera")}
          </button>
        )}
      </div>
    </div>
  );
}
