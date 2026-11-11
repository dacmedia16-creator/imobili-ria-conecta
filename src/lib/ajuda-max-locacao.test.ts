// Ajuda MAX na Locação — fatia 1/2 (t_b037935e).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  LIMITE_DIA,
  TEXTO_DESLIGADO,
  TEXTO_INDISPONIVEL,
  TEXTO_NAO_SEI,
  formatarResposta,
  lerResposta,
  lerUso,
  mascararDados,
  prepararEntrada,
  promptSistema,
  telaDaRota,
} from "@/lib/ajuda-max-locacao";
import { MANUAL_LOCACAO } from "@/lib/ajuda-max-locacao-manual";
import {
  lerRetornoGemini,
  montarChamada,
  responderPergunta,
  type ChamadaIA,
  type DepsFluxo,
} from "@/lib/ajuda-max-locacao-fluxo";
import { ETAPAS } from "@/lib/locacao";
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_LABELS } from "@/lib/platform-organizations";
import { INVITE_MODULES_OFF } from "@/lib/org-invites";

const MIG = readFileSync(
  new URL("../../supabase/migrations/20261116120000_ajuda_max_locacao.sql", import.meta.url),
  "utf8",
);
const RB = readFileSync(
  new URL("../../supabase/rollback/20261116120000_ajuda_max_locacao.sql", import.meta.url),
  "utf8",
);
const FN = readFileSync(new URL("./ajuda-max-locacao.functions.ts", import.meta.url), "utf8");
const COMP = readFileSync(
  new URL("../components/locacao/AjudaMaxLocacao.tsx", import.meta.url),
  "utf8",
);

describe("rota e chave", () => {
  it("só nas telas de Locação", () => {
    expect(telaDaRota("/locacoes")).toBe("lista");
    expect(telaDaRota("/locacoes/")).toBe("lista");
    expect(telaDaRota("/locacoes/7c1d-uuid")).toBe("detalhe");
    expect(telaDaRota("/locacoes/x/y")).toBeNull();
    expect(telaDaRota("/dashboard")).toBeNull();
    expect(telaDaRota("/locacoesx")).toBeNull();
  });
  it("módulo na lista do código, com rótulo, desligado no convite", () => {
    expect(ORGANIZATION_MODULES).toContain("ajuda_max_locacao");
    expect(ORGANIZATION_MODULE_LABELS.ajuda_max_locacao).toMatch(/Ajuda MAX/);
    expect(INVITE_MODULES_OFF).toContain("ajuda_max_locacao");
  });
  it("lerUso falha fechado (sem dado = desligado)", () => {
    expect(lerUso(null)).toEqual({ ligado: false, usadas: 0, limite: LIMITE_DIA });
    expect(lerUso({ ligado: "true", usadas: "3" })).toEqual({
      ligado: false,
      usadas: 0,
      limite: LIMITE_DIA,
    });
    expect(lerUso({ ligado: true, usadas: 7, limite: 20 })).toEqual({
      ligado: true,
      usadas: 7,
      limite: 20,
    });
  });
});

