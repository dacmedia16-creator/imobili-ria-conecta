// Revisão (admin) de como cada corretor do XML RE/MAX ficou ligado a um usuário do ADM.
// A RPC remax_xml_broker_links não devolve e-mail nem telefone; aqui só agrupamos e rotulamos.

// "admin": vínculo confirmado por um admin na lista de revisão (migration 20261016210000).
export type Via = "id" | "admin" | "email" | "telefone" | "conflito" | "sem_cadastro";

export type BrokerLink = {
  agent_id: string;
  corretor_xml: string | null;
  via: Via;
  candidatos: number;
  broker_id: string | null;
  anuncios: number;
};

export const VIA_TEXTO: Record<Via, string> = {
  id: "Ligado pelo ID RE/MAX",
  admin: "Confirmado por um admin",
  email: "Ligado pelo e-mail",
  telefone: "Ligado pelo telefone",
  conflito: "Conflito: mais de um usuário possível",
  sem_cadastro: "Sem usuário no ADM",
};

/** O que o admin precisa fazer em cada caso (texto curto). */
export const VIA_ACAO: Record<Via, string> = {
  id: "",
  admin: "",
  email: "Confira e preencha o ID RE/MAX no cadastro para fixar o vínculo.",
  telefone: "Confira e preencha o ID RE/MAX no cadastro para fixar o vínculo.",
  conflito: "Preencha o ID RE/MAX no cadastro certo; até lá os anúncios ficam só com o admin.",
  sem_cadastro: "Cadastre o corretor (com o ID RE/MAX) ou deixe os anúncios com o admin.",
};

export const precisaRevisar = (l: BrokerLink) => l.via !== "id" && l.via !== "admin";

export type ResumoLinks = Record<Via, { corretores: number; anuncios: number }>;

export function resumoLinks(rows: BrokerLink[]): ResumoLinks {
  const r = Object.fromEntries(
    (Object.keys(VIA_TEXTO) as Via[]).map((v) => [v, { corretores: 0, anuncios: 0 }]),
  ) as ResumoLinks;
  for (const l of rows) {
    const k = r[l.via] ? l.via : "sem_cadastro";
    r[k].corretores++;
    r[k].anuncios += l.anuncios;
  }
  return r;
}

const ORDEM: Via[] = ["conflito", "sem_cadastro", "telefone", "email", "admin", "id"];

/** Pendências primeiro (conflito, sem cadastro, telefone, e-mail), depois os ligados por ID. */
export const ordenarLinks = (rows: BrokerLink[]) =>
  [...rows].sort(
    (a, b) =>
      ORDEM.indexOf(a.via) - ORDEM.indexOf(b.via) ||
      b.anuncios - a.anuncios ||
      a.agent_id.localeCompare(b.agent_id),
  );
