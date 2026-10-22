import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { FAQ, GUIAS } from "./guias";
import { buscarGuias, guiasDoPapel, papeisDaWiki, partesNegrito } from "./filtro";
import { WIKI_VIDEO_BUCKET, WIKI_VIDEOS } from "./videos";

const raiz = resolve(__dirname, "../../..");
const texto = (g: (typeof GUIAS)[number]) =>
  [g.titulo, g.resumo, g.onde, ...g.passos, g.dica, g.cuidado, g.outrosPapeis]
    .concat((g.prints ?? []).map((p) => p.legenda))
    .join(" ");

describe("Wiki MAX v4 dentro da ajuda", () => {
  it("22 guias publicáveis + 7 dúvidas; a calculadora pública (marcada 'não publicar') fica fora", () => {
    expect(GUIAS).toHaveLength(22);
    expect(FAQ).toHaveLength(7);
    expect(GUIAS.some((g) => g.id === "estudo-calc")).toBe(false);
    expect(new Set(GUIAS.map((g) => g.id)).size).toBe(GUIAS.length);
  });

  it("nada que era só da maquete aparece na página", () => {
    const tudo = GUIAS.map(texto).join(" ") + FAQ.map((f) => f.pergunta + f.resposta).join(" ");
    for (const proibido of [
      /maquete/i,
      /conferido pelo c[oó]digo/i,
      /o que mudou/i,
      /rascunho da wiki/i,
      /lacuna/i,
      /decis[aã]o (marcada|de produto)/i,
      /Denis/,
      /simulad[ao] s[oó] no navegador/i,
      /conta de teste/i,
      /fict[ií]ci/i,
    ])
      expect(tudo).not.toMatch(proibido);
  });

  it("só aceita <b> como marcação", () => {
    for (const g of GUIAS) expect(texto(g).replace(/<\/?b>/g, "")).not.toMatch(/<[a-z/]/i);
    expect(partesNegrito("a <b>b</b> c")).toEqual([
      { texto: "a ", negrito: false },
      { texto: "b", negrito: true },
      { texto: " c", negrito: false },
    ]);
  });

  it("todo print citado existe em src/assets (fora de public/) e não sobra arquivo", () => {
    const dir = resolve(raiz, "src/assets/wiki-max");
    const citados = new Set(
      GUIAS.flatMap((g) =>
        (g.prints ?? []).map((p) => p.chave).concat(g.video ? [g.video.capa] : []),
      ),
    );
    for (const c of citados) expect(existsSync(resolve(dir, `${c}.webp`))).toBe(true);
    const arquivos = readdirSync(dir).map((f) => f.replace(/\.webp$/, ""));
    expect(arquivos.sort()).toEqual([...citados].sort());
    expect(existsSync(resolve(raiz, "public/wiki-max"))).toBe(false);
  });

  it("guias por papel", () => {
    const ids = (roles: string[]) => guiasDoPapel(GUIAS, papeisDaWiki(roles)).map((g) => g.id);
    expect(ids(["corretor"])).toContain("venda");
    expect(ids(["corretor"])).not.toContain("financeiro");
    expect(ids(["corretor"])).not.toContain("usuarios");
    expect(ids(["team_leader"])).toContain("painel-equipe");
    expect(ids(["gestor"])).toContain("usuarios");
    expect(ids(["admin"])).toContain("financeiro");
    expect(ids(["admin"])).toContain("modulos");
    expect(ids(["super_admin"])).toEqual(ids(["admin"]));
    // papel sem guia próprio (ex.: jurídico) vê todos
    expect(ids(["juridico"])).toHaveLength(GUIAS.length);
    // gestor + corretor somam os dois
    expect(ids(["gestor", "corretor"]).length).toBeGreaterThanOrEqual(ids(["gestor"]).length);
  });

  it("busca sem acento e em texto em negrito", () => {
    expect(buscarGuias(GUIAS, "aniversario").map((g) => g.id)).toContain("mural");
    expect(buscarGuias(GUIAS, "Criar rascunho").map((g) => g.id)).toContain("venda");
    expect(buscarGuias(GUIAS, "zzzz-nada")).toHaveLength(0);
  });

  it("rota fica dentro do layout autenticado", () => {
    const rota = readFileSync(resolve(raiz, "src/routes/_authenticated/ajuda_.wiki.tsx"), "utf8");
    expect(rota).toContain('createFileRoute("/_authenticated/ajuda_/wiki")');
    expect(rota).not.toContain("dangerouslySetInnerHTML");
  });

  it("vídeo: só o guia venda tem; arquivo no bucket privado, link só com login e chave fixa", () => {
    expect(GUIAS.filter((g) => g.video).map((g) => g.id)).toEqual(["venda"]);
    const venda = GUIAS.find((g) => g.id === "venda")!;
    expect(venda.video?.chave).toBe("venda");
    expect(WIKI_VIDEOS[venda.video!.chave]).toMatch(/^venda\/.+-v2\.mp4$/);
    expect(WIKI_VIDEO_BUCKET).toBe("wiki-midia");
    expect(existsSync(resolve(raiz, "public/wiki-midia"))).toBe(false);

    const fn = readFileSync(resolve(raiz, "src/lib/wiki-max/videos.functions.ts"), "utf8");
    expect(fn).toContain("requireSupabaseAuth");
    expect(fn).toContain("z.enum(WIKI_VIDEO_CHAVES)");

    const player = readFileSync(resolve(raiz, "src/components/wiki/WikiVideo.tsx"), "utf8");
    for (const attr of ["controls", 'preload="metadata"', "playsInline"])
      expect(player).toContain(attr);

    const sql = readFileSync(
      resolve(raiz, "supabase/migrations/20261022230000_wiki_midia_bucket.sql"),
      "utf8",
    );
    expect(sql).toMatch(/'wiki-midia', 'wiki-midia', false/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
