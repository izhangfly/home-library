// Service worker —— F7「添加到主屏幕」后要能离线打开。
//
// 刻意保守：只缓存静态资源（app shell / Next 构建产物），
// API 一律走网络。书目数据缓存了反而会看到过期的位置信息，
// 那比"打不开"更糟 —— 你按着缓存去书架前找书，书已经不在那了。

const CACHE = "home-library-v1";
const PRECACHE = ["/", "/scan", "/books", "/map"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API 和上传的图片永远走网络，别拿旧数据糊弄用户
  if (url.pathname.startsWith("/api/")) return;

  // 页面导航：网络优先，断网时回落到缓存
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icons/"))) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
