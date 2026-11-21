// Módulo de Locação — Fase 1 (t_74426f94; maquete aprovada por Denis em 09/11/2026, t_660d2262).
// Regras puras (sem banco): etapas, leitura fechada do que vem das RPCs, comissão, data de pagamento,
// tempo parado. O banco (migration 20261110120000) repete toda checagem de permissão, etapa e trava.

export type EtapaLocacao =
  | "pre_analise"
  | "aprovacao"
  | "documentacao"
  | "conferencia"
  | "minuta"
  | "assinatura"
  | "pos_assinatura"
  | "chaves"
  | "comissao";

export type PapelLocacao = "corretor" | "gestora" | "contratos" | "vistoria" | "comissao";
export type Garantia =
  "fiador" | "caucao" | "seguro_fianca" | "loft" | "titulo_capitalizacao" | "outras";

export const ETAPAS: { key: EtapaLocacao; label: string; papel: PapelLocacao }[] = [
  { key: "pre_analise", label: "Pré-análise", papel: "corretor" },
  { key: "aprovacao", label: "Aprovação gestora", papel: "gestora" },
  { key: "documentacao", label: "Documentação", papel: "corretor" },
  { key: "conferencia", label: "Conferência gestora", papel: "gestora" },
  { key: "minuta", label: "Minuta (contratos)", papel: "contratos" },
  { key: "assinatura", label: "Assinatura", papel: "contratos" },
  { key: "pos_assinatura", label: "Pós-assinatura", papel: "vistoria" },
  { key: "chaves", label: "Entrega das chaves", papel: "vistoria" },
  { key: "comissao", label: "Comissão", papel: "comissao" },
];

export const PAPEL_LABEL: Record<PapelLocacao, string> = {
  corretor: "Corretor",
  gestora: "Gestora de locação",
  contratos: "Setor de contratos",
  vistoria: "Vistoria/Seguro",
  comissao: "Comissão (mês seguinte)",
};

// Ordem da maquete aprovada (13/11, t_b2ce1207). Espelho de locacao_garantia_rotulo() no banco.
export const GARANTIA_LABEL: Record<Garantia, string> = {
  seguro_fianca: "Seguro-fiança",
  caucao: "Caução",
  fiador: "Fiador",
  loft: "Loft (antiga CredPago)",
  titulo_capitalizacao: "Título de capitalização",
  outras: "Caucionamento / outras",
};

export const MINUTA_LABEL: Record<string, string> = {
  elaborando: "elaborando",
  pendencia: "pendência com o corretor",
  com_corretor: "minuta com o corretor",
  ajuste: "EM AJUSTE",
  aprovada: "aprovada",
};

export const ENVELOPE_LABEL: Record<"adm" | "loc" | "vist", string> = {
  adm: "1. Contrato de administração",
  loc: "2. Contrato de locação",
  vist: "3. Laudo de vistoria",
};

/** Ordem de assinatura informada pelo setor de contratos (DocuSign, registro manual nesta fase). */
export function ordemAssinatura(garantia: Garantia): string[] {
  return [
    "Proprietário (+ cônjuge)",
    "Locatário (+ cônjuge)",
    ...(garantia === "fiador" ? ["Fiador(es) (+ cônjuge)"] : []),
    "Testemunhas",
    "Diretoria RE/MAX",
  ];
}

export const SERVICOS: { key: "cpfl" | "saae" | "gas"; label: string }[] = [
  { key: "cpfl", label: "CPFL (energia)" },
  { key: "saae", label: "SAAE (água)" },
  { key: "gas", label: "Gás" },
];

export function etapaIndex(e: EtapaLocacao): number {
  return ETAPAS.findIndex((x) => x.key === e);
}

export function etapaLabel(e: EtapaLocacao): string {
  return ETAPAS[etapaIndex(e)]?.label ?? e;
}

// ----------------------------------------------------------------------------------------------------------------
// Leitura fechada do JSON das RPCs (nunca confiar no formato).
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const sn = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
};
const b = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const ETAPA_KEYS = new Set(ETAPAS.map((e) => e.key));
const GARANTIAS = new Set<Garantia>(Object.keys(GARANTIA_LABEL) as Garantia[]);

export type Titularidade = Record<
  "cpfl" | "saae" | "gas",
  { aplica: boolean; protocolo: string | null }
>;

/** Água/gás incluídos no condomínio (t_778e6bef), calculado pelo banco a partir dos dados do contrato. */
export type ContasCondominio = { agua: boolean; gas: boolean };

/** Tipo do imóvel escolhido ao abrir a locação (t_8f09d406, item 2). */
export type ImovelTipo = "condominio" | "casa" | "comercial";
export const IMOVEL_TIPO_LABEL: Record<ImovelTipo, string> = {
  condominio: "Condomínio (apto ou condomínio fechado)",
  casa: "Casa de rua",
  comercial: "Comercial",
};
/** Prazo sugerido (editável): 30 meses residencial, 36 comercial (item 4). */
export const prazoPadraoMeses = (tipo: "residencial" | "comercial"): number =>
  tipo === "comercial" ? 36 : 30;
/** Equipe gravada na abertura (item 5): não muda se o corretor trocar de equipe depois. */
export type EquipeGravada = {
  id: string | null;
  nome: string | null;
  gestorNome: string | null;
  teamLeaderNome: string | null;
  gravadaEm: string | null;
};

