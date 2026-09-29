const FORMATO_DATA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Data civil de hoje (YYYY-MM-DD) no horário de Brasília, independente do fuso do navegador.
 * `new Date().toISOString().slice(0, 10)` usa UTC: depois das 21h em SP já devolve o dia seguinte
 * e faz uma parcela que vence hoje aparecer como vencida. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return FORMATO_DATA_SP.format(agora);
}

/** Data civil (YYYY-MM-DD) em São Paulo de um valor vindo do banco.
 * Colunas `date` ("YYYY-MM-DD") já são data civil e voltam intactas. Colunas timestamptz chegam
 * em UTC ("2026-09-01T00:10:00+00:00" = 31/08 21:10 em SP): cortar os 10 primeiros caracteres
 * joga assinaturas depois das 21h para o dia (e às vezes o mês) seguinte. */
export function dataCivilSaoPaulo(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const instante = new Date(valor);
  if (Number.isNaN(instante.getTime())) return null;
  return FORMATO_DATA_SP.format(instante);
}
