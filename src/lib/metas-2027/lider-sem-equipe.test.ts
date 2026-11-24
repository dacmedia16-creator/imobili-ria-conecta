/**
 * Metas 2027 · Equipes: a meta de quem LIDERA uma equipe, mas não tem equipe vigente, cai na equipe que ele
 * lidera (cartão t_a897136b; Denis 23/11/2026, tópico 6238, opção "1").
 *
 * Caso real: Aline de Souza Rodrigues (Única) tem papel gestor (sem team_leader), a equipe dela não tem membros e
 * não há histórico. equipe_vigente() devolve NULL; metas_equipe_escopo devolvia team_id NULL e a meta dela
 * (R$ 189.000 · 18 vendas · 18 captações) ia para "Sem equipe", com a aba "Aline de Souza Rodrigues" vazia.
 *
 * Correção no banco (migration 20261231120000): metas_equipe_escopo usa a equipe liderada quando
 * equipe_vigente() vier NULL. A prova com dados roda em supabase/tests/run-metas-lider-sem-equipe.sh
 * (homologação, transação desfeita, com controle negativo). Aqui: o texto da migration e do rollback e o efeito
 * na tela (aba da equipe com a meta; "Todas" conta 1 vez só).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  montarPainelGestor,
  type PessoaRpc,
  type PlanosRpc,
  type RealizadoRpc,
} from "./painel-gestor";

const MIG = "supabase/migrations/20261231120000_metas_lider_sem_equipe.sql";
const RB = "supabase/rollback/20261231120000_metas_lider_sem_equipe.sql";
const ORIGINAL = "supabase/migrations/20261207120000_metas_2027_painel_gestor.sql";

const corpo = (sql: string, fn: string) => {
  const i = sql.indexOf(`FUNCTION public.${fn}(`);
  expect(i).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const ler = (f: string) => {
  expect(existsSync(f), `falta o arquivo ${f}`).toBe(true);
  return readFileSync(f, "utf8");
};

describe("banco: metas_equipe_escopo com a equipe liderada como reserva", () => {
  it("quando equipe_vigente() vem NULL, usa a equipe que a pessoa lidera (mesma imobiliária)", () => {
    const f = corpo(ler(MIG), "metas_equipe_escopo");
    // A equipe vigente continua mandando: a liderada só entra no coalesce, DEPOIS dela.
    expect(f).toMatch(
      /coalesce\(\s*public\.equipe_vigente\(m\.user_id, now\(\)\),\s*\(SELECT t\.id FROM public\.teams t/,
    );
    expect(f).toMatch(/t\.lider_id = m\.user_id AND t\.organization_id = _org/);
    // Permissões iguais: continua passando por metas_equipe_times/broker e pelo filtro de equipes permitidas.
    expect(f).toMatch(/_times := public\.metas_equipe_times\(\)/);
    expect(f).toMatch(/CASE WHEN gente\.ev = ANY \(_times\) THEN gente\.ev END/);
    expect(f).toMatch(/AND \(_broker OR g\.team_id = ANY \(_times\)\)/);
  });

  it("não mexe em equipe_vigente (usada por comissões e outras telas), nem em papel ou equipe", () => {
    const sql = ler(MIG);
    expect(sql).not.toMatch(/FUNCTION public\.equipe_vigente/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b[^;]*\b(user_roles|teams|team_members)\b/i);
    // Mesma ACL: só service_role executa.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.metas_equipe_escopo\(uuid\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.metas_equipe_escopo\(uuid\) TO service_role;/,
    );
  });

  it("rollback devolve exatamente o corpo de antes (20261207120000)", () => {
    expect(corpo(ler(RB), "metas_equipe_escopo")).toBe(corpo(ler(ORIGINAL), "metas_equipe_escopo"));
  });
});

describe("tela: a meta do líder sem equipe aparece na aba da equipe dele", () => {
  // Meta oficial gravada (sem assinatura) igual à da Aline: R$ 189.000 · 18 vendas · 18 captações.
  const aline: PessoaRpc = {
    user_id: "aline",
    nome: "Aline de Souza Rodrigues",
    team_id: "eq-aline", // o que o banco passa a mandar (antes: null)
    papeis: ["gestor", "lancamento"],
    tem_plano: true,
    respostas: { "mt.tCapt": "9", "mt.tVenda": "9", "mt.comMedia": "10500", "m.ticket": "350000" },
    assinado_em: null,
    meta_oficial: { meta_comissao: 189000, meta_vendas: 18, meta_captacoes: 18, meta_vgv: 3150000 },
    meta_oficial_em: "2026-11-23T23:24:00Z",
  };
  const planos: PlanosRpc = {
    todas: true,
    modulo_plano: true,
    equipes: [
      {
        id: "eq-aline",
        nome: "Aline de Souza Rodrigues",
        lider_id: "aline",
        lider_nome: "Aline de Souza Rodrigues",
      },
      { id: "eq-outra", nome: "Outra", lider_id: "x", lider_nome: "X" },
    ],
    pessoas: [aline],
  };
  const vazio: RealizadoRpc = { captacoes_ligadas: true, vendas: [], captacoes: [] };
  const painel = montarPainelGestor({
    hoje: "2026-11-24",
    planos,
    realizadoAno: vazio,
    ultimos12: vazio,
    anotacoes: [],
  });

  it("aba 'Aline de Souza Rodrigues' mostra R$ 189.000 · 18 · 18 e não há grupo 'Sem equipe'", () => {
    const aba = painel.grupos.find((g) => g.id === "eq-aline")!;
    expect(aba.pessoas.map((p) => p.userId)).toEqual(["aline"]);
    expect(aba.soma.assinados?.ano).toMatchObject({ comissao: 189000, vendas: 18, captacoes: 18 });
    expect(painel.grupos.find((g) => g.nome === "Sem equipe")).toBeUndefined();
  });

  it("'Todas' conta a meta uma vez só", () => {
    expect(painel.total.pessoas.filter((p) => p.userId === "aline")).toHaveLength(1);
    expect(painel.total.soma.assinados?.ano).toMatchObject({
      comissao: 189000,
      vendas: 18,
      captacoes: 18,
    });
  });
});
