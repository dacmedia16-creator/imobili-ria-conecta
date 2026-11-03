/** Sistemas da rede REMAX Brasil listados na página /sistemas-remax (t_06bb81c4).
 * Todos são externos: cada um abre em aba nova, com o login próprio dele. */
export type SistemaRemax = {
  id: string;
  nome: string;
  /** Iniciais mostradas no ícone redondo. */
  sigla: string;
  descricao?: string;
  href: string;
};

export const SISTEMAS_REMAX: SistemaRemax[] = [
  {
    id: "ilist",
    nome: "iList",
    sigla: "iL",
    href: "https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f",
  },
  {
    id: "banib",
    nome: "Banib",
    sigla: "BA",
    href: "https://gerenciador.banibconecta.com/manager/login",
  },
  { id: "remarkt", nome: "REMARKT", sigla: "RE", href: "https://br.remarkt.net/auth/login" },
  {
    id: "buffini",
    nome: "Buffini",
    sigla: "BU",
    descricao: "Treinamento",
    href: "https://www.buffini.com.br/",
  },
  {
    id: "c2s",
    nome: "C2S",
    sigla: "C2S",
    descricao: "Gestão de leads",
    href: "https://api.contact2sale.com/webapp/login",
  },
];
