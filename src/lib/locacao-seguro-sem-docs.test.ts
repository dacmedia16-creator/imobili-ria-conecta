// Seguro-fiança sem documentos no checklist do corretor (t_d3e1c29f). A suíte do banco (checklist, trava e
// imobiliárias já configuradas) é supabase/tests/locacao-seguro-sem-docs.sql (run-locacao-seguro-sem-docs.sh).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { docsParaTexto, textoParaDocs } from "./locacao";

const MIG = readFileSync(
  "supabase/migrations/20261129120000_locacao_seguro_fianca_sem_docs.sql",
  "utf8",
);
const RB = readFileSync(
  "supabase/rollback/20261129120000_locacao_seguro_fianca_sem_docs.sql",
  "utf8",
);
const FICHA = readFileSync(
  "supabase/migrations/20261113120000_locacao_ficha_checklist.sql",
  "utf8",
);
const PRE = readFileSync("supabase/migrations/20261124130000_locacao_pre_aprovacao.sql", "utf8");

const fn = (sql: string, nome: string) =>
  new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\([\\s\\S]*?\\n\\$\\$;\\n`).exec(
    sql,
  )?.[0] ?? "";
const padrao = (sql: string) =>
  JSON.parse(
    /locacao_docs_padrao\(\)[\s\S]*?SELECT '(\{[\s\S]*?\})'::jsonb/.exec(sql)?.[1] ?? "{}",
  ) as Record<string, string[]>;

describe("seguro-fiança fora do checklist do corretor", () => {
  it("locacao_partes só filtra a parte seguro-fiança (resto igual à versão anterior)", () => {
    const novo = fn(MIG, "locacao_partes");
    const antes = fn(PRE, "locacao_partes");
    expect(novo).toContain("WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')");
    const semFiltro = novo
      .split("\n")
      .filter((l) => !/t_d3e1c29f|WHERE NOT \(v\.ordem = 2/.test(l))
      .join("\n");
    expect(semFiltro).toBe(antes);
  });
  it("lista padrão perde só o grupo seguro_fianca", () => {
    const antes = padrao(FICHA);
    const novo = padrao(MIG);
    expect(novo.seguro_fianca).toBeUndefined();
    const { seguro_fianca: _sf, ...resto } = antes;
    expect(novo).toEqual(resto);
  });
  it("imobiliárias configuradas: guarda a lista antes de tirar e não apaga arquivo", () => {
    expect(MIG.indexOf("INSERT INTO public.locacao_config_sf_backup")).toBeLessThan(
      MIG.indexOf("documentos - 'seguro_fianca'"),
    );
    expect(MIG).not.toMatch(
      /DELETE FROM public\.locacao_documentos|UPDATE public\.locacao_documentos/,
    );
    expect(MIG).toMatch(
      /REVOKE ALL ON public\.locacao_config_sf_backup FROM PUBLIC, anon, authenticated/,
    );
  });
  it("rollback devolve as duas funções com o texto exato anterior e a lista guardada", () => {
    expect(fn(RB, "locacao_partes")).toBe(fn(PRE, "locacao_partes"));
    expect(fn(RB, "locacao_docs_padrao")).toBe(fn(FICHA, "locacao_docs_padrao"));
    expect(RB).toContain("jsonb_build_object('seguro_fianca', b.itens)");
    expect(RB).toContain("DROP TABLE public.locacao_config_sf_backup");
  });
  it("Regras não mostra mais o grupo Seguro-fiança", () => {
    expect(docsParaTexto({ seguro_fianca: ["Apólice"] })).not.toContain("[Seguro-fiança]");
    expect(textoParaDocs("[Seguro-fiança]\nApólice").seguro_fianca).toBeUndefined();
  });
});