export type Locacao = {
  id: string;
  codigo: string;
  corretorId: string;
  corretorNome: string;
  coordenadorNome: string | null;
  imovelTipo: ImovelTipo | null;
  equipe: EquipeGravada;
  /** Bloco/apto (ficha.complemento), também na lista. */
  complemento: string | null;
  etapa: EtapaLocacao;
  situacao: "ativa" | "encerrada";
  devolvida: boolean;
  motivoDevolucao: string | null;
  etapaDesde: string;
  candidato: {
    cpf: string;
    nome: string;
    nascimento: string;
    telefone: string;
    email: string;
    /** Renda mensal em reais, texto "1234.56" (caução e fiador; t_b2ce1207). */
    renda: string;
  };
  endereco: string;
  tipo: "residencial" | "comercial";
  garantia: Garantia;
  aluguel: number;
  condominio: number;
  iptu: number;
  taxaAdm: number;
  /** Só intermediação (t_ec2962bd): taxa 0, casa cobra 1 aluguel, sem contrato no Financeiro. */
  semAdministracao: boolean;
  parceria: boolean;
  /** t_40cff7e4: locação nova = moradores só pela ficha individual; antiga (false) segue com o texto livre. */
  moradoresFicha: boolean;
  /** Valores lançados pela Fernanda (só vem na lista; t_8f09d406 item 6). */
  lancamento: LancamentoResumo | null;
  minuta: {
    estado: string;
    externa: boolean;
    pendencia: string | null;
    modelo: string | null;
    ajusteData: string | null;
    ajusteMotivo: string | null;
    /** Versão (v1, v2…) do arquivo enviado ao corretor (t_f8f83f9f). */
    versaoEnviada: number | null;
  };
  assinatura: {
    enviadoEm: string | null;
    adm: string;
    loc: string;
    vist: string;
    vistJunto: boolean;
    modo: string;
  };
  pos: {
    vistoriaPedida: string | null;
    /** t_c3ea1b18: vistoria agendada (data/hora ISO, vistoriador e se o corretor acompanha). */
    vistoriaAgenda: VistoriaAgenda | null;
    laudoEm: string | null;
    contestacaoEm: string | null;
    seguroEm: string | null;
    apolice: string | null;
    condominioAviso: string | null;
    semCondominio: boolean;
    mudanca: string | null;
    vistJunto: boolean;
    tit: Titularidade;
  };
  /** t_778e6bef: água/gás incluídos no condomínio (sem titularidade, sem aviso de protocolo). */
  contasCondominio: ContasCondominio;
  chaveEm: string | null;
  /** Ficha de abertura (t_28e583e2): o resto do formulário cadastral da locação. */
  ficha: FichaLocacao;
  captadorId: string | null;
  /** Data em que todos os documentos obrigatórios ficaram entregues (null = ainda falta). */
  docsCompletosEm: string | null;
};

export type Pessoa = "pf" | "pj";
export type Mobilia = "mobiliado" | "semi" | "sem";
export const MOBILIA_LABEL: Record<Mobilia, string> = {
  mobiliado: "Mobiliado (eletros, modulados, móveis)",
  semi: "Semimobiliado (móveis e modulados fixos)",
  sem: "Sem mobília",
};
export type FichaLocacao = {
  imovelId: string;
  mobilia: Mobilia | "";
  metragem: number;
  locatarioEndereco: string;
  locatarioPessoa: Pessoa;
  proprietarioPessoa: Pessoa;
  fiadorPessoa: Pessoa;
  proprietario: { nome: string; telefone: string; email: string };
  /** Observação da garantia (Loft, título, caucionamento/outras): texto livre. */
  garantiaOutra: string;
  observacoes: string;
  /** CEP do imóvel (pré-aprovação, t_b2ce1207). */
  cep: string;
  /** Bloco/apto do imóvel locado (t_8f09d406, item 1). */
  complemento: string;
  /** Fiador na pré-aprovação: renda em reais "1234.56" e nº da matrícula do imóvel. */
  fiador: FiadorPre;
};
export type FiadorPre = { nome: string; cpf: string; renda: string; matricula: string };

export type LeituraDoc = "pendente" | "ok" | "falhou" | "sem_leitura" | null;
export type DocumentoLocacao = {
  id: string;
  item: string;
  nomeArquivo: string;
  enviadoEm: string;
  /** Selo da leitura por IA (t_127811ca). null = ainda não lido. */
  leitura: LeituraDoc;
  leituraErro: string | null;
  preenchidos: number;
};
export type EventoLocacao = {
  em: string;
  etapa: string;
  papel: string;
  descricao: string;
  atorNome: string | null;
};
export type ContratoDados = {
  exige: boolean;
  valores: unknown;
  origem: unknown;
  faltando: string[];
};
/** Arquivo da minuta guardado no sistema (t_f8f83f9f): cada envio vira uma versão. */
export type MinutaVersao = {
  id: string;
  versao: number;
  origem: "anexo" | "gerada" | "externa";
  nomeArquivo: string;
  enviadoEm: string;
  enviadoPorNome: string | null;
};
export type Aguardando = "proprietario" | "locatario" | "corretor" | "seguradora";
export const AGUARDANDO_LABEL: Record<Aguardando, string> = {
  proprietario: "proprietário",
  locatario: "locatário",
  corretor: "corretor",
  seguradora: "seguradora",
};
/** Registro de andamento do setor de contratos (t_f8f83f9f): não muda a situação da minuta. */
export type Andamento = {
  id: string;
  etapa: string;
  texto: string;
  aguardando: Aguardando | null;
  criadoEm: string;
  criadoPorNome: string | null;
  resolvidoEm: string | null;
  resolvidoPorNome: string | null;
  resolucao: string | null;
};
/** Checklist de uma parte (Locatário PF/PJ, garantia, Proprietário PF/PJ) — t_28e583e2. */
export type ParteChecklist = {
  parte: string;
  grupo: string;
  rotulo: string;
  itens: { item: string; obrigatorio: boolean; entregue: boolean }[];
};
export type LocacaoDetalhe = Locacao & {
  checklist: string[];
  faltando: string[];
  documentos: DocumentoLocacao[];
  eventos: EventoLocacao[];
  contrato: ContratoDados;
  partes: ParteChecklist[];
  /** Todos os documentos obrigatórios entregues (a trava do "Montar contrato" libera). */
  docsCompleta: boolean;
  captadorNome: string | null;
  /** Versões da minuta, da mais nova para a mais antiga (t_f8f83f9f). */
  minutas: MinutaVersao[];
  andamentos: Andamento[];
  anexos: {
    id: string;
    tipo: string;
    nomeArquivo: string;
    numero: string | null;
    enviadoEm: string;
  }[];
  apolicePendente: boolean;
  /** t_40cff7e4: locação antiga que já ganhou ficha de moradores (o campo de texto do contrato trava). */
  moradoresComFicha: boolean;
  finaisPode: boolean;
  finaisTem: { contrato_locacao: boolean; contrato_adm: boolean; laudo: boolean };
  finaisTel: { locatario: boolean; proprietario: boolean } | null;
  finais: {
    id: string;
    tipo: "contrato_locacao" | "contrato_adm" | "laudo";
    nomeArquivo: string;
    enviadoEm: string;
    enviadoPorNome: string | null;
    envios: {
      id: string;
      destinatario: string;
      origem: string;
      status: string;
      erro: string | null;
      telefoneFinal: string | null;
      criadoEm: string;
      solicitadoPorNome: string | null;
    }[];
  }[];
};
const LEITURAS = new Set(["pendente", "ok", "falhou", "sem_leitura"]);

