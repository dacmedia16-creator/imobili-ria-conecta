import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AVISO_SO_ENVIA,
  SINAL_TIPO,
  VALIDADE_PADRAO_DIAS,
  diasParaVencer,
  lerPropostaPublica,
  lerResultadoAssinatura,
  montarMensagem,
  precisaConjuge,
  propostaLinkUrl,
  situacaoVisivel,
  somarDias,
  textoErroAssinatura,
  waMe,
} from "@/lib/proposta-compra";
import {
  canalDoAmbiente,
  chaveDoEnvio,
  enviarCodigos,
  type ItemEnvio,
} from "@/lib/proposta-compra-envio.server";
import { ORGANIZATION_MODULES } from "@/lib/platform-organizations";
import { INVITE_MODULES_OFF } from "@/lib/org-invites";

const MIG = readFileSync(
  new URL("../../supabase/migrations/20261109120000_proposta_compra.sql", import.meta.url),
  "utf8",
);
const RB = readFileSync(
  new URL("../../supabase/rollback/20261109120000_proposta_compra.sql", import.meta.url),
  "utf8",
);
const ENVIO = readFileSync(new URL("./proposta-compra-envio.server.ts", import.meta.url), "utf8");
const FN = readFileSync(new URL("./proposta-compra.functions.ts", import.meta.url), "utf8");

const TOKEN = "A".repeat(43);
const item = (o: Partial<ItemEnvio> = {}): ItemEnvio => ({
  codigo_id: "c1",
  codigo: "123456",
  telefone: "15999990000",
  token: TOKEN,
  parte_nome: "João Silva",
  papel: "comprador",
  ordem: 1,
  imobiliaria: "REMAX Teste",
  endereco: "Rua A, 10, Centro, Sorocaba/SP",
  corretor_nome: "Maria Corretora",
  corretor_telefone: "(15) 98888-7777",
  ...o,
});

describe("regras puras", () => {
  it("D9: validade padrão 5 dias corridos (inclui fim de semana)", () => {
    expect(VALIDADE_PADRAO_DIAS).toBe(5);
    expect(somarDias("2026-11-06", 5)).toBe("2026-11-11"); // sexta + 5 corridos
    expect(somarDias("2026-12-30", 5)).toBe("2027-01-04");
    expect(diasParaVencer("2026-11-11", "2026-11-09")).toBe(2);
  });
  it("D7: sinal sempre arras confirmatórias, sem escolha", () => {
    expect(SINAL_TIPO).toBe("confirmatorias");
    expect(MIG).toMatch(/CHECK \(sinal_tipo = 'confirmatorias'\)/);
  });
  it("todas as situações; vencida calculada pela validade", () => {
    expect(situacaoVisivel("aguardando_assinaturas", "2026-11-08", "2026-11-09")).toBe("vencida");
    expect(situacaoVisivel("aguardando_assinaturas", "2026-11-09", "2026-11-09")).toBe(
      "aguardando_assinaturas",
    );
    for (const s of ["rascunho", "aceita", "recusada", "contraproposta"])
      expect(situacaoVisivel(s, "2026-01-01", "2026-11-09")).toBe(s);
  });
  it("cônjuge obrigatório para casado e união estável", () => {
    expect(precisaConjuge("casado")).toBe(true);
    expect(precisaConjuge("uniao_estavel")).toBe(true);
    expect(precisaConjuge("solteiro")).toBe(false);
    expect(precisaConjuge(null)).toBe(false);
  });
  it("wa.me do corretor só com dígitos e DDI", () => {
    expect(waMe("(15) 98888-7777")).toBe("https://wa.me/5515988887777");
    expect(waMe("5515988887777")).toBe("https://wa.me/5515988887777");
    expect(waMe("123")).toBeNull();
  });
});

describe("mensagem individual do WhatsApp", () => {
  it("tem imobiliária, endereço, link, código, wa.me do corretor do negócio e o aviso", () => {
    const m = montarMensagem({
      imobiliaria: "REMAX Teste",
      endereco: "Rua A, 10",
      link: propostaLinkUrl("https://adm.example/", TOKEN),
      codigo: "654321",
      parteNome: "João Silva",
      corretorNome: "Maria",
      corretorTelefone: "15988887777",
    });
    expect(m).toContain("*REMAX Teste*");
    expect(m).toContain("Rua A, 10");
    expect(m).toContain(`https://adm.example/proposta/${TOKEN}`);
    expect(m).toContain("*654321*");
    expect(m).toContain("Dúvidas? Fale com seu corretor Maria: https://wa.me/5515988887777");
    expect(m).toContain(AVISO_SO_ENVIA);
    expect(m).toContain("Olá, João!");
  });
  it("recusa código inválido", () => {
    expect(() =>
      montarMensagem({
        imobiliaria: "X",
        endereco: null,
        link: "l",
        codigo: "12",
        parteNome: null,
        corretorNome: null,
        corretorTelefone: null,
      }),
    ).toThrow();
  });
});

