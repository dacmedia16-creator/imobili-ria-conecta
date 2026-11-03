/** Sistemas da rede REMAX Brasil listados na página /sistemas-remax (t_06bb81c4).
 * Todos são externos: cada um abre em aba nova, com o login próprio dele. */
export type SistemaRemax = {
  id: string;
  nome: string;
  /** Iniciais mostradas no ícone redondo (usadas só se não houver logo). */
  sigla: string;
  /** Logo oficial salvo em public/sistemas-remax/ (t_48434b4a). Sem hotlink. */
  logo?: string;
  /** Fundo do círculo atrás do logo. Padrão: branco. Use cor quando o logo oficial é branco. */
  logoFundo?: string;
  descricao?: string;
  href: string;
};

export const SISTEMAS_REMAX: SistemaRemax[] = [
  {
    id: "ilist",
    nome: "iList",
    sigla: "iL",
    logo: "/sistemas-remax/ilist.svg",
    href: "https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f",
  },
  {
    id: "banib",
    nome: "Banib",
    sigla: "BA",
    logo: "/sistemas-remax/banib.png",
    href: "https://gerenciador.banibconecta.com/manager/login",
  },
  {
    id: "remarkt",
    nome: "REMARKT",
    sigla: "RE",
    logo: "/sistemas-remax/remarkt.png",
    href: "https://br.remarkt.net/auth/login",
  },
  {
    id: "buffini",
    nome: "Buffini",
    sigla: "BU",
    logo: "/sistemas-remax/buffini.svg",
    descricao: "Treinamento",
    href: "https://www.buffini.com.br/",
  },
  {
    id: "c2s",
    nome: "C2S",
    sigla: "C2S",
    logo: "/sistemas-remax/c2s.png",
    // Logo oficial do C2S é branco; na página de login ele aparece sobre este azul (#449be9).
    logoFundo: "#449be9",
    descricao: "Gestão de leads",
    href: "https://api.contact2sale.com/webapp/login",
  },
  {
    id: "universidade-remax",
    nome: "Universidade REMAX",
    sigla: "UR",
    // Escudo recortado do logo oficial (t_d5a53c2a); fundo = bordô da própria imagem.
    logo: "/sistemas-remax/universidade-remax.png",
    logoFundo: "#5d0d06",
    descricao: "EAD",
    href: "https://hub.minharemax.com/universidade",
  },
  {
    id: "eemovel",
    nome: "eemovel",
    sigla: "EE",
    // Ícone das barras recortado do logo oficial (t_63a28bd0); fundo = azul-marinho da própria imagem.
    logo: "/sistemas-remax/eemovel.png",
    logoFundo: "#090c2d",
    href: "https://brokers.eemovel.com.br/login",
  },
  {
    id: "checkonn",
    nome: "Checkonn",
    sigla: "CK",
    // Ícone do "O" recortado do logo oficial (t_601fa6c9); fundo branco padrão.
    logo: "/sistemas-remax/checkonn.png",
    descricao: "Inteligência de dados",
    href: "https://appbuscacheckonn.com/login.aspx?ReturnUrl=%2fconsultas%2fConsultaCPF.aspx",
  },
];