function lerTit(v: unknown): Titularidade {
  const t = obj(v);
  const um = (k: string, padrao: boolean) => {
    const x = obj(t[k]);
    return { aplica: x.aplica === undefined ? padrao : b(x.aplica), protocolo: sn(x.protocolo) };
  };
  return { cpfl: um("cpfl", true), saae: um("saae", true), gas: um("gas", false) };
}

const MOBILIAS = new Set(["mobiliado", "semi", "sem"]);
const pessoa = (v: unknown): Pessoa => (v === "pj" ? "pj" : "pf");

export function lerFicha(raw: unknown): FichaLocacao {
  const f = obj(raw);
  const p = obj(f.proprietario);
  const fi = obj(f.fiador);
  return {
    imovelId: s(f.imovel_id),
    mobilia: MOBILIAS.has(s(f.mobilia)) ? (s(f.mobilia) as Mobilia) : "",
    metragem: n(f.metragem),
    locatarioEndereco: s(f.locatario_endereco),
    locatarioPessoa: pessoa(f.locatario_pessoa),
    proprietarioPessoa: pessoa(f.proprietario_pessoa),
    fiadorPessoa: pessoa(f.fiador_pessoa),
    proprietario: { nome: s(p.nome), telefone: s(p.telefone), email: s(p.email) },
    garantiaOutra: s(f.garantia_outra),
    observacoes: s(f.observacoes),
    cep: s(f.cep),
    complemento: s(f.complemento),
    fiador: { nome: s(fi.nome), cpf: s(fi.cpf), renda: s(fi.renda), matricula: s(fi.matricula) },
  };
}

/** Ficha → JSON do banco (campo vazio vai como null e sai da ficha). Espelho de locacao_ficha_ok. */
export function fichaParaBanco(f: FichaLocacao): Record<string, unknown> {
  const t = (v: string) => (v.trim() === "" ? null : v.trim());
  return {
    imovel_id: t(f.imovelId),
    mobilia: f.mobilia || null,
    metragem: f.metragem > 0 ? f.metragem : null,
    locatario_endereco: t(f.locatarioEndereco),
    locatario_pessoa: f.locatarioPessoa,
    proprietario_pessoa: f.proprietarioPessoa,
    fiador_pessoa: f.fiadorPessoa,
    proprietario: {
      nome: t(f.proprietario.nome),
      telefone: t(f.proprietario.telefone),
      email: t(f.proprietario.email),
    },
    garantia_outra: t(f.garantiaOutra),
    observacoes: t(f.observacoes),
    cep: t(f.cep),
    complemento: t(f.complemento),
    fiador: {
      nome: t(f.fiador.nome),
      cpf: t(f.fiador.cpf),
      renda: t(f.fiador.renda),
      matricula: t(f.fiador.matricula),
    },
  };
}

/** Item opcional da lista de documentos: o nome termina em "(opcional)". Aparece no checklist, não trava. */
export function itemOpcional(item: string): boolean {
  return /\(opcional\)\s*$/i.test(item);
}

export function lerPartes(raw: unknown): ParteChecklist[] {
  return arr(raw).map((p) => {
    const x = obj(p);
    return {
      parte: s(x.parte),
      grupo: s(x.grupo),
      rotulo: s(x.rotulo),
      itens: arr(x.itens).map((i) => {
        const y = obj(i);
        return { item: s(y.item), obrigatorio: y.obrigatorio !== false, entregue: b(y.entregue) };
      }),
    };
  });
}

