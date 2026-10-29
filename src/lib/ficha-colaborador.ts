/**
 * Ficha pessoal e de emergência do colaborador (t_618b64bc, pedido de Denis em 29/10/2026).
 *
 * Regras (o banco é a autoridade; aqui só a tela):
 * - vale para todos que acessam o sistema; todos os campos são obrigatórios, menos religião;
 * - ANTES da data de obrigatoriedade (ficha_config por imobiliária; padrão 30/10/2026 01:30 em
 *   São Paulo) a tela aparece ao logar com "Preencher depois"; DEPOIS dela, só libera ao salvar.
 *   Quem decide "bloqueia" é a RPC ficha_minha_situacao, com o relógio do banco — nunca o
 *   relógio do navegador;
 * - visão da plataforma, "Entrar como" e dono da plataforma não veem a tela (o banco devolve
 *   aplica=false e recusa ler/gravar a ficha nessas sessões).
 */

export type FichaDados = {
  qtd_filhos: number;
  tem_plano_saude: boolean;
  plano_saude: string | null;
  emergencia_nome: string;
  emergencia_parentesco: string;
  emergencia_telefone: string;
  hospital_preferencia: string;
  religiao: string | null;
  aceite_em?: string | null;
  preenchida_em?: string | null;
  updated_at?: string | null;
};

export type SituacaoFicha =
  | { aplica: false; motivo?: string }
  | {
      aplica: true;
      completa: boolean;
      obrigatoria_a_partir_de: string;
      bloqueia: boolean;
      data_nascimento: string | null;
      ficha: FichaDados | null;
    };

export type ModoFicha = "bloqueio" | "lembrete" | null;

/**
 * O que a tela faz ao logar:
 * - "bloqueio": prazo vencido (decidido no banco) e ficha incompleta → só sai salvando (ou Sair);
 * - "lembrete": ficha incompleta antes do prazo → mostra a tela com "Preencher depois";
 * - null: ficha completa, não se aplica, ou adiada neste mesmo login.
 */
export function modoFicha(
  situacao: SituacaoFicha | null | undefined,
  adiadaNesteLogin: boolean,
): ModoFicha {
  if (!situacao || !situacao.aplica || situacao.completa) return null;
  if (situacao.bloqueia) return "bloqueio";
  return adiadaNesteLogin ? null : "lembrete";
}

/** Chave do "Preencher depois" no navegador (guarda o session_id do login em que foi adiado). */
export function chaveFichaAdiada(userId: string): string {
  return `max:ficha-colaborador-adiada:${userId}`;
}

// ------------------------------------------------------------------------------------------------
// Formulário

export type FichaForm = {
  data_nascimento: string;
  qtd_filhos: string;
  tem_plano_saude: "" | "sim" | "nao";
  plano_saude: string;
  emergencia_nome: string;
  emergencia_parentesco: string;
  emergencia_telefone: string;
  hospital_preferencia: string;
  religiao: string;
  ciente: boolean;
};

export type CampoFicha = keyof FichaForm;

export const CAMPO_FICHA_LABEL: Record<CampoFicha, string> = {
  data_nascimento: "Data de nascimento",
  qtd_filhos: "Quantidade de filhos",
  tem_plano_saude: "Tem plano de saúde?",
  plano_saude: "Qual plano de saúde",
  emergencia_nome: "Nome do contato de emergência",
  emergencia_parentesco: "Parentesco",
  emergencia_telefone: "Telefone do contato de emergência",
  hospital_preferencia: "Hospital de preferência",
  religiao: "Religião",
  ciente: "Ciência do aviso de uso dos dados",
};

export const RELIGIOES = [
  "Católica",
  "Evangélica",
  "Adventista do Sétimo Dia",
  "Espírita",
  "Umbanda ou Candomblé",
  "Judaica",
  "Sem religião",
  "Prefiro não informar",
] as const;

export const AVISO_FINALIDADE =
  "Usamos estes dados só em caso de emergência (avisar seu contato e levar você ao hospital de preferência) e para a gestão de pessoas da imobiliária. Quem vê: você e o staff/administração da imobiliária. Gestores, líderes e colegas não veem. A religião é opcional e serve só para conhecimento da empresa.";

