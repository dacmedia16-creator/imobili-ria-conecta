// Lógica da função max-juridico-contratos sem dependências do Deno (testável localmente).
// Multiempresa: o token do agente é vinculado a UMA agência (MAX_JURIDICO_ORGANIZATION_ID).
// Toda consulta, URL assinada e auditoria ficam restritas a essa organização; sem ela, falha fechada.

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export const ALLOWED_TYPES = new Set(["contrato", "contrato_assinado", "aditivo", "distrato"]);
export const DEFAULT_TYPES = ["contrato", "contrato_assinado"];
export const SIGNED_URL_TTL_SECONDS = 300;
export const MAX_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CoreResult = { status: number; body: Record<string, unknown> };

export function normalizeTypes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_TYPES;
  const types = input.filter(
    (value): value is string => typeof value === "string" && ALLOWED_TYPES.has(value),
  );
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

/** Organização configurada precisa existir e estar ativa. */
export async function activeOrganization(
  admin: AdminClient,
  organizationId: string,
): Promise<boolean> {
  if (!UUID_RE.test(organizationId)) return false;
  const { data, error } = await admin
    .from("organizations")
    .select("id")
    .eq("id", organizationId)
    .eq("status", "ativa")
    .maybeSingle();
  return !error && Boolean(data);
}

export async function handleJuridicoRequest(
  admin: AdminClient,
  organizationId: string,
  body: Record<string, unknown> | null,
  requestId: string | null,
): Promise<CoreResult> {
  if (!(await activeOrganization(admin, organizationId))) {
    return { status: 503, body: { error: "organization_not_configured" } };
  }
  const action = body?.action === "get" ? "get" : body?.action === "search" ? "search" : null;
  if (!action) return { status: 400, body: { error: "invalid_action" } };
  const types = normalizeTypes(body?.types);

  let query = admin
    .from("sale_documents")
    .select(
      "id, sale_id, tipo, file_name, storage_path, status, versao, created_at, updated_at, organization_id",
    )
    .eq("organization_id", organizationId)
    .in("tipo", types)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (action === "get") {
    if (typeof body?.document_id !== "string" || !body.document_id)
      return { status: 400, body: { error: "document_id_required" } };
    query = query.eq("id", body.document_id).limit(1);
  } else {
    if (typeof body?.sale_id === "string" && body.sale_id) query = query.eq("sale_id", body.sale_id);
    if (typeof body?.status === "string" && body.status) query = query.eq("status", body.status);
    if (typeof body?.file_name_contains === "string" && body.file_name_contains.trim()) {
      query = query.ilike("file_name", `%${escapeLike(body.file_name_contains.trim())}%`);
    }
    if (typeof body?.created_after === "string" && body.created_after)
      query = query.gte("created_at", body.created_after);
    if (typeof body?.created_before === "string" && body.created_before)
      query = query.lte("created_at", body.created_before);
    const limit = Math.max(1, boundedInteger(body?.limit, 50, MAX_LIMIT));
    const offset = boundedInteger(body?.offset, 0, 100000);
    // Busca uma linha extra para informar has_more sem afirmar um total incorreto.
    query = query.range(offset, offset + limit);
  }

  const { data, error } = await query;
  if (error) {
    console.error("juridico_contract_query_failed", error.message);
    return { status: 500, body: { error: "query_failed" } };
  }

  // Defesa extra: descarta qualquer linha fora da agência antes de assinar URLs.
  const rawDocuments = ((data ?? []) as Array<Record<string, unknown>>).filter(
    (document) => document.organization_id === organizationId,
  );
  const requestedLimit =
    action === "search" ? Math.max(1, boundedInteger(body?.limit, 50, MAX_LIMIT)) : 1;
  const hasMore = action === "search" && rawDocuments.length > requestedLimit;
  const documents = await attachSignedUrls(admin, rawDocuments.slice(0, requestedLimit));
  const saleIdForAudit =
    typeof body?.sale_id === "string" && documents.some((d) => d.sale_id === body.sale_id)
      ? body.sale_id
      : documents.length === 1
        ? String(documents[0].sale_id ?? "")
        : null;
  await writeAudit(admin, organizationId, {
    action,
    saleId: saleIdForAudit || null,
    documentId: action === "get" && documents.length === 1 ? String(documents[0].id) : null,
    resultCount: documents.length,
    requestId,
  });

  return {
    status: 200,
    body: {
      documents: documents.map(({ organization_id: _org, ...rest }) => rest),
      count: documents.length,
      has_more: hasMore,
      signed_url_expires_in: SIGNED_URL_TTL_SECONDS,
    },
  };
}

async function writeAudit(
  admin: AdminClient,
  organizationId: string,
  payload: {
    action: string;
    saleId?: string | null;
    documentId?: string | null;
    resultCount: number;
    requestId?: string | null;
  },
) {
  const { error } = await admin.from("juridico_agent_audit").insert({
    organization_id: organizationId,
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
  admin: AdminClient,
  documents: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  const paths = documents
    .map((document) => document.storage_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0);
  if (paths.length === 0)
    return documents.map((document) => ({ ...document, signed_url: null, signed_url_expires_in: 0 }));

  const { data: signed, error } = await admin.storage
    .from("sale-documents")
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    console.error("juridico_signed_urls_failed", error?.message ?? "empty_response");
    return documents.map((document) => ({ ...document, signed_url: null, signed_url_expires_in: 0 }));
  }

  const byPath = new Map(
    (signed as Array<{ path: string; signedUrl?: string | null }>).map((entry) => [
      entry.path,
      entry.signedUrl ?? null,
    ]),
  );
  return documents.map((document) => ({
    ...document,
    signed_url:
      typeof document.storage_path === "string" ? (byPath.get(document.storage_path) ?? null) : null,
    signed_url_expires_in: SIGNED_URL_TTL_SECONDS,
  }));
}
