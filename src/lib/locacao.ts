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
export type Garantia = "fiador" | "caucao" | "seguro_fianca";

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

export const GARANTIA_LABEL: Record<Garantia, string> = {
  fiador: "Fiador",
  caucao: "Caução",
  seguro_fianca: "Seguro-fiança",
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
const GARANTIAS = new Set<Garantia>(["fiador", "caucao", "seguro_fianca"]);

export type Titularidade = Record<
  "cpfl" | "saae" | "gas",
  { aplica: boolean; protocolo: string | null }
>;

export type Locacao = {
  id: string;
  codigo: string;
  corretorId: string;
  corretorNome: string;
  coordenadorNome: string | null;
  etapa: EtapaLocacao;
  situacao: "ativa" | "encerrada";
  devolvida: boolean;
  motivoDevolucao: string | null;
  etapaDesde: string;
  candidato: { cpf: string; nome: string; nascimento: string; telefone: string; email: string };
  endereco: string;
  tipo: "residencial" | "comercial";
  garantia: Garantia;
  aluguel: number;
  condominio: number;
  iptu: number;
  taxaAdm: number;
  parceria: boolean;
  minuta: {
    estado: string;
    externa: boolean;
    pendencia: string | null;
    modelo: string | null;
    ajusteData: string | null;
    ajusteMotivo: string | null;
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
  /** Garantia fora da lista atual (CredPago, título de capitalização…): texto livre, lista final a confirmar. */
  garantiaOutra: string;
  observacoes: string;
};

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
  };
}

/** O que falta da ficha cadastral para enviar à gestora (o banco repete a regra em locacao_enviar_pre). */
export function faltasFicha(f: FichaLocacao, captadorId: string | null): string[] {
  const x: string[] = [];
  if (!f.imovelId.trim()) x.push("ID do imóvel");
  if (!f.mobilia) x.push("mobília");
  if (!(f.metragem > 0)) x.push("metragem");
  if (f.locatarioEndereco.trim().length < 8) x.push("endereço atual do locatário");
  if (f.proprietario.nome.trim().length < 3) x.push("nome do proprietário");
  if (!f.proprietario.telefone.trim() && !f.proprietario.email.trim())
    x.push("telefone ou e-mail do proprietário");
  if (!captadorId) x.push("corretor captador");
  return x;
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
    },
    endereco: s(o.endereco),
    tipo: o.tipo === "comercial" ? "comercial" : "residencial",
    garantia: GARANTIAS.has(garantia) ? garantia : "fiador",
    aluguel: n(o.aluguel),
    condominio: n(o.condominio),
    iptu: n(o.iptu),
    taxaAdm: n(o.taxa_adm) || 10,
    parceria: b(o.parceria),
    minuta: {
      estado: s(m.estado),
      externa: b(m.externa),
      pendencia: sn(m.pendencia),
      modelo: sn(m.modelo),
      ajusteData: sn(m.ajuste_data),
      ajusteMotivo: sn(m.ajuste_motivo),
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
    chaveEm: sn(o.chave_em),
    ficha: lerFicha(o.ficha),
    captadorId: sn(o.captador_id),
    docsCompletosEm: sn(o.docs_completos_em),
  };
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
  diaPagamento16a31: 6,
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
    diaPagamento1a15: num("dia_pagamento_1a15", 8),
    diaPagamento16a31: num("dia_pagamento_16a31", 6),
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

export function calcularComissao(
  l: Pick<Locacao, "aluguel" | "taxaAdm" | "parceria">,
  cfg: ConfigLocacao,
): CalculoComissao {
  const pct = pctPorTaxa(l.taxaAdm, cfg.tabelaTaxa);
  const divide = l.parceria && cfg.parceriaDividePorDois;
  const base = divide ? l.aluguel / 2 : l.aluguel;
  const totalLado = centavos((base * pct) / 100);
  const temCoord = !l.parceria || cfg.coordenadorNaParceria;
  const coordenador = temCoord ? centavos((totalLado * cfg.pctCoordenador) / 100) : 0;
  const corretor = cfg.coordenadorSaiDoCorretor ? centavos(totalLado - coordenador) : totalLado;
  const parceiro = divide ? centavos(((l.aluguel / 2) * pct) / 100) : 0;
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

/** Serviços aplicáveis sem protocolo. Vazio = titularidade ok. Só ALERTA (não bloqueia a comissão). */
export function titularidadePendente(tit: Titularidade): string[] {
  return SERVICOS.filter((x) => tit[x.key].aplica && !tit[x.key].protocolo).map((x) =>
    x.key.toUpperCase(),
  );
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
// Pré-análise: o que falta para enviar (o banco repete a regra).
export function faltasPreAnalise(l: Pick<Locacao, "candidato" | "endereco" | "aluguel">): string[] {
  const f: string[] = [];
  if (!/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(l.candidato.cpf.trim())) f.push("CPF");
  if (l.candidato.nome.trim().length < 5) f.push("nome completo");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.candidato.nascimento)) f.push("data de nascimento");
  if (l.candidato.telefone.replace(/\D/g, "").length < 10) f.push("telefone");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.candidato.email.trim())) f.push("e-mail");
  if (l.endereco.trim().length < 8) f.push("endereço do imóvel");
  if (!(l.aluguel > 0)) f.push("aluguel");
  return f;
}

export function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  { key: "seguro_fianca", label: GARANTIA_LABEL.seguro_fianca },
  { key: "proprietario", label: "Proprietário" },
  // t_28e583e2: listas PJ (formulários reais de 10/11). Fiador PJ sem lista → usa a do fiador.
  { key: "locatario_pj", label: "Locatário PJ" },
  { key: "fiador_pj", label: "Fiador PJ" },
  { key: "proprietario_pj", label: "Proprietário PJ" },
];

export function docsParaTexto(docs: Record<string, string[]>): string {
  // Grupos PJ só aparecem quando a imobiliária tem a lista (o banco já devolve as PJ padrão).
  return GRUPOS_DOC.filter((g) => !g.key.endsWith("_pj") || g.key in docs)
    .map((g) => `[${g.label}]\n${(docs[g.key] ?? []).join("\n")}`)
    .join("\n\n");
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
  return out;
}

export const EXTENSOES_DOC = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
export const TAMANHO_MAX_DOC = 16 * 1024 * 1024;

/** Extensão aceita do arquivo escolhido (ou null). O bucket repete o limite de tipo e tamanho. */
export function extensaoDoc(nome: string): (typeof EXTENSOES_DOC)[number] | null {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  return (EXTENSOES_DOC as readonly string[]).includes(ext)
    ? (ext as (typeof EXTENSOES_DOC)[number])
    : null;
}
