import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  Capture,
  CaptureDocument,
  CaptureEvent,
  CaptureForm,
  DocumentKind,
  Template,
} from "./exclusive-captures";
import { normalizeForm } from "./exclusive-captures";

// Tipos das novas tabelas/RPCs são gerados pelo Supabase somente após a migration.
// Isolar o cast evita editar types.ts, que é gerado automaticamente pelo projeto.
const db = supabase as unknown as SupabaseClient;
const bucket = () => supabase.storage.from("exclusive-captures");
const check = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

export async function exclusiveEnabled(): Promise<boolean> {
  const { data, error } = await db.rpc("exclusive_capture_enabled");
  if (error) return false; // a migração ainda não existe ou o serviço falhou: fechar, não abrir
  return data === true;
}
export type ProfileRegistration = { user_id: string; cpf: string | null; creci: string | null };
export async function profileRegistrations(): Promise<ProfileRegistration[]> {
  const { data, error } = await db.rpc("exclusive_profile_registration");
  check(error);
  return (data ?? []) as ProfileRegistration[];
}
export async function listCaptures(): Promise<Capture[]> {
  const { data, error } = await db
    .from("exclusive_captures")
    .select("*")
    .order("created_at", { ascending: false });
  check(error);
  return ((data ?? []) as Capture[]).map((c) => ({ ...c, form_data: normalizeForm(c.form_data) }));
}
export async function loadCapture(
  id: string,
): Promise<{ capture: Capture; docs: CaptureDocument[]; history: CaptureEvent[] }> {
  const { data, error } = await db.from("exclusive_captures").select("*").eq("id", id).single();
  check(error);
  const [{ data: docs, error: docError }, { data: history, error: histError }] = await Promise.all([
    db.from("exclusive_documents").select("*").eq("capture_id", id).order("created_at"),
    db
      .from("exclusive_history")
      .select("*")
      .eq("capture_id", id)
      .order("created_at", { ascending: false }),
  ]);
  check(docError);
  check(histError);
  const capture = data as Capture;
  return {
    capture: { ...capture, form_data: normalizeForm(capture.form_data) },
    docs: (docs ?? []) as CaptureDocument[],
    history: (history ?? []) as CaptureEvent[],
  };
}
export async function createCapture(template: Template): Promise<string> {
  const { data, error } = await db.rpc("exclusive_create", { _template: template });
  check(error);
  if (typeof data !== "string") throw new Error("Captação não foi criada");
  return data;
}
export async function saveCapture(id: string, form: CaptureForm, cpf: string, creci: string) {
  const { error } = await db.rpc("exclusive_save", {
    _id: id,
    _form: form,
    _broker_cpf: cpf,
    _broker_creci: creci,
  });
  check(error);
}
export async function transitionCapture(
  id: string,
  action: "enviar" | "assinatura" | "aprovar" | "devolver",
  detail?: string,
) {
  const { error } = await db.rpc("exclusive_transition", {
    _id: id,
    _action: action,
    _detail: detail ?? null,
  });
  check(error);
}
export async function uploadCaptureDocument(
  id: string,
  kind: DocumentKind,
  owner: number,
  file: File,
) {
  const extByMime: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const ext = extByMime[file.type];
  if (!ext || file.size > 16 * 1024 * 1024 || file.size === 0)
    throw new Error("Envie PDF/JPG/PNG/WEBP de até 16 MB");
  if ((kind === "gerado" || kind === "assinado") && ext !== "pdf")
    throw new Error("Contrato deve ser PDF");
  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await bucket().upload(path, file, { upsert: false, contentType: file.type });
  check(error);
  const { error: registerError } = await db.rpc("exclusive_register_document", {
    _id: id,
    _kind: kind,
    _owner: owner,
    _path: path,
    _file_name: file.name,
  });
  check(registerError);
}
export async function signedDocument(doc: CaptureDocument): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(doc.storage_path, 300);
  check(error);
  if (!data?.signedUrl) throw new Error("Documento indisponível");
  return data.signedUrl;
}
export async function downloadCaptureTemplate(template: Template): Promise<Uint8Array> {
  if (template !== "campolim" && template !== "barao-de-tatui") throw new Error("Modelo inválido");
  const { data, error } = await supabase.storage
    .from("exclusive-templates")
    .download(`${template}.pdf`);
  check(error);
  if (!data) throw new Error("Modelo indisponível");
  return new Uint8Array(await data.arrayBuffer());
}
export async function signedDocuments(
  docs: CaptureDocument[],
): Promise<{ file_name: string; url: string }[]> {
  return Promise.all(
    docs.map(async (doc) => ({ file_name: doc.file_name, url: await signedDocument(doc) })),
  );
}
export async function downloadDocument(doc: CaptureDocument) {
  const url = await signedDocument(doc);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Falha ao baixar documento");
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = doc.file_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
