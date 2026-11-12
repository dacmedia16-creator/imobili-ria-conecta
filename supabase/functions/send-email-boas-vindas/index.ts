// E-mail de boas-vindas do MAX HUB (t_30cf354f). Edge Function + nodemailer + SMTP Zoho
// (smtppro.zoho.com:465 SSL, conta paga). Credenciais SÓ nos secrets BOAS_VINDAS_ZOHO_USER /
// BOAS_VINDAS_ZOHO_PASSWORD; nunca no código nem em log (erros são mascarados).
//
// Quem chama:
//  * pg_cron (public.email_disparar) com cabeçalho x-email-internal = EMAIL_INTERNAL_SECRET
//      { "acao": "processar" }  -> processa a fila email_outbox (nada acontece com a chave 'off')
//  * Denis/operador, manualmente, com a chave service_role (Authorization: Bearer ...):
//      { "acao": "teste" }                          -> dados fictícios, para o 1º e-mail da allowlist
//      { "acao": "teste", "user_id": "<uuid>" }     -> usuário real cujo e-mail está na allowlist (1 vez só)
//      { "acao": "processar" }                      -> roda a fila agora (respeita a chave)
// O destinatário do teste NUNCA sai da allowlist (email_config.allowlist), mesmo com a chave 'off'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.8";
import {
  type Banco,
  chaveServidorOk,
  type Config,
  DOMINIO_MESSAGE_ID,
  mascararErro,
  type Mensagem,
  NOME_REMETENTE,
  processarFila,
  REMETENTE,
  segredoInternoOk,
  testeFicticio,
  testeUsuario,
} from "./core.ts";
import { enviarConvite } from "../_shared/email-convite/envio.ts";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const resp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

const SMTP_USER = Deno.env.get("BOAS_VINDAS_ZOHO_USER") ?? "";
const SMTP_PASS = Deno.env.get("BOAS_VINDAS_ZOHO_PASSWORD") ?? "";
const SEGREDOS = [SMTP_PASS];

async function smtp(m: Mensagem): Promise<string> {
  if (!SMTP_USER || !SMTP_PASS) throw new Error("smtp_nao_configurado");
  const t = nodemailer.createTransport({
    host: Deno.env.get("BOAS_VINDAS_ZOHO_HOST") || "smtppro.zoho.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  // Multipart/alternative: text + html.
  const info = await t.sendMail(m);
  return String(info.messageId ?? m.messageId);
}

// deno-lint-ignore no-explicit-any
function banco(admin: any): Banco {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  return {
    async config(): Promise<Config> {
      const { data, error } = await admin
        .from("email_config")
        .select("boas_vindas_mode, allowlist")
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return { modo: "off", allowlist: [] }; // falha fechada
      return { modo: data.boas_vindas_mode, allowlist: data.allowlist ?? [] };
    },
    pegar: (limite) => rpc("email_outbox_pegar", { p_limite: limite }),
    async dados(userId) {
      const d = await rpc("email_boas_vindas_dados", { p_user: userId });
      return (Array.isArray(d) ? d[0] : d) ?? null;
    },
    concluir: (id, resultado, erro, messageId) =>
      rpc("email_outbox_concluir", {
        p_id: id,
        p_resultado: resultado,
        p_erro: erro ?? null,
        p_message_id: messageId ?? null,
      }),
    testeReservar: (userId) => rpc("email_teste_reservar", { p_user: userId }),
    testeFicticioReservar: (destino) =>
      rpc("email_teste_ficticio_reservar", { p_destino: destino }),
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return resp({ error: "function_not_configured" }, 503);

  const doCron = segredoInternoOk(
    req.headers.get("x-email-internal"),
    Deno.env.get("EMAIL_INTERNAL_SECRET"),
  );
  // ADM_WORKER_SERVICE_KEY (t_fbd97175): a chave service_role LEGADA (JWT) que o Worker do ADM MAX usa
  // no botão "Enviar convite". O runtime agora injeta em SUPABASE_SERVICE_ROLE_KEY a chave secreta nova,
  // então sem isto o painel recebia 401. Continua exigindo chave de servidor; ausente = ignorada.
  let chaves: string[] = [service, Deno.env.get("ADM_WORKER_SERVICE_KEY") ?? ""];
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (raw) chaves = chaves.concat(Object.values(JSON.parse(raw)).map(String));
  } catch {
    /* ignora */
  }
  const manual = !doCron && chaveServidorOk(req.headers, chaves);
  if (!doCron && !manual) return resp({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  if (body?.modo === "teste" && !body.acao) body.acao = "teste"; // compatível com a versão anterior
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = banco(admin);
  try {
    if (body?.acao === "processar") return resp(await processarFila(db, smtp, SEGREDOS));
    // Convite de autocadastro (t_6e4dab96): chamado só pelo servidor do ADM (chave service_role)
    // logo depois de o super-admin criar/reenviar o convite. Destino = e-mail gravado no convite.
    if (body?.acao === "convite" && manual) {
      return resp(
        await enviarConvite(
          {
            async dados(id) {
              const { data, error } = await admin.rpc("org_invite_email_data", { _id: id });
              if (error) throw new Error("org_invite_email_data falhou");
              return (Array.isArray(data) ? data[0] : data) ?? null;
            },
            async marcar(id, ok, erro) {
              await admin.rpc("org_invite_mark_sent", { _id: id, _ok: ok, _erro: erro ?? null });
            },
          },
          smtp,
          { inviteId: body.invite_id, token: body.token, appUrl: body.app_url },
          { from: `"${NOME_REMETENTE}" <${REMETENTE}>`, dominio: DOMINIO_MESSAGE_ID },
          (e) => mascararErro(e, SEGREDOS),
        ),
      );
    }
    if (body?.acao === "teste" && manual) {
      if (typeof body.user_id === "string")
        return resp(await testeUsuario(db, smtp, body.user_id, SEGREDOS));
      return resp(
        await testeFicticio(
          db,
          smtp,
          body.destino,
          { nome: body.nome, imobiliaria: body.imobiliaria },
          SEGREDOS,
        ),
      );
    }
    return resp({ error: "invalid_body" }, 400);
  } catch (e) {
    console.error("[send-email-boas-vindas]", (e as Error).message?.slice(0, 200));
    return resp({ error: "falha_interna" }, 500);
  }
});
