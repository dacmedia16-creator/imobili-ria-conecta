/**
 * Funções do banco executáveis SEM LOGIN (papel anon) — t_44f96aed.
 *
 * Desde a migration 20261223120000_revoke_anon_funcoes, função nova NÃO nasce aberta ao anon (default
 * privileges). Este teste reprova o build se QUALQUER migration nova (de qualquer data) abrir uma função ao
 * anon ou ao PUBLIC fora da lista permitida (supabase/tests/anon-funcoes-permitidas.txt), voltar a abrir por
 * atacado (ON ALL FUNCTIONS / ALTER DEFAULT PRIVILEGES), conceder um papel ao anon/PUBLIC ou fazer isso por
 * SQL dinâmico. Para abrir uma função de propósito: GRANT explícito + linha na lista com o motivo.
 * As migrations antigas que abriam funções ficam numa lista fixa (o efeito delas foi desfeito pela 20261223120000).
 * A varredura do banco real é supabase/tests/run-anon-funcoes.sh.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VERSAO = "20261223120000";
const MIG_DIR = "supabase/migrations";
const MIG = readFileSync(`${MIG_DIR}/${VERSAO}_revoke_anon_funcoes.sql`, "utf8");
const RB = readFileSync(`supabase/rollback/${VERSAO}_revoke_anon_funcoes.sql`, "utf8");

/** Assinaturas permitidas (formato regprocedure, com schema). */
export function lerPermitidas(texto: string): string[] {
  return texto
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}
const PERMITIDAS = lerPermitidas(
  readFileSync("supabase/tests/anon-funcoes-permitidas.txt", "utf8"),
);

