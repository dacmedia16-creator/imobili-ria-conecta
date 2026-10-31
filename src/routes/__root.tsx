import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import type { RouterAuth } from "@/lib/route-access";

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
const HOMOLOG_URL = "https://adm-max-homolog.dacmedia16.workers.dev";
// Marca neutra (t_475d2778): antes do login a imobiliária ainda não é conhecida, e o mesmo
// portal atende várias imobiliárias. A og-image antiga dizia "Sistema exclusivo RE/MAX Única
// Escolha", por isso saiu do cartão de compartilhamento.
const SITE_TITLE = IS_HOMOLOG ? "ADM MAX — Homologação" : "ADM MAX — Portal da imobiliária";
const SITE_DESCRIPTION = IS_HOMOLOG
  ? "Ambiente interno de demonstração do ADM MAX, com dados fictícios."
  : "ADM MAX: gestão de vendas, contratos e comissões para imobiliárias, do cadastro ao pós-venda.";
const SHARE_DESCRIPTION = IS_HOMOLOG
  ? "Ambiente interno de demonstração do ADM MAX."
  : SITE_DESCRIPTION;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient; auth: RouterAuth }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SHARE_DESCRIPTION },
      { property: "og:type", content: "website" },
      // Domínio novo (t_97380535). O antigo unicaescolha.com.br segue no ar e depois redireciona (301).
      { property: "og:url", content: IS_HOMOLOG ? HOMOLOG_URL : "https://app.somosmaxhub.com.br" },
      { property: "og:locale", content: "pt_BR" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SHARE_DESCRIPTION },
      ...(IS_HOMOLOG ? [{ name: "robots", content: "noindex, nofollow, noarchive" }] : []),
      { name: "theme-color", content: "#0b1330" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      // "default" = barra de status clara com relógio escuro, e a página começa abaixo dela
      // (t_1ebe1a47). Com "black-translucent" o relógio branco ficava por cima do cabeçalho branco.
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "ADM MAX" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      ...(!IS_HOMOLOG
        ? [
            { rel: "icon", type: "image/png", href: "/favicon-32.png" },
            { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
            { rel: "manifest", href: "/manifest.webmanifest" },
          ]
        : []),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster
        richColors
        position="top-right"
        // Avisos abaixo do relógio/bateria no app da tela inicial (t_1ebe1a47); 0 no navegador.
        mobileOffset={{ top: "calc(16px + env(safe-area-inset-top))" }}
      />
    </QueryClientProvider>
  );
}
