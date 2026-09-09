/* 앱 껍데기만 캐시 (지도 타일·바람·길 데이터는 캐시하지 않음) */
const CACHE = 'baramgil-shell-v2';
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest',
  './vendor/maplibre-gl.js', './vendor/maplibre-gl.css',
  './js/geo.js', './js/wind.js', './js/streets.js', './js/model.js', './js/mock.js', './js/particles.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 외부(타일·API)는 그대로 네트워크
  // 같은 출처: 네트워크 우선, 실패하면 캐시
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