describe("envio: só ZIONTALK_API_KEY e simulação por padrão", () => {
  const env = {
    ZIONTALK_API_KEY: "chave-avisos",
    ZIONTALK_LEADS_IA_API_KEY: "chave-leads",
    ZIONTALK_MAX_API_KEY: "chave-max",
  };
  it("a única chave lida é ZIONTALK_API_KEY", () => {
    expect(chaveDoEnvio(env)).toBe("chave-avisos");
    expect(chaveDoEnvio({ ZIONTALK_LEADS_IA_API_KEY: "x", ZIONTALK_MAX_API_KEY: "y" })).toBeNull();
    // O código lê UMA chave do ambiente: ZIONTALK_API_KEY (as outras só aparecem no comentário de proibição).
    expect(ENVIO.match(/env\.ZIONTALK_[A-Z_]+/g)).toEqual(["env.ZIONTALK_API_KEY"]);
    expect(FN).not.toMatch(/ZIONTALK_[A-Z_]*API_KEY/);
  });
  it("sem PROPOSTA_WHATSAPP_REAL=1 é simulação e nada é enviado", async () => {
    const real = vi.fn(async (_chave: string, _tel: string, _texto: string) => true);
    const canal = canalDoAmbiente(env, real);
    expect(canal.modo).toBe("simulacao");
    const r = await enviarCodigos([item(), item({ codigo_id: "c2", papel: "vendedor" })], {
      origin: "https://x",
      canal,
    });
    expect(r.map((x) => x.status)).toEqual(["simulado", "simulado"]);
    expect(real).not.toHaveBeenCalled();
  });
  it("real usa a chave dos avisos, uma mensagem por parte, e respeita o 'só para'", async () => {
    const real = vi.fn(async (_chave: string, _tel: string, _texto: string) => true);
    const canal = canalDoAmbiente(
      { ...env, PROPOSTA_WHATSAPP_REAL: "1", PROPOSTA_WHATSAPP_SO_PARA: "15999990000" },
      real,
    );
    expect(canal.modo).toBe("real");
    const reg = vi.fn(async () => {});
    const r = await enviarCodigos([item(), item({ codigo_id: "c2", telefone: "15911112222" })], {
      origin: "https://x",
      canal,
      registrar: reg,
      soPara: "15999990000",
    });
    expect(r.map((x) => x.status)).toEqual(["enviado", "bloqueado"]);
    expect(real).toHaveBeenCalledTimes(1);
    expect(real.mock.calls[0][0]).toBe("chave-avisos");
    expect(real.mock.calls[0][1]).toBe("5515999990000");
    // eslint-disable-next-line no-control-regex -- intencional: confere que só sobrou ASCII (ZionTalk recusa acento)
    expect(String(real.mock.calls[0][2])).not.toMatch(/[^\x00-\x7E]/);
    expect(reg).toHaveBeenCalledWith("c1", true, null);
    expect(JSON.stringify(r)).not.toMatch(/123456|15999990000/); // retorno sem código nem telefone
  });
  it("sem chave configurada fica em simulação mesmo com REAL=1", () => {
    expect(canalDoAmbiente({ PROPOSTA_WHATSAPP_REAL: "1", ZIONTALK_MAX_API_KEY: "y" }).modo).toBe(
      "simulacao",
    );
  });
});

