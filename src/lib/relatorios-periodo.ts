export type AtalhoPeriodoRelatorios = "mes_atual" | "mes_anterior";

function anoMesSaoPaulo(data: Date): { ano: number; mes: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(data);
  return {
    ano: Number(partes.find((p) => p.type === "year")?.value),
    mes: Number(partes.find((p) => p.type === "month")?.value),
  };
}

export function periodoMensalRelatorios(
  periodo: AtalhoPeriodoRelatorios,
  agora = new Date(),
): { de: string; ate: string } {
  const deslocamento = periodo === "mes_anterior" ? -1 : 0;
  const { ano, mes } = anoMesSaoPaulo(agora);
  const primeiro = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  const ultimo = new Date(Date.UTC(ano, mes + deslocamento, 0));
  return {
    de: primeiro.toISOString().slice(0, 10),
    ate: ultimo.toISOString().slice(0, 10),
  };
}
