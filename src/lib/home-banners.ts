// Banner rotativo no topo do Início (cartão t_75786f5c). Regras puras, sem rede, usadas pela tela de cadastro,
// pelo carrossel e pelos testes. O banco (migration 20261121120000) é a proteção real: aqui só se orienta o usuário.
import { ROLE_LABEL, type AppRole } from "@/lib/auth";

/** Tamanho padrão da arte: proporção 3:1 (ex.: 1500 × 500 px). Mostrado na tela de cadastro. */
export const BANNER_LARGURA = 1500;
export const BANNER_ALTURA = 500;
export const BANNER_PROPORCAO = BANNER_LARGURA / BANNER_ALTURA;
/** Igual ao file_size_limit do bucket home-banners. */
export const BANNER_TAMANHO_MAX = 2 * 1024 * 1024;
export const BANNER_TIPOS = ["image/jpeg", "image/png", "image/webp"] as const;
/** Troca automática do carrossel. */
export const BANNER_INTERVALO_MS = 5000;

export const ORIENTACAO_IMAGEM =
  `Use imagem na proporção 3:1 (recomendado ${BANNER_LARGURA} × ${BANNER_ALTURA} px), JPG, PNG ou WEBP, ` +
  "até 2 MB. Deixe textos e logotipos longe das bordas. No celular a arte aparece inteira, só menor.";

export type BannerAtivo = { id: string; titulo: string; link: string | null; url: string };

export type BannerCadastro = {
  id: string;
  titulo: string;
  imagem_path: string;
  link: string | null;
  inicio: string;
  fim: string;
  publico: string[];
  ordem: number;
  ativo: boolean;
  no_ar: boolean;
  url: string | null;
};

/** Extensão aceita pelo banco a partir do tipo do arquivo. */
export function extensaoBanner(tipo: string): "jpg" | "png" | "webp" | null {
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/png") return "png";
  if (tipo === "image/webp") return "webp";
  return null;
}

/** Mesma regra do banco: rota interna ("/vendas") ou endereço https. Vazio = sem link. */
export function linkBannerValido(link: string): boolean {
  const l = link.trim();
  if (!l) return true;
  if (l.length > 500) return false;
  if (l.startsWith("/")) return !l.startsWith("//") && /^\/[A-Za-z0-9/_.~%?=&#+-]*$/.test(l);
  return /^https:\/\/[^\s<>"]+$/.test(l);
}

export function linkInterno(link: string): boolean {
  return link.startsWith("/") && !link.startsWith("//");
}

/** Papéis que podem ser público-alvo: todos os do sistema, menos o Fotógrafo (ele não abre o Início).
 * Um papel novo (ex.: Locação, t_1fe07126) entra sozinho quando for adicionado a ROLE_LABEL. */
export function papeisDoPublico(): { valor: AppRole; rotulo: string }[] {
  return (Object.keys(ROLE_LABEL) as AppRole[])
    .filter((r) => r !== "fotografo")
    .map((valor) => ({ valor, rotulo: ROLE_LABEL[valor] }));
}

export function rotuloPublico(publico: readonly string[]): string {
  if (!publico.length) return "Todos";
  return publico.map((p) => ROLE_LABEL[p as AppRole] ?? p).join(", ");
}

/** A imagem está fora do padrão 3:1? (tolerância de 5%; só avisa, não impede). */
export function foraDaProporcao(largura: number, altura: number): boolean {
  if (!largura || !altura) return false;
  return Math.abs(largura / altura - BANNER_PROPORCAO) / BANNER_PROPORCAO > 0.05;
}

/** Situação mostrada na lista do cadastro. */
export function situacaoBanner(
  b: Pick<BannerCadastro, "ativo" | "inicio" | "fim">,
  hoje: string,
): "no_ar" | "agendado" | "encerrado" | "desativado" {
  if (!b.ativo) return "desativado";
  if (hoje < b.inicio) return "agendado";
  if (hoje > b.fim) return "encerrado";
  return "no_ar";
}

/** Data de hoje (AAAA-MM-DD) no fuso de São Paulo, igual ao filtro do banco. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
