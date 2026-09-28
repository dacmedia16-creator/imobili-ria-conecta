/**
 * Cadastro de imobiliárias pela plataforma (multiempresa, Fase 2b) — regras puras usadas pela tela e
 * pelo servidor. Autorização definitiva: RPCs `platform_*` no banco (só o super-admin da plataforma).
 */
import { z } from "zod";

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const COLOR_RE = /^#[0-9a-f]{6}$/;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const LOGO_MAX_BYTES = 1024 * 1024;

/** "Imobiliária São João Ltda." → "imobiliaria-sao-joao-ltda". */
export function slugify(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export const onlyDigits = (v: string) => v.replace(/\D/g, "");

/** CNPJ com dígitos verificadores (aceita com ou sem pontuação). */
export function isValidCnpj(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function formatCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length !== 14) return value ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const optionalColor = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || COLOR_RE.test(v), "Cor inválida (use o formato #RRGGBB).")
  .optional()
  .nullable();

const optionalCnpj = z
  .string()
  .trim()
  .refine((v) => v === "" || isValidCnpj(v), "CNPJ inválido.")
  .optional()
  .nullable();

export const organizationFormSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome da imobiliária.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, "Identificador: letras minúsculas, números e hífen (2 a 63)."),
  cnpj: optionalCnpj,
  corPrimaria: optionalColor,
  corSecundaria: optionalColor,
});
export type OrganizationForm = z.infer<typeof organizationFormSchema>;

export const firstAdminSchema = z.object({
  organizationId: z.string().uuid(),
  nome: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, "Digite o nome completo."),
  email: z.string().trim().toLowerCase().email().max(255),
});
export type FirstAdminInput = z.infer<typeof firstAdminSchema>;

export type StepKey = "organizacao" | "dados" | "logo" | "administrador" | "convite";
export type StepStatus = "ok" | "erro" | "pulado";
export type Step = { key: StepKey; status: StepStatus; message: string };

export const STEP_LABEL: Record<StepKey, string> = {
  organizacao: "Imobiliária",
  dados: "CNPJ e cores",
  logo: "Logo",
  administrador: "Primeiro administrador",
  convite: "Link de convite",
};

/** Resultado de uma sequência de etapas: para na primeira falha, as seguintes ficam "pulado". */
export function summarizeSteps(steps: Step[]): { ok: boolean; failed: Step | null } {
  const failed = steps.find((s) => s.status === "erro") ?? null;
  return { ok: failed === null, failed };
}

export type OrganizationRow = {
  id: string;
  slug: string;
  nome: string;
  status: "ativa" | "suspensa";
  legacy_default: boolean;
  cnpj: string | null;
  cor_primaria: string | null;
  cor_secundaria: string | null;
  logo_path: string | null;
  created_at: string;
};

export type OrganizationSummary = OrganizationRow & {
  logoUrl: string | null;
  membros: number;
  administradores: number;
};

/** Mensagem clara para erros comuns do banco (sem expor detalhes internos). */
export function friendlyOrgError(message: string): string {
  if (/organizations_slug_key|duplicate key.*slug/i.test(message))
    return "Já existe uma imobiliária com esse identificador.";
  if (/organizations_cnpj_unique/i.test(message)) return "Já existe uma imobiliária com esse CNPJ.";
  // Motivo específico antes do código genérico: a recusa da agência legada também usa 42501.
  if (/agencia legada/i.test(message)) return "A agência original não pode ser suspensa por aqui.";
  if (/super-admin da plataforma|42501/i.test(message))
    return "Somente o super-admin da plataforma pode fazer isso.";
  if (/nao encontrada|P0002/i.test(message)) return "Imobiliária não encontrada.";
  if (/check constraint|23514/i.test(message)) return "Dados inválidos (confira CNPJ, cores e identificador).";
  return message;
}