export function lerLocacao(raw: unknown): Locacao {
  const o = obj(raw);
  const c = obj(o.candidato);
  const m = obj(o.minuta);
  const a = obj(o.assinatura);
  const p = obj(o.pos);
  const etapa = s(o.etapa) as EtapaLocacao;
  const garantia = s(o.garantia) as Garantia;
  return {
    id: s(o.id),
    codigo: s(o.codigo) || "LOC",
    corretorId: s(o.corretor_id),
    corretorNome: s(o.corretor_nome) || "—",
    coordenadorNome: sn(o.coordenador_nome),
    imovelTipo:
      o.imovel_tipo === "condominio" || o.imovel_tipo === "casa" || o.imovel_tipo === "comercial"
        ? o.imovel_tipo
        : null,
    equipe: {
      id: sn(o.equipe_id),
      nome: sn(o.equipe_nome),
      gestorNome: sn(o.equipe_gestor_nome),
      teamLeaderNome: sn(o.equipe_tl_nome),
      gravadaEm: sn(o.equipe_gravada_em),
    },
    complemento: sn(o.complemento) ?? (sn(obj(o.ficha).complemento) || null),
    etapa: ETAPA_KEYS.has(etapa) ? etapa : "pre_analise",
    situacao: o.situacao === "encerrada" ? "encerrada" : "ativa",
    devolvida: b(o.devolvida),
    motivoDevolucao: sn(o.motivo_devolucao),
    etapaDesde: s(o.etapa_desde),
    candidato: {
      cpf: s(c.cpf),
      nome: s(c.nome),
      nascimento: s(c.nascimento),
      telefone: s(c.telefone),
      email: s(c.email),
      renda: s(c.renda),
    },
    endereco: s(o.endereco),
    tipo: o.tipo === "comercial" ? "comercial" : "residencial",
    garantia: GARANTIAS.has(garantia) ? garantia : "fiador",
    aluguel: n(o.aluguel),
    condominio: n(o.condominio),
    iptu: n(o.iptu),
    // Sem administração a taxa é 0 de propósito; o "|| 10" vale só para locação com administração (legado).
    taxaAdm: b(o.sem_administracao) ? 0 : n(o.taxa_adm) || 10,
    semAdministracao: b(o.sem_administracao),
    parceria: b(o.parceria),
    moradoresFicha: b(o.moradores_ficha),
    minuta: {
      estado: s(m.estado),
      externa: b(m.externa),
      pendencia: sn(m.pendencia),
      modelo: sn(m.modelo),
      ajusteData: sn(m.ajuste_data),
      ajusteMotivo: sn(m.ajuste_motivo),
      versaoEnviada: n(m.versao_enviada) || null,
    },
    assinatura: {
      enviadoEm: sn(a.enviado_em),
      adm: s(a.adm) || "nao",
      loc: s(a.loc) || "nao",
      vist: s(a.vist) || "nao",
      vistJunto: b(a.vist_junto),
      modo: s(a.modo) || "manual",
    },
    pos: {
      vistoriaPedida: sn(p.vistoria_pedida),
      vistoriaAgenda: lerVistoriaAgenda(p.vistoria_agenda),
      laudoEm: sn(p.laudo_em),
      contestacaoEm: sn(p.contestacao_em),
      seguroEm: sn(p.seguro_em),
      apolice: sn(p.apolice),
      condominioAviso: sn(p.condominio_aviso),
      semCondominio: b(p.sem_condominio),
      mudanca: sn(p.mudanca),
      vistJunto: b(p.vist_junto),
      tit: lerTit(p.tit),
    },
    contasCondominio: {
      agua: b(obj(o.contas_condominio).agua),
      gas: b(obj(o.contas_condominio).gas),
    },
    chaveEm: sn(o.chave_em),
    ficha: lerFicha(o.ficha),
    captadorId: sn(o.captador_id),
    docsCompletosEm: sn(o.docs_completos_em),
    lancamento: lerLancamentoResumo(o.lancamento),
  };
}

/** Resumo do lançamento da Fernanda que a lista traz (aluguel, taxa, parceria). */
export type LancamentoResumo = {
  aluguel: number;
  taxaAdm: number;
  semAdministracao: boolean;
  parceria: "nenhuma" | "remax" | "externa";
};

export function lerLancamentoResumo(raw: unknown): LancamentoResumo | null {
  if (!raw || typeof raw !== "object") return null;
  const x = obj(raw);
  const aluguel = n(x.aluguel);
  const semAdministracao = b(x.sem_administracao);
  const taxaAdm = semAdministracao ? 0 : n(x.taxa_adm);
  if (!(aluguel > 0) || !(semAdministracao || taxaAdm > 0)) return null;
  const p = x.parceria === "remax" || x.parceria === "externa" ? x.parceria : "nenhuma";
  return { aluguel, taxaAdm, semAdministracao, parceria: p };
}

/**
 * Regras do lançamento na comissão (dúvidas para a Cris; comportamento atual até ela responder — t_8f09d406):
 * - LANCAMENTO_SUBSTITUI_VALORES: o aluguel/taxa lançados substituem os da pré-análise no cálculo.
 * - Parceria RE/MAX ou externa conta como parceria (divisão 50/50 vem de config.parceriaDividePorDois).
 * Para mudar depois, basta trocar a constante ou esta função.
 */
export const LANCAMENTO_SUBSTITUI_VALORES = true;

export function valoresParaComissao(
  l: Pick<Locacao, "aluguel" | "taxaAdm" | "parceria" | "lancamento"> & {
    semAdministracao?: boolean;
  },
): {
  aluguel: number;
  taxaAdm: number;
  semAdministracao: boolean;
  parceria: boolean;
  lancado: boolean;
} {
  const x = l.lancamento;
  if (!x || !LANCAMENTO_SUBSTITUI_VALORES) {
    return {
      aluguel: l.aluguel,
      taxaAdm: l.taxaAdm,
      semAdministracao: !!l.semAdministracao,
      parceria: l.parceria,
      lancado: false,
    };
  }
  return {
    aluguel: x.aluguel,
    taxaAdm: x.taxaAdm,
    semAdministracao: x.semAdministracao,
    parceria: x.parceria !== "nenhuma",
    lancado: true,
  };
}

/** Texto curto da administração para fichas e listas (t_ec2962bd). */
export const TEXTO_SEM_ADMINISTRACAO = "Sem administração (intermediação: 1 aluguel)";
export function textoAdministracao(x: { semAdministracao?: boolean; taxaAdm: number }): string {
  return x.semAdministracao ? TEXTO_SEM_ADMINISTRACAO : `Taxa adm. ${x.taxaAdm}%`;
}

/** Endereço com complemento (bloco/apto), para listas e contrato. */
export function enderecoCompleto(endereco: string, complemento: string | null | undefined): string {
  const e = (endereco ?? "").trim();
  const c = (complemento ?? "").trim();
  if (!c) return e;
  return e ? `${e} — ${c}` : c;
}

/** Equipe gravada na abertura: texto curto para listas e ficha. */
export function equipeTexto(e: EquipeGravada): string {
  if (!e.gravadaEm) return "aberta antes do registro";
  if (!e.nome) return "sem equipe";
  return e.nome;
}