describe("nenhum dado de cliente vai à IA", () => {
  it("mascara e-mail, CPF, CNPJ, telefone, CEP e números longos", () => {
    const t = mascararDados(
      "cliente joao@x.com cpf 123.456.789-09 cnpj 12.345.678/0001-90 tel (15) 99876-5432 cep 18035-000 rg 12.345.678-9",
    );
    expect(t).not.toMatch(/joao@x\.com|123\.456|12\.345|99876|18035|5432/);
    expect(t.match(/\[dado removido\]/g)?.length).toBeGreaterThanOrEqual(6);
    // perguntas comuns de uso continuam intactas
    expect(mascararDados("Como envio a etapa 3 à gestora?")).toBe(
      "Como envio a etapa 3 à gestora?",
    );
  });
  it("pergunta e histórico mascarados, histórico limitado a 4", () => {
    const h = Array.from({ length: 7 }, (_, i) => ({
      papel: i % 2 ? ("assistente" as const) : ("usuario" as const),
      texto: `msg ${i} 15991234567`,
    }));
    const e = prepararEntrada("  como   ligo  para 15 99123-4567 ? ", h);
    expect(e.pergunta).toBe("como ligo para [dado removido] ?");
    expect(e.historico).toHaveLength(4);
    expect(JSON.stringify(e.historico)).not.toMatch(/15991234567/);
  });
  it("a chamada leva só manual + pergunta/histórico (nada de id, rota ou dados da locação)", () => {
    const c = montarChamada("detalhe", "Como envio a ficha?", [
      { papel: "assistente", texto: "oi" },
      { papel: "usuario", texto: "a" },
      { papel: "assistente", texto: "b" },
    ]);
    expect(c.conteudos[0].role).toBe("user");
    expect(c.conteudos.at(-1)).toEqual({ role: "user", parts: [{ text: "Como envio a ficha?" }] });
    expect(c.sistema).toContain(MANUAL_LOCACAO);
    expect(c.sistema).not.toMatch(/\/locacoes\/[0-9a-f-]{8,}/);
  });
  it("a função de servidor não lê tabelas da locação nem usa a Nicole/leitura de documentos", () => {
    const codigo = FN.replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/\.from\(/);
    expect(codigo).not.toMatch(/locacao_detalhe|locacao_lista|nicole|leads-ia|documento/i);
    expect(FN).toMatch(/requireSupabaseAuth/);
    expect(FN).toMatch(/process\.env\.GEMINI_API_KEY/);
    expect(FN).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    // log só de números/estado
    expect(FN).not.toMatch(/console\.\w+\([^)]*pergunta/);
  });
  it("o balão avisa para não escrever dados e não envia o id da locação", () => {
    expect(COMP).toMatch(/Não escreva nome, CPF ou telefone/);
    expect(COMP).toMatch(/Não consulta contratos nem clientes/);
    expect(COMP).not.toMatch(/useParams|locacaoId/);
  });
});

