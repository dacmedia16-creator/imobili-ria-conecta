/**
 * Trava contra valores absurdos no Meu Plano 2027 (cartão t_125c4dd3, Denis 20/11, tópico 6238).
 * REGRA ÚNICA usada pela tela do plano (avisos e bloqueio da assinatura) e pelos 3 painéis de metas
 * ("plano com valor a conferir"). Pura, sem banco. Não muda nenhuma conta: só lê o que calc() já usa.
 *
 * Limites (calibrados com os 114 planos reais de 2027, só leitura, em 20/11):
 * - Transações do ano (captação, venda, novas CREs e similares): só inteiro. Aviso acima de 150, bloqueio acima
 *   de 500 por campo. O maior plano legítimo tem 120 captações + 60 vendas; os erros vieram como 42.000/81.000.
 * - Ticket médio: aviso abaixo de R$ 50 mil ou acima de R$ 10 mi. O menor ticket legítimo é R$ 135 mil; os
 *   errados (R$ 250, 800, 15 mil, 30 mil) eram comissão digitada no lugar do ticket.
 * - % de comissão por transação: aviso fora de 1% a 10%. Os planos usam 2, 3 ou 6; os errados têm 45 (a faixa
 *   de comissionamento digitada no lugar errado) e 100.
 * - Comissão média por transação: aviso abaixo de R$ 1.000 (mesma trava de t_c14dccfe).
 * - Meta de comissão (VGC) do ano: aviso acima de R$ 1 mi; acima de R$ 5 mi bloqueia a ASSINATURA e o
 *   "usar como meta oficial" (o rascunho continua sendo salvo).
 * O banco repete as travas de bloqueio (migration 20261209120000: carreira_plano_assinar / usar_meta).
 */
import { calc, fmt, num, ok, type Respostas, type TaxasFunil, type Valor } from "./regras";
import { COMISSAO_MINIMA_REAIS } from "./comissao";

export const LIMITES = {
  transAviso: 150,
  transBloqueio: 500,
  ticketMin: 50_000,
  ticketMax: 10_000_000,
  pctMin: 1,
  pctMax: 10,
  comissaoMin: COMISSAO_MINIMA_REAIS,
  vgcAviso: 1_000_000,
  vgcBloqueio: 5_000_000,
} as const;

/** Campos de quantidade do ano (tela Metas, p32). `naMeta` = entra na meta oficial (painéis). */
export const CAMPOS_TRANSACAO: { k: string; nome: string; naMeta: boolean }[] = [
  { k: "mt.tCapt", nome: "transações de captação", naMeta: true },
  { k: "mt.tVenda", nome: "transações de venda", naMeta: true },
  { k: "mt.novas", nome: "novas CREs", naMeta: true },
  { k: "mt.vendidas", nome: "CREs vendidas", naMeta: false },
  { k: "mt.canc", nome: "CREs canceladas/expiradas", naMeta: false },
  { k: "mt.creIni", nome: "CREs ativas no início", naMeta: false },
  { k: "mt.creFim", nome: "CREs ativas no fim", naMeta: false },
];
const CHAVES_TRANSACAO = new Set(CAMPOS_TRANSACAO.map((c) => c.k));
export const ehCampoTransacao = (k: string) => CHAVES_TRANSACAO.has(k);

export type NivelAviso = "aviso" | "bloqueio";
export type AvisoPlano = {
  /** Chave do campo ("vgc" = meta de comissão do ano, calculada). */
  campo: string;
  nivel: NivelAviso;
  msg: string;
  /** O valor mexe na meta oficial (comissão, vendas, captações ou VGV): conta para "valor a conferir". */
  naMeta: boolean;
};
export type ConferenciaPlano = {
  avisos: AvisoPlano[];
  /** Algum bloqueio: não assina nem grava a meta oficial (rascunho continua salvo). */
  bloqueiaAssinatura: boolean;
  /** Algum aviso em valor que entra na meta: marca "plano com valor a conferir" nos painéis. */
  aConferir: boolean;
};

const inteiro = (v: number) => Math.round(v).toLocaleString("pt-BR");
const texto = (v: Valor) =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";

