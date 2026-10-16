// Dados para pagamento da equipe da venda (card t_a4ef3b48, maquete aprovada em 16/10/2026).
// Tabelas/RPCs da migração 20261016220000 (fora de types.ts). Regras de quem grava e de quem vê
// completo ficam no banco (RLS + RPCs); aqui só normalização, validação de formulário e status.

export type TipoConta = "corrente" | "poupanca";
export type PixTipo = "cpf" | "cnpj" | "email" | "celular" | "aleatoria";
export type ModoPagamento = "imobiliaria" | "conta_propria";

export const PIX_TIPOS: { value: PixTipo; label: string }[] = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "celular", label: "Celular" },
  { value: "aleatoria", label: "Chave aleatória" },
];

export type DadosBancarios = {
  titular: string;
  documento: string;
  tipo_conta: TipoConta | "";
  banco: string;
  agencia: string;
  conta: string;
  pix_tipo: PixTipo | "";
  pix_chave: string;
};

export const DADOS_VAZIOS: DadosBancarios = {
  titular: "",
  documento: "",
  tipo_conta: "",
  banco: "",
  agencia: "",
  conta: "",
  pix_tipo: "",
  pix_chave: "",
};

/** Linha devolvida por venda_dados_pagamento(_sale_id). */
export type PagamentoPessoa = DadosBancarios & {
  user_id: string;
  nome: string;
  origem: "venda" | "cadastro" | "nenhum";
  modo: ModoPagamento;
  completo: boolean;
  tem_cadastro: boolean;
  /** true = quem pergunta vê os dados inteiros (o próprio, admin ou financeiro). */
  dados_completos: boolean;
  /** Quem gravou a cópia desta venda e quando (t_19cd1fc1). null = ainda sem cópia. */
  preenchido_por: string | null;
  preenchido_por_nome: string | null;
  preenchido_em: string | null;
};

const txt = (v: unknown) => (typeof v === "string" ? v : "");

export function normalizarDados(r: Record<string, unknown> | null | undefined): DadosBancarios {
  if (!r) return { ...DADOS_VAZIOS };
  const tipo = txt(r.tipo_conta);
  const pix = txt(r.pix_tipo);
  return {
    titular: txt(r.titular),
    documento: txt(r.documento),
    tipo_conta: tipo === "corrente" || tipo === "poupanca" ? tipo : "",
    banco: txt(r.banco),
    agencia: txt(r.agencia),
    conta: txt(r.conta),
    pix_tipo: PIX_TIPOS.some((p) => p.value === pix) ? (pix as PixTipo) : "",
    pix_chave: txt(r.pix_chave),
  };
}

export function normalizarPessoas(data: unknown): PagamentoPessoa[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !!r.user_id)
    .map((r) => ({
      ...normalizarDados(r),
      user_id: String(r.user_id),
      nome: txt(r.nome) || "Sem nome",
      origem: r.origem === "venda" || r.origem === "cadastro" ? r.origem : "nenhum",
      modo: r.modo === "imobiliaria" ? "imobiliaria" : "conta_propria",
      completo: r.completo === true,
      tem_cadastro: r.tem_cadastro === true,
      dados_completos: r.dados_completos === true,
      preenchido_por: txt(r.preenchido_por) || null,
      preenchido_por_nome: txt(r.preenchido_por_nome) || null,
      preenchido_em: txt(r.preenchido_em) || null,
    }));
}

/** "Preenchido por Fulano em 16/10" (ou "por você"). null = sem registro na venda. */
export function textoPreenchido(
  p: Pick<PagamentoPessoa, "preenchido_por" | "preenchido_por_nome" | "preenchido_em">,
  meuId: string,
): string | null {
  if (!p.preenchido_por) return null;
  const quem = p.preenchido_por === meuId ? "você" : p.preenchido_por_nome || "alguém da equipe";
  const d = p.preenchido_em ? new Date(p.preenchido_em) : null;
  const quando =
    d && !Number.isNaN(d.getTime())
      ? ` em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}`
      : "";
  return `Preenchido por ${quem}${quando}`;
}

/** Conta "completa" = titular + (PIX ou banco + agência + conta). Mesmo critério do banco. */
export function dadosCompletos(d: DadosBancarios): boolean {
  const t = (s: string) => s.trim() !== "";
  return t(d.titular) && (t(d.pix_chave) || (t(d.banco) && t(d.agencia) && t(d.conta)));
}

