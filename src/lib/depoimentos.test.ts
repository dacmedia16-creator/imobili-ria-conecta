import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAVE_RETORNO_DEPOIMENTO,
  abreConviteAutomatico,
  acoesModeracao,
  caminhoDaNota,
  consumirRetornoDepoimento,
  contarPorStatus,
  depFormVazio,
  destinoDoEnvio,
  erroDoForm,
  filtrarModeracao,
  guardarRetornoDepoimento,
  linkDepoimento,
  mensagemErroDep,
  paramsEnviar,
  textoVitrine,
  type DepForm,
  type DepModeracao,
  type DepSituacao,
} from "./depoimentos";

const form = (p: Partial<DepForm>): DepForm => ({ ...depFormVazio(), ...p });

describe("depoimentos: caminho pela nota", () => {
  it("4 e 5 convidam para o depoimento; 1 a 3 vão para 'o que podemos melhorar'", () => {
    expect(caminhoDaNota(null)).toBe("nenhum");
    expect([1, 2, 3].map(caminhoDaNota)).toEqual(["melhorar", "melhorar", "melhorar"]);
    expect([4, 5].map(caminhoDaNota)).toEqual(["depoimento", "depoimento"]);
  });

  it("vitrine só com nota 4–5 E autorização; sem autorização ou nota baixa = interno", () => {
    expect(destinoDoEnvio(form({ nota: 5, autorizo: true }))).toBe("vitrine");
    expect(destinoDoEnvio(form({ nota: 5, autorizo: false }))).toBe("interno");
    expect(destinoDoEnvio(form({ nota: 3, autorizo: true }))).toBe("interno");
  });

  it("nota baixa nunca manda respostas de depoimento nem autorização ao banco", () => {
    const p = paramsEnviar(
      form({ nota: 2, mudou: "x", frase: "y", melhorar: " busca ", autorizo: true }),
      "v1",
      "convite",
    );
    expect(p).toEqual({
      _nota: 2,
      _mudou: null,
      _tarefa: null,
      _frase: null,
      _melhorar: "busca",
      _autorizo: false,
      _termo_versao: null,
      _origem: "convite",
    });
  });

  it("nota alta com autorização leva a versão do termo; sem autorização, não", () => {
    const base = form({ nota: 5, mudou: "Organizou minhas vendas", frase: " Recomendo " });
    expect(paramsEnviar({ ...base, autorizo: true }, "v1-2026-11-02", "link")).toMatchObject({
      _autorizo: true,
      _termo_versao: "v1-2026-11-02",
      _frase: "Recomendo",
      _origem: "link",
    });
    expect(paramsEnviar(base, "v1-2026-11-02", "link")).toMatchObject({
      _autorizo: false,
      _termo_versao: null,
    });
  });
});

describe("depoimentos: validação (mesmas regras do banco)", () => {
  it("exige nota, 'o que mudou' com 10+ letras e 'melhorar' na nota baixa", () => {
    expect(erroDoForm(form({}))).toMatch(/nota/);
    expect(erroDoForm(form({ nota: 5, mudou: "curto" }))).toMatch(/10 letras/);
    expect(erroDoForm(form({ nota: 5, mudou: "Mudou bastante coisa" }))).toBeNull();
    expect(erroDoForm(form({ nota: 2 }))).toMatch(/melhorar/);
    expect(erroDoForm(form({ nota: 2, melhorar: "A busca" }))).toBeNull();
    expect(erroDoForm(form({ nota: 5, mudou: "Mudou bastante coisa", frase: "x".repeat(161) }))).toMatch(
      /Frase muito longa/,
    );
  });

  it("traduz os erros do banco para a tela", () => {
    expect(mensagemErroDep({ code: "42501" })).toMatch(/própria pessoa/);
    expect(mensagemErroDep({ code: "23505" })).toMatch(/já tem um depoimento/);
    expect(mensagemErroDep({ code: "22023", message: "O texto da autorizacao mudou. Recarregue a pagina." })).toBe(
      "O texto da autorização mudou. Recarregue a página.",
    );
    expect(mensagemErroDep(null)).toMatch(/Tente de novo/);
  });
});

describe("depoimentos: convite automático", () => {
  const ok = (convite: boolean): DepSituacao => ({
    pode_enviar: true,
    convite,
    motivo: convite ? "elegivel" : "conta_nova",
    termo: { versao: "v1", texto: "Autorizo" },
    previa: { nome_exibicao: "Maria Silva", papel: "Corretor(a)", imobiliaria: "X", cidade: null, foto_url: null },
    meus: [],
  });
  it("abre só quando o banco diz que sim e não foi fechado neste login", () => {
    expect(abreConviteAutomatico(ok(true), false)).toBe(true);
    expect(abreConviteAutomatico(ok(true), true)).toBe(false);
    expect(abreConviteAutomatico(ok(false), false)).toBe(false);
    expect(abreConviteAutomatico({ pode_enviar: false, convite: false, motivo: "plataforma" }, false)).toBe(false);
    expect(abreConviteAutomatico(null, false)).toBe(false);
  });
});

describe("depoimentos: link /depoimento antes do login", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      m,
    };
  };
  it("guarda o pedido e consome uma vez só", () => {
    const s = mem();
    guardarRetornoDepoimento(s, 1000);
    expect(s.m.get(CHAVE_RETORNO_DEPOIMENTO)).toBe("1000");
    expect(consumirRetornoDepoimento(s, 1000 + 60_000)).toBe(true);
    expect(consumirRetornoDepoimento(s, 1000 + 60_000)).toBe(false);
  });
  it("pedido com mais de 30 min ou ilegível é descartado", () => {
    const s = mem();
    guardarRetornoDepoimento(s, 0);
    expect(consumirRetornoDepoimento(s, 31 * 60_000)).toBe(false);
    expect(s.m.size).toBe(0);
    s.setItem(CHAVE_RETORNO_DEPOIMENTO, "lixo");
    expect(consumirRetornoDepoimento(s, 1)).toBe(false);
    expect(consumirRetornoDepoimento(null, 1)).toBe(false);
  });
  it("monta o link a partir do endereço atual", () => {
    expect(linkDepoimento("https://app.somosunihub.com.br/")).toBe("https://app.somosunihub.com.br/depoimento");
  });
});

