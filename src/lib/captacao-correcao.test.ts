import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVISO_VENDA_CORRECAO,
  lerCorrecao,
  montarCorrecao,
  podeCorrigirAprovada,
  textoMudanca,
} from "./captacao-correcao";
import { addOwner, emptyForm, normalizeForm, type CaptureForm } from "./exclusive-captures";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261027170000_captacao_corrigir_aprovada.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL("../../supabase/rollback/20261027170000_captacao_corrigir_aprovada.sql", import.meta.url),
  "utf8",
);
const rpc = (() => {
  const start = migration.indexOf("FUNCTION public.exclusive_corrigir_aprovada(");
  return migration.slice(start, migration.indexOf("END $function$;", start));
})();

const CORRETOR = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

const base = (): CaptureForm => {
  const f = emptyForm();
  f.imovel = { ...f.imovel, endereco: "Rua A, 10", valor_imovel: "R$ 500.000,00" };
  f.ficha = {
    area_util_m2: "80",
    area_construida_m2: "",
    area_terreno_m2: "",
    ano_construcao: "",
    quartos: "3",
    suites: "1",
    banheiros: "2",
    vagas: "2",
  };
  f.proprietario_1 = { ...f.proprietario_1, nome_completo: "Maria Silva", cpf: "52998224725" };
  return normalizeForm(f);
};

describe("quem pode corrigir (tela; o banco confere de novo)", () => {
  const caso = (over: Partial<Parameters<typeof podeCorrigirAprovada>[0]>) =>
    podeCorrigirAprovada({
      status: "aprovada",
      archived: false,
      userId: CORRETOR,
      captorId: CORRETOR,
      manager: false,
      ...over,
    });
  it("corretor dono da captação aprovada: pode", () => expect(caso({})).toBe(true));
  it("gestor/TL/admin: pode", () => expect(caso({ userId: OUTRO, manager: true })).toBe(true));
  it("outro corretor: não pode", () => expect(caso({ userId: OUTRO })).toBe(false));
  it("sem login: não pode", () => expect(caso({ userId: null })).toBe(false));
  it("arquivada: não pode", () => expect(caso({ archived: true, manager: true })).toBe(false));
  it.each(["rascunho", "devolvida", "enviada", "em_assinatura"])(
    "status %s: não aparece (usa o fluxo normal)",
    (status) => expect(caso({ status, manager: true })).toBe(false),
  );
});

describe("montarCorrecao: só imóvel, ficha e proprietários", () => {
  it("área útil 80 → 85: manda só esse campo e registra antes/depois", () => {
    const original = base();
    const editado = { ...original, ficha: { ...original.ficha!, area_util_m2: "85" } };
    const r = montarCorrecao(original, editado);
    expect(r.erro).toBeNull();
    expect(r.payload).toEqual({ ficha: { area_util_m2: "85" } });
    expect(r.mudancas).toEqual([
      { grupo: "Ficha do imóvel", campo: "Área útil (m²)", antes: "80", depois: "85" },
    ]);
  });
  it("prazo, comissão, testemunhas, data de assinatura e Plano NÃO entram no envio", () => {
    const original = base();
    const editado: CaptureForm = {
      ...original,
      condicoes: { ...original.condicoes, prazo_dias_numero: "365", comissao_percentual_numero: "3" },
      testemunha_1: { ...original.testemunha_1, nome: "X" },
      data_assinatura: "2026-01-01",
      dossie: ["a"],
    };
    const r = montarCorrecao(original, editado);
    expect(r.payload).toEqual({});
    expect(r.mudancas).toHaveLength(0);
  });
  it("endereço e proprietário: manda a lista de proprietários na mesma ordem", () => {
    const original = base();
    const editado: CaptureForm = {
      ...original,
      imovel: { ...original.imovel, complemento: "Apto 12" },
      proprietario_1: { ...original.proprietario_1, telefone_1: "15999990000" },
    };
    const r = montarCorrecao(original, editado);
    expect(r.payload.imovel).toEqual({ complemento: "Apto 12" });
    expect(r.payload.proprietarios).toEqual([{ telefone_1: "15999990000" }]);
    expect(r.mudancas.map((m) => m.campo)).toEqual(["Complemento", "Telefone"]);
  });
  it("incluir proprietário é recusado (documentos presos à posição)", () => {
    const original = base();
    const r = montarCorrecao(original, addOwner(original));
    expect(r.erro).toMatch(/Devolver ao corretor/);
    expect(r.payload).toEqual({});
  });
});

describe("histórico 'corrigida'", () => {
  it("lê o JSON gravado pelo banco e mostra antes → depois", () => {
    const detail = JSON.stringify({
      v: 1,
      por: "corretor",
      mudancas: [{ grupo: "Ficha do imóvel", campo: "Área útil (m²)", antes: "80", depois: "85" }],
    });
    const c = lerCorrecao(detail);
    expect(c.por).toBe("corretor");
    expect(textoMudanca(c.mudancas[0])).toBe("Ficha do imóvel · Área útil (m²): 80 → 85");
  });
  it("vazio aparece como (vazio); detalhe inválido não quebra a tela", () => {
    expect(textoMudanca({ grupo: "Imóvel", campo: "Complemento", antes: "", depois: "Apto 12" })).toBe(
      "Imóvel · Complemento: (vazio) → Apto 12",
    );
    expect(lerCorrecao("não é json")).toEqual({ por: null, mudancas: [] });
    expect(lerCorrecao(null)).toEqual({ por: null, mudancas: [] });
  });
  it("aviso da venda ligada diz que a venda não é atualizada", () => {
    expect(AVISO_VENDA_CORRECAO).toMatch(/NÃO é atualizada automaticamente/);
  });
});

