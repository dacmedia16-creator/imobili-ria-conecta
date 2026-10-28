// Conjunto de referência com o MODELO REAL (t_a9f1b447). Só teste: não grava no banco, não envia mensagem.
// Uso: npx tsx scripts/leads-ia-test/referencia-modelo.ts <saida.md> [modelo] [arquivo .env com OPENROUTER_API_KEY]
// Teto de gasto: US$ 1 (para antes de passar). A chave é lida do arquivo e nunca impressa.
import { readFileSync, writeFileSync } from "node:fs";
import { proximaResposta, type ContextoIa } from "../../src/lib/leads-ia";
import type { UsoModelo } from "../../src/lib/leads-ia-modelo";
import { redigirResposta, exigeTextoFixo, type FalaHistorico, type ModoValidador } from "../../src/lib/leads-ia-redacao";
import { buscasReferencia, ctxReferencia, REFERENCIA } from "../../src/lib/leads-ia-referencia.dados";

const SAIDA = process.argv[2] ?? "referencia-modelo.md";
const MODELO = process.argv[3] ?? "google/gemini-3.8-flash";
const ENVF = process.argv[4] ?? "/root/.hermes/profiles/max/.env";
const MODO = (process.env.REF_MODO as ModoValidador) || "bloquear";
// t_f7155e0c: REF_CONV=B roda só essa conversa; REF_TETO=0.2 baixa o teto.
const TETO = Number(process.env.REF_TETO) || 1;
const SO_CONV = process.env.REF_CONV ?? "";
const PAUSA = Number(process.env.REF_PAUSA) || 0;
const AGORA = new Date("2026-10-27T13:00:00Z");
const env: Record<string, string> = {};
for (const l of readFileSync(ENVF, "utf8").split("\n")) {
  const m = /^OPENROUTER_API_KEY=(.*)$/.exec(l.trim());
  if (m) env.OPENROUTER_API_KEY = m[1].replace(/^["']|["']$/g, "");
}
if (!env.OPENROUTER_API_KEY) throw new Error("sem chave");

type Linha = { conv: string; cliente: string; esperado: string; antes: string | null; depois: string; origem: string; t1: string | null; t2: string | null; custo: number; ms: number; brutos: string[] };

async function main() {
  const linhas: Linha[] = [];
  let total = 0;
  let chamadas1 = 0;
  let bloq1 = 0;
  let bloqFinal = 0;
  for (const conv of REFERENCIA.filter((x) => !SO_CONV || x.id === SO_CONV)) {
    const b = buscasReferencia(conv);
    let c: ContextoIa = ctxReferencia(conv);
    const hist: FalaHistorico[] = [{ autor: "ia", texto: conv.primeira }];
    let juntas: string[] = [];
    for (const f of conv.falas) {
      if (total >= TETO) break;
      // t_37cf21e3: mensagens que chegaram juntas (ao vivo, 1 resposta só) entram em falasAntes da próxima.
      if (f.junto) {
        juntas.push(f.cliente);
        hist.push({ autor: "cliente", texto: f.cliente });
        continue;
      }
      const falasAntes = juntas;
      juntas = [];
      const usos: UsoModelo[] = [];
      // t_91c8cf89: guarda o texto cru de cada tentativa (para ver o que a trava barrou).
      const brutos: string[] = [];
      const fetchFn: typeof fetch = async (u, i) => {
        let res = await fetch(u, i);
        // Só no teste: 429 do OpenRouter é limite do provedor, não da trava; tenta de novo até 3x.
        for (let k = 0; k < 3 && res.status === 429; k++) {
          await new Promise((ok) => setTimeout(ok, 8000));
          res = await fetch(u, { ...i, signal: AbortSignal.timeout(20000) });
        }
        const j = (await res.clone().json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
        brutos.push(j?.choices?.[0]?.message?.content ?? "");
        return res;
      };
      // t_6667db44: REF_PAUSA (ms) espera antes de cada fala (fora do tempo-limite da chamada), para não tomar 429.
      if (PAUSA) await new Promise((ok) => setTimeout(ok, PAUSA));
      const base = await proximaResposta(c, f.cliente, undefined, { agora: AGORA, ...b, falasAntes });
      const t0 = Date.now();
      const r = await redigirResposta(c, f.cliente, base, {
        escolha: { provedor: "openrouter", modelo: MODELO },
        fetchFn,
        env,
        historico: [...hist],
        buscarParecidos: b.buscarParecidos,
        // t_228659f0: busca por nome de condomínio (simula a RPC lead_ia_imoveis_nome, ainda não aplicada).
        buscarNome: b.buscarNome,
        registrar: (u) => usos.push(u),
        agora: AGORA,
        modo: MODO,
      });
      const ms = Date.now() - t0;
      const custo = usos.reduce((s, u) => s + (u.custo_usd ?? 0), 0);
      total += custo;
      const red = usos.filter((u) => u.uso === "redigir");
      const u1 = red.find((u) => u.tentativa === 1);
      const u2 = red.find((u) => u.tentativa === 2);
      if (u1?.ok) {
        chamadas1++;
        if (u1.bloqueado) bloq1++;
      }
      const fixo = !red.length && exigeTextoFixo(c, f.cliente, base);
      const final = red.length && !r.redigida;
      if (final && red.some((u) => u.bloqueado)) bloqFinal++;
      const origem = fixo
        ? "texto fixo (regra antes do modelo)"
        : !red.length
          ? "plano B (modelo não chamado)"
          : r.redigida
            ? u2 ? "MODELO (2ª tentativa)" : "MODELO"
            : `FRASE PRONTA (${r.bloqueio ?? u1?.erro ?? "?"})`;
      const tr = (u?: UsoModelo) => (u ? (u.bloqueado ? `${u.bloqueio}: ${u.bloqueio_trecho ?? ""}` : u.ok ? "ok" : `erro ${u.erro}`) : null);
      linhas.push({ conv: `${conv.id} (lead ${conv.lead})`, cliente: falasAntes.length ? `${falasAntes.join(" / ")} / ${f.cliente}` : f.cliente, esperado: f.esperado, antes: f.antes, depois: r.resposta, origem, t1: tr(u1), t2: tr(u2), custo, ms, brutos });
      hist.push({ autor: "cliente", texto: f.cliente }, { autor: "ia", texto: r.resposta });
      // t_37cf21e3: na F (d8907e38) Denis seguiu conversando depois; segue para refazer todas as falas.
      if (r.fim && !["F", "H", "I", "J"].includes(conv.id)) break;
      c = { ...c, passo: r.passo, dados: r.dados, versao: c.versao + 1 };
    }
  }
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "-");
  const out: string[] = [
    `# Conjunto de referência com o modelo real (t_a9f1b447)`,
    ``,
    `Modelo: ${MODELO} via OpenRouter. Modo do validador: ${MODO}. Data simulada: 27/10/2026 10h. Gasto: US$ ${total.toFixed(4)} (teto US$ ${TETO}).`,
    ``,
    `- Respostas do modelo (1ª tentativa) barradas pela trava: **${bloq1} de ${chamadas1} = ${pct(bloq1, chamadas1)}** (meta: menos de 10%).`,
    `- Viraram frase pronta mesmo depois da 2ª tentativa: **${bloqFinal} de ${linhas.length} falas**.`,
    ``,
  ];
  let atual = "";
  for (const l of linhas) {
    if (l.conv !== atual) {
      atual = l.conv;
      out.push(`## Conversa ${atual}`, ``);
    }
    out.push(
      `**Cliente:** ${l.cliente}`,
      `- ANTES (ao vivo): ${l.antes ?? (l.cliente.startsWith("quero visitar") || l.cliente.startsWith("sabado") ? "_(fala do teste offline; não houve ao vivo)_" : "_(ficou sem resposta)_")}`,
      `- DEPOIS: ${l.depois}`,
      `- Como a equipe responderia: _${l.esperado}_`,
      `- _${l.origem} · trava 1ª: ${l.t1 ?? "-"}${l.t2 ? ` · 2ª: ${l.t2}` : ""} · ${l.ms} ms · US$ ${l.custo.toFixed(5)}_`,
      ``,
    );
  }
  writeFileSync(SAIDA, out.join("\n"));
  writeFileSync(SAIDA.replace(/\.md$/, ".json"), JSON.stringify({ modelo: MODELO, modo: MODO, total, chamadas1, bloq1, bloqFinal, linhas }, null, 1));
  console.log(out.slice(0, 7).join("\n"));
}
main();
