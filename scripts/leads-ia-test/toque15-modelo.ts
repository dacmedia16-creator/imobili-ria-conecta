// Simulação do toque de 15 min com o MODELO REAL (t_b3f753a5). Só teste: não grava no banco, não envia mensagem.
// Uso: npx tsx scripts/leads-ia-test/toque15-modelo.ts <entrada.json> <saida.md> [modelo] [arquivo .env com OPENROUTER_API_KEY]
// entrada.json: [{ "id": "75957c60", "cliente": "Denis", "falas": [{"autor":"ia"|"cliente","texto":"..."}] }]
// O histórico é cortado na última fala da Nicole (o ponto em que o cliente "parou"). Teto: US$ 0,05.
import { readFileSync, writeFileSync } from "node:fs";
import { textoToque15, textoFixoToque15 } from "../../src/lib/leads-ia-toque15";
import type { UsoModelo } from "../../src/lib/leads-ia-modelo";
import type { FalaHistorico } from "../../src/lib/leads-ia-redacao";

const [ENTRADA, SAIDA] = [process.argv[2], process.argv[3] ?? "toque15-modelo.md"];
const MODELO = process.argv[4] ?? "deepseek/deepseek-v4-flash-0731";
const ENVF = process.argv[5] ?? "/root/.hermes/profiles/max/.env";
const env: Record<string, string> = {};
for (const l of readFileSync(ENVF, "utf8").split("\n")) {
  const m = /^OPENROUTER_API_KEY=(.*)$/.exec(l.trim());
  if (m) env.OPENROUTER_API_KEY = m[1].replace(/^["']|["']$/g, "");
}
if (!env.OPENROUTER_API_KEY) throw new Error("sem chave");
type Conv = { id: string; cliente: string; corte?: number; falas: FalaHistorico[] };

async function main() {
  const convs = JSON.parse(readFileSync(ENTRADA, "utf8")) as Conv[];
  let total = 0;
  const out: string[] = [`# Toque de 15 min — modelo real (${MODELO})`, ""];
  for (const c of convs) {
    if (total >= 0.05) break;
    let h = c.falas.slice(0, c.corte ?? c.falas.length);
    while (h.length && h[h.length - 1].autor !== "ia") h = h.slice(0, -1);
    const usos: UsoModelo[] = [];
    const t0 = Date.now();
    // Guarda o texto cru do modelo só para este relatório (para ver o que a trava barrou).
    let bruto = "";
    const fetchFn: typeof fetch = async (u, i) => {
      const res = await fetch(u, i);
      const j = (await res.clone().json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }> } | null;
      bruto = j?.choices?.[0]?.message?.content ?? "";
      return res;
    };
    const r = await textoToque15({
      ia_nome: "Nicole",
      org_nome: "ZZ Teste Provisionamento",
      cliente: c.cliente,
      historico: h.slice(-10),
      redige: true,
      escolha: { provedor: "openrouter", modelo: MODELO },
      env,
      registrar: (u) => usos.push(u),
      fetchFn,
    });
    const custo = usos.reduce((s, u) => s + (u.custo_usd ?? 0), 0);
    total += custo;
    out.push(`## Conversa ${c.id}`, "", `Última fala da Nicole: "${h[h.length - 1]?.texto ?? ""}"`, "",
      `- **Toque (${r.origem}${r.bloqueio ? `, trava: ${r.bloqueio}` : ""})**: ${r.texto}`,
      ...(r.origem === "fixo" && bruto ? [`- Texto do modelo barrado pela trava: ${bruto}`] : []),
      `- Frase fixa (plano B): ${textoFixoToque15(c.cliente, h[h.length - 1]?.texto ?? "", [...h].reverse().find((f) => f.autor === "cliente")?.texto ?? "")}`,
      `- custo US$ ${custo.toFixed(6)} · ${Date.now() - t0} ms · rota ${usos[0]?.rota ?? "-"}`, "");
  }
  out.push(`Total: US$ ${total.toFixed(6)}`);
  writeFileSync(SAIDA, out.join("\n"));
  console.log(out.join("\n"));
}
void main();
