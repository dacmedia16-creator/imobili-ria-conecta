const CACHE_NAME = "remax-portal-static-v3";
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
  "/hub/adm.png",
  "/hub/estudo.png",
  "/hub/academia.png",
  "/hub/60dias.png",
  "/hub/recruta.png",
  "/hub/locacao.png",
  "/hub/visita.png",
  "/fonts/barlow-condensed-600.woff2",
  "/fonts/barlow-condensed-800.woff2",
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
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

// Avisos de exclusividade (cartão t_c337fc12): web push. O servidor manda JSON
// {title, body, url, tag}; o clique abre (ou foca) o ADM MAX direto na captação.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  const url = typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/notificacoes";
  event.waitUntil(
    self.registration.showNotification(d.title || "ADM MAX", {
      body: d.body || "",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      tag: d.tag || undefined,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notificacoes", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.startsWith(self.location.origin) && "focus" in c) {
          c.navigate(url).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
