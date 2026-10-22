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
};

export type WikiFaq = { pergunta: string; resposta: string };