export function formVazio(): FichaForm {
  return {
    data_nascimento: "",
    qtd_filhos: "",
    tem_plano_saude: "",
    plano_saude: "",
    emergencia_nome: "",
    emergencia_parentesco: "",
    emergencia_telefone: "",
    hospital_preferencia: "",
    religiao: "",
    ciente: false,
  };
}

export function formDaSituacao(s: SituacaoFicha | null | undefined): FichaForm {
  const f = formVazio();
  if (!s || !s.aplica) return f;
  f.data_nascimento = s.data_nascimento ?? "";
  const d = s.ficha;
  if (!d) return f;
  return {
    ...f,
    qtd_filhos: String(d.qtd_filhos),
    tem_plano_saude: d.tem_plano_saude ? "sim" : "nao",
    plano_saude: d.plano_saude ?? "",
    emergencia_nome: d.emergencia_nome ?? "",
    emergencia_parentesco: d.emergencia_parentesco ?? "",
    emergencia_telefone: d.emergencia_telefone ?? "",
    hospital_preferencia: d.hospital_preferencia ?? "",
    religiao: d.religiao ?? "",
    // Quem já salvou já deu ciência; no Meu perfil a caixinha vem marcada.
    ciente: Boolean(d.aceite_em),
  };
}

const limpo = (t: string) => t.trim().replace(/\s+/g, " ");

export function telefoneEmergenciaValido(t: string): boolean {
  const v = t.trim();
  const dig = v.replace(/\D/g, "").length;
  return dig >= 10 && dig <= 13 && v.length <= 20 && /^[0-9()+\-. ]+$/.test(v);
}

/** Campos com problema (mesmas regras do banco; o banco valida de novo ao salvar). */
export function camposFichaFaltando(
  f: FichaForm,
  validarNascimento: (d: string) => string | null,
): CampoFicha[] {
  const falta: CampoFicha[] = [];
  if (validarNascimento(f.data_nascimento)) falta.push("data_nascimento");
  const filhos = f.qtd_filhos.trim();
  if (!/^\d{1,2}$/.test(filhos) || Number(filhos) > 30) falta.push("qtd_filhos");
  if (f.tem_plano_saude === "") falta.push("tem_plano_saude");
  if (f.tem_plano_saude === "sim") {
    const p = limpo(f.plano_saude);
    if (p.length < 2 || p.length > 120) falta.push("plano_saude");
  }
  const en = limpo(f.emergencia_nome);
  if (en.length < 2 || en.length > 120) falta.push("emergencia_nome");
  const ep = limpo(f.emergencia_parentesco);
  if (ep.length < 2 || ep.length > 60) falta.push("emergencia_parentesco");
  if (!telefoneEmergenciaValido(f.emergencia_telefone)) falta.push("emergencia_telefone");
  const h = limpo(f.hospital_preferencia);
  if (h.length < 2 || h.length > 160) falta.push("hospital_preferencia");
  if (limpo(f.religiao).length > 60) falta.push("religiao");
  if (!f.ciente) falta.push("ciente");
  return falta;
}

/** Parâmetros da RPC ficha_salvar_minha (só chamar depois de camposFichaFaltando vazio). */
export function paramsSalvarFicha(f: FichaForm) {
  const temPlano = f.tem_plano_saude === "sim";
  const rel = limpo(f.religiao);
  return {
    _qtd_filhos: Number(f.qtd_filhos.trim()),
    _tem_plano_saude: temPlano,
    _plano_saude: temPlano ? limpo(f.plano_saude) : null,
    _emergencia_nome: limpo(f.emergencia_nome),
    _emergencia_parentesco: limpo(f.emergencia_parentesco),
    _emergencia_telefone: f.emergencia_telefone.trim(),
    _hospital_preferencia: limpo(f.hospital_preferencia),
    _religiao: rel || null,
    _data_nascimento: f.data_nascimento,
    _ciente: f.ciente,
  };
}

