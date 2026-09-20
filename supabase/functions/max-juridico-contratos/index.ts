import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_TYPES = new Set(["contrato", "contrato_assinado", "aditivo", "distrato"]);
const DEFAULT_TYPES = ["contrato", "contrato_assinado"];
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_LIMIT = 50;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-max-juridico-token, x-request-id",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function getPresentedToken(req: Request): string {
  const direct = req.headers.get("x-max-juridico-token");
  if (direct) return direct.trim();
  const authorization = req.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

function normalizeTypes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_TYPES;
  const types = input.filter((value): value is string => typeof value === "string" && ALLOWED_TYPES.has(value));
  return [...new Set(types)];
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  payload: { action: string; saleId?: string | null; documentId?: string | null; resultCount: number; requestId?: string | null },
) {
  const { error } = await admin.from("juridico_agent_audit").insert({
    agent_name: "max_juridico",
    action: payload.action,
    sale_id: payload.saleId ?? null,
    document_id: payload.documentId ?? null,
    result_count: payload.resultCount,
    request_id: payload.requestId ?? null,
  });
  if (error) console.error("juridico_agent_audit_failed", error.message);
}

async function attachSignedUrls(
  admin: ReturnType<typeof createClient>,
  documents: Array<Record<string, unknown>>,
) {
  const paths = documents.map((document) => document.storage_path).filter((path): path is string => typeof path === "string" && path.length > 0);
  if (paths.length === 0) return documents.map((document) => ({ ...document, signed_url: null, signed_url_expires_in: 0 }));

  const { data: signed, error } = await admin.storage.from("sale-documents").createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    console.error("juridico_signed_urls_failed", error?.message ?? "empty_response");
    return documents.map((document) => ({ ...document, signed_url: null, signed_url_expires_in: 0 }));
  }

  const byPath = new Map(signed.map((entry) => [entry.path, entry.signedUrl ?? null]));
  return documents.map((document) => ({
    ...document,
    signed_url: typeof document.storage_path === "string" ? byPath.get(document.storage_path) ?? null : null,
    signed_url_expires_in: SIGNED_URL_TTL_SECONDS,
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const expectedToken = Deno.env.get("MAX_JURIDICO_API_TOKEN") ?? "";
  const presentedToken = getPresentedToken(req);
  if (expectedToken.length < 32 || !constantTimeEqual(presentedToken, expectedToken)) {
    return response({ error: "unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return response({ error: "function_not_configured" }, 503);

  const body = await req.json().catch(() => ({}));
  const action = body?.action === "get" ? "get" : body?.action === "search" ? "search" : null;
  if (!action) return response({ error: "invalid_action" }, 400);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requestId = req.headers.get("x-request-id");
  const types = normalizeTypes(body?.types);

  let query = admin
    .from("sale_documents")
    .select("id, sale_id, tipo, file_name, storage_path, status, versao, created_at, updated_at")
    .in("tipo", types)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (action === "get") {
    if (typeof body?.document_id !== "string" || !body.document_id) return response({ error: "document_id_required" }, 400);
    query = query.eq("id", body.document_id).limit(1);
  } else {
    if (typeof body?.sale_id === "string" && body.sale_id) query = query.eq("sale_id", body.sale_id);
    if (typeof body?.status === "string" && body.status) query = query.eq("status", body.status);
    if (typeof body?.file_name_contains === "string" && body.file_name_contains.trim()) {
      query = query.ilike("file_name", `%${escapeLike(body.file_name_contains.trim())}%`);
    }
    if (typeof body?.created_after === "string" && body.created_after) query = query.gte("created_at", body.created_after);
    if (typeof body?.created_before === "string" && body.created_before) query = query.lte("created_at", body.created_before);
    const limit = Math.max(1, boundedInteger(body?.limit, 50, MAX_LIMIT));
    const offset = boundedInteger(body?.offset, 0, 100000);
    // Busca uma linha extra para informar has_more sem afirmar um total incorreto.
    query = query.range(offset, offset + limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error("juridico_contract_query_failed", error.message);
    return response({ error: "query_failed" }, 500);
  }

  const rawDocuments = (data ?? []) as Array<Record<string, unknown>>;
  const requestedLimit = action === "search" ? Math.max(1, boundedInteger(body?.limit, 50, MAX_LIMIT)) : 1;
  const hasMore = action === "search" && rawDocuments.length > requestedLimit;
  const documents = await attachSignedUrls(admin, rawDocuments.slice(0, requestedLimit));
  await writeAudit(admin, {
    action,
    saleId: typeof body?.sale_id === "string" ? body.sale_id : documents.length === 1 ? String(documents[0].sale_id ?? "") : null,
    documentId: action === "get" ? String(body.document_id) : null,
    resultCount: documents.length,
    requestId,
  });

  return response({
    documents,
    count: documents.length,
    has_more: hasMore,
    signed_url_expires_in: SIGNED_URL_TTL_SECONDS,
  });
});