export function lerDetalhe(raw: unknown): LocacaoDetalhe {
  const o = obj(raw);
  return {
    ...lerLocacao(raw),
    checklist: arr(o.checklist).map(s).filter(Boolean),
    faltando: arr(o.faltando).map(s).filter(Boolean),
    partes: lerPartes(o.partes),
    docsCompleta: o.docs_completa === undefined ? arr(o.faltando).length === 0 : b(o.docs_completa),
    captadorNome: sn(o.captador_nome),
    minutas: arr(o.minutas)
      .map((v) => {
        const x = obj(v);
        const origem = s(x.origem);
        return {
          id: s(x.id),
          versao: n(x.versao),
          origem: (origem === "gerada" || origem === "externa"
            ? origem
            : "anexo") as MinutaVersao["origem"],
          nomeArquivo: s(x.nome_arquivo) || "minuta",
          enviadoEm: s(x.enviado_em),
          enviadoPorNome: sn(x.enviado_por_nome),
        };
      })
      .filter((v) => v.id && v.versao > 0)
      .sort((a, b) => b.versao - a.versao),
    andamentos: arr(o.andamentos).map((a) => {
      const x = obj(a);
      const ag = s(x.aguardando);
      return {
        id: s(x.id),
        etapa: s(x.etapa),
        texto: s(x.texto),
        aguardando: ag in AGUARDANDO_LABEL ? (ag as Aguardando) : null,
        criadoEm: s(x.criado_em),
        criadoPorNome: sn(x.criado_por_nome),
        resolvidoEm: sn(x.resolvido_em),
        resolvidoPorNome: sn(x.resolvido_por_nome),
        resolucao: sn(x.resolucao),
      };
    }),
    anexos: arr(o.anexos).map((a) => {
      const x = obj(a);
      return {
        id: s(x.id),
        tipo: s(x.tipo),
        nomeArquivo: s(x.nome_arquivo),
        numero: sn(x.numero),
        enviadoEm: s(x.enviado_em),
      };
    }),
    apolicePendente: b(o.apolice_pendente),
    moradoresComFicha: b(o.moradores_com_ficha),
    finaisPode: b(o.finais_pode),
    finaisTem: {
      contrato_locacao: b(obj(o.finais_tem).contrato_locacao),
      contrato_adm: b(obj(o.finais_tem).contrato_adm),
      laudo: b(obj(o.finais_tem).laudo),
    },
    finaisTel: o.finais_tel
      ? {
          locatario: b(obj(o.finais_tel).locatario),
          proprietario: b(obj(o.finais_tel).proprietario),
        }
      : null,
    finais: arr(o.finais)
      .map((raw) => {
        const f = obj(raw);
        const t = s(f.tipo);
        return {
          id: s(f.id),
          tipo: (t === "laudo" || t === "contrato_adm" ? t : "contrato_locacao") as
            "laudo" | "contrato_adm" | "contrato_locacao",
          nomeArquivo: s(f.nome_arquivo),
          enviadoEm: s(f.enviado_em),
          enviadoPorNome: sn(f.enviado_por_nome),
          envios: arr(f.envios).map((rawEnvio) => {
            const e = obj(rawEnvio);
            return {
              id: s(e.id),
              destinatario: s(e.destinatario),
              origem: s(e.origem),
              status: s(e.status),
              erro: sn(e.erro),
              telefoneFinal: sn(e.telefone_final),
              criadoEm: s(e.criado_em),
              solicitadoPorNome: sn(e.solicitado_por_nome),
            };
          }),
        };
      })
      .filter((f) => f.id),
    documentos: arr(o.documentos).map((d) => {
      const x = obj(d);
      return {
        id: s(x.id),
        item: s(x.item),
        nomeArquivo: s(x.nome_arquivo),
        enviadoEm: s(x.enviado_em),
        leitura: LEITURAS.has(s(x.leitura)) ? (s(x.leitura) as LeituraDoc) : null,
        leituraErro: sn(x.leitura_erro),
        preenchidos: n(x.preenchidos),
      };
    }),
    contrato: (() => {
      const c = obj(o.contrato);
      return {
        exige: b(c.exige),
        valores: c.valores,
        origem: c.origem,
        faltando: arr(c.faltando).map(s).filter(Boolean),
      };
    })(),
    eventos: arr(o.eventos).map((e) => {
      const x = obj(e);
      return {
        em: s(x.em),
        etapa: s(x.etapa),
        papel: s(x.papel),
        descricao: s(x.descricao),
        atorNome: sn(x.ator_nome),
      };
    }),
  };
}

export function lerLista(raw: unknown): Locacao[] {
  return arr(raw).map(lerLocacao);
}

// ----------------------------------------------------------------------------------------------------------------
// Regras por imobiliária (tudo "a confirmar" por Denis; padrão = maquete aprovada).
export type ConfigLocacao = {
  pctCoordenador: number;
  coordenadorSaiDoCorretor: boolean;
  parceriaDividePorDois: boolean;
  coordenadorNaParceria: boolean;
  diaPagamento1a15: number;
  diaPagamento16a31: number;
  reprovadaVoltaAoCorretor: boolean;
  chaveAntesDoLaudo: boolean;
  seguroIncendioObrigatorio: boolean;
  tabelaTaxa: Record<string, number>;
  documentos: Record<string, string[]>;
};

export const CONFIG_PADRAO: ConfigLocacao = {
  pctCoordenador: 10,
  coordenadorSaiDoCorretor: true,
  parceriaDividePorDois: true,
  coordenadorNaParceria: true,
  diaPagamento1a15: 8,
  diaPagamento16a31: 23,
  reprovadaVoltaAoCorretor: true,
  chaveAntesDoLaudo: true,
  seguroIncendioObrigatorio: false,
  tabelaTaxa: { "10": 50, "9": 45, "8": 40, "7": 35, "6": 30 },
  documentos: {},
};

