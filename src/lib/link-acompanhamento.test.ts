import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ETAPAS,
  ETAPA_POR_STATUS,
  LINK_INDISPONIVEL,
  LINK_TOKEN_RE,
  TODOS_STATUS,
  dataBr,
  etapaDoStatus,
  juntarNomes,
  lerLinksVenda,
  lerRespostaPublica,
  linkAcompanhamentoUrl,
  primeiroNome,
  textoAberturas,
} from "@/lib/link-acompanhamento";
import { ORGANIZATION_MODULES } from "@/lib/platform-organizations";

const MIG = readFileSync(
  new URL("../../supabase/migrations/20261108200000_link_acompanhamento.sql", import.meta.url),
  "utf8",
);
const RB = readFileSync(
  new URL("../../supabase/rollback/20261108200000_link_acompanhamento.sql", import.meta.url),
  "utf8",
);
const PAGINA = readFileSync(new URL("../routes/acompanhar.$token.tsx", import.meta.url), "utf8");
const FN = readFileSync(new URL("./link-acompanhamento.functions.ts", import.meta.url), "utf8");

describe("mapeamento de status para as 3 etapas", () => {
  it("todo status do enum tem etapa (status novo sem mapeamento = falha)", () => {
    expect([...TODOS_STATUS].sort()).toEqual(Object.keys(ETAPA_POR_STATUS).sort());
    for (const s of TODOS_STATUS) expect([0, 1, 2, 3]).toContain(ETAPA_POR_STATUS[s]);
  });

  it("etapas exatamente como Denis pediu", () => {
    const por = (e: number) =>
      TODOS_STATUS.filter((s) => ETAPA_POR_STATUS[s] === e)
        .slice()
        .sort();
    expect(por(1)).toEqual(
      [
        "rascunho",
        "enviada_revisao",
        "devolvida_ajuste",
        "aprovada_gestor",
        "enviada_juridico",
        "em_elaboracao_contrato",
        "contrato_conferencia_gestor",
        "contrato_conferencia_corretor",
        "contrato_ok_corretor",
      ].sort(),
    );
    expect(por(2)).toEqual(["aguardando_assinatura"]);
    // Ocorrências são internas: o link continua "Contrato assinado".
    expect(por(3)).toEqual(
      [
        "contrato_assinado",
        "ocorrencia_pendente",
        "ocorrencia_analise_financeiro",
        "ocorrencia_devolvida_gestor",
        "ocorrencia_concluida",
      ].sort(),
    );
    expect(por(0)).toEqual(["arquivada", "cancelada"]);
    expect(ETAPAS).toEqual(["Preparando o contrato", "Aguardando assinatura", "Contrato assinado"]);
  });

  it("status desconhecido = indisponível (não inventa etapa)", () => {
    expect(etapaDoStatus("status_que_nao_existe")).toBe(0);
    expect(etapaDoStatus("cancelada")).toBe(0);
    expect(etapaDoStatus("ocorrencia_pendente")).toBe(3);
  });

  it("banco e tela usam o MESMO mapa (acompanhamento_etapa)", () => {
    const corpo = MIG.slice(
      MIG.indexOf("FUNCTION public.acompanhamento_etapa"),
      MIG.indexOf("END\n$$;", MIG.indexOf("FUNCTION public.acompanhamento_etapa")),
    );
    const banco = Object.fromEntries(
      [...corpo.matchAll(/WHEN '([a-z_]+)' THEN (\d)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(banco).toEqual(ETAPA_POR_STATUS);
  });
});

describe("resposta pública: só campos permitidos", () => {
  const base = {
    ok: true,
    imobiliaria: "RE/MAX Teste",
    lado: "comprador",
    imovel: { linha1: "Rua A, 1", linha2: "Centro · Sorocaba/SP" },
    compradores: ["João", "Marina"],
    vendedores: ["Carlos"],
    corretor: "Ana Souza",
    etapa: 3,
    datas: { preparando: "2026-11-01", aguardando: "2026-11-05", assinado: "2026-11-08" },
    atualizado_em: "2026-11-08",
    google_url: "https://g.page/r/x/review",
  };

  it("lista fechada: campo a mais vindo do banco é descartado", () => {
    const r = lerRespostaPublica({
      ...base,
      valor_negociado: 777000,
      cpf: "123",
      telefone: "1599",
      email: "a@b.c",
      status: "ocorrencia_pendente",
      comissao: 1,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.dados).sort()).toEqual(
      [
        "atualizado_em",
        "compradores",
        "corretor",
        "datas",
        "etapa",
        "google_url",
        "imobiliaria",
        "imovel",
        "lado",
        "vendedores",
      ].sort(),
    );
    expect(JSON.stringify(r.dados)).not.toMatch(/777000|cpf|telefone|email|ocorrencia|comissao/);
  });

  it("botão do Google só no contrato assinado E com o campo preenchido (https)", () => {
    const g = (x: object) => {
      const r = lerRespostaPublica({ ...base, ...x });
      return r.ok ? r.dados.google_url : "erro";
    };
    expect(g({})).toBe("https://g.page/r/x/review");
    expect(g({ etapa: 2 })).toBeNull();
    expect(g({ etapa: 1 })).toBeNull();
    expect(g({ google_url: null })).toBeNull();
    expect(g({ google_url: "" })).toBeNull();
    expect(g({ google_url: "javascript:alert(1)" })).toBeNull();
  });

  it("indisponível / erro / etapa inválida = link indisponível", () => {
    expect(lerRespostaPublica({ ok: false, erro: "indisponivel" })).toEqual({ ok: false });
    expect(lerRespostaPublica({ ...base, etapa: 0 })).toEqual({ ok: false });
    expect(lerRespostaPublica({ ...base, etapa: 4 })).toEqual({ ok: false });
    expect(lerRespostaPublica(null)).toEqual({ ok: false });
    expect(LINK_INDISPONIVEL).toBe("Este link não está mais disponível. Fale com o seu corretor.");
  });
});

describe("bloco da venda", () => {
  const tok = "a".repeat(43);
  it("lê os links e descarta token inválido", () => {
    const r = lerLinksVenda({
      disponivel: true,
      links: [
        { lado: "vendedor", token: tok, aberturas: 3, ultima_abertura: "2026-11-08T17:05:00Z" },
        { lado: "comprador", token: "b".repeat(43), aberturas: 0, ultima_abertura: null },
        { lado: "comprador", token: "curto" },
        { lado: "outro", token: tok },
      ],
    });
    expect(r.disponivel).toBe(true);
    expect(r.links.map((l) => l.lado)).toEqual(["comprador", "vendedor"]);
    expect(lerLinksVenda(null)).toEqual({ disponivel: false, links: [] });
  });

  it("texto das aberturas", () => {
    expect(textoAberturas({ aberturas: 0, ultima_abertura: null })).toBe("Ainda não abriu");
    expect(textoAberturas({ aberturas: 1, ultima_abertura: "2026-11-08T17:05:00Z" })).toBe(
      "Aberto 1 vez · última em 08/11/2026, 14:05",
    );
    expect(textoAberturas({ aberturas: 3, ultima_abertura: null })).toBe("Aberto 3 vezes");
  });

  it("URL do link e formato do token", () => {
    expect(linkAcompanhamentoUrl("https://app.x.com/", tok)).toBe(
      `https://app.x.com/acompanhar/${tok}`,
    );
    expect(LINK_TOKEN_RE.test(tok)).toBe(true);
    expect(LINK_TOKEN_RE.test("a".repeat(42))).toBe(false);
    expect(LINK_TOKEN_RE.test(`${"a".repeat(42)}/`)).toBe(false);
  });

  it("nomes e datas", () => {
    expect(juntarNomes(["João"])).toBe("João");
    expect(juntarNomes(["João", "Marina"])).toBe("João e Marina");
    expect(juntarNomes(["A", "B", "C"])).toBe("A, B e C");
    expect(primeiroNome("  Ana Souza ")).toBe("Ana");
    expect(dataBr("2026-11-08")).toBe("08/11/2026");
    expect(dataBr(null)).toBeNull();
  });
});

describe("página pública e servidor", () => {
  it("noindex, sem referrer, sem SSR", () => {
    expect(PAGINA).toMatch(/name: "robots", content: "noindex, nofollow, noarchive"/);
    expect(PAGINA).toMatch(/name: "referrer", content: "no-referrer"/);
    expect(PAGINA).toMatch(/ssr: false/);
    expect(PAGINA).toMatch(/Este link é só seu\. Não compartilhe\./);
  });
  it("a página não acessa tabelas: só a server function (service_role) chama a RPC", () => {
    expect(PAGINA).not.toMatch(/supabase|\.from\(|\.rpc\(/);
    expect(FN).toMatch(/rpc\(\s*"acompanhamento_publico"/);
    expect(FN).toMatch(/return lerRespostaPublica\(r\)/);
    expect(FN).not.toMatch(/console\./);
  });
});

describe("migration 20261108200000", () => {
  const nomes = (x: string) => [...x.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();

  it("CHECK e RPC da plataforma = lista anterior + link_acompanhamento; rollback volta a anterior", () => {
    // proposta_compra (t_4cff61a6) veio depois, na migration 20261109120000.
    const novo = [...ORGANIZATION_MODULES]
      .filter((x) => x !== "proposta_compra" && x !== "locacao" && x !== "ajuda_max_locacao")
      .sort();
    const anterior = novo.filter((x) => x !== "link_acompanhamento");
    expect(novo).toContain("link_acompanhamento");
    expect(nomes(MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(novo);
    expect(nomes(MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(novo);
    expect(nomes(RB.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(anterior);
    expect(nomes(RB.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(anterior);
  });

  it("nasce desligado (sem seed); o rollback apaga a chave antes de voltar o CHECK", () => {
    expect(MIG.match(/INSERT INTO public\.organization_modules/g)).toHaveLength(1);
    const del = RB.indexOf(
      "DELETE FROM public.organization_modules WHERE module = 'link_acompanhamento'",
    );
    expect(del).toBeGreaterThan(0);
    expect(del).toBeLessThan(RB.indexOf("ADD CONSTRAINT organization_modules_module_check"));
  });

  it("aditiva: não altera venda, partes, histórico nem o fluxo de status", () => {
    expect(MIG).not.toMatch(/ALTER TYPE public\.sale_status/);
    expect(MIG).not.toMatch(
      /(UPDATE|DELETE FROM|INSERT INTO|ALTER TABLE) public\.(sales|sale_parties|sale_status_history)\b/,
    );
    expect(MIG).not.toMatch(/validate_sale_status_transition|change_sale_status/);
    expect(MIG).not.toMatch(/DROP (TABLE|FUNCTION|COLUMN)/);
  });

  it("guarda só o hash; tabelas sem acesso direto; RPC pública só service_role", () => {
    expect(MIG).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(MIG).not.toMatch(/\btoken text\b/);
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.sale_acompanhamento_links FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.sale_acompanhamento_tentativas FROM PUBLIC, anon, authenticated;/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.acompanhamento_publico\(text, text\) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public\.acompanhamento_publico\(text, text\) TO service_role;/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.acompanhamento_token\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
    );
  });

  it("toda função SECURITY DEFINER fixa search_path vazio", () => {
    const defs = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION [^;]*?AS \$\$/gs)].map((m) => m[0]);
    expect(defs.length).toBeGreaterThan(10);
    for (const d of defs.filter((x) => /SECURITY DEFINER/.test(x)))
      expect(d).toMatch(/SET search_path TO ''/);
  });

  it("resposta pública não lê nenhuma coluna de valor nem dado pessoal", () => {
    const fn = MIG.slice(MIG.indexOf("FUNCTION public.acompanhamento_publico"));
    const saida = fn.slice(fn.indexOf("RETURN jsonb_build_object(\n    'ok', true"));
    expect(saida).not.toMatch(
      /valor|comissao|percentual|parceria|cpf|\.rg\b|telefone|email|motivo|observ|forma_pagamento|_s\.status|'id'/,
    );
    // _s.id só aparece como filtro das subconsultas (partes), nunca como campo devolvido.
    expect(saida.match(/_s\.id/g)?.length).toBe(2);
    expect(saida).toMatch(/WHERE p\.sale_id = _s\.id AND p\.papel LIKE 'comprador%'/);
  });
});
