// Resumo diário de erros do ADM MAX (t_59e94d27). Roda na VPS 1x por dia (fora do Worker).
// Só LEITURA: Analytics da Cloudflare (5xx/exceções do Worker) + Logs do Supabase (Edge Functions e API).
// Só manda Telegram quando houve erro (ou quando uma fonte não pôde ser lida). Dia sem erro = silêncio.
//
// Uso: node scripts/resumo-erros-diario.ts [--enviar] [--dia AAAA-MM-DD]
//   sem --enviar: só imprime o texto (ou "sem erros") e não manda nada.
// Variáveis (fora do repositório, sem segredo aqui):
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_THREAD_ID (só com --enviar)
import {
  janelaDoDiaAnterior,
  montarResumo,
  type DadosResumo,
  type LinhaApi,
  type LinhaFuncao,
  type LinhaLogErro,
  type LinhaWorker,
} from "../src/lib/resumo-erros.ts";

const WORKER = "imobili-ria-conecta";
const args = process.argv.slice(2);
const enviar = args.includes("--enviar");
const iDia = args.indexOf("--dia");

function env(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`falta a variável ${nome}`);
  return v;
}

function janela() {
  if (iDia >= 0) {
    const d = args[iDia + 1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d ?? "")) throw new Error("--dia precisa de AAAA-MM-DD");
    const amanha = new Date(Date.parse(`${d}T12:00:00Z`) + 24 * 3600_000);
    return janelaDoDiaAnterior(
      new Date(Date.UTC(amanha.getUTCFullYear(), amanha.getUTCMonth(), amanha.getUTCDate(), 12)),
    );
  }
  return janelaDoDiaAnterior(new Date());
}

async function lerWorker(inicio: string, fim: string): Promise<LinhaWorker[]> {
  const query = `query($a:string!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
    workersInvocationsAdaptive(limit:200,filter:{scriptName:"${WORKER}",datetime_geq:$s,datetime_lt:$e}){
      sum{requests errors} dimensions{status httpResponseStatus}}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { a: env("CLOUDFLARE_ACCOUNT_ID"), s: inicio, e: fim },
    }),
  });
  if (!r.ok) throw new Error(`Cloudflare HTTP ${r.status}`);
  const j = (await r.json()) as {
    errors?: unknown[] | null;
    data?: { viewer: { accounts: { workersInvocationsAdaptive: unknown[] }[] } };
  };
  if (j.errors?.length) throw new Error("Cloudflare GraphQL recusou a consulta");
  const linhas = (j.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? []) as {
    sum: { requests: number; errors: number };
    dimensions: { status: string; httpResponseStatus: number };
  }[];
  return linhas.map((l) => ({
    status: l.dimensions.status,
    httpStatus: l.dimensions.httpResponseStatus,
    pedidos: l.sum.requests,
    erros: l.sum.errors,
  }));
}

async function sqlLogs<T>(sql: string, inicio: string, fim: string): Promise<T[]> {
  const ref = env("SUPABASE_PROJECT_REF");
  const qs = new URLSearchParams({ sql, iso_timestamp_start: inicio, iso_timestamp_end: fim });
  let r: Response | undefined;
  // A API de logs tem limite de consultas por minuto (429): espera e tenta de novo, até 3 vezes.
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    if (tentativa) await new Promise((ok) => setTimeout(ok, 20_000 * tentativa));
    r = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs?${qs}`, {
      headers: { Authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}` },
    });
    if (r.status !== 429) break;
  }
  if (!r) throw new Error("Supabase Logs sem resposta");
  if (!r.ok) throw new Error(`Supabase Logs HTTP ${r.status}`);
  const j = (await r.json()) as { result?: T[]; error?: unknown };
  if (j.error) throw new Error("Supabase Logs recusou a consulta");
  return j.result ?? [];
}

async function nomesDasFuncoes(): Promise<Map<string, string>> {
  const ref = env("SUPABASE_PROJECT_REF");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${env("SUPABASE_ACCESS_TOKEN")}` },
  });
  if (!r.ok) return new Map();
  const lista = (await r.json()) as { id: string; slug: string }[];
  return new Map(lista.map((f) => [f.id, f.slug]));
}

async function coletar(): Promise<DadosResumo> {
  const { dia, inicio, fim } = janela();
  const falhas: string[] = [];
  const tentar = async <T>(nome: string, f: () => Promise<T>, vazio: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      falhas.push(`${nome} (${e instanceof Error ? e.message : "erro"})`);
      return vazio;
    }
  };

  const worker = await tentar("Analytics do Worker", () => lerWorker(inicio, fim), []);
  const nomes = await tentar("lista de Edge Functions", nomesDasFuncoes, new Map<string, string>());
  const nome = (id: string) => nomes.get(id) ?? id.slice(0, 8);

  const fnBruto = await tentar(
    "Logs das Edge Functions",
    () =>
      sqlLogs<{ f: string; s: string; n: number }>(
        "select log_attributes['function_id'] as f, log_attributes['response.status_code'] as s, count() as n " +
          "from logs where source = 'function_edge_logs' " +
          "and toInt32OrZero(log_attributes['response.status_code']) >= 500 group by f, s",
        inicio,
        fim,
      ),
    [],
  );
  const funcoes: LinhaFuncao[] = fnBruto.map((x) => ({
    funcao: nome(x.f),
    status: Number(x.s),
    chamadas: Number(x.n),
  }));

  const logBruto = await tentar(
    "Logs de erro das Edge Functions",
    () =>
      sqlLogs<{ f: string; n: number }>(
        "select log_attributes['function_id'] as f, count() as n from logs " +
          "where source = 'function_logs' and lower(log_attributes['level']) = 'error' group by f",
        inicio,
        fim,
      ),
    [],
  );
  const logsErroFuncoes: LinhaLogErro[] = logBruto.map((x) => ({
    funcao: nome(x.f),
    quantidade: Number(x.n),
  }));

  const apiBruto = await tentar(
    "Logs da API do Supabase",
    () =>
      sqlLogs<{ p: string; s: string; n: number }>(
        "select splitByChar('/', log_attributes['request.path'])[2] as p, " +
          "log_attributes['response.status_code'] as s, count() as n from logs " +
          "where source = 'edge_logs' and toInt32OrZero(log_attributes['response.status_code']) >= 500 " +
          "group by p, s",
        inicio,
        fim,
      ),
    [],
  );
  const api: LinhaApi[] = apiBruto.map((x) => ({
    servico: x.p || "outro",
    status: Number(x.s),
    pedidos: Number(x.n),
  }));

  return { dia, worker, funcoes, api, logsErroFuncoes, falhasDeLeitura: falhas };
}

async function mandarTelegram(texto: string) {
  const r = await fetch(`https://api.telegram.org/bot${env("TELEGRAM_BOT_TOKEN")}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env("TELEGRAM_CHAT_ID"),
      message_thread_id: Number(env("TELEGRAM_THREAD_ID")),
      text: texto,
      disable_web_page_preview: true,
    }),
  });
  if (!r.ok) throw new Error(`Telegram HTTP ${r.status}`);
}

const dados = await coletar();
const texto = montarResumo(dados);
const total = dados.worker.reduce((t, l) => t + l.pedidos, 0);
console.log(`dia ${dados.dia}: ${total} pedidos no Worker; ${texto ? "COM erro" : "sem erros"}`);
if (texto) {
  console.log(texto);
  if (enviar) {
    await mandarTelegram(texto);
    console.log("enviado ao Telegram");
  }
}