export function lerConfig(raw: unknown): ConfigLocacao {
  const o = obj(raw);
  const bool = (k: string, p: boolean) => (typeof o[k] === "boolean" ? (o[k] as boolean) : p);
  const num = (k: string, p: number) => (o[k] === undefined || o[k] === null ? p : n(o[k]));
  const tabela: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.tabela_taxa))) tabela[k] = n(v);
  const docs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj(o.documentos))) docs[k] = arr(v).map(s).filter(Boolean);
  return {
    pctCoordenador: num("pct_coordenador", CONFIG_PADRAO.pctCoordenador),
    coordenadorSaiDoCorretor: bool("coordenador_sai_do_corretor", true),
    parceriaDividePorDois: bool("parceria_divide_por_dois", true),
    coordenadorNaParceria: bool("coordenador_na_parceria", true),
    diaPagamento1a15: num("dia_pagamento_1a15", CONFIG_PADRAO.diaPagamento1a15),
    diaPagamento16a31: num("dia_pagamento_16a31", CONFIG_PADRAO.diaPagamento16a31),
    reprovadaVoltaAoCorretor: bool("reprovada_volta_ao_corretor", true),
    chaveAntesDoLaudo: bool("chave_antes_do_laudo", true),
    seguroIncendioObrigatorio: bool("seguro_incendio_obrigatorio", false),
    tabelaTaxa: Object.keys(tabela).length ? tabela : { ...CONFIG_PADRAO.tabelaTaxa },
    documentos: docs,
  };
}

/** Papéis da locação por imobiliária. 'financeiro' = Financeiro da locação (Fase 2, t_be750361). */
export type PapelExtra = "gestora" | "contratos" | "vistoria" | "financeiro";
const PAPEIS_EXTRA: readonly PapelExtra[] = ["gestora", "contratos", "vistoria", "financeiro"];

export type ContextoLocacao = {
  usuarioId: string;
  papeis: PapelExtra[];
  admin: boolean;
  gerencia: boolean;
  veComissao: boolean;
  config: ConfigLocacao;
  pessoas: Record<string, string[]>;
};

export function lerContexto(raw: unknown): ContextoLocacao {
  const o = obj(raw);
  const pessoas: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj(o.pessoas))) pessoas[k] = arr(v).map(s).filter(Boolean);
  return {
    usuarioId: s(o.usuario_id),
    papeis: arr(o.papeis)
      .map(s)
      .filter((x): x is PapelExtra => (PAPEIS_EXTRA as readonly string[]).includes(x)),
    admin: b(o.admin),
    gerencia: b(o.gerencia),
    veComissao: b(o.ve_comissao),
    config: lerConfig(o.config),
    pessoas,
  };
}

// ----------------------------------------------------------------------------------------------------------------
// Comissão (exibição; nada é lançado no financeiro nesta fase).

/** % do 1º aluguel para o lado da casa conforme a taxa de administração. Fora da tabela: taxa × 5. */
export function pctPorTaxa(
  taxa: number,
  tabela: Record<string, number> = CONFIG_PADRAO.tabelaTaxa,
): number {
  const chave = String(Math.round(taxa * 100) / 100);
  const v = tabela[chave];
  return typeof v === "number" && Number.isFinite(v) ? v : Math.round(taxa * 5 * 100) / 100;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

export type CalculoComissao = {
  pct: number;
  base: number;
  totalLado: number;
  coordenador: number;
  corretor: number;
  parceiro: number;
};

/** Sem administração a casa cobra 1 aluguel de intermediação: 100% do 1º aluguel (decisão de Denis, 20/11). */
export const PCT_SEM_ADMINISTRACAO = 100;

export function calcularComissao(
  l: Pick<Locacao, "aluguel" | "taxaAdm" | "parceria"> & { semAdministracao?: boolean },
  cfg: ConfigLocacao,
): CalculoComissao {
  // Mesma divisão (coordenador, corretor, parceria ÷ 2); só muda a base % do lado da casa.
  const pct = l.semAdministracao ? PCT_SEM_ADMINISTRACAO : pctPorTaxa(l.taxaAdm, cfg.tabelaTaxa);
  const divide = l.parceria && cfg.parceriaDividePorDois;
  const base = divide ? l.aluguel / 2 : l.aluguel;
  const totalLado = centavos((base * pct) / 100);
  const temCoord = !l.parceria || cfg.coordenadorNaParceria;
  const coordenador = temCoord ? centavos((totalLado * cfg.pctCoordenador) / 100) : 0;
  const corretor = cfg.coordenadorSaiDoCorretor ? centavos(totalLado - coordenador) : totalLado;
  // Parceiro: sempre metade de 1 aluguel, sem administração e sem a tabela da taxa (Denis, 20/11; t_45d1a6eb).
  const parceiro = l.parceria ? centavos(l.aluguel / 2) : 0;
  return { pct, base: centavos(base), totalLado, coordenador, corretor, parceiro };
}

/** Pagamento no mês seguinte à entrega das chaves: 1–15 → dia X; 16–31 → dia Y (padrão 8 e 6; a confirmar). */
export function dataPagamento(chaveEm: string | null, cfg: ConfigLocacao): string | null {
  if (!chaveEm || !/^\d{4}-\d{2}-\d{2}$/.test(chaveEm)) return null;
  const [y, m, d] = chaveEm.split("-").map(Number);
  const dia = d <= 15 ? cfg.diaPagamento1a15 : cfg.diaPagamento16a31;
  const ano = m === 12 ? y + 1 : y;
  const mes = m === 12 ? 1 : m + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** t_778e6bef: água (SAAE) e gás marcados como incluídos no condomínio não têm troca de titularidade. */
export function incluidaNoCondominio(
  servico: "cpfl" | "saae" | "gas",
  contas: ContasCondominio | undefined,
): boolean {
  return (servico === "saae" && !!contas?.agua) || (servico === "gas" && !!contas?.gas);
}

/** Serviços aplicáveis sem protocolo. Vazio = titularidade ok. Só ALERTA (não bloqueia a comissão).
 * Conta incluída no condomínio (t_778e6bef) não se aplica e não gera o aviso. */
export function titularidadePendente(tit: Titularidade, contas?: ContasCondominio): string[] {
  return SERVICOS.filter(
    (x) => tit[x.key].aplica && !tit[x.key].protocolo && !incluidaNoCondominio(x.key, contas),
  ).map((x) => x.key.toUpperCase());
}

// ----------------------------------------------------------------------------------------------------------------
// Tempo parado (mesmas cores da venda: até 2 dias normal · 3–5 âmbar · mais de 5 vermelho).
export function diasParado(desde: string, agora: Date = new Date()): number {
  const t = Date.parse(desde);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((agora.getTime() - t) / 86_400_000));
}

export function tomParado(dias: number): "slate" | "amber" | "red" {
  return dias > 5 ? "red" : dias >= 3 ? "amber" : "slate";
}

export function textoParado(dias: number): string {
  return dias === 0 ? "hoje" : dias === 1 ? "há 1 dia" : `há ${dias} dias`;
}

/** Quem responde pela etapa atual (nome do corretor ou o papel). */
export function responsavelAtual(l: Locacao, pessoas: Record<string, string[]> = {}): string {
  const papel = ETAPAS[etapaIndex(l.etapa)]?.papel ?? "corretor";
  if (papel === "corretor") return l.corretorNome;
  const nomes = pessoas[papel];
  return nomes && nomes.length ? `${PAPEL_LABEL[papel]} · ${nomes.join(", ")}` : PAPEL_LABEL[papel];
}

export type ResumoEtapa = {
  etapa: EtapaLocacao;
  quantidade: number;
  maxDias: number;
  mediaDias: number;
};

export function resumoPorEtapa(lista: Locacao[], agora: Date = new Date()): ResumoEtapa[] {
  return ETAPAS.map((e) => {
    const dias = lista.filter((l) => l.etapa === e.key).map((l) => diasParado(l.etapaDesde, agora));
    return {
      etapa: e.key,
      quantidade: dias.length,
      maxDias: dias.length ? Math.max(...dias) : 0,
      mediaDias: dias.length ? Math.round(dias.reduce((a, x) => a + x, 0) / dias.length) : 0,
    };
  });
}

// ----------------------------------------------------------------------------------------------------------------
// Pré-aprovação por garantia (maquete aprovada por Denis em 13/11, t_b2ce1207). SOMENTE dados, nenhum anexo.
// Espelho de locacao_pre_parte_faltando / locacao_pre_faltando (mesma ordem e mesmo texto; o banco repete tudo).
// Substitui faltasPreAnalise + faltasFicha: ID do imóvel, mobília, metragem, proprietário, endereço atual e captador
// continuam na ficha, mas não travam mais o envio à gestora.

/** CPF com dígitos verificadores (com ou sem pontuação). Espelho de locacao_cpf_ok(). */
export function cpfValido(v: string): boolean {
  if (!/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(v)) return false;
  const d = v.replace(/\D/g, "");
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = ((soma * 10) % 11) % 10;
    if (r !== Number(d[n])) return false;
  }
  return true;
}