/** Texto digitado é número inteiro sem ponto/vírgula ("42", " 7 "). Vazio = true (não avisa). */
export function textoInteiro(v: Valor): boolean {
  if (v === undefined || v === null || v === "" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isInteger(v);
  const s = v.trim();
  return s === "" || /^\d+$/.test(s);
}

/**
 * Filtro da digitação dos campos de transação (Inp `aceita`): só dígitos (sem ponto, vírgula, letra ou %).
 * Devolve null se aceita; senão a mensagem para mostrar (o texto recusado não é gravado).
 * Acima de 500 NÃO é recusado na digitação: recusar tecla a tecla deixaria gravado um pedaço do número
 * (ex.: "420" ao digitar 42000). O número fica como digitado, com o aviso vermelho, e a assinatura trava.
 */
export function recusaTransacao(txt: string, nome: string): string | null {
  const s = txt.trim();
  if (s === "" || /^\d+$/.test(s)) return null;
  const n = num(s);
  if (ok(n) && n > LIMITES.transBloqueio)
    return `Você digitou ${inteiro(n)} ${nome} no ano. Confira se não digitou um valor em reais. Use só números inteiros, sem ponto nem vírgula, até ${LIMITES.transBloqueio}.`;
  return "Use só números inteiros, sem ponto nem vírgula (ex.: 24).";
}

function avisoTransacao(
  campo: string,
  nome: string,
  naMeta: boolean,
  bruto: Valor,
  usado: number,
): AvisoPlano | null {
  const digitado = texto(bruto) !== "";
  if (digitado && !textoInteiro(bruto)) {
    const n = num(bruto);
    return {
      campo,
      nivel: "bloqueio",
      naMeta,
      msg:
        ok(n) && n > LIMITES.transBloqueio
          ? `Você digitou ${inteiro(n)} ${nome} no ano ("${texto(bruto)}"). Confira se não digitou um valor em reais. Use só números inteiros, até ${LIMITES.transBloqueio}.`
          : `${cap(nome)}: "${texto(bruto)}" não é um número inteiro. Use só números, sem ponto nem vírgula (ex.: 24).`,
    };
  }
  if (!ok(usado)) return null;
  const quem = digitado ? "Você digitou" : "A sugestão do plano deu";
  // Sugestão em branco só bloqueia nas transações (elas fazem o VGC). Novas CREs sugeridas vêm da conversão
  // (transações ÷ conversão) e podem passar de 500 num plano legítimo de conversão baixa: aí só avisa.
  const bloqueiaSugestao = campo === "mt.tCapt" || campo === "mt.tVenda";
  if (usado > LIMITES.transBloqueio && (digitado || bloqueiaSugestao))
    return {
      campo,
      nivel: "bloqueio",
      naMeta,
      msg: `${quem} ${inteiro(usado)} ${nome} no ano. Confira se não ${digitado ? "digitou" : "entrou"} um valor em reais${digitado ? "" : " no ticket ou na comissão"}. O máximo aceito é ${LIMITES.transBloqueio}.`,
    };
  if (usado > (digitado || bloqueiaSugestao ? LIMITES.transAviso : LIMITES.transBloqueio))
    return {
      campo,
      nivel: "aviso",
      naMeta,
      msg: `${quem} ${inteiro(usado)} ${nome} no ano. É bem acima do comum (até ${LIMITES.transAviso}). Confira o número.`,
    };
  return null;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Confere o plano. Usa os MESMOS valores da conta (calc): digitado ou, em branco, a sugestão.
 * Funciona com as respostas inteiras (tela do plano) ou só com as da meta (painéis, metas_respostas_meta);
 * campos que não entram na meta só são conferidos quando vierem nas respostas.
 */
export function conferirPlano(
  S: Respostas | null | undefined,
  padrao?: Partial<TaxasFunil> | null,
): ConferenciaPlano {
  const r = S ?? {};
  const avisos: AvisoPlano[] = [];
  if (Object.keys(r).length === 0) return { avisos, bloqueiaAssinatura: false, aConferir: false };
  const C = calc(r, padrao);
  const usado: Record<string, number> = {
    "mt.tCapt": C.tCapt,
    "mt.tVenda": C.tVenda,
    "mt.novas": C.novas,
  };
  for (const c of CAMPOS_TRANSACAO) {
    const a = avisoTransacao(c.k, c.nome, c.naMeta, r[c.k], usado[c.k] ?? num(r[c.k]));
    if (a) avisos.push(a);
  }
  // Ticket: o valor usado na conta (digitado ou o do diagnóstico). Entra na meta de VGV.
  const ticketDigitado = texto(r["m.ticket"]) !== "";
  if (ok(C.ticket) && C.ticket > 0) {
    const de = ticketDigitado ? "" : " (do seu diagnóstico)";
    if (C.ticket < LIMITES.ticketMin)
      avisos.push({
        campo: ticketDigitado ? "m.ticket" : "d.ticket",
        nivel: "aviso",
        naMeta: true,
        msg: `Ticket médio de ${fmt.brl0(C.ticket)}${de} parece baixo. É o preço médio do imóvel vendido (ex.: 450000), não a comissão.`,
      });
    else if (C.ticket > LIMITES.ticketMax)
      avisos.push({
        campo: ticketDigitado ? "m.ticket" : "d.ticket",
        nivel: "aviso",
        naMeta: true,
        msg: `Ticket médio de ${fmt.brl0(C.ticket)}${de} parece alto. Confira se não sobrou zero.`,
      });
  }
  // % por transação: só mexe na meta quando a comissão média está em branco (aí ela = ticket × %).
  const comDigitada = texto(r["mt.comMedia"]) !== "";
  if (ok(C.pctTrans) && (C.pctTrans < LIMITES.pctMin || C.pctTrans > LIMITES.pctMax))
    avisos.push({
      campo: "m.pct",
      nivel: "aviso",
      naMeta: !comDigitada,
      msg:
        C.pctTrans > LIMITES.pctMax
          ? `${fmt.pc(C.pctTrans)} de comissão por transação parece alto. O comum fica entre ${LIMITES.pctMin}% e ${LIMITES.pctMax}% (ex.: 3 ou 6). Confira se não digitou a sua faixa de comissionamento (40%, 45%, 60%, 70%).`
          : `${fmt.pc(C.pctTrans)} de comissão por transação parece baixo. O comum fica entre ${LIMITES.pctMin}% e ${LIMITES.pctMax}% (ex.: 3 ou 6).`,
    });
  // Comissão média usada na conta (digitada ou ticket × %).
  if (ok(C.comMedia) && C.comMedia > 0 && C.comMedia < LIMITES.comissaoMin)
    avisos.push({
      campo: comDigitada ? "mt.comMedia" : "m.pct",
      nivel: "aviso",
      naMeta: true,
      msg: comDigitada
        ? `Comissão média de ${fmt.brl(C.comMedia)} por transação parece baixa. É em reais (ex.: 12000), não em %.`
        : `A comissão média por transação ficou em ${fmt.brl(C.comMedia)} (ticket × %). Parece baixa: confira o ticket e o %.`,
    });
  // Meta de comissão do ano (VGC).
  if (ok(C.vgc)) {
    if (C.vgc > LIMITES.vgcBloqueio)
      avisos.push({
        campo: "vgc",
        nivel: "bloqueio",
        naMeta: true,
        msg: `Sua meta de comissão do ano ficou em ${fmt.brl0(C.vgc)}, acima de R$ 5 milhões. O plano continua salvo, mas para assinar confira as transações e a comissão média.`,
      });
    else if (C.vgc > LIMITES.vgcAviso)
      avisos.push({
        campo: "vgc",
        nivel: "aviso",
        naMeta: true,
        msg: `Sua meta de comissão do ano ficou em ${fmt.brl0(C.vgc)}. É bem acima do comum (até R$ 1 milhão). Confira as transações e a comissão média.`,
      });
  }
  return {
    avisos,
    bloqueiaAssinatura: avisos.some((a) => a.nivel === "bloqueio"),
    // Só marca plano que tem meta (plano sem VGC não entra em soma nenhuma).
    aConferir: ok(C.vgc) && avisos.some((a) => a.naMeta),
  };
}

/** Avisos de um campo (para mostrar embaixo dele). */
export const avisosDoCampo = (c: ConferenciaPlano, ...campos: string[]) =>
  c.avisos.filter((a) => campos.includes(a.campo));
