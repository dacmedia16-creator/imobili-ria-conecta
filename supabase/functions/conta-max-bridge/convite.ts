// Convite de autocadastro (t_6e4dab96) na ponte Conta MAX — sem dependências do Deno (testável).
// O dono abriu /convite/<token> e entrou pela Conta MAX (Google). A ponte já validou o passe
// (assinatura, validade, e-mail verificado e uso único). Aqui: o e-mail do passe precisa ser
// EXATAMENTE o convidado (o banco compara, sem maiúsculas/espaços). Se bater, devolve uma reserva
// de 1 h para o cadastro. Nunca cria usuário, sessão nem imobiliária.

// deno-lint-ignore no-explicit-any
type AdminClient = any;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const CODES = [
  "convite_substituido",
  "convite_outro_email",
  "convite_cancelado",
  "convite_ja_usado",
  "convite_expirado",
  "convite_invalido",
  "email_ja_cadastrado",
] as const;
export type ConviteErro = (typeof CODES)[number] | "convite_falhou";

const enc = new TextEncoder();
export async function sha256Hex(v: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(v)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function codigoConvite(message: string | undefined): ConviteErro {
  const m = String(message ?? "");
  return CODES.find((c) => m.includes(c)) ?? "convite_falhou";
}

export type ConviteResultado =
  | { ok: true; claim: string; email: string }
  | { ok: false; status: number; error: ConviteErro };

export async function reservarConvite(
  admin: AdminClient,
  input: { inviteToken: unknown; email: string; sub: string },
): Promise<ConviteResultado> {
  const token = String(input.inviteToken ?? "");
  if (!TOKEN_RE.test(token)) return { ok: false, status: 400, error: "convite_invalido" };
  const claim = randomToken();
  const { data, error } = await admin.rpc("org_invite_claim", {
    _token_hash: await sha256Hex(token),
    _email: input.email,
    _workos_sub: input.sub,
    _claim_hash: await sha256Hex(claim),
  });
  if (error) {
    const code = codigoConvite(error.message);
    return { ok: false, status: code === "convite_falhou" ? 500 : 403, error: code };
  }
  return { ok: true, claim, email: String(data ?? input.email) };
}
