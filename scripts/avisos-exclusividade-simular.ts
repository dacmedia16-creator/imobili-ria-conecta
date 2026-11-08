// Contagem SÓ LEITURA dos avisos que a rotina diária mandaria hoje (cartão t_c337fc12).
// Uso: npx tsx scripts/avisos-exclusividade-simular.ts <dados.json> [AAAA-MM-DD]
// O JSON vem de uma consulta read-only (sem telefone real: só um marcador de "tem telefone").
// Usa a MESMA função da rotina (planejarEnvios). Não grava nem envia nada.
import { readFileSync } from "node:fs";
import { planejarEnvios, type DadosOrg } from "../src/lib/avisos-exclusividade.server";
import { TIPO_AVISO_LABEL, type TipoAviso } from "../src/lib/avisos-exclusividade";

const [arq, data] = process.argv.slice(2);
const bruto = JSON.parse(readFileSync(arq, "utf8"));
const d = (Array.isArray(bruto) ? bruto[0].dados : bruto) as Record<string, unknown[]> & { orgId: string };
const hoje = data ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const dados: DadosOrg = {
  orgId: d.orgId,
  capturas: d.capturas as DadosOrg["capturas"],
  vendidas: new Set(d.vendidas as string[]),
  reunioes: new Map(), // tabela nova ainda não existe em produção: nenhuma reunião registrada
  codigos: new Map(
    (d.codigos as { capture_id: string; listing_code: string }[]).map((c) => [c.capture_id, c.listing_code]),
  ),
  pessoas: new Map((d.pessoas as { id: string }[]).map((p) => [p.id, p as never])),
  preferencias: new Map(),
  inscricoes: [],
  lideranca: {
    teams: d.teams as never,
    membros: d.membros as never,
    coLideres: d.coLideres as never,
    lideresComPapel: d.lideresComPapel as string[],
  },
  jaEnviados: new Set(),
};

const envios = planejarEnvios(dados, hoje);
const porTipo = new Map<TipoAviso, number>();
for (const e of envios) porTipo.set(e.tipo, (porTipo.get(e.tipo) ?? 0) + 1);
const pessoas = new Set(envios.map((e) => e.recipientId));
const comWhats = envios.filter((e) => e.telefone).length;
console.log(`Data simulada: ${hoje}`);
console.log(`Captações aprovadas/assinadas ativas lidas: ${dados.capturas.length}; vendidas: ${dados.vendidas.size}`);
for (const t of Object.keys(TIPO_AVISO_LABEL) as TipoAviso[])
  console.log(`  ${TIPO_AVISO_LABEL[t]}: ${porTipo.get(t) ?? 0}`);
console.log(`Total de avisos: ${envios.length} para ${pessoas.size} pessoas`);
console.log(`Sino: ${envios.length} | WhatsApp (tem telefone): ${comWhats} | Push: 0 (ninguém inscrito ainda)`);