/** Valor em reais guardado como "1234.56" (> 0). Espelho de locacao_renda_ok(). */
export function rendaValida(v: string): boolean {
  return /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0;
}

/** Texto digitado em R$ ("7.800,00", "R$ 7800", "2500", "0") → número ≥ 0; vazio ou inválido → null. */
export function reaisNumero(v: string): number | null {
  const t = v.replace(/R\$|\s/g, "");
  if (!t) return null;
  // Com vírgula: ponto é milhar. Sem vírgula: ponto seguido de 3 dígitos também é milhar ("2.500").
  const norm = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, "")
      : t;
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) && n < 1e9 ? n : null;
}

/** Renda digitada em R$ → "7800.00" do banco; vazio, zero ou inválido → "". */
export function reaisParaBanco(v: string): string {
  const n = reaisNumero(v);
  return n !== null && n > 0 ? n.toFixed(2) : "";
}

/** "7800.00" (ou número) → "7.800,00" (campo da tela, sem o "R$"). */
export function reaisParaTela(v: string | number): string {
  const n = Number(v);
  return v !== "" && Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}

export const pedeRendaLocatario = (g: Garantia) => g === "caucao" || g === "fiador";

const dataValida = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === v &&
    v >= "1900-01-01" &&
    v <= "2100-12-31"
  );
};

export type LocatarioPre = Locacao["candidato"];

/** O que falta de UMA parte (locatário ou fiador) para a garantia. */
export function faltasParte(
  parte: "locatario" | "fiador",
  garantia: Garantia,
  d: Partial<LocatarioPre & FiadorPre>,
): string[] {
  const f: string[] = [];
  const t = (k: keyof (LocatarioPre & FiadorPre)) => (d[k] ?? "").trim();
  if (parte === "locatario") {
    if (!cpfValido(t("cpf"))) f.push("CPF do locatário");
    if (t("nome").length < 5) f.push("nome completo do locatário");
    if (!dataValida(t("nascimento"))) f.push("data de nascimento do locatário");
    if (t("telefone").replace(/\D/g, "").length < 10) f.push("telefone do locatário");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t("email"))) f.push("e-mail do locatário");
    if (pedeRendaLocatario(garantia) && !rendaValida(t("renda"))) f.push("renda do locatário");
  } else if (garantia === "fiador") {
    if (t("nome").length < 5) f.push("nome completo do fiador");
    if (!cpfValido(t("cpf"))) f.push("CPF do fiador");
    if (!rendaValida(t("renda"))) f.push("renda do fiador");
    if (!t("matricula")) f.push("nº da matrícula do imóvel do fiador");
  }
  return f;
}

/**
 * Tudo o que falta para enviar a pré-aprovação à gestora. Condomínio e IPTU: null = campo vazio na tela (0 = não
 * tem). Só a tela cobra esses dois: o banco guarda 0 por padrão e não distingue "vazio" de "zero".
 */
