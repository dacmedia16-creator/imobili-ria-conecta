// Ingestão do mural de Oportunidades (roda na VPS, Node 24+: `node scripts/oportunidades-ingest.ts`).
//
// Lê o banco do leitor do WhatsApp SÓ PARA LEITURA, pega as mensagens do grupo dos últimos 8 dias,
// limpa (sem telefone, e-mail, link, senha ou menção), classifica e envia para a RPC
// public.opportunity_ingest (service_role). A RPC não grava nada se o módulo estiver desligado.
//
// Padrão = simulação: só mostra contagens. Para gravar: `--apply` + variáveis de ambiente
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPORTUNIDADES_ORG_ID
// Opcionais: OPORTUNIDADES_LEITOR (pasta do leitor), OPORTUNIDADES_GRUPO (trecho do nome do grupo).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  classifyPost,
  isNoise,
  sanitizeName,
  sanitizeText,
  sourceKeyInput,
} from "../src/lib/oportunidades.ts";

const LEITOR = process.env.OPORTUNIDADES_LEITOR || "/root/.hermes/profiles/max/whatsapp-reader";
const GRUPO = process.env.OPORTUNIDADES_GRUPO || "Única Escolha";
const DIAS = 8;
const LOTE = 500;
const apply = process.argv.includes("--apply");

type Row = { sender: string | null; sender_phone?: string | null; ts: number; text: string };
type Allow = { name: string; jid: string };

const cfg = JSON.parse(readFileSync(`${LEITOR}/config.json`, "utf8")) as { allowlist?: Allow[] };
const alvo = (cfg.allowlist ?? []).filter(
  (g) => g.jid.endsWith("@g.us") && g.name.toLowerCase().includes(GRUPO.toLowerCase()),
);
if (alvo.length !== 1) {
  console.error(
    `Grupo não encontrado ou ambíguo no leitor (${alvo.length} resultados para "${GRUPO}").`,
  );
  process.exit(1);
}

const db = new DatabaseSync(`${LEITOR}/data/messages.db`, { readOnly: true });
const desde = Math.floor(Date.now() / 1000) - DIAS * 86_400;
// Telefone do remetente (t_6dd4a31b): só se o leitor gravar a coluna sender_phone. Ele vai para a
// RPC apenas para ligar o post ao cadastro (author_profile_id) e NUNCA é gravado no post.
// Sem a coluna, os posts ficam sem autor e o selo 🤝 aparece só para gestor/administrador/staff.
const temTelefone = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).some(
  (c) => c.name === "sender_phone",
);
// Só o grupo (@g.us) e só mensagens dos outros (from_me = 0): conversas privadas nunca entram.
const rows = db
  .prepare(
    `SELECT sender, ${temTelefone ? "sender_phone" : "NULL AS sender_phone"}, ts, text FROM messages WHERE chat_id = ? AND from_me = 0 AND ts >= ? ORDER BY ts`,
  )
  .all(alvo[0].jid, desde) as unknown as Row[];
db.close();

const porChave = new Map<string, Record<string, unknown>>();
for (const r of rows) {
  if (isNoise(r.text)) continue;
  const texto = sanitizeText(r.text);
  if (isNoise(texto)) continue;
  const corretor = sanitizeName(r.sender ?? "");
  const source_key = createHash("sha256").update(sourceKeyInput(corretor, texto)).digest("hex");
  // Repostagem do mesmo anúncio: fica a mais recente (a RPC também só atualiza a data).
  porChave.set(source_key, {
    source_key,
    ...classifyPost(texto),
    corretor,
    texto: texto.slice(0, 4000),
    posted_at: new Date(r.ts * 1000).toISOString(),
    autor_telefone: r.sender_phone?.replace(/\D/g, "") || null,
  });
}
const posts = [...porChave.values()];
const conta = (k: string) => posts.filter((p) => p.kind === k).length;
console.log(
  `Mensagens lidas: ${rows.length} | cartões: ${posts.length} (procura ${conta("procura")}, oferta ${conta("oferta")}, outros ${conta("outros")}) | com telefone do autor: ${posts.filter((p) => p.autor_telefone).length}`,
);

if (!apply) {
  console.log("Simulação: nada foi enviado. Use --apply para gravar.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const org = process.env.OPORTUNIDADES_ORG_ID;
if (!url || !key || !org) {
  console.error("Faltam SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou OPORTUNIDADES_ORG_ID.");
  process.exit(1);
}

let gravados = 0;
for (let i = 0; i < posts.length; i += LOTE) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/opportunity_ingest`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ _org: org, _posts: posts.slice(i, i + LOTE) }),
  });
  if (!res.ok) {
    console.error(`Falha na gravação (HTTP ${res.status}).`);
    process.exit(1);
  }
  gravados += Number(await res.json()) || 0;
}
console.log(
  `Gravados/atualizados: ${gravados}${gravados === 0 && posts.length ? " (módulo desligado?)" : ""}`,
);
