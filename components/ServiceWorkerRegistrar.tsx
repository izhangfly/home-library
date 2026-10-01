"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // 只在 HTTPS（或 localhost）下注册；http 访问时浏览器本来就会拒绝
    if (!window.isSecureContext) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不影响正常使用，安静降级
    });
  }, []);

  return null;
}
