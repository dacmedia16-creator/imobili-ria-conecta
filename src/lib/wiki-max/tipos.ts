import type { WikiVideoChave } from "./videos";

/** Papéis como a Wiki os marca: c corretor, tl team leader, g gestor, a administrador, f financeiro. */
export type WikiPapel = "c" | "tl" | "g" | "a" | "f";
export type WikiSistema = "ger" | "adm" | "vis" | "est";

export type WikiGuia = {
  id: string;
  sistema: WikiSistema;
  icone: string;
  titulo: string;
  resumo: string;
  papeis: WikiPapel[];
  onde: string;
  passos: string[];
  dica?: string;
  cuidado?: string;
  outrosPapeis?: string;
  prints?: { chave: string; legenda: string }[];
  /**
   * Vídeos do guia, na ordem em que aparecem: arquivo em WIKI_VIDEOS (bucket privado);
   * capa = print em src/assets/wiki-max.
   */
  videos?: WikiGuiaVideo[];
};

export type WikiGuiaVideo = {
  chave: WikiVideoChave;
  capa: string;
  /** Título curto mostrado acima do player (ex.: "Vídeo 1 de 2 · Registrar a venda"). */
  titulo?: string;
  legenda: string;
  duracao: string;
};

export type WikiFaq = { pergunta: string; resposta: string };
