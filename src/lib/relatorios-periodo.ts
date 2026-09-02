export type AtalhoPeriodoRelatorios = "mes_atual" | "mes_anterior";

function dataIsoLocal(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

export function periodoMensalRelatorios(
  periodo: AtalhoPeriodoRelatorios,
  agora = new Date(),
): { de: string; ate: string } {
  const deslocamento = periodo === "mes_anterior" ? -1 : 0;
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + deslocamento;

  return {
    de: dataIsoLocal(new Date(ano, mes, 1)),
    ate: dataIsoLocal(new Date(ano, mes + 1, 0)),
  };
}
