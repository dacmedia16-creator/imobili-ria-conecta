// "Virou venda" (maquete t_44bf526e, aprovada por Denis em 08/10/2026): textos e contas puras
// usadas na captação, na lista, no mapa e na venda. A regra de quem pode e a situação vêm do banco.

export type SituacaoVendaCaptacao = "rascunho" | "em_negociacao" | "vendida";

/** Dias inteiros entre duas datas civis YYYY-MM-DD (nunca negativo). */
export function diasEntre(desde: string | null | undefined, hoje: string): number | null {
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hoje))
    return null;
  const ms = Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** "hoje", "há 1 dia", "há 12 dias". */
export function haQuantosDias(dias: number | null): string {
  if (dias === null) return "";
  if (dias === 0) return "hoje";
  return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Selo da captação conforme a venda ativa (rascunho não muda nada: continua "Ativa"). */
export function seloSituacaoCaptacao(
  situacao: SituacaoVendaCaptacao | null | undefined,
): { texto: string; classe: string } | null {
  if (situacao === "em_negociacao")
    return {
      texto: "Em negociação",
      classe: "border border-orange-300 bg-orange-100 text-orange-800",
    };
  if (situacao === "vendida") return { texto: "Vendida", classe: "bg-violet-100 text-violet-800" };
  return null;
}

/** Nome do documento herdado da captação, como aparece na venda. */
export function rotuloDocumentoHerdado(kind: string, ownerIndex: number): string {
  const base: Record<string, string> = {
    rg: "RG",
    cpf: "CPF",
    cnh: "CNH",
    iptu: "IPTU",
    matricula: "Matrícula",
    residencia: "Comprovante de residência",
    assinado: "Contrato de exclusividade assinado",
  };
  const nome = base[kind] ?? kind.replace(/_/g, " ");
  return ownerIndex > 0 ? `${nome} — proprietário ${ownerIndex}` : nome;
}
