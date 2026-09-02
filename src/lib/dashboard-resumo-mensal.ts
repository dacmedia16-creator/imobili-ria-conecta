export type ResumoMensalPeriodo = {
  de: string;
  ate: string;
  hoje: string;
  label: string;
};

/** Intervalo mensal do resumo do gestor, sempre baseado no calendário de São Paulo. */
export function intervaloResumoMensal(
  deslocamentoMes: 0 | -1,
  agora = new Date(),
): ResumoMensalPeriodo {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(agora);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((parte) => parte.type === tipo)?.value);

  const referencia = new Date(Date.UTC(valor("year"), valor("month") - 1 + deslocamentoMes, 1));
  const ano = referencia.getUTCFullYear();
  const mes = referencia.getUTCMonth();
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const mm = String(mes + 1).padStart(2, "0");
  const diaHoje = deslocamentoMes === 0 ? valor("day") : ultimoDia;

  return {
    de: `${ano}-${mm}-01`,
    ate: `${ano}-${mm}-${String(ultimoDia).padStart(2, "0")}`,
    hoje: `${ano}-${mm}-${String(diaHoje).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }).format(referencia),
  };
}
