const CACHE_NAME = "remax-portal-static-v1";
const STATIC_WHITELIST = [
  "/remax-icon.png",
  "/remax-icon-512.png",
  "/remax-logo.png",
  "/remax-logo-white.png",
  "/remax-logo-transparent.png",
  "/remax-pin-watermark.png",
  "/og-image.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
  "/pwa-192.png",
  "/pwa-512.png",
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Só cacheia um punhado de imagens estáticas de marca (não sensíveis, não versionadas por hash).
// HTML, JS/CSS do build e qualquer chamada de API/Supabase sempre vão direto pra rede — página e
// dados nunca são servidos do cache aqui, pra não mostrar tela ou dado desatualizado depois de um
// novo deploy, nem vazar dado de um usuário pro próximo que usar o mesmo aparelho.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!STATIC_WHITELIST.includes(url.pathname)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }),
  );
});
