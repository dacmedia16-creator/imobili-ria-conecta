/**
 * Cálculo de período pra "Movimentação do período" (Etapa 2B) — puro, sem depender do fuso do
 * navegador. Nenhuma biblioteca nova: usa só `Intl.DateTimeFormat` (nativo) pra descobrir o offset
 * de America/Sao_Paulo em qualquer instante, sem fixar "-03:00" (o Brasil não tem horário de verão
 * desde 2019, mas fixar o offset seria uma suposição desnecessária que o Intl já resolve sozinho).
 */

export type PeriodoTipo = "mes_atual" | "mes_anterior" | "ano_atual" | "personalizado";

export type PeriodoSearch = {
  periodo: PeriodoTipo;
  de: string | null; // yyyy-MM-dd, só relevante quando periodo === "personalizado"
  ate: string | null;
};

export type PeriodoResolvido =
  | {
      incompleto: false;
      inicioUtc: string; // ISO, limite inicial inclusivo
      fimExclusivoUtc: string; // ISO, limite final EXCLUSIVO (evita duplicidade na virada)
      label: string; // "Agosto/2026", "2026", "01/08/2026 – 15/08/2026"
    }
  | {
      incompleto: true;
      inicioUtc: null;
      fimExclusivoUtc: null;
      label: string; // mensagem explicando o motivo (faltando data, ou intervalo invertido)
    };

const PERIODO_TIPOS: readonly PeriodoTipo[] = [
  "mes_atual",
  "mes_anterior",
  "ano_atual",
  "personalizado",
];

const MESES_LABEL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/**
 * Validação estrita de calendário — `new Date("2026-02-31")` NÃO retorna Invalid Date, o motor JS
 * normaliza silenciosamente pra 2026-03-03. Por isso a checagem é por round-trip: monta a data a
 * partir dos números informados e confere se ano/mês/dia voltam exatamente iguais; qualquer
 * overflow (dia 31 de fevereiro, mês 13, dia 0, 29/fev fora de ano bissexto...) não bate e é
 * rejeitado. Não precisa de tabela de dias-por-mês nem de regra de bissexto escrita à mão — o
 * calendário gregoriano do próprio `Date.UTC` já resolve isso corretamente.
 */
