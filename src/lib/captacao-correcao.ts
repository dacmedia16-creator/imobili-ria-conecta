/**
 * "Corrigir dados" na captação APROVADA (t_9f9f0c6a, Denis 27/10/2026).
 * Regras da tela iguais às do banco (exclusive_corrigir_aprovada): quem pode, o que pode mudar e
 * como o histórico 'corrigida' é lido. Nada aqui fala com o banco.
 */
import {
  OWNER_FIELDS,
  PROPERTY_FIELDS,
  captureOwners,
  type CaptureForm,
  type OwnerField,
  type PropertyField,
} from "./exclusive-captures";
import { FICHA_CAPTACAO_CAMPOS, type FichaCaptacao } from "./ficha-imovel";

/** Chaves que a correção aceita (mesma lista fechada do banco). */
export const CORRECAO_IMOVEL: readonly PropertyField[] = PROPERTY_FIELDS.map((f) => f.key);
export const CORRECAO_FICHA: readonly (keyof FichaCaptacao)[] = FICHA_CAPTACAO_CAMPOS.map(
  (f) => f.key,
);
export const CORRECAO_PROPRIETARIO: readonly OwnerField[] = OWNER_FIELDS.map((f) => f.key);

/** O que NÃO muda por este botão (continua no fluxo "Devolver ao corretor"). */
export const CORRECAO_TRAVADOS = [
  "status",
  "data de assinatura",
  "prazo e vencimento da exclusividade",
  "comissão e foro",
  "documentos (contrato assinado e PDF gerado)",
  "captador",
  "unidade",
] as const;

/**
 * Mostra o botão "Corrigir dados"? Captação aprovada, não arquivada, e a pessoa é o corretor
 * captador ou gestor/team leader/admin (o banco ainda confere a liderança e a organização).
 */
export function podeCorrigirAprovada(p: {
  status: string;
  archived: boolean;
  userId: string | null | undefined;
  captorId: string;
  manager: boolean;
}): boolean {
  if (p.status !== "aprovada" || p.archived || !p.userId) return false;
  return p.userId === p.captorId || p.manager;
}

export type MudancaCorrecao = { grupo: string; campo: string; antes: string; depois: string };
export type PayloadCorrecao = {
  imovel?: Partial<Record<PropertyField, string>>;
  ficha?: Partial<Record<keyof FichaCaptacao, string>>;
  proprietarios?: Partial<Record<OwnerField, string>>[];
};

const rotulo = new Map<string, string>([
  ...PROPERTY_FIELDS.map((f) => [f.key, f.label] as [string, string]),
  ...FICHA_CAPTACAO_CAMPOS.map((f) => [f.key, f.label] as [string, string]),
  ...OWNER_FIELDS.map((f) => [f.key, f.label] as [string, string]),
]);
const txt = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function diff<K extends string>(
  antes: Partial<Record<K, unknown>> | undefined,
  depois: Partial<Record<K, unknown>> | undefined,
  keys: readonly K[],
  grupo: string,
  out: MudancaCorrecao[],
): Partial<Record<K, string>> | undefined {
  const mudou: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const a = txt(antes?.[k]);
    const d = txt(depois?.[k]);
    if (a === d) continue;
    mudou[k] = d;
    out.push({ grupo, campo: rotulo.get(k) ?? k, antes: a, depois: d });
  }
  return Object.keys(mudou).length ? mudou : undefined;
}

/**
 * Monta o que vai para o banco: SÓ as chaves permitidas que mudaram. Prazo, testemunhas, Plano,
 * data de assinatura etc. nunca entram, mesmo se o formulário tiver mudado neles.
 * Proprietário incluído ou removido não é aceito (documentos presos à posição).
 */
export function montarCorrecao(
  original: CaptureForm,
  editado: CaptureForm,
): { payload: PayloadCorrecao; mudancas: MudancaCorrecao[]; erro: string | null } {
  const mudancas: MudancaCorrecao[] = [];
  const payload: PayloadCorrecao = {};
  const imovel = diff(original.imovel, editado.imovel, CORRECAO_IMOVEL, "Imóvel", mudancas);
  if (imovel) payload.imovel = imovel;
  const ficha = diff(original.ficha, editado.ficha, CORRECAO_FICHA, "Ficha do imóvel", mudancas);
  if (ficha) payload.ficha = ficha;
  const antes = captureOwners(original);
  const depois = captureOwners(editado);
  if (antes.length !== depois.length)
    return {
      payload: {},
      mudancas: [],
      erro: 'Não é possível incluir ou remover proprietário pela correção. Use "Devolver ao corretor".',
    };
  const props = antes.map(
    (o, i) =>
      diff(o, depois[i], CORRECAO_PROPRIETARIO, `Proprietário ${i + 1}`, mudancas) ?? {},
  );
  if (props.some((p) => Object.keys(p).length)) payload.proprietarios = props;
  return { payload, mudancas, erro: null };
}

/** Lê o detalhe JSON do histórico 'corrigida'. Detalhe inválido = lista vazia (nunca quebra a tela). */
export function lerCorrecao(
  detail: string | null | undefined,
): { por: "corretor" | "gestor" | null; mudancas: MudancaCorrecao[] } {
  try {
    const j = JSON.parse(detail ?? "") as { por?: unknown; mudancas?: unknown };
    const mudancas = Array.isArray(j.mudancas)
      ? j.mudancas
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
          .map((m) => ({
            grupo: txt(m.grupo),
            campo: txt(m.campo),
            antes: txt(m.antes),
            depois: txt(m.depois),
          }))
      : [];
    const por = j.por === "corretor" || j.por === "gestor" ? j.por : null;
    return { por, mudancas };
  } catch {
    return { por: null, mudancas: [] };
  }
}

/** "Imóvel · Área útil (m²): 80 → 85" (vazio aparece como "(vazio)"). */
export function textoMudanca(m: MudancaCorrecao): string {
  const v = (s: string) => (s.trim() ? s : "(vazio)");
  return `${m.grupo} · ${m.campo}: ${v(m.antes)} → ${v(m.depois)}`;
}

/** Aviso exibido quando há venda ativa ligada à captação. */
export const AVISO_VENDA_CORRECAO =
  "Esta captação tem uma venda ativa ligada. A correção vale só para a captação: a venda NÃO é atualizada automaticamente. Se precisar, corrija também na venda.";
