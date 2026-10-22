import type { WikiGuia, WikiPapel, WikiSistema } from "./tipos";

export const NOME_PAPEL: Record<WikiPapel, string> = {
  c: "Corretor",
  tl: "Team leader",
  g: "Gestor",
  a: "Administrador",
  f: "Financeiro",
};

export const NOME_SISTEMA: Record<WikiSistema, string> = {
  ger: "Geral",
  adm: "ADM MAX",
  vis: "Visita MAX",
  est: "Estudo de Mercado MAX",
};

const DO_PAPEL: Record<string, WikiPapel> = {
  corretor: "c",
  team_leader: "tl",
  gestor: "g",
  admin: "a",
  super_admin: "a",
  financeiro: "f",
};

/** Papéis da Wiki que a pessoa tem. Vazio = nenhum papel com guia próprio (mostra todos). */
export function papeisDaWiki(roles: readonly string[]): WikiPapel[] {
  const out = new Set<WikiPapel>();
  for (const r of roles) if (DO_PAPEL[r]) out.add(DO_PAPEL[r]);
  return [...out];
}

/** Guias do papel da pessoa; sem papel reconhecido, todos (só muda o que aparece primeiro). */
export function guiasDoPapel(guias: WikiGuia[], papeis: WikiPapel[]): WikiGuia[] {
  if (papeis.length === 0) return guias;
  return guias.filter((g) => g.papeis.some((p) => papeis.includes(p)));
}

export function normalizar(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Busca sem acento em título, resumo, onde fica, passos, dica, cuidado, papéis e sistema. */
export function buscarGuias(guias: WikiGuia[], termo: string): WikiGuia[] {
  const t = normalizar(termo.trim());
  if (!t) return guias;
  return guias.filter((g) =>
    normalizar(
      [
        g.titulo,
        g.resumo,
        g.onde,
        ...g.passos,
        g.dica ?? "",
        g.cuidado ?? "",
        g.outrosPapeis ?? "",
        g.papeis.map((p) => NOME_PAPEL[p]).join(" "),
        NOME_SISTEMA[g.sistema],
      ].join(" "),
    ).includes(t),
  );
}

/** Divide "texto <b>negrito</b> texto" em partes; qualquer outra tag vira texto puro. */
export function partesNegrito(s: string): { texto: string; negrito: boolean }[] {
  const out: { texto: string; negrito: boolean }[] = [];
  const re = /<b>(.*?)<\/b>/g;
  let ultimo = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > ultimo) out.push({ texto: s.slice(ultimo, m.index), negrito: false });
    out.push({ texto: m[1], negrito: true });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < s.length) out.push({ texto: s.slice(ultimo), negrito: false });
  return out;
}
