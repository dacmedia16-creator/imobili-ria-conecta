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

const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";
const HOMOLOG_URL = "https://adm-max-homolog.dacmedia16.workers.dev";

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

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
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

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: IS_HOMOLOG ? "ADM MAX — Homologação" : "RE/MAX Única Escolha — Portal Interno" },
      {
        name: "description",
        content: IS_HOMOLOG
          ? "Ambiente interno de demonstração do ADM MAX, com dados fictícios."
          : "Sistema exclusivo RE/MAX Única Escolha para gestão de vendas, contratos e comissões, do cadastro ao pós-venda.",
      },
      {
        property: "og:title",
        content: IS_HOMOLOG ? "ADM MAX — Homologação" : "RE/MAX Única Escolha — Portal Interno",
      },
      {
        property: "og:description",
        content: IS_HOMOLOG
          ? "Ambiente interno de demonstração do ADM MAX."
          : "Sistema exclusivo RE/MAX Única Escolha para gestão de vendas, contratos e comissões, do cadastro ao pós-venda.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: IS_HOMOLOG ? HOMOLOG_URL : "https://unicaescolha.com.br" },
      ...(!IS_HOMOLOG
        ? [
            { property: "og:image", content: "https://unicaescolha.com.br/og-image.png" },
            { property: "og:image:width", content: "1200" },
            { property: "og:image:height", content: "630" },
          ]
        : []),
      { property: "og:locale", content: "pt_BR" },
      { name: "twitter:card", content: IS_HOMOLOG ? "summary" : "summary_large_image" },
      {
        name: "twitter:title",
        content: IS_HOMOLOG ? "ADM MAX — Homologação" : "RE/MAX Única Escolha — Portal Interno",
      },
      {
        name: "twitter:description",
        content: IS_HOMOLOG
          ? "Ambiente interno de demonstração do ADM MAX."
          : "Sistema exclusivo RE/MAX Única Escolha para gestão de vendas, contratos e comissões, do cadastro ao pós-venda.",
      },
      ...(!IS_HOMOLOG
        ? [{ name: "twitter:image", content: "https://unicaescolha.com.br/og-image.png" }]
        : []),
      ...(IS_HOMOLOG ? [{ name: "robots", content: "noindex, nofollow, noarchive" }] : []),
      { name: "theme-color", content: "#0b1330" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: IS_HOMOLOG ? "ADM MAX" : "RE/MAX Portal" },
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
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
