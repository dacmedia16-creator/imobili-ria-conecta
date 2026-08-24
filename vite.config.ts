// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// O browser só recebe variáveis com prefixo VITE_. Em produção, as mesmas
// variáveis públicas também precisam existir como bindings do Worker, por isso
// wrangler.toml é a fonte única. Isso evita que um build novo publique um bundle
// sem a configuração do Supabase.
const wranglerConfig = readFileSync(
  fileURLToPath(new URL("./wrangler.toml", import.meta.url)),
  "utf8",
);

function requirePublicBuildVar(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY") {
  const viteName = `VITE_${name}`;
  const configuredValue = process.env[viteName] ?? process.env[name];
  const tomlValue = wranglerConfig.match(
    new RegExp(`^${name}\\s*=\\s*["']([^"']+)["']`, "m"),
  )?.[1];
  const value = configuredValue ?? tomlValue;

  if (!value) {
    throw new Error(
      `Build bloqueado: ${viteName} não foi configurada no ambiente nem ${name} em wrangler.toml.`,
    );
  }

  process.env[viteName] = value;
}

requirePublicBuildVar("SUPABASE_URL");
requirePublicBuildVar("SUPABASE_PUBLISHABLE_KEY");

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