describe("migration exclusive_corrigir_aprovada (regras no banco)", () => {
  it("confere dono OU gestor, na organização atual, só aprovada e não arquivada", () => {
    expect(rpc).toContain("organization_id = public.current_org_id() FOR UPDATE");
    expect(rpc).toContain("public.exclusive_can_view(_id, _uid)");
    expect(rpc).toContain("_dono := _c.captor_id = _uid");
    expect(rpc).toContain("_gestor := public.exclusive_is_manager(_id, _uid)");
    expect(rpc).toContain("IF NOT (_dono OR _gestor) THEN");
    expect(rpc).toContain("_c.status <> 'aprovada' OR _c.archived_at IS NOT NULL");
  });
  it("lista fechada: só imovel, ficha e proprietarios; o resto é recusado", () => {
    expect(rpc).toContain("k NOT IN ('imovel','ficha','proprietarios')");
    expect(rpc).not.toMatch(/'condicoes'|'data_assinatura'|'dossie'|'testemunha_/);
  });
  it("só form_data muda: status, signed_on, captador, unidade e documentos intocados", () => {
    expect(rpc).toContain(
      "UPDATE public.exclusive_captures SET form_data = _form, updated_at = now() WHERE id = _id;",
    );
    expect(rpc).not.toMatch(/SET[^;]*\b(status|signed_on|captor_id|unit_id|template|broker_\w+)\s*=/);
    expect(rpc).not.toMatch(/DELETE FROM public\.exclusive_documents/);
    expect(rpc).not.toMatch(/INSERT INTO public\.exclusive_documents/);
  });
  it("grava histórico 'corrigida' com quem, e antes/depois por campo", () => {
    expect(rpc).toContain("VALUES (_id, _uid, 'corrigida'");
    expect(migration).toContain("'antes'");
    expect(migration).toContain("'depois'");
    // Dados pessoais do proprietário mascarados no histórico (LGPD).
    expect(migration).toContain("'antes', public.exclusive_correcao_mascara(_k, _a)");
    expect(migration).toContain("WHEN _k IN ('cpf','rg') THEN '***' || right(_v, 3)");
    expect(migration).toContain("WHEN _k = 'endereco_completo' THEN '(alterado)'");
    expect(migration).toMatch(/WHEN _k = 'email' THEN left\(_v, 1\) \|\| '\*\*\*'/);
  });
  it("não esvazia obrigatório, valida CPF e recusa edição simultânea", () => {
    expect(migration).toContain("RAISE EXCEPTION '% não pode ficar vazio'");
    expect(migration).toContain("NOT public.exclusive_valid_cpf(btrim(_d))");
    expect(rpc).toContain("_lido_em IS NOT NULL AND _c.updated_at IS DISTINCT FROM _lido_em");
  });
  it("aviso só no sino (sem WhatsApp), para o outro lado, sem desfazer a correção", () => {
    expect(rpc).toContain("INSERT INTO public.notifications");
    expect(rpc).toContain("'captacao_corrigida'");
    expect(rpc).not.toMatch(/whatsapp_fila|INSERT INTO public\.\w*whats/i);
    expect(rpc).toContain("p.ativo IS NOT FALSE AND p.id IS DISTINCT FROM _uid");
    expect(rpc).toContain("UNION SELECT _c.captor_id WHERE NOT _dono");
    // líder da equipe-mãe também (mesma regra de is_lead_of)
    expect(rpc).toContain("JOIN public.teams pt ON pt.id = t.parent_team_id");
    expect(rpc).toContain("EXCEPTION WHEN others THEN");
  });
  it("venda ativa não bloqueia; o retorno avisa a tela", () => {
    expect(rpc).toContain("'venda_ativa', public.exclusive_venda_ativa(_id) IS NOT NULL");
    expect(rpc).not.toMatch(/venda ativa ligada.*RAISE|RAISE[^;]*venda/i);
  });
  it("permissões: anon fora; helpers sem execução por authenticated; rollback remove tudo", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz) FROM PUBLIC, anon;",
    );
    expect(migration).toContain(
      "ALTER FUNCTION public.exclusive_corrigir_aprovada(uuid, jsonb, timestamptz) OWNER TO mt_1b_definer;",
    );
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.exclusive_correcao_secao[^;]*authenticated;/);
    for (const f of [
      "exclusive_corrigir_aprovada(uuid, jsonb, timestamptz)",
      "exclusive_correcao_secao(jsonb, jsonb, text[], text)",
      "exclusive_correcao_mascara(text, text)",
      "exclusive_correcao_rotulo(text)",
    ])
      expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
  });
});