export function ehDataIsoValida(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [ano, mes, dia] = v.split("-").map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

/**
 * Sanitiza search params arbitrários (da URL, portanto não confiáveis) num PeriodoSearch válido.
 * `periodo` desconhecido/ausente cai em "mes_atual"; `de`/`ate` só sobrevivem quando o período é
 * "personalizado" e o valor é uma data yyyy-MM-dd bem formada.
 */
export function validarPeriodoSearch(raw: Record<string, unknown>): PeriodoSearch {
  const periodo = PERIODO_TIPOS.includes(raw?.periodo as PeriodoTipo)
    ? (raw.periodo as PeriodoTipo)
    : "mes_atual";
  if (periodo !== "personalizado") return { periodo, de: null, ate: null };
  return {
    periodo,
    de: ehDataIsoValida(raw?.de) ? (raw.de as string) : null,
    ate: ehDataIsoValida(raw?.ate) ? (raw.ate as string) : null,
  };
}

type PartesData = {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
};

function partesEmFuso(instante: Date, fuso: string): PartesData {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const parte of dtf.formatToParts(instante)) p[parte.type] = parte.value;
  return {
    ano: Number(p.year),
    mes: Number(p.month) - 1,
    dia: Number(p.day),
    // Alguns motores retornam "24" às 00:00 com hour12:false em vez de "00" — normaliza.
    hora: Number(p.hour) === 24 ? 0 : Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

/** Offset de America/Sao_Paulo em relação ao UTC, em minutos, no instante dado (negativo = atrás do UTC). */
export function offsetSaoPauloMinutos(instante: Date): number {
  const partes = partesEmFuso(instante, "America/Sao_Paulo");
  const comoUtc = Date.UTC(
    partes.ano,
    partes.mes,
    partes.dia,
    partes.hora,
    partes.minuto,
    partes.segundo,
  );
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/**
 * Instante UTC correspondente à meia-noite de America/Sao_Paulo na data informada. `mesIndex0`
 * fora de 0-11 (ex.: -1 ou 12) é normalizado automaticamente pelo `Date.UTC` — é assim que
 * "mês anterior a janeiro" vira dezembro do ano anterior sem lógica extra de virada de ano.
 */
export function dataUtcDeSaoPaulo(ano: number, mesIndex0: number, dia: number): Date {
  // Meio-dia UTC só pra achar o offset do dia certo (evita cair do lado errado da meia-noite ao
  // consultar o offset — irrelevante hoje sem DST, mas não custa ser robusto a isso).
  const aproxUtc = new Date(Date.UTC(ano, mesIndex0, dia, 12, 0, 0));
  const offsetMin = offsetSaoPauloMinutos(aproxUtc);
  return new Date(Date.UTC(ano, mesIndex0, dia, 0, 0, 0) - offsetMin * 60000);
}

function periodoDeMes(ano: number, mesIndex0: number): PeriodoResolvido {
  const inicio = dataUtcDeSaoPaulo(ano, mesIndex0, 1);
  const fimExclusivo = dataUtcDeSaoPaulo(ano, mesIndex0 + 1, 1);
  // Rótulo usa o ano/mês NORMALIZADOS (de "inicio"), não os brutos passados — importante pro
  // "mês anterior a janeiro/2026" render "Dezembro/2025", não "Dezembro/2026".
  const partesInicio = partesEmFuso(inicio, "America/Sao_Paulo");
  return {
    incompleto: false,
    inicioUtc: inicio.toISOString(),
    fimExclusivoUtc: fimExclusivo.toISOString(),
    label: `${MESES_LABEL[partesInicio.mes]}/${partesInicio.ano}`,
  };
}

function formatarDataBr(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Resolve um PeriodoSearch (já validado) num intervalo UTC concreto + rótulo. `agora` é injetável
 * pra testes (mês atual/ano atual dependem de "hoje"); em produção o chamador passa `new Date()`.
 */
export function resolverPeriodo(search: PeriodoSearch, agora: Date): PeriodoResolvido {
  const partesAgora = partesEmFuso(agora, "America/Sao_Paulo");

  if (search.periodo === "mes_atual") return periodoDeMes(partesAgora.ano, partesAgora.mes);
  if (search.periodo === "mes_anterior") return periodoDeMes(partesAgora.ano, partesAgora.mes - 1);
  if (search.periodo === "ano_atual") {
    const inicio = dataUtcDeSaoPaulo(partesAgora.ano, 0, 1);
    const fimExclusivo = dataUtcDeSaoPaulo(partesAgora.ano + 1, 0, 1);
    return {
      incompleto: false,
      inicioUtc: inicio.toISOString(),
      fimExclusivoUtc: fimExclusivo.toISOString(),
      label: String(partesAgora.ano),
    };
  }

  // personalizado
  if (!search.de || !search.ate) {
    return {
      incompleto: true,
      inicioUtc: null,
      fimExclusivoUtc: null,
      label: "Selecione as duas datas do período",
    };
  }
  // Defesa em profundidade: resolverPeriodo é uma função pública, chamável direto (não só via
  // validarPeriodoSearch/URL) — sem essa checagem, uma data impossível vinda de outro caminho
  // normalizaria silenciosamente via dataUtcDeSaoPaulo (que usa Date.UTC, sem validar overflow).
  if (!ehDataIsoValida(search.de) || !ehDataIsoValida(search.ate)) {
    return {
      incompleto: true,
      inicioUtc: null,
      fimExclusivoUtc: null,
      label: "Data inválida",
    };
  }
  const [anoDe, mesDe, diaDe] = search.de.split("-").map(Number);
  const [anoAte, mesAte, diaAte] = search.ate.split("-").map(Number);
  const inicio = dataUtcDeSaoPaulo(anoDe, mesDe - 1, diaDe);
  // "ate" é inclusivo pro usuário -> limite técnico exclusivo é a meia-noite do dia SEGUINTE.
  // dataUtcDeSaoPaulo(ano, mes, dia+1) já normaliza a virada de mês/ano sozinho via Date.UTC.
  const fimExclusivo = dataUtcDeSaoPaulo(anoAte, mesAte - 1, diaAte + 1);
  if (fimExclusivo.getTime() <= inicio.getTime()) {
    return {
      incompleto: true,
      inicioUtc: null,
      fimExclusivoUtc: null,
      label: "Data final não pode ser antes da inicial",
    };
  }
  return {
    incompleto: false,
    inicioUtc: inicio.toISOString(),
    fimExclusivoUtc: fimExclusivo.toISOString(),
    label: `${formatarDataBr(search.de)} – ${formatarDataBr(search.ate)}`,
  };
}

export const PERIODO_LABEL: Record<PeriodoTipo, string> = {
  mes_atual: "Mês atual",
  mes_anterior: "Mês anterior",
  ano_atual: "Este ano",
  personalizado: "Personalizado",
};