describe("prompt e manual", () => {
  it("manual cobre as 8 abas e as 9 etapas do código", () => {
    for (const aba of [
      "Minhas locações",
      "Gestora",
      "Contratos",
      "Pós-assinatura e chaves",
      "Comissão",
      "Financeiro",
      "Visão geral",
      "Regras e papéis",
    ])
      expect(MANUAL_LOCACAO).toContain(`**${aba}**`);
    expect(ETAPAS).toHaveLength(9);
    ETAPAS.forEach((e, i) => expect(MANUAL_LOCACAO).toContain(`### Etapa ${i + 1} — `));
  });
  it("prompt manda não inventar e responder sabe=false fora do manual", () => {
    const p = promptSistema("lista");
    expect(p).toMatch(/Nunca invente/);
    expect(p).toMatch(/sabe": false/);
    expect(p).toMatch(/lista da Locação/);
    expect(promptSistema("detalhe")).toMatch(/9 etapas/);
  });
});

describe("leitura da resposta", () => {
  it("sabe=true com texto: mostra o texto", () => {
    expect(lerResposta('{"sabe": true, "resposta": "1. Clique em **Nova locação**."}')).toEqual({
      sabe: true,
      resposta: "1. Clique em **Nova locação**.",
    });
    expect(
      lerResposta('```json\n{"sabe":true,"resposta":"Clique em **Salvar**."}\n```')?.sabe,
    ).toBe(true);
  });
  it("sabe=false, vazio ou texto livre da IA: sempre o nosso 'não sei'", () => {
    expect(lerResposta('{"sabe": false, "resposta": "acho que é assim..."}')).toEqual({
      sabe: false,
      resposta: TEXTO_NAO_SEI,
    });
    expect(lerResposta('{"sabe": true, "resposta": ""}')?.resposta).toBe(TEXTO_NAO_SEI);
    expect(lerResposta("não é json")).toBeNull();
  });
  it("formata lista, negrito e não interpreta HTML", () => {
    const l = formatarResposta("Faça assim:\n1. Clique em **Gestora**\n- <b>x</b>");
    expect(l[0]).toEqual({ tipo: "p", trechos: [{ negrito: false, texto: "Faça assim:" }] });
    expect(l[1]).toMatchObject({ tipo: "num", n: 1 });
    expect(l[1].trechos[1]).toEqual({ negrito: true, texto: "Gestora" });
    expect(l[2]).toEqual({ tipo: "item", trechos: [{ negrito: false, texto: "<b>x</b>" }] });
    expect(COMP).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it("Gemini: ignora partes de raciocínio e soma tokens", () => {
    expect(
      lerRetornoGemini({
        candidates: [
          { content: { parts: [{ text: "pensando", thought: true }, { text: '{"sabe":true}' }] } },
        ],
        usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 80, thoughtsTokenCount: 20 },
      }),
    ).toEqual({ texto: '{"sabe":true}', entrada: 3000, saida: 100 });
    expect(lerRetornoGemini(null)).toEqual({ texto: "", entrada: 0, saida: 0 });
  });
});

// Fluxo completo com banco e IA simulados (sem chamada real).
function deps(over: Partial<DepsFluxo> & { usadas?: number } = {}) {
  const fechar = vi.fn(async () => {});
  const usadas = over.usadas ?? 1;
  const d: DepsFluxo = {
    reservar: async () => ({ ok: true, usadas, limite: 20, org: "org-a", dia: "2026-11-11" }),
    fechar,
    chamarIA: null,
    ...over,
  };
  return { d, fechar: d.fechar === fechar ? fechar : (d.fechar as ReturnType<typeof vi.fn>) };
}
const ENTRADA = {
  pergunta: "Como envio a ficha à gestora?",
  tela: "lista" as const,
  historico: [],
};

describe("fluxo de uma pergunta (respostas simuladas)", () => {
  it("pergunta respondida: conta 1 e fecha como 'sabe' com os tokens", async () => {
    const recebidas: ChamadaIA[] = [];
    const chamarIA = vi.fn(async (c: ChamadaIA) => {
      recebidas.push(c);
      return {
        ok: true as const,
        texto: '{"sabe":true,"resposta":"1. Abra a locação.\\n2. Clique em **Enviar à gestora**."}',
        entrada: 3100,
        saida: 120,
      };
    });
    const { d, fechar } = deps({ chamarIA, usadas: 5 });
    const r = await responderPergunta(ENTRADA, d);
    expect(r).toMatchObject({ ok: true, sabe: true, usadas: 5, limite: 20 });
    expect(r.ok && r.resposta).toMatch(/Enviar à gestora/);
    expect(fechar).toHaveBeenCalledWith("org-a", "2026-11-11", "sabe", 3100, 120);
    expect(recebidas[0]?.conteudos.at(-1)?.parts[0]?.text).toBe(ENTRADA.pergunta);
  });
  it("fora do manual: mostra o 'não sei' e conta como pergunta", async () => {
    const chamarIA = vi.fn(async () => ({
      ok: true as const,
      texto: '{"sabe":false,"resposta":"Talvez a lei diga..."}',
      entrada: 3000,
      saida: 10,
    }));
    const { d, fechar } = deps({ chamarIA });
    const r = await responderPergunta(
      { ...ENTRADA, pergunta: "Qual o índice de reajuste deste ano?" },
      d,
    );
    expect(r).toMatchObject({ ok: true, sabe: false, resposta: TEXTO_NAO_SEI, usadas: 1 });
    expect(fechar).toHaveBeenCalledWith("org-a", "2026-11-11", "nao_sabe", 3000, 10);
  });
  it("limite diário: não chama a IA e avisa", async () => {
    const chamarIA = vi.fn();
    const { d, fechar } = deps({
      reservar: async () => ({ ok: false, usadas: 20, limite: 20 }),
      chamarIA,
    });
    const r = await responderPergunta(ENTRADA, d);
    expect(r).toMatchObject({ ok: false, motivo: "limite", usadas: 20, limite: 20 });
    expect(!r.ok && r.mensagem).toMatch(/20 perguntas de hoje/);
    expect(chamarIA).not.toHaveBeenCalled();
    expect(fechar).not.toHaveBeenCalled();
  });
  it("sem chave da IA no ambiente: devolve a pergunta ao limite e diz que não contou", async () => {
    const { d, fechar } = deps({ usadas: 3 });
    const r = await responderPergunta(ENTRADA, d);
    expect(r).toEqual({
      ok: false,
      motivo: "indisponivel",
      mensagem: TEXTO_INDISPONIVEL,
      usadas: 2,
      limite: 20,
    });
    expect(fechar).toHaveBeenCalledWith("org-a", "2026-11-11", "falha", 0, 0);
    expect(TEXTO_INDISPONIVEL).toMatch(/não contou/);
  });
  it("IA com erro, tempo-limite ou formato inválido: devolve a pergunta", async () => {
    for (const ret of [
      { ok: false as const, erro: "tempo" as const },
      { ok: true as const, texto: "texto solto", entrada: 1, saida: 1 },
    ]) {
      const { d, fechar } = deps({ chamarIA: async () => ret, usadas: 4 });
      const r = await responderPergunta(ENTRADA, d);
      expect(r).toMatchObject({ ok: false, motivo: "falha", usadas: 3 });
      expect(fechar).toHaveBeenCalledWith("org-a", "2026-11-11", "falha", 0, 0);
    }
  });
  it("chave desligada: o banco recusa e nada é chamado", async () => {
    const chamarIA = vi.fn();
    const { d } = deps({
      reservar: async () => {
        throw new Error("42501");
      },
      chamarIA,
    });
    expect(await responderPergunta(ENTRADA, d)).toMatchObject({
      ok: false,
      motivo: "desligado",
      mensagem: TEXTO_DESLIGADO,
    });
    expect(chamarIA).not.toHaveBeenCalled();
  });
  it("log só leva números e estado, nunca o texto", async () => {
    const log = vi.fn();
    const { d } = deps({
      chamarIA: async () => ({
        ok: true,
        texto: '{"sabe":true,"resposta":"Clique em **Salvar**."}',
        entrada: 9,
        saida: 9,
      }),
      log,
    });
    await responderPergunta({ ...ENTRADA, pergunta: "segredo-xyz como salvo?" }, d);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/segredo-xyz|Salvar/);
  });
});

describe("migration 20261116120000", () => {
  const nomes = (x: string) => [...x.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
  it("CHECK e RPC = lista do código; rollback volta à anterior e apaga a chave antes do CHECK", () => {
    const novo = [...ORGANIZATION_MODULES].sort();
    expect(nomes(MIG.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(novo);
    expect(nomes(MIG.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(novo);
    const anterior = novo.filter((x) => x !== "ajuda_max_locacao");
    expect(nomes(RB.match(/CHECK \(module IN \(([^)]*)\)\)/)?.[1] ?? "")).toEqual(anterior);
    expect(nomes(RB.match(/_module NOT IN \(([^)]*)\)/)?.[1] ?? "")).toEqual(anterior);
    const del = RB.indexOf(
      "DELETE FROM public.organization_modules WHERE module = 'ajuda_max_locacao'",
    );
    expect(del).toBeGreaterThan(0);
    expect(del).toBeLessThan(RB.indexOf("ADD CONSTRAINT organization_modules_module_check"));
    expect(RB).toMatch(/DROP TABLE IF EXISTS public\.ajuda_max_locacao_uso/);
  });
  it("nasce desligado (nenhuma chave gravada) e não toca locações nem outras tabelas", () => {
    expect(MIG).not.toMatch(
      /INSERT INTO public\.organization_modules \(organization_id, module, enabled\)\s*(VALUES|SELECT)/,
    );
    expect(MIG.match(/INSERT INTO public\.organization_modules/g)).toHaveLength(1); // só a da RPC da plataforma
    expect(MIG).not.toMatch(
      /(UPDATE|DELETE FROM|INSERT INTO) public\.(locacao|locacoes|sales|leads|user_roles)/,
    );
  });
  it("contador com organization_id, RLS ligada, sem grant ao navegador e sem texto", () => {
    expect(MIG).toMatch(/organization_id uuid NOT NULL REFERENCES public\.organizations/);
    expect(MIG).toMatch(/ALTER TABLE public\.ajuda_max_locacao_uso ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.ajuda_max_locacao_uso FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).not.toMatch(/GRANT [A-Z, ]+ ON public\.ajuda_max_locacao_uso TO authenticated/);
    const tabela = MIG.slice(
      MIG.indexOf("CREATE TABLE public.ajuda_max_locacao_uso"),
      MIG.indexOf("CREATE INDEX"),
    );
    expect(tabela).not.toMatch(/\btext\b/);
    expect(MIG).toMatch(/CHECK \(perguntas BETWEEN 0 AND 20\)/);
    expect(MIG).toMatch(/IF _n >= 20 THEN/);
    expect(LIMITE_DIA).toBe(20);
  });
  it("reservar usa o login e trava a linha; fechar é só do servidor", () => {
    expect(MIG).toMatch(/_uid uuid := auth\.uid\(\); _org uuid := public\.current_org_id\(\)/);
    expect(MIG).toMatch(/dia = _dia FOR UPDATE/);
    expect(MIG).toMatch(
      /ajuda_max_locacao_fechar\(uuid, uuid, date, text, integer, integer\)\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.ajuda_max_locacao_fechar\([^)]*\) TO service_role;/,
    );
    expect(MIG).toMatch(/public\.locacao_enabled\(\) AND EXISTS/);
    for (const f of ["enabled()", "uso_hoje()", "reservar()"])
      expect(MIG).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.ajuda_max_locacao_${f.replace(/[()]/g, "\\$&")} FROM PUBLIC, anon;`,
        ),
      );
  });
});
