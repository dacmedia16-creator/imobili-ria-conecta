/**
 * Duas brechas antigas de permissão (cartão t_b03b2db1; Denis 22/11/2026, tópico 6238, item 4).
 * O teste lê a ÚLTIMA definição de cada função nas migrations (a que vale no banco depois do `db push`):
 * (a) meu_plano_ve_imobiliaria só dá a visão ampla a quem é admin/super_admin DA IMOBILIÁRIA ATUAL;
 * (b) gestao_farol_dados não entrega a soma da imobiliária (funil90_equipe) a quem está sem equipe e não é admin.
 * A prova com dados (admin da própria e de outra imobiliária, dono, plataforma, gestor com/sem equipe, TL, corretor)
 * roda em supabase/tests/run-brechas-ve-imobiliaria-farol-sem-equipe.sh.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "supabase/migrations");
const ROLLBACK = join(
  process.cwd(),
  "supabase/rollback/20261220120000_brechas_ve_imobiliaria_farol_sem_equipe.sql",
);

/** Corpo da última `CREATE OR REPLACE FUNCTION public.<nome>(` nas migrations, até o `$function$;`/`$$;` seguinte. */
function ultimaDefinicao(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\(`, "i");
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const txt = readFileSync(join(DIR, arquivo), "utf8");
    const i = txt.search(re);
    if (i < 0) continue;
    const resto = txt.slice(i);
    const fim = resto.search(/\n\$(function)?\$;/);
    achado = { arquivo, corpo: fim > 0 ? resto.slice(0, fim) : resto };
  }
  if (!achado) throw new Error(`função ${nome} não encontrada`);
  return achado;
}

describe("brechas antigas de permissão (t_b03b2db1)", () => {
  it("(a) visão ampla exige o papel admin/super_admin NESTA imobiliária", () => {
    const { corpo } = ultimaDefinicao("meu_plano_ve_imobiliaria");
    expect(corpo).toMatch(/r\.organization_id = public\.current_org_id\(\)/);
    expect(corpo).toMatch(/r\.role IN \('admin', 'super_admin'\)/);
    // "Entrar como" da plataforma segue valendo, só para a própria pessoa.
    expect(corpo).toMatch(
      /_uid = auth\.uid\(\) AND coalesce\(public\.mt_pc_in_context\(\), false\)/,
    );
  });

  it("(b) farol: sem equipe, a soma da imobiliária só vai para admin/super_admin", () => {
    const { corpo } = ultimaDefinicao("gestao_farol_dados");
    const bloco = corpo.slice(corpo.indexOf("'funil90_equipe'"), corpo.indexOf("'ultima_1a1'"));
    expect(bloco).toMatch(
      /WHEN _broker THEN f\.uid IN \(SELECT m\.user_id FROM public\.organization_members m/,
    );
    // Os outros: só a pessoa; gestor/TL no próprio farol: + as equipes que lidera (CTE lidero).
    expect(bloco).toMatch(
      /ELSE f\.uid = p\.id OR \(p\.id = _me AND f\.uid IN \(SELECT l\.uid FROM lidero l\)\) END/,
    );
    expect(corpo).toMatch(/lidero AS \([\s\S]*public\.leads_team_or_parent\(t\.id, _me\)\)/);
    // O funil só soma a imobiliária toda quando quem vê é admin/super_admin.
    expect(corpo).toMatch(/AND _broker {2}-- t_b03b2db1/);
  });

  it("rollback devolve as definições anteriores (sem as checagens novas)", () => {
    const rb = readFileSync(ROLLBACK, "utf8");
    expect(rb).toContain("CREATE OR REPLACE FUNCTION public.meu_plano_ve_imobiliaria(_uid uuid)");
    expect(rb).toContain("CREATE OR REPLACE FUNCTION public.gestao_farol_dados(_ano integer");
    expect(rb).not.toMatch(/t_b03b2db1: o papel/);
    expect(rb).not.toMatch(/lidero AS \(/);
  });
});
