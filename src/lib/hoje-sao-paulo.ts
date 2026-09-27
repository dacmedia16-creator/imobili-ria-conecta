/** Data civil de hoje (YYYY-MM-DD) no horário de Brasília, independente do fuso do navegador.
 * `new Date().toISOString().slice(0, 10)` usa UTC: depois das 21h em SP já devolve o dia seguinte
 * e faz uma parcela que vence hoje aparecer como vencida. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}
