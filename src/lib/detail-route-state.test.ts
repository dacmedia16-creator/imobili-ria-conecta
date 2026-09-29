import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DETAIL_NOT_FOUND_MESSAGE,
  isDetailRouteId,
  isTransientLoadError,
  resolveDetailRouteState,
} from "@/lib/detail-route-state";

// Achado da homologação de 29/09/2026: /vendas/<id de outra imobiliária> ficava para sempre em
// "Carregando…". A tela precisa terminar num estado neutro que não revele se o ID existe.

const ID = "5b47cdca-0d00-4a00-8a00-000000000001";

describe("resolveDetailRouteState", () => {
  it("mantém carregando enquanto a consulta não voltou", () => {
    expect(resolveDetailRouteState({ loading: true, record: null })).toBe("loading");
  });

  it("mostra a venda quando a linha voltou", () => {
    expect(resolveDetailRouteState({ loading: false, record: { id: ID } })).toBe("ready");
  });

  it("ID inexistente e ID de outra imobiliária (RLS: zero linhas) dão o MESMO estado", () => {
    const inexistente = resolveDetailRouteState({ loading: false, record: null, error: null });
    const outraImobiliaria = resolveDetailRouteState({ loading: false, record: null });
    expect(inexistente).toBe("not_found");
    expect(outraImobiliaria).toBe(inexistente);
  });

  it.each([
    ["PGRST116 (.single sem linha)", { code: "PGRST116", message: "0 rows" }],
    ["42501 (permissão negada)", { code: "42501", message: "permission denied" }],
    ["22P02 (UUID inválido)", { code: "22P02", message: "invalid input syntax for type uuid" }],
    ["HTTP 406", { status: 406 }],
  ])("%s vira 'não encontrada ou sem acesso', nunca carregamento infinito", (_, error) => {
    expect(resolveDetailRouteState({ loading: false, record: null, error })).toBe("not_found");
  });

  it("falha de rede/servidor oferece tentar de novo em vez de dizer que não existe", () => {
    const rede = { message: "TypeError: Failed to fetch", code: "" };
    expect(isTransientLoadError(rede)).toBe(true);
    expect(resolveDetailRouteState({ loading: false, record: null, error: rede })).toBe("error");
    expect(isTransientLoadError({ status: 503 })).toBe(true);
  });
});

describe("isDetailRouteId", () => {
  it("aceita UUID e recusa lixo sem consultar o banco", () => {
    expect(isDetailRouteId(ID)).toBe(true);
    expect(isDetailRouteId("abc")).toBe(false);
    expect(isDetailRouteId("")).toBe(false);
    expect(isDetailRouteId(`${ID}' or 1=1`)).toBe(false);
    expect(isDetailRouteId(undefined)).toBe(false);
  });
});

describe("contrato das telas de detalhe por ID", () => {
  const venda = readFileSync("src/routes/_authenticated/vendas.$id.tsx", "utf8");
  const captacao = readFileSync("src/routes/_authenticated/exclusividades.$id.tsx", "utf8");

  it("vendas/:id não usa mais 'sem venda = carregando'", () => {
    expect(venda).not.toMatch(/if \(loading \|\| !sale\)\s*return <div[^>]*>Carregando/);
    expect(venda).toContain("resolveDetailRouteState(");
    expect(venda).toContain("DETAIL_NOT_FOUND_MESSAGE.venda");
    expect(venda).toContain('backTo="/vendas"');
    // O load() encerra o carregamento quando a venda não voltou.
    expect(venda).toMatch(/if \(!s\.data\) \{[\s\S]{0,400}setLoading\(false\);[\s\S]{0,40}return;/);
  });

  it("exclusividades/:id usa a mesma mensagem neutra e não exibe o erro cru do banco", () => {
    expect(captacao).toContain("DETAIL_NOT_FOUND_MESSAGE.captacao");
    expect(captacao).not.toContain('"Sem acesso a esta captação"');
  });

  it("a mensagem não diferencia inexistente de outra imobiliária", () => {
    for (const msg of Object.values(DETAIL_NOT_FOUND_MESSAGE)) {
      expect(msg).toMatch(/não encontrada ou sem acesso/);
      expect(msg).not.toMatch(/outra imobili|pertence|existe/i);
    }
  });
});