describe("leitura pública em lista fechada", () => {
  const base = {
    ok: true,
    imobiliaria: "REMAX",
    documento: "PC-1",
    versao: 2,
    situacao: "aguardando_assinaturas",
    conteudo_hash: "a".repeat(64),
    voce: {
      papel: "comprador",
      ordem: 1,
      nome: "João",
      documento_final: "66",
      cpf_cnpj: "99988877766",
    },
    imovel: { endereco: "Rua", matricula: "1", observacoes: "INTERNO" },
    valores: { oferta: "480000.00", forma_pagamento: "a_vista", sinal_tipo: "penitenciais" },
    condicoes: { validade_dias: 5 },
    partes: [
      { papel: "vendedor", ordem: 1, nome: "V", assinou: true, cpf_cnpj: "111", telefone: "159" },
    ],
    corretor: { nome: "M", telefone: "15988887777" },
    capture_id: "x",
  };
  it("só copia os campos permitidos (sem CPF/telefone de terceiros nem ids internos)", () => {
    const r = lerPropostaPublica(base);
    expect(r.ok).toBe(true);
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/99988877766|INTERNO|"cpf_cnpj"|"telefone"|capture_id/);
    if (r.ok) {
      expect(r.dados.valores.oferta).toBe(480000);
      expect(r.dados.valores.sinalTipo).toBe("confirmatorias");
      expect(r.dados.corretor.whatsapp).toBe("https://wa.me/5515988887777");
    }
  });
  it("erro do banco vira erro conhecido", () => {
    expect(lerPropostaPublica({ ok: false, erro: "limite" })).toEqual({
      ok: false,
      erro: "limite",
    });
    expect(lerPropostaPublica(null)).toEqual({ ok: false, erro: "indisponivel" });
  });
  it("código certo, errado, vencido e limite", () => {
    expect(
      lerResultadoAssinatura({ ok: true, resultado: "assinado", situacao: "aceita", faltam: 0 }),
    ).toEqual({
      ok: true,
      situacao: "aceita",
      faltam: 0,
    });
    const errado = lerResultadoAssinatura({ ok: false, erro: "codigo_errado", restantes: 4 });
    expect(errado).toEqual({ ok: false, erro: "codigo_errado", restantes: 4 });
    if (!errado.ok) expect(textoErroAssinatura(errado)).toContain("4 tentativa");
    expect(lerResultadoAssinatura({ ok: false, erro: "codigo_vencido" })).toEqual({
      ok: false,
      erro: "codigo_vencido",
    });
    expect(lerResultadoAssinatura({ ok: false, erro: "limite" })).toEqual({
      ok: false,
      erro: "limite",
    });
  });
});

describe("migration 20261109120000", () => {
  const nomes = (x: string) => [...x.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
  it("módulo na lista do código, desligado no convite; CHECK e RPC = lista; rollback volta a anterior", () => {
    expect(ORGANIZATION_MODULES).toContain("proposta_compra");
    expect(INVITE_MODULES_OFF).toContain("proposta_compra");
    const novo = [...ORGANIZATION_MODULES].sort();
    expect(nomes(MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(novo);
    expect(nomes(MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(novo);
    const anterior = novo.filter((x) => x !== "proposta_compra");
    expect(nomes(RB.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(anterior);
    expect(nomes(RB.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(anterior);
  });
  it("nasce desligado (sem seed) e o rollback apaga a chave antes do CHECK", () => {
    expect(MIG.match(/INSERT INTO public\.organization_modules/g)).toHaveLength(1);
    const del = RB.indexOf(
      "DELETE FROM public.organization_modules WHERE module = 'proposta_compra'",
    );
    expect(del).toBeGreaterThan(0);
    expect(del).toBeLessThan(RB.indexOf("ADD CONSTRAINT organization_modules_module_check"));
  });
  it("aditiva: nenhum status novo, fluxo de status intocado; venda só pela função existente", () => {
    expect(MIG).not.toMatch(
      /ALTER TYPE public\.sale_status|change_sale_status|validate_sale_status/,
    );
    expect(MIG).not.toMatch(/INSERT INTO public\.sales\b/);
    expect(MIG).not.toMatch(/UPDATE public\.sales SET status/);
    expect(MIG).toMatch(/public\.exclusive_virar_venda\(_p\.capture_id\)/);
    expect(MIG).not.toMatch(
      /DROP TABLE|ALTER TABLE public\.(sales|sale_parties|leads|exclusive_captures)\b/,
    );
  });
  it("guarda só hash de código e de token", () => {
    expect(MIG).toMatch(/codigo_hash text NOT NULL/);
    expect(MIG).toMatch(/token_hash text NOT NULL UNIQUE/);
    expect(MIG).not.toMatch(/\bcodigo text\b/);
  });
  it("o rollback derruba todas as funções que a migration cria", () => {
    const criadas = [...MIG.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(/g)]
      .map((m) => m[1])
      .filter((n) => n !== "public.platform_set_organization_module");
    for (const f of criadas) expect(RB).toContain(`DROP FUNCTION IF EXISTS ${f}(`);
  });
});
