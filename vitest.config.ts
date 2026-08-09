import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  // Testes de integração (src/**/*.integration.test.ts) precisam de SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
  // em process.env pra montar o client admin — vitest, ao contrário do `vite dev`, não injeta o .env
  // em process.env sozinho.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      // Os testes de integração (*.integration.test.ts) fazem várias chamadas de rede reais ao
      // Supabase por caso — o default de 5s do vitest estoura fácil. Não atrapalha os testes
      // unitários puros: é só o teto máximo de espera, não um atraso adicionado.
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  };
});