/** Mensagem amigável a partir do erro da RPC (o banco manda texto sem acento). */
export function mensagemErroFicha(err: { code?: string; message?: string } | null): string {
  const msg = err?.message ?? "";
  if (err?.code === "22023") {
    const mapa: [RegExp, string][] = [
      [/aviso/i, "Confirme que leu o aviso de uso dos dados."],
      [/filhos/i, "Quantidade de filhos inválida."],
      [/qual e o plano/i, "Informe qual é o plano de saúde."],
      [/tem plano/i, "Informe se tem plano de saúde."],
      [/nome do contato/i, "Informe o nome do contato de emergência."],
      [/parentesco/i, "Informe o parentesco do contato de emergência."],
      [/telefone/i, "Telefone de emergência inválido (use DDD)."],
      [/hospital/i, "Informe o hospital de preferência."],
      [/religiao/i, "Religião muito longa."],
      [/nascimento/i, "Data de nascimento inválida (é preciso ter 16 anos ou mais)."],
    ];
    for (const [re, txt] of mapa) if (re.test(msg)) return txt;
  }
  if (err?.code === "42501") return "Sem permissão para salvar esta ficha.";
  return "Não foi possível salvar agora. Tente de novo.";
}

// ------------------------------------------------------------------------------------------------
// Tela do staff "Ficha dos colaboradores"

export type Colaborador = {
  user_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  papeis: string[];
  equipes: string[];
  data_nascimento: string | null;
  completa: boolean;
  qtd_filhos: number | null;
  tem_plano_saude: boolean | null;
  plano_saude: string | null;
  emergencia_nome: string | null;
  emergencia_parentesco: string | null;
  emergencia_telefone: string | null;
  hospital_preferencia: string | null;
  religiao: string | null;
  preenchida_em: string | null;
  updated_at: string | null;
};

export const TODOS = "__todos__";
export const NAO_INFORMADO = "__nao_informado__";

export type FiltrosFicha = {
  busca: string;
  /** Mês de aniversário (1..12) inicial e final; período pode virar o ano (ex.: 11 → 2). */
  mesDe: number | null;
  mesAte: number | null;
  temPlano: typeof TODOS | "sim" | "nao";
  plano: string;
  filhos: string;
  religiao: string;
  hospital: string;
  situacao: typeof TODOS | "completa" | "pendente";
  papel: string;
  equipe: string;
};

export function filtrosVazios(): FiltrosFicha {
  return {
    busca: "",
    mesDe: null,
    mesAte: null,
    temPlano: TODOS,
    plano: TODOS,
    filhos: TODOS,
    religiao: TODOS,
    hospital: TODOS,
    situacao: TODOS,
    papel: TODOS,
    equipe: TODOS,
  };
}

