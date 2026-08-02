var CACHE_NAME = 'justyou-timer-v6.2.12';
var APP_SHELL = [
  './index.html',
  './style.css?v=6.2.12',
  './app.js?v=6.2.12',
  './manifest.json',
  './logo.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(APP_SHELL);
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      if (key !== CACHE_NAME) return caches.delete(key);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // Externí API (zejména počasí) se nikdy nesmí obsluhovat z cache.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(function (response) {
      if (!response || !response.ok) return caches.match('./index.html');
      return response;
    }).catch(function () { return caches.match('./index.html'); }));
    return;
  }

  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(function (cached) {
    if (cached) return cached;
    return fetch(event.request).then(function (response) {
      if (!response || !response.ok) return response;
      var copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      return response;
    });
  }));
});