/** Mensagem de validação do formulário (null = pode salvar). */
export function validarDados(d: DadosBancarios): string | null {
  if (!d.titular.trim()) return "Informe o nome do titular da conta.";
  if (d.pix_chave.trim() && !d.pix_tipo) return "Escolha o tipo da chave PIX.";
  if (!d.pix_chave.trim() && !(d.banco.trim() && d.agencia.trim() && d.conta.trim()))
    return "Informe a chave PIX ou banco, agência e conta.";
  const doc = d.documento.replace(/\D/g, "");
  if (doc && doc.length !== 11 && doc.length !== 14) return "CPF/CNPJ do titular inválido.";
  if (
    d.pix_tipo === "email" &&
    d.pix_chave.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.pix_chave.trim())
  )
    return "Chave PIX de e-mail inválida.";
  return null;
}

export type StatusPagamento = "imobiliaria" | "ok" | "pendente";

/** Status do selo da maquete: Pela imobiliária / Conta própria ✓ / Falta dados bancários. */
export function statusPessoa(
  p: Pick<PagamentoPessoa, "modo" | "completo" | "origem">,
): StatusPagamento {
  if (p.origem !== "nenhum" && p.modo === "imobiliaria") return "imobiliaria";
  return p.origem !== "nenhum" && p.completo ? "ok" : "pendente";
}

export const STATUS_LABEL: Record<StatusPagamento, string> = {
  imobiliaria: "Pela imobiliária",
  ok: "Conta própria ✓",
  pendente: "Falta dados bancários",
};

/** Texto curto da conta para o resumo: "PIX CPF ***8901" ou "Banco X · ag 1234 · cc 98765-4". */
export function resumoConta(d: DadosBancarios): string {
  const partes: string[] = [];
  if (d.pix_chave) {
    const tipo = PIX_TIPOS.find((p) => p.value === d.pix_tipo)?.label ?? "";
    partes.push(`PIX ${tipo} ${d.pix_chave}`.replace(/\s+/g, " ").trim());
  }
  if (d.banco || d.agencia || d.conta) {
    const conta = [
      d.banco,
      d.agencia && `ag ${d.agencia}`,
      d.conta && `${d.tipo_conta === "poupanca" ? "cp" : "cc"} ${d.conta}`,
    ]
      .filter(Boolean)
      .join(" · ");
    if (conta) partes.push(conta);
  }
  return partes.join(" | ");
}

const PAPEL_EXTRA: Record<string, string> = {
  gestor: "Gestor",
  team_leader: "Team Leader",
  corretor_captador: "Corretor captador",
  corretor_vendedor: "Corretor vendedor",
  outro: "Outro",
};

type EquipeVenda = {
  corretor_captador_id?: string | null;
  corretor_vendedor_id?: string | null;
  lider_captador_id?: string | null;
  lider_vendedor_id?: string | null;
  indicador_captador_id?: string | null;
  indicador_vendedor_id?: string | null;
};

/** Papel(is) de cada pessoa na etapa Equipe, para o resumo "Como cada um vai receber". */
export function papeisDaEquipe(
  sale: EquipeVenda,
  extras: { user_id?: string | null; papel?: string | null; lado?: string | null }[],
): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const add = (uid: string | null | undefined, papel: string) => {
    if (!uid) return;
    const atual = mapa.get(uid) ?? [];
    if (!atual.includes(papel)) atual.push(papel);
    mapa.set(uid, atual);
  };
  add(sale.corretor_captador_id, "Corretor captador");
  add(sale.lider_captador_id, "Gestor/TL do captador");
  add(sale.indicador_captador_id, "Indicador do captador");
  add(sale.corretor_vendedor_id, "Corretor vendedor");
  add(sale.lider_vendedor_id, "Gestor/TL do vendedor");
  add(sale.indicador_vendedor_id, "Indicador do vendedor");
  extras.forEach((e) => {
    const base = PAPEL_EXTRA[e.papel ?? ""] ?? "Outro";
    const lado = e.lado === "captador" || e.lado === "vendedor" ? ` (${e.lado})` : "";
    add(e.user_id, base + lado);
  });
  return mapa;
}

/** Payload jsonb para salvar_meus_dados_pagamento_venda (sem espaços extras, vazio = null no banco). */
export function payloadDados(d: DadosBancarios): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(d) as (keyof DadosBancarios)[]).forEach((k) => {
    const v = d[k].trim();
    if (v) out[k] = v;
  });
  return out;
}