/** Mês (1..12) da data AAAA-MM-DD, sem passar por Date (evita erro de fuso). */
export function mesDaData(d: string | null | undefined): number | null {
  const m = /^\d{4}-(\d{2})-\d{2}/.exec(d ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

export function mesNoPeriodo(mes: number, de: number | null, ate: number | null): boolean {
  if (de == null && ate == null) return true;
  const a = de ?? ate!;
  const b = ate ?? de!;
  return a <= b ? mes >= a && mes <= b : mes >= a || mes <= b;
}

const norm = (t: string | null | undefined) =>
  (t ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

export function faixaFilhos(n: number | null): string {
  if (n == null) return NAO_INFORMADO;
  return n >= 3 ? "3+" : String(n);
}

export function filtrarColaboradores(lista: Colaborador[], f: FiltrosFicha): Colaborador[] {
  const busca = norm(f.busca);
  return lista.filter((c) => {
    if (busca && !norm(c.nome).includes(busca) && !norm(c.email).includes(busca)) return false;
    if (f.mesDe != null || f.mesAte != null) {
      const mes = mesDaData(c.data_nascimento);
      if (mes == null || !mesNoPeriodo(mes, f.mesDe, f.mesAte)) return false;
    }
    if (f.temPlano === "sim" && c.tem_plano_saude !== true) return false;
    if (f.temPlano === "nao" && c.tem_plano_saude !== false) return false;
    if (f.plano !== TODOS && norm(c.plano_saude) !== norm(f.plano)) return false;
    if (f.filhos !== TODOS && faixaFilhos(c.qtd_filhos) !== f.filhos) return false;
    if (f.religiao !== TODOS) {
      if (
        f.religiao === NAO_INFORMADO ? Boolean(c.religiao) : norm(c.religiao) !== norm(f.religiao)
      )
        return false;
    }
    if (f.hospital !== TODOS && norm(c.hospital_preferencia) !== norm(f.hospital)) return false;
    if (f.situacao === "completa" && !c.completa) return false;
    if (f.situacao === "pendente" && c.completa) return false;
    if (f.papel !== TODOS && !c.papeis.includes(f.papel)) return false;
    if (f.equipe !== TODOS && !c.equipes.includes(f.equipe)) return false;
    return true;
  });
}

/** Valores distintos (sem diferenciar acento/maiúscula), em ordem alfabética, para os filtros. */
export function opcoesDistintas(valores: (string | null | undefined)[]): string[] {
  const vistos = new Map<string, string>();
  for (const v of valores) {
    const t = (v ?? "").trim();
    if (t && !vistos.has(norm(t))) vistos.set(norm(t), t);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** AAAA-MM-DD → DD/MM/AAAA. */
export function dataBr(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** Data/hora no fuso de São Paulo (para mostrar o prazo e "preenchida em"). */
export function dataHoraSp(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(t));
}

/** Valor para <input type="datetime-local"> no fuso de São Paulo. */
export function isoParaInputSp(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
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
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/**
 * "AAAA-MM-DDTHH:MM" digitado (horário de São Paulo) → ISO com fuso -03:00.
 * shortcut: São Paulo está sem horário de verão desde 2019; se voltar, trocar por cálculo de fuso.
 */
export function inputSpParaIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return `${v}:00-03:00`;
}

export function rotuloPapeis(papeis: string[], labels: Record<string, string>): string {
  return papeis.map((p) => labels[p] ?? p).join(", ");
}

/** Linhas para Excel/PDF (mesma ordem de colunas nos dois). */
export const COLUNAS_EXPORT = [
  "Nome",
  "E-mail",
  "Papel",
  "Equipe",
  "Nascimento",
  "Ficha",
  "Filhos",
  "Tem plano",
  "Plano de saúde",
  "Hospital de preferência",
  "Contato de emergência",
  "Parentesco",
  "Telefone de emergência",
  "Religião",
  "Preenchida em",
] as const;

export function linhaExport(c: Colaborador, labels: Record<string, string>): string[] {
  return [
    c.nome,
    c.email ?? "",
    rotuloPapeis(c.papeis, labels),
    c.equipes.join(", "),
    dataBr(c.data_nascimento),
    c.completa ? "Completa" : "Pendente",
    c.qtd_filhos == null ? "" : String(c.qtd_filhos),
    c.tem_plano_saude == null ? "" : c.tem_plano_saude ? "Sim" : "Não",
    c.plano_saude ?? "",
    c.hospital_preferencia ?? "",
    c.emergencia_nome ?? "",
    c.emergencia_parentesco ?? "",
    c.emergencia_telefone ?? "",
    c.religiao ?? "",
    dataHoraSp(c.preenchida_em),
  ];
}

/** Resumo do filtro aplicado, em texto, para o cabeçalho do PDF. */
export function descreverFiltros(f: FiltrosFicha, labels: Record<string, string>): string {
  const partes: string[] = [];
  if (f.mesDe != null || f.mesAte != null) {
    const a = MESES[(f.mesDe ?? f.mesAte!) - 1];
    const b = MESES[(f.mesAte ?? f.mesDe!) - 1];
    partes.push(a === b ? `Aniversário em ${a}` : `Aniversário de ${a} a ${b}`);
  }
  if (f.temPlano !== TODOS) partes.push(f.temPlano === "sim" ? "Com plano" : "Sem plano");
  if (f.plano !== TODOS) partes.push(`Plano: ${f.plano}`);
  if (f.filhos !== TODOS)
    partes.push(f.filhos === NAO_INFORMADO ? "Filhos: não informado" : `Filhos: ${f.filhos}`);
  if (f.religiao !== TODOS)
    partes.push(
      f.religiao === NAO_INFORMADO ? "Religião: não informada" : `Religião: ${f.religiao}`,
    );
  if (f.hospital !== TODOS) partes.push(`Hospital: ${f.hospital}`);
  if (f.situacao !== TODOS)
    partes.push(f.situacao === "completa" ? "Fichas completas" : "Fichas pendentes");
  if (f.papel !== TODOS) partes.push(`Papel: ${labels[f.papel] ?? f.papel}`);
  if (f.equipe !== TODOS) partes.push(`Equipe: ${f.equipe}`);
  if (f.busca.trim()) partes.push(`Busca: "${f.busca.trim()}"`);
  return partes.length ? partes.join(" · ") : "Sem filtros (todos os colaboradores)";
}