export function faltasPreAprovacao(x: {
  garantia: Garantia;
  cep: string;
  endereco: string;
  aluguel: number;
  condominio?: number | null;
  iptu?: number | null;
  candidato: LocatarioPre;
  fiador: FiadorPre;
  observacao: string;
  /** t_8f09d406: tipo do imóvel; `undefined` = tela antiga que não informa (não cobra). */
  imovelTipo?: ImovelTipo | null;
}): string[] {
  const f: string[] = [];
  if (x.imovelTipo === null) f.push("tipo do imóvel");
  if (!/^\d{5}-?\d{3}$/.test(x.cep.trim())) f.push("CEP");
  if (x.endereco.trim().length < 8) f.push("endereço do imóvel");
  if (!(x.aluguel > 0)) f.push("aluguel");
  if (x.condominio === null) f.push("condomínio");
  if (x.iptu === null) f.push("IPTU");
  f.push(...faltasParte("locatario", x.garantia, x.candidato));
  f.push(...faltasParte("fiador", x.garantia, x.fiador));
  if (x.garantia === "outras" && x.observacao.trim().length < 3) f.push("observação da garantia");
  return f;
}

export function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** t_c3ea1b18: vistoria agendada (gravada em pos.vistoria_agenda pela RPC locacao_vistoria_agendar). */
export type VistoriaAgenda = { em: string; vistoriador: string; acompanha: boolean };

export function lerVistoriaAgenda(v: unknown): VistoriaAgenda | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const em = sn(o.em);
  if (!em || Number.isNaN(Date.parse(em))) return null;
  return { em, vistoriador: s(o.vistoriador), acompanha: b(o.acompanha) };
}

const FORMATO_AGENDA_SP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** "sex., 21/11, 14:00" no horário de Brasília (mesma referência dos lembretes do banco). */
export function quandoVistoria(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : FORMATO_AGENDA_SP.format(d);
}

/** Valor do campo datetime-local ("YYYY-MM-DDTHH:MM") em Brasília, para reabrir o agendamento na tela. */
export function agendaParaCampo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// Lista de documentos editável como texto: "[Grupo]" seguido de um documento por linha.
const GRUPOS_DOC: { key: string; label: string }[] = [
  { key: "locatario", label: "Locatário" },
  { key: "fiador", label: GARANTIA_LABEL.fiador },
  { key: "caucao", label: GARANTIA_LABEL.caucao },
  // t_d3e1c29f: seguro-fiança não pede documento ao corretor (apólice vai em "Seguro e condomínio").
  // t_b2ce1207: garantias novas começam sem lista; a gestão inclui em Regras.
  { key: "loft", label: GARANTIA_LABEL.loft },
  { key: "titulo_capitalizacao", label: GARANTIA_LABEL.titulo_capitalizacao },
  { key: "outras", label: GARANTIA_LABEL.outras },
  { key: "proprietario", label: "Proprietário" },
  // t_28e583e2: listas PJ (formulários reais de 10/11). Fiador PJ sem lista → usa a do fiador.
  { key: "locatario_pj", label: "Locatário PJ" },
  { key: "fiador_pj", label: "Fiador PJ" },
  { key: "proprietario_pj", label: "Proprietário PJ" },
];

export function docsParaTexto(docs: Record<string, string[]>): string {
  // Todos os grupos aparecem (inclusive Fiador PJ, ainda sem lista padrão).
  return GRUPOS_DOC.map((g) => `[${g.label}]\n${(docs[g.key] ?? []).join("\n")}`).join("\n\n");
}

export function textoParaDocs(texto: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let atual: string | null = null;
  for (const linha of texto.split("\n").map((l) => l.trim())) {
    const g = /^\[(.+)\]$/.exec(linha);
    if (g) {
      const rotulo = g[1].trim().toLowerCase();
      atual = GRUPOS_DOC.find((x) => x.label.toLowerCase() === rotulo)?.key ?? null;
      if (atual) out[atual] = [];
    } else if (linha && atual) {
      out[atual].push(linha.slice(0, 200));
    }
  }
  // Grupo PJ vazio não é gravado: o banco usa a lista PJ padrão ou, sem ela, a PF da mesma parte.
  // Garantias novas (t_b2ce1207) sem itens também não são gravadas: vazio e ausente = sem lista.
  const semLista = new Set(["loft", "titulo_capitalizacao", "outras"]);
  for (const k of Object.keys(out))
    if ((k.endsWith("_pj") || semLista.has(k)) && !out[k].length) delete out[k];
  return out;
}

export const EXTENSOES_DOC = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
/** Minuta: PDF ou Word (t_f8f83f9f). O banco e o bucket repetem a regra. */
export const EXTENSOES_MINUTA = ["pdf", "doc", "docx"] as const;
export function extensaoMinuta(nome: string): (typeof EXTENSOES_MINUTA)[number] | null {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  return (EXTENSOES_MINUTA as readonly string[]).includes(ext)
    ? (ext as (typeof EXTENSOES_MINUTA)[number])
    : null;
}
/** Modelos por garantia: "outras" só se os dados indicarem caução de imóvel (não título de capitalização). */
export function temModeloMinuta(d: {
  tipo: string;
  garantia: string;
  contrato?: { valores?: unknown };
}): boolean {
  if (d.tipo !== "residencial" && d.tipo !== "comercial") return false;
  if (d.garantia === "outras") return obj(d.contrato?.valores).cau_tipo === "imovel";
  return ["fiador", "caucao", "seguro_fianca", "loft"].includes(d.garantia);
}
export const TAMANHO_MAX_DOC = 16 * 1024 * 1024;

/** Extensão aceita do arquivo escolhido (ou null). O bucket repete o limite de tipo e tamanho. */
export function extensaoDoc(nome: string): (typeof EXTENSOES_DOC)[number] | null {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  return (EXTENSOES_DOC as readonly string[]).includes(ext)
    ? (ext as (typeof EXTENSOES_DOC)[number])
    : null;
}