/** Normaliza "schema.nome(tipo, tipo)": tira aspas, espaços e nomes de parâmetro; põe schema public se faltar. */
export function normalizarAssinatura(sig: string): string {
  const s = sig.replace(/"/g, "").trim().toLowerCase();
  const m = s.match(/^([^(]+)\(([\s\S]*)\)$/);
  if (!m) return s.includes(".") ? s : `public.${s}`;
  const nome = m[1].trim().includes(".") ? m[1].trim() : `public.${m[1].trim()}`;
  const args = m[2]
    .split(",")
    .map((a) => a.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((a) => a.replace(/^(in |out |inout |variadic )/, ""))
    .map((a) => (/^(_|p_)\w*\s/.test(a) ? a.replace(/^\S+\s+/, "") : a))
    .map((a) => a.replace(/\s*default\s[\s\S]*$/, "").replace(/\s*=\s*[\s\S]*$/, ""))
    .map((a) => a.replace(/^public\./, ""));
  return `${nome}(${args.join(",")})`;
}
const PERMITIDAS_NORM = new Set(PERMITIDAS.map(normalizarAssinatura));

/** Tira comentários SQL (linha e bloco) para não acusar texto de explicação. */
function semComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export type Abertura = { arquivo: string; trecho: string; motivo: string };

/** Divide "f(a, b), g(c)" respeitando parênteses. */
function separarFuncoes(lista: string): string[] {
  const out: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of lista) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      out.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual.trim()) out.push(atual);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Procura, numa migration, tudo que deixa função executável por anon/PUBLIC:
 *  - GRANT ... ON FUNCTION|ROUTINE|PROCEDURE <f>(...) TO ... anon|PUBLIC  (f fora da lista => abertura)
 *  - GRANT ... ON ALL FUNCTIONS|ROUTINES|PROCEDURES IN SCHEMA ... TO anon|PUBLIC
 *  - ALTER DEFAULT PRIVILEGES ... GRANT ... ON FUNCTIONS|ROUTINES TO anon|PUBLIC
 *  - GRANT <papel> TO anon|PUBLIC (sem ON: herda tudo que o papel executa)
 *  - o mesmo dentro de texto de SQL dinâmico (EXECUTE format('GRANT ... TO anon'))
 */
export function aberturasAnon(
  arquivo: string,
  sqlBruto: string,
  permitidas: Set<string>,
): Abertura[] {
  const sql = semComentarios(sqlBruto);
  const out: Abertura[] = [];
  for (const m of sql.matchAll(/\bGRANT\b(?!ED)([^;]*?)\bTO\b([^;]*)/gi)) {
    const [trecho, oque, destinos] = m;
    const tokens = destinos
      .replace(/\bGRANTED\s+BY\b[\s\S]*$/i, "")
      .split(/[\s,'"()%|]+/)
      .map((t) => t.toLowerCase())
      .filter(Boolean);
    if (!tokens.some((t) => t === "anon" || t === "public")) continue;
    const t = trecho.replace(/\s+/g, " ").trim().slice(0, 200);
    const antes = sql.slice(Math.max(0, m.index! - 400), m.index!);
    if (/ALTER\s+DEFAULT\s+PRIVILEGES[^;]*$/i.test(antes)) {
      if (/\b(FUNCTIONS|ROUTINES)\b/i.test(oque))
        out.push({
          arquivo,
          trecho: t,
          motivo: "default privileges abrindo funções novas ao anon/PUBLIC",
        });
      continue;
    }
    if (!/\bON\b/i.test(oque)) {
      out.push({ arquivo, trecho: t, motivo: "concede um papel ao anon/PUBLIC" });
      continue;
    }
    if (/\bON\s+ALL\s+(FUNCTIONS|ROUTINES|PROCEDURES)\b/i.test(oque)) {
      out.push({ arquivo, trecho: t, motivo: "abre todas as funções do schema" });
      continue;
    }
    const alvo = oque.match(/\bON\s+(?:FUNCTION|ROUTINE|PROCEDURE)\s+([\s\S]+)$/i);
    if (!alvo) continue; // tabela, schema, sequence: fora do escopo deste teste
    for (const f of separarFuncoes(alvo[1])) {
      if (/%[sIL]/.test(f) || !/^[\w."]+\s*\(/.test(f)) {
        out.push({
          arquivo,
          trecho: t,
          motivo: `função dinâmica/indefinida (${f.slice(0, 40)}) aberta ao anon/PUBLIC`,
        });
        continue;
      }
      const sig = normalizarAssinatura(f);
      if (!permitidas.has(sig))
        out.push({ arquivo, trecho: t, motivo: `${sig} fora da lista permitida` });
    }
  }
  return out;
}

/**
 * Migrations ANTIGAS que abriam funções ao anon/PUBLIC (o efeito foi desfeito pela 20261223120000, que fecha
 * tudo fora da lista). Ficam congeladas aqui com a quantidade de aberturas: arquivo novo com abertura, ou
 * antigo com quantidade diferente, reprova o teste.
 */
const ANTIGAS_COM_ABERTURA: Record<string, number> = {
  "20260728001440_emergency_revert_execute_revoke.sql": 19,
  "20261009030000_ajuda_acesso_max.sql": 1,
};

const todas = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("funções sem login (anon) — trava permanente (t_44f96aed)", () => {
  it("nenhuma migration nova (de qualquer data) abre função ao anon/PUBLIC fora da lista", () => {
    const porArquivo = new Map<string, Abertura[]>();
    for (const f of todas) {
      const achados = aberturasAnon(f, readFileSync(`${MIG_DIR}/${f}`, "utf8"), PERMITIDAS_NORM);
      if (achados.length) porArquivo.set(f, achados);
    }
    const novos = [...porArquivo].filter(([f, a]) => ANTIGAS_COM_ABERTURA[f] !== a.length);
    expect(novos, JSON.stringify(novos, null, 2)).toEqual([]);
  });

  it("o detector pega abertura nova (controle negativo) e ignora o que é permitido ou comentário", () => {
    const sqlRuim = [
      "CREATE FUNCTION public.nova_x() RETURNS int LANGUAGE sql AS $$ select 1 $$;",
      "GRANT EXECUTE ON FUNCTION public.nova_x() TO authenticated, anon;",
      "GRANT EXECUTE ON FUNCTION public.outra(uuid, text) TO PUBLIC;",
      "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;",
      "GRANT EXECUTE ON FUNCTION nova_y(int) TO anon GRANTED BY postgres;",
      "GRANT authenticated TO anon;",
      "DO $$ BEGIN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', 'public.z()'); END $$;",
      "GRANT EXECUTE ON FUNCTION public.list_public_org_regions(uuid) TO anon;",
      'GRANT ALL ON ROUTINE "public"."Nova_W"(text) TO "anon";',
    ].join("\n");
    const achados = aberturasAnon("x.sql", sqlRuim, PERMITIDAS_NORM).map((a) => a.motivo);
    expect(achados).toEqual([
      "public.nova_x() fora da lista permitida",
      "public.outra(uuid,text) fora da lista permitida",
      "abre todas as funções do schema",
      "default privileges abrindo funções novas ao anon/PUBLIC",
      "public.nova_y(int) fora da lista permitida",
      "concede um papel ao anon/PUBLIC",
      "função dinâmica/indefinida (%s) aberta ao anon/PUBLIC",
      "public.list_public_org_regions(uuid) fora da lista permitida",
      "public.nova_w(text) fora da lista permitida",
    ]);
    const sqlOk = [
      "-- GRANT EXECUTE ON FUNCTION public.nova_x() TO anon;",
      "GRANT EXECUTE ON FUNCTION public.nova_x() TO authenticated, service_role;",
      "GRANT EXECUTE ON FUNCTION public.list_public_org_regions(text) TO anon, authenticated;",
      "GRANT EXECUTE ON FUNCTION list_public_org_specialists(_slug text, _search text, _region_id bigint) TO anon;",
      "REVOKE EXECUTE ON FUNCTION public.nova_x() FROM PUBLIC, anon;",
      "REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.nova_x() FROM authenticated;",
      "GRANT SELECT ON public.tabela TO authenticated;",
    ].join("\n");
    expect(aberturasAnon("ok.sql", sqlOk, PERMITIDAS_NORM)).toEqual([]);
  });

  it("lista permitida: só as 6 públicas, com motivo em cada linha", () => {
    expect(PERMITIDAS).toEqual([
      "public.depoimentos_publicos()",
      "public.list_public_org_regions(text)",
      "public.list_public_org_specialists(text,text,bigint)",
      "public.list_public_positioning_regions()",
      "public.list_public_specialist_agencies()",
      "public.list_public_specialists(text,bigint)",
    ]);
    const linhas = readFileSync("supabase/tests/anon-funcoes-permitidas.txt", "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
    for (const l of linhas) expect(l).toMatch(/#\s+\S/);
  });
});

describe("migration 20261223120000_revoke_anon_funcoes (texto)", () => {
  const revogadas = [
    ...MIG.matchAll(/^REVOKE EXECUTE ON FUNCTION (.+?\)) FROM PUBLIC, anon;$/gm),
  ].map((m) => m[1]);

  it("fecha 74 funções e nenhuma delas é da lista permitida", () => {
    expect(revogadas).toHaveLength(74);
    expect(new Set(revogadas).size).toBe(74);
    for (const s of revogadas) expect(PERMITIDAS).not.toContain(s);
  });

  it("só mexe em permissão: sem corpo de função, política, tabela ou dado", () => {
    const sql = semComentarios(MIG);
    expect(sql).not.toMatch(/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i);
    expect(sql).not.toMatch(/\b(CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(sql).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+)/i,
    );
    expect(sql).not.toMatch(/\bREVOKE\b[^;]*\bFROM\b[^;]*\b(authenticated|service_role)\b[^;]*;/i);
  });

  it("default privileges: função nova sem anon e sem PUBLIC; authenticated/service_role seguem", () => {
    expect(MIG).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;",
    );
    expect(MIG).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;",
    );
    expect(MIG).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA academia GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;",
    );
    expect(semComentarios(MIG)).not.toMatch(
      /REVOKE[^;]*ON FUNCTIONS[^;]*(authenticated|service_role)/i,
    );
  });

  it("termina conferindo no banco: lista existe, só ela fica aberta e authenticated/service_role intactos", () => {
    expect(MIG).toContain("Função pública da lista não existe no banco");
    expect(MIG).toContain("Funções ainda executáveis sem login fora da lista permitida");
    expect(MIG).toContain("WHERE to_regprocedure(x) IS NOT NULL");
    expect(MIG).toContain("authenticated/service_role perderiam acesso a");
    for (const s of PERMITIDAS) expect(MIG).toContain(`'${s}'`);
  });
});

describe("rollback 20261223120000 (devolve a lista idêntica)", () => {
  it("cada função fechada volta com as mesmas entradas, na mesma ordem do comentário 'antes'", () => {
    const blocos = RB.split(/\n(?=-- public\.)/).filter((b) => b.startsWith("-- public."));
    expect(blocos).toHaveLength(74);
    for (const b of blocos) {
      const [, sig, antes] = b.match(/^-- (public\..+?\))\s+antes: (\{.*\})/)!;
      const entradas = antes
        .slice(1, -1)
        .split(",")
        .map((e) => e.split("=")[0] || "PUBLIC");
      const grants = [...b.matchAll(/^GRANT EXECUTE ON FUNCTION (.+?\)) TO (\S+);$/gm)];
      expect(grants.map((g) => g[1]).every((g) => g === sig)).toBe(true);
      expect(grants.map((g) => g[2])).toEqual(entradas);
      expect(b).toMatch(
        new RegExp(`^REVOKE ALL ON FUNCTION ${sig.replace(/[()[\].]/g, "\\$&")} FROM `, "m"),
      );
    }
  });

  it("devolve os default privileges como estavam", () => {
    expect(RB).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;",
    );
    expect(RB).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;",
    );
    expect(RB).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA academia REVOKE EXECUTE ON FUNCTIONS FROM authenticated, service_role;",
    );
  });
});
