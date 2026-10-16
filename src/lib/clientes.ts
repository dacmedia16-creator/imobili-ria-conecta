// Regras de vínculo parte da venda ↔ cadastro central de clientes (clientes, único por
// organização + CPF/CNPJ normalizado — índice clientes_org_cpf_cnpj_normalizado_key).
//
// A identidade do cliente é o documento. O cliente_id que a parte já carrega NÃO pode ser
// reaproveitado às cegas: se o corretor corrigiu o CPF (ou duas partes ficaram ligadas ao mesmo
// cadastro), dar UPDATE nesse cadastro trocaria o CPF/nome de OUTRA pessoa — e, quando o CPF novo
// já existe na org, o banco recusa com 23505 e a venda trava (t_d1738ada).

export function normalizarDocumento(doc: string | null | undefined): string {
  return (doc ?? "").replace(/\D/g, "");
}

export type ClienteRef = { id: string; cpf_cnpj_normalizado: string | null };

export type DecisaoCliente =
  /** Cadastro já ligado a esta parte e com o mesmo documento: atualiza com o que foi digitado. */
  | { acao: "atualizar"; clienteId: string }
  /** Cadastro existente de outra parte/venda com este documento: liga sem sobrescrever dados preenchidos. */
  | { acao: "vincular"; clienteId: string }
  /** Ninguém na org tem este documento: cria um cadastro novo. */
  | { acao: "criar" }
  /** Documento incompleto: não mexe no cadastro central; mantém o vínculo atual. */
  | { acao: "manter"; clienteId: string | null };

/**
 * Decide o que fazer com o cadastro central ao salvar uma parte.
 * @param docDigitado CPF/CNPJ do formulário
 * @param vinculadoAtual cliente_id que a parte já tem no banco (pode ser de outro documento)
 * @param achadoPorDocumento cliente da org com o documento digitado (busca por cpf_cnpj_normalizado)
 */
export function decidirCliente(
  docDigitado: string | null | undefined,
  vinculadoAtual: string | null | undefined,
  achadoPorDocumento: ClienteRef | null,
): DecisaoCliente {
  const doc = normalizarDocumento(docDigitado);
  if (doc.length < 11) return { acao: "manter", clienteId: vinculadoAtual ?? null };
  if (achadoPorDocumento) {
    return achadoPorDocumento.id === vinculadoAtual
      ? { acao: "atualizar", clienteId: achadoPorDocumento.id }
      : { acao: "vincular", clienteId: achadoPorDocumento.id };
  }
  // Documento novo na org. Mesmo que a parte já esteja ligada a um cadastro, ele é de outro
  // documento (senão a busca o teria achado): nunca reescrever o CPF dele — cria um novo.
  return { acao: "criar" };
}

/** Só os campos vazios do cadastro existente recebem o que foi digitado (não sobrescreve outra venda). */
export function camposParaCompletar<T extends Record<string, unknown>>(
  existente: Record<string, unknown>,
  digitado: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(digitado)) {
    if (v == null || v === "") continue;
    const atual = existente[k];
    if (atual == null || atual === "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export type ClientePayload = {
  tipo_pessoa?: string | null;
  nome?: string | null;
  razao_social?: string | null;
  cnpj?: string | null;
  cpf_cnpj?: string | null;
  rg?: string | null;
  profissao?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
};

type DbErr = { code?: string; message?: string } | null;
type Res<T> = PromiseLike<{ data: T | null; error: DbErr }>;
/** Fatia mínima do client Supabase usada aqui (facilita teste sem banco). */
export type ClientesDb = {
  from(t: "clientes"): {
    select(cols: string): {
      eq(c: "cpf_cnpj_normalizado", v: string): { maybeSingle(): Res<Record<string, unknown>> };
    };
    update(v: Record<string, unknown>): { eq(c: "id", v: string): Res<unknown> };
    insert(v: Record<string, unknown>): { select(c: "id"): { single(): Res<{ id: string }> } };
  };
};

/**
 * Acha/cria o cadastro central desta parte pelo CPF/CNPJ da org e devolve o cliente_id a gravar
 * em sale_parties. Nunca reescreve o documento de um cadastro de outra pessoa; em corrida de
 * INSERT (23505) reaproveita o cadastro criado pela outra chamada.
 */
export async function resolverClienteDaParte(
  db: ClientesDb,
  payload: ClientePayload,
  vinculadoAtual: string | null | undefined,
  userId: string | null,
): Promise<{ clienteId: string | null; error: DbErr }> {
  const doc = normalizarDocumento(payload.cpf_cnpj);
  if (doc.length < 11) return { clienteId: vinculadoAtual ?? null, error: null };
  const buscar = async () => {
    const { data, error } = await db
      .from("clientes")
      .select("*")
      .eq("cpf_cnpj_normalizado", doc)
      .maybeSingle();
    return { data, error };
  };
  const achado = await buscar();
  if (achado.error) return { clienteId: null, error: achado.error };
  const ref = achado.data ? { id: String(achado.data.id), cpf_cnpj_normalizado: doc } : null;
  const decisao = decidirCliente(doc, vinculadoAtual, ref);

  const completar = async (existente: Record<string, unknown>) => {
    const faltando = camposParaCompletar(existente, payload as Record<string, unknown>);
    delete (faltando as Record<string, unknown>).cpf_cnpj;
    if (Object.keys(faltando).length === 0) return { clienteId: String(existente.id), error: null };
    const { error } = await db
      .from("clientes")
      .update({ ...faltando, updated_by: userId })
      .eq("id", String(existente.id));
    return { clienteId: String(existente.id), error };
  };

  if (decisao.acao === "atualizar") {
    const { error } = await db
      .from("clientes")
      .update({ ...payload, updated_by: userId })
      .eq("id", decisao.clienteId);
    return { clienteId: decisao.clienteId, error };
  }
  if (decisao.acao === "vincular" && achado.data) return completar(achado.data);
  if (decisao.acao === "manter") return { clienteId: decisao.clienteId, error: null };

  const { data: novo, error } = await db
    .from("clientes")
    .insert({ ...payload, created_by: userId })
    .select("id")
    .single();
  if (novo) return { clienteId: novo.id, error: null };
  if (error?.code === "23505") {
    const deNovo = await buscar();
    if (deNovo.data) return completar(deNovo.data);
  }
  return { clienteId: null, error };
}

/** Mensagem em português para erros do cadastro de clientes (nada de texto cru do banco). */
export function mensagemErroCliente(error: { code?: string; message?: string } | null): string {
  if (!error) return "Não foi possível salvar o cadastro do cliente.";
  if (error.code === "23505" || /clientes_org_cpf_cnpj_normalizado_key/.test(error.message ?? "")) {
    return "Este CPF/CNPJ já pertence a outro cliente cadastrado na imobiliária. Confira o documento digitado; se estiver certo, atualize a página e salve de novo para usar o cadastro existente.";
  }
  if (error.code === "42501")
    return "Você não tem permissão para alterar este cadastro de cliente.";
  return "Não foi possível salvar o cadastro do cliente. Tente novamente em instantes.";
}