describe("depoimentos: moderação", () => {
  const dep = (p: Partial<DepModeracao>): DepModeracao =>
    ({
      id: "1",
      nota: 5,
      status: "pendente",
      origem: "convite",
      mudou: "orig",
      tarefa: null,
      frase: "Frase orig",
      melhorar: null,
      mudou_corrigido: null,
      tarefa_corrigido: null,
      frase_corrigido: null,
      corrigido_em: null,
      consentimento: true,
      consentimento_em: "2026-11-02T10:00:00Z",
      consentimento_versao: "v1",
      nome_completo: "Maria Silva",
      nome_exibicao: "Maria Silva",
      papel: "Corretor(a)",
      imobiliaria: "X",
      cidade: null,
      foto_url: null,
      motivo_moderacao: null,
      moderado_em: null,
      aprovado_em: null,
      revogado_em: null,
      criado_em: "2026-11-02T10:00:00Z",
      ...p,
    }) as DepModeracao;

  it("ações de um clique por status; interno e retirado pelo autor não publicam", () => {
    expect(acoesModeracao(dep({ status: "pendente" }))).toEqual(["aprovar", "recusar"]);
    expect(acoesModeracao(dep({ status: "aprovado" }))).toEqual(["remover"]);
    expect(acoesModeracao(dep({ status: "recusado" }))).toEqual(["aprovar"]);
    expect(acoesModeracao(dep({ status: "interno" }))).toEqual([]);
    expect(acoesModeracao(dep({ status: "removido", revogado_em: "2026-11-02T11:00:00Z" }))).toEqual([]);
  });

  it("vitrine usa a correção de digitação quando existe, senão o original", () => {
    expect(textoVitrine(dep({})).frase).toBe("Frase orig");
    expect(textoVitrine(dep({ frase_corrigido: "Frase corrigida" })).frase).toBe("Frase corrigida");
  });

  it("filtro e contagem por status", () => {
    const l = [dep({ status: "pendente" }), dep({ id: "2", status: "interno" }), dep({ id: "3", status: "aprovado" })];
    expect(filtrarModeracao(l, "pendente").map((d) => d.id)).toEqual(["1"]);
    expect(filtrarModeracao(l, "todos")).toHaveLength(3);
    expect(contarPorStatus(l)).toMatchObject({ pendente: 1, interno: 1, aprovado: 1, todos: 3 });
  });
});

describe("migration 20261102120000_depoimentos (salvaguardas no texto)", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261102120000_depoimentos.sql", import.meta.url), "utf8");
  const rb = readFileSync(new URL("../../supabase/rollback/20261102120000_depoimentos.sql", import.meta.url), "utf8");

  it("tabelas sem acesso direto e RLS ligada", () => {
    for (const t of ["depoimentos", "depoimento_convites", "depoimento_eventos", "depoimento_termos"]) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`);
    }
  });

  it("só a vitrine é liberada para anon; toda SECURITY DEFINER tem search_path vazio", () => {
    const anon = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION ([^\s]+) TO ([^;]+);/g)].filter((m) =>
      m[2].includes("anon"),
    );
    expect(anon.map((m) => m[1])).toEqual(["public.depoimentos_publicos()"]);
    const definer = sql.match(/SECURITY DEFINER SET search_path TO ''/g) ?? [];
    expect(definer.length).toBe((sql.match(/SECURITY DEFINER/g) ?? []).length);
  });

  it("constraint impede publicar nota baixa ou sem consentimento", () => {
    expect(sql).toContain("CONSTRAINT depoimentos_publicavel CHECK");
    expect(sql).toContain("CONSTRAINT depoimentos_nota_baixa_interna CHECK (nota >= 4 OR (status = 'interno' AND NOT consentimento))");
  });

  it("a vitrine não devolve contato, documento nem ids", () => {
    const vitrine = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.depoimentos_publicos()"));
    const saida = vitrine.slice(0, vitrine.indexOf("FROM public.depoimentos d"));
    for (const proibido of ["email", "telefone", "cpf", "remax_id", "user_id", "organization_id", "nome_completo", "d.id"]) {
      expect(saida).not.toContain(proibido);
    }
  });

  it("vitrine e prévia mostram o nome completo (decisão de Denis, 02/11)", () => {
    expect(sql).not.toContain("depoimento_nome_abreviado");
    expect(sql).toContain("'nome_exibicao', public.depoimento_nome_vitrine(_p.nome)");
    expect(sql).toContain("public.depoimento_nome_vitrine(_p.nome),\n      public.depoimento_papel");
    const helper = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.depoimento_nome_vitrine"));
    expect(helper.slice(0, helper.indexOf("$$;"))).not.toMatch(/left\(|initcap|\|\| '\.'/);
  });

  it("rollback remove tudo o que a migration cria", () => {
    const funcoes = [...sql.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(/g)].map((m) => m[1]);
    for (const f of funcoes) expect(rb, f).toContain(`DROP FUNCTION IF EXISTS ${f}(`);
    const tabelas = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (public\.[a-z_]+)/g)].map((m) => m[1]);
    for (const t of tabelas) expect(rb, t).toContain(`DROP TABLE IF EXISTS ${t};`);
  });
});
