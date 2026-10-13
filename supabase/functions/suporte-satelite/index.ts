import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CABECALHO, conferirPrint, receberPedido } from "./protocolo.mjs";

// Ponte servidor-servidor. Sem CORS: só o satélite chama, com HMAC.
// Secrets já existentes: ESTUDO_SYNC_SECRET e VISITA_SYNC_SECRET. Sem segredo novo.
// verify_jwt = false: a autenticação é a assinatura, não o JWT do usuário.
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const resp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function mensagemSegura(bruta: string): string {
  const m = bruta.replace(/^.*ERROR:\s*/i, "").split("\n")[0].trim();
  if (!m || m.length > 180 || /public\.|schema|syntax|permission|stack/i.test(m)) {
    return "Não foi possível concluir o chamado. Tente de novo.";
  }
  return m;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp({ error: "Método não permitido." }, 405);
  const corpo = await req.text();
  const agoraSeg = Math.floor(Date.now() / 1000);
  const recebido = await receberPedido({
    corpo,
    assinatura: req.headers.get(CABECALHO),
    agoraSeg,
    segredos: {
      estudo: Deno.env.get("ESTUDO_SYNC_SECRET"),
      visita: Deno.env.get("VISITA_SYNC_SECRET"),
    },
  });
  if (recebido.status !== 200) return resp(recebido.body, recebido.status);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return resp({ error: "A ajuda ainda não está ligada. Avise o suporte." }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const p = recebido.payload;
  const { data: perfil, error: erroPerfil } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", p.adm_user_id)
    .maybeSingle();
  if (erroPerfil || !perfil?.organization_id) {
    return resp({ error: "Usuário sem imobiliária ativa no ADM" }, 403);
  }

  let printPath: string | null = null;
  if (p.print_base64) {
    const print = conferirPrint(p.print_base64, p.print_tipo);
    if (!print.ok) return resp({ error: print.erro }, 400);
    const ext = print.tipo === "image/png" ? "png" : print.tipo === "image/webp" ? "webp" : "jpg";
    printPath = `${perfil.organization_id}/${p.adm_user_id}/${crypto.randomUUID()}.${ext}`;
    const up = await admin.storage.from("support-attachments").upload(printPath, print.bytes, {
      contentType: print.tipo,
      upsert: false,
    });
    if (up.error) return resp({ error: "Não foi possível guardar o print." }, 500);
  }

  const payload = {
    jti: p.jti,
    iat: p.iat,
    tipo: p.tipo,
    texto: p.texto,
    tela_rota: p.tela_rota,
    tela_nome: p.tela_nome,
    user_agent: p.user_agent,
    ticket_id: p.ticket_id,
    print_path: printPath,
  };
  const { data, error } = await admin.rpc("support_ticket_origem_exec", {
    _acao: p.acao,
    _origem: p.sistema,
    _user: p.adm_user_id,
    _payload: payload,
  });
  if (error) {
    if (printPath) await admin.storage.from("support-attachments").remove([printPath]);
    return resp({ error: mensagemSegura(error.message) }, 400);
  }
  if (p.acao === "print" && data?.print_path) {
    const assinado = await admin.storage.from("support-attachments").createSignedUrl(data.print_path, 300);
    return resp({ ok: true, url: assinado.data?.signedUrl ?? null });
  }
  return resp({ ok: true, ...((data && typeof data === "object") ? data : { resultado: data }) });
});
