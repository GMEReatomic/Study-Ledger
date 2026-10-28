/* ==========================================================================
   一页工作台 · Service Worker
   - 预缓存全部静态页面与共享资源
   - 页面导航：网络优先，离线回退缓存
   - 站内静态资源：缓存优先 + 后台更新
   - 跨域 CDN 渲染库：交给浏览器 HTTP 缓存，不由 SW 改写
   ========================================================================== */
'use strict';

const CACHE_NAME = 'yipan-toolbox-v1.6.4';

const CORE_ASSETS = [
  './',
  './index.html',
  './password.html',
  './notes.html',
  './resources.html',
  './weather.html',
  './datetime.html',
  './random.html',
  './external.html',
  './404.html',
  './css/style.css',
  './js/common.js',
  './js/home.js',
  './js/password.js',
  './js/notes.js',
  './js/notes-mindmap.js',
  './js/resources.js',
  './js/weather.js',
  './js/datetime.js',
  './js/random.js',
  './js/external.js',
  './assets/icons.svg',
  './assets/curtain-doodle.svg',
  './assets/favicon.svg',
  './assets/icon-180.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isWeatherApi(url) {
  return url.hostname.endsWith('open-meteo.com');
}

/** 网络优先，失败时回退到缓存；离线导航最终回退到 404 纸页。 */
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const index = await caches.match('./index.html');
    if (index && new URL(request.url).pathname.endsWith('/')) return index;
    const notFound = await caches.match('./404.html');
    if (notFound) return notFound;
    return new Response('当前页面暂时不可用，请联网后重试。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/** 缓存优先并后台更新，适用于 CSS / JS / 图标和 CDN 渲染库。 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => undefined);
    return cached;
  }
  const response = await networkPromise;
  if (response) return response;
  return new Response('资源暂时不可用。', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 天气 API 不缓存，避免展示过期观测。
  if (isWeatherApi(url)) return;

  // 站内页面导航。
  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // 站内静态资源。
  if (url.origin === self.location.origin) {
    const isStatic = /\.(?:css|js|svg|png|webp|ico|json|woff2?|ttf)$/i.test(url.pathname);
    if (isStatic) {
      event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
      return;
    }
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).catch(() => new Response('', { status: 504 })))
    );
    return;
  }

  // 跨域 CDN 渲染库不交给 Service Worker 改写，避免浏览器与 SW
  // 网络策略不同导致样式/脚本被错误回成 503；正常 HTTP 缓存仍可复用。
});
