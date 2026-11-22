// Resumo diário de erros do ADM MAX (t_59e94d27). Funções puras: montam o texto a partir das contagens.
// Regra principal: se não houve erro, NÃO há mensagem (retorna null) — sem relatório vazio.
// Sem dependências e com import relativo: roda no Node puro (scripts/resumo-erros-diario.ts).
import { mascarar } from "./log-seguro.ts";

export type LinhaWorker = { status: string; httpStatus: number; pedidos: number; erros: number };
export type LinhaFuncao = { funcao: string; status: number; chamadas: number };
export type LinhaApi = { servico: string; status: number; pedidos: number };
export type LinhaLogErro = { funcao: string; quantidade: number };

export type DadosResumo = {
  /** Data do dia resumido, AAAA-MM-DD (Brasília). */
  dia: string;
  worker: LinhaWorker[];
  funcoes: LinhaFuncao[];
  api: LinhaApi[];
  /** Linhas de log com nível "error" dentro das Edge Functions (mesmo quando responderam 200). */
  logsErroFuncoes: LinhaLogErro[];
  /** Fontes que não puderam ser lidas (o resumo avisa, para ninguém achar que está tudo bem). */
  falhasDeLeitura: string[];
};

// Status do Worker que contam como erro, além de HTTP 5xx.
const STATUS_ERRO_WORKER = new Set([
  "scriptThrewException",
  "exceededResources",
  "exceededCpu",
  "exceededMemory",
  "internalError",
]);

function soma<T>(lista: T[], f: (x: T) => number): number {
  return lista.reduce((t, x) => t + f(x), 0);
}

function agrupar<T>(lista: T[], chave: (x: T) => string, valor: (x: T) => number) {
  const m = new Map<string, number>();
  for (const x of lista) m.set(chave(x), (m.get(chave(x)) ?? 0) + valor(x));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function errosDoWorker(linhas: LinhaWorker[]) {
  const http5xx = linhas.filter((l) => l.httpStatus >= 500);
  const excecoes = linhas.filter((l) => STATUS_ERRO_WORKER.has(l.status) && l.httpStatus < 500);
  return {
    http5xx: soma(http5xx, (l) => l.pedidos),
    porStatus: agrupar(
      http5xx,
      (l) => String(l.httpStatus),
      (l) => l.pedidos,
    ),
    excecoes: soma(excecoes, (l) => l.pedidos),
    porTipo: agrupar(
      excecoes,
      (l) => l.status,
      (l) => l.pedidos,
    ),
    total: soma(linhas, (l) => l.pedidos),
  };
}

/** Texto do aviso, ou null quando não houve nenhum erro e todas as fontes foram lidas. */
export function montarResumo(d: DadosResumo): string | null {
  const w = errosDoWorker(d.worker);
  const funcoes5xx = d.funcoes.filter((f) => f.status >= 500);
  const api5xx = d.api.filter((a) => a.status >= 500);
  const logs = d.logsErroFuncoes.filter((l) => l.quantidade > 0);
  const nFuncoes = soma(funcoes5xx, (f) => f.chamadas);
  const nApi = soma(api5xx, (a) => a.pedidos);
  const nLogs = soma(logs, (l) => l.quantidade);
  const temErro = w.http5xx + w.excecoes + nFuncoes + nApi + nLogs > 0;
  if (!temErro && d.falhasDeLeitura.length === 0) return null;

  const [a, m, dd] = d.dia.split("-");
  const linhas: string[] = [`⚠️ ADM MAX — erros de ${dd}/${m}/${a} (Brasília)`];

  if (w.http5xx + w.excecoes > 0) {
    const pct = w.total ? ` de ${w.total} pedidos` : "";
    linhas.push(`\nSite (Worker): ${w.http5xx + w.excecoes} com erro${pct}`);
    for (const [st, n] of w.porStatus) linhas.push(`• HTTP ${st}: ${n}`);
    for (const [tipo, n] of w.porTipo) linhas.push(`• ${tipo}: ${n}`);
  }
  if (nFuncoes > 0) {
    linhas.push(`\nEdge Functions com falha (5xx): ${nFuncoes}`);
    for (const [fn, n] of agrupar(
      funcoes5xx,
      (f) => `${mascarar(f.funcao)} (${f.status})`,
      (f) => f.chamadas,
    ).slice(0, 10))
      linhas.push(`• ${fn}: ${n}`);
  }
  if (nLogs > 0) {
    linhas.push(`\nEdge Functions que registraram erro no log: ${nLogs}`);
    for (const l of [...logs].sort((x, y) => y.quantidade - x.quantidade).slice(0, 10))
      linhas.push(`• ${mascarar(l.funcao)}: ${l.quantidade}`);
  }
  if (nApi > 0) {
    linhas.push(`\nAPI do banco (Supabase) com 5xx: ${nApi}`);
    for (const [s, n] of agrupar(
      api5xx,
      (x) => `${x.servico} ${x.status}`,
      (x) => x.pedidos,
    ).slice(0, 10))
      linhas.push(`• ${s}: ${n}`);
  }
  if (d.falhasDeLeitura.length) {
    linhas.push(`\nNão consegui ler: ${d.falhasDeLeitura.map((f) => mascarar(f)).join("; ")}`);
  }
  linhas.push(
    "\nDetalhes: painel da Cloudflare (Workers Logs do imobili-ria-conecta) e Logs do Supabase.",
  );
  return linhas.join("\n");
}

/** Janela do dia anterior em Brasília (UTC-3, sem horário de verão), em ISO UTC. */
export function janelaDoDiaAnterior(agora: Date): { dia: string; inicio: string; fim: string } {
  const brasilia = new Date(agora.getTime() - 3 * 3600_000);
  const hojeUtc = Date.UTC(
    brasilia.getUTCFullYear(),
    brasilia.getUTCMonth(),
    brasilia.getUTCDate(),
  );
  const inicio = new Date(hojeUtc - 24 * 3600_000 + 3 * 3600_000);
  const fim = new Date(hojeUtc + 3 * 3600_000);
  const dia = new Date(hojeUtc - 24 * 3600_000).toISOString().slice(0, 10);
  const iso = (x: Date) => x.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { dia, inicio: iso(inicio), fim: iso(fim) };
}
