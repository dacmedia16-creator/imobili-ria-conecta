import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHECKS_NAO_DOCUMENTAIS,
  MIDIA_OBRIGATORIA_MSG,
  MIDIA_OCORRENCIA_OBRIGATORIA_MSG,
  midiaPreenchida,
  validarProntaParaRevisao,
} from "./status";
import type { SaleRow } from "@/lib/database.types";

const venda = (midia: string | null) => ({ midia }) as unknown as SaleRow;
const pendMidia = (midia: string | null) =>
  validarProntaParaRevisao(venda(midia), {}, null, []).filter((p) => p.campo === "midia");

describe("Mídia obrigatória para enviar a venda", () => {
  it("vazia, nula ou em branco não conta como preenchida", () => {
    expect(midiaPreenchida(null)).toBe(false);
    expect(midiaPreenchida(undefined)).toBe(false);
    expect(midiaPreenchida("")).toBe(false);
    expect(midiaPreenchida("  ")).toBe(false);
    expect(midiaPreenchida("Instagram")).toBe(true);
  });

  it("vira pendência de envio quando falta, e some quando preenchida", () => {
    expect(pendMidia(null)).toHaveLength(1);
    expect(pendMidia(null)[0].mensagem).toMatch(/Mídia/);
    expect(pendMidia("Placa")).toHaveLength(0);
  });

  it("entra na contagem de checagens da barra de progresso", () => {
    expect(CHECKS_NAO_DOCUMENTAIS).toContain("midia");
  });

  it("a mensagem da tela é a mesma que o banco devolve (quem burla pela API vê o mesmo texto)", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../supabase/migrations/20261008130000_midia_obrigatoria_ao_avancar.sql",
      ),
      "utf8",
    );
    expect(sql).toContain(MIDIA_OBRIGATORIA_MSG);
    expect(sql).toContain(MIDIA_OCORRENCIA_OBRIGATORIA_MSG);
  });
});
