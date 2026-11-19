/**
 * Realizado dos painéis de metas 2027 (cartão t_f87b2ae5). Funções puras, sem banco.
 *
 * Regra (a mesma de meu_realizado e dos relatórios): a venda conta na ASSINATURA, no mês civil de
 * São Paulo; comissão = parte do corretor (occurrence_commissions, já líquida de indicador/extras);
 * VGV = VGV próprio da venda; captação conta na aprovação da exclusividade. Número digitado pelo
 * corretor (pm.*) NUNCA entra como realizado.
 *
 * Soma de equipe/imobiliária sem contar venda em dobro: a mesma venda com captador e vendedor no
 * grupo conta 1 venda e 1 VGV; a comissão soma a parte de cada pessoa (são valores diferentes).
 */
import { dataCivilSaoPaulo } from "@/lib/hoje-sao-paulo";
import type { Realizado } from "@/lib/minha-carreira";
import { valoresZero, type Valores } from "./regra";

/** Uma participação de uma pessoa numa venda válida (uma linha por pessoa e venda). */
export type ParticipacaoVenda = {
  saleId: string;
  userId: string;
  /** Data de assinatura: "aaaa-mm-dd" ou timestamptz (convertido para o dia de São Paulo). */
  assinadaEm: string;
  /** Parte do corretor nesta venda (líquida). */
  comissao: number;
  /** VGV próprio da venda (o mesmo valor em todas as linhas da venda). */
  vgv: number;
};

/** Uma captação aprovada (conta para o captador original). */
export type CaptacaoAprovada = {
  captureId: string;
  userId: string;
  aprovadaEm: string;
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const numero = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Mês 1..12 da data no fuso de São Paulo, ou null se for de outro ano / data inválida. */
export function mesNoAno(valor: string | null | undefined, ano: number): number | null {
  const d = dataCivilSaoPaulo(valor);
  if (!d || Number(d.slice(0, 4)) !== ano) return null;
  return Number(d.slice(5, 7));
}

/**
 * Realizado mês a mês (12 posições) de UMA pessoa ou de um GRUPO (equipe/imobiliária).
 * `pessoas` = quem conta no grupo; vazio/undefined = todo mundo das listas.
 * `captacoesLigadas = false` → captações ficam null (módulo de captação desligado, como meu_realizado).
 */
export function realizadoMensal(
  vendas: readonly ParticipacaoVenda[],
  captacoes: readonly CaptacaoAprovada[],
  ano: number,
  pessoas?: ReadonlySet<string> | null,
  captacoesLigadas = true,
): Valores[] {
  const conta = (u: string) => !pessoas || pessoas.size === 0 || pessoas.has(u);
  const meses = Array.from({ length: 12 }, valoresZero);
  const vendaContada = new Set<string>();
  for (const p of vendas) {
    if (!conta(p.userId)) continue;
    const m = mesNoAno(p.assinadaEm, ano);
    if (m == null) continue;
    const alvo = meses[m - 1];
    alvo.comissao = r2((alvo.comissao ?? 0) + numero(p.comissao));
    if (!vendaContada.has(p.saleId)) {
      vendaContada.add(p.saleId);
      alvo.vendas = (alvo.vendas ?? 0) + 1;
      alvo.vgv = r2((alvo.vgv ?? 0) + numero(p.vgv));
    }
  }
  const capContada = new Set<string>();
  for (const c of captacoes) {
    if (!conta(c.userId) || capContada.has(c.captureId)) continue;
    const m = mesNoAno(c.aprovadaEm, ano);
    if (m == null) continue;
    capContada.add(c.captureId);
    meses[m - 1].captacoes = (meses[m - 1].captacoes ?? 0) + 1;
  }
  if (!captacoesLigadas) for (const m of meses) m.captacoes = null;
  return meses;
}

/** Converte o retorno de meu_realizado (normalizarRealizado) de UM mês para Valores. */
export function valoresDeMeuRealizado(r: Realizado | null | undefined): Valores {
  if (!r) return valoresZero();
  return { comissao: r.comissao, vendas: r.vendas, vgv: r.vgv, captacoes: r.captacoes };
}

/**
 * Monta os 12 meses a partir de chamadas mensais de meu_realizado (chave = mês 1..12).
 * Mês ausente = 0 (ainda sem venda); captações null se o módulo estiver desligado.
 */
export function realizadoDeMeuRealizadoPorMes(
  porMes: Partial<Record<number, Realizado | null>>,
): Valores[] {
  return Array.from({ length: 12 }, (_, i) => valoresDeMeuRealizado(porMes[i + 1]));
}
