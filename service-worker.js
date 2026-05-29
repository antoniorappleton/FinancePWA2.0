const CACHE_NAME = "finance-pwa-v45";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./js/main.js",
  "./js/firebase-config.js",
  "./js/screens/auth.js",
  "./js/screens/dashboard.js",
  "./js/screens/atividade.js",
  "./js/screens/analise.js",
  "./js/screens/settings.js",
  "./js/screens/simulador.js",
  "./js/utils/indicator-info.js",
  "./js/utils/scoring.js",
  "./js/utils/num.js",
  "./js/utils/reportGenerator.js",
  "./js/utils/normalize.js",
  "./js/utils/portfolioPositions.js",
  "./js/engines/quality.js",
  "./js/engines/momentum.js",
  "./js/engines/valuation.js",
  "./js/engines/risk.js",
  "./js/engines/score-v2.js",
  "./js/engines/factors.js",
  "./js/engines/portfolio-health.js",
  "./js/engines/sizing.js",
  "./js/engines/risk-contrib.js",
  "./js/engines/etf-overlap.js",
  "./js/engines/correlation.js",
  "./js/engines/stress-test.js",
  "./js/engines/thematic.js",
  "./js/engines/macro.js",
  "./js/engines/dna.js",
  "./js/engines/temporal.js",
  "./js/engines/observations.js",
  "./js/engines/rebalance.js",
  "./js/engines/economic-drivers.js",
  "./screens/auth.html",
  "./screens/dashboard.html",
  "./screens/atividade.html",
  "./screens/analise.html",
  "./screens/settings.html",
  "./screens/portfolio-intel.html",
  "./screens/simulador.html",
  "./icons/icon-192.png",
];

// Instalação do Service Worker
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Caching assets...");
      return cache.addAll(ASSETS);
    }),
  );
  self.skipWaiting(); // Força a nova versão a tornar-se ativa imediatamente
});

// Ativação e limpeza de caches antigos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );
  self.clients.claim(); // Garante que o SW controla todas as abas abertas imediatamente
});

// Estratégia: Network-First para HTML/JS (garante atualizações), Cache-First para imagens/CSS
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Para ficheiros de navegação ou lógica, preferimos rede para apanhar atualizações
  if (
    event.request.mode === "navigate" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".html")
  ) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
  } else {
    // Para outros (CSS, imagens), Cache-First
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      }),
    );
  }
});
