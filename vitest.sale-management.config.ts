import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: [
      "src/lib/sale-management-capabilities.test.ts",
      "src/lib/sale-permissions.test.ts",
      "src/lib/sale-financial-calc.test.ts",
      "src/lib/vendas-indicador-save.test.ts",
    ],
  },
});
