/**
 * Módulo "Agendar fotos" (t_d86ab990 / t_ee532309): tipos e regras puras das telas.
 * A proteção real fica no banco (RPCs photo_* da migration 20261105120000).
 */

export type StatusVoucher = "disponivel" | "agendado" | "usado" | "vencido";
export type StatusSessao = "aguardando" | "confirmada" | "feita" | "cancelada" | "recusada";

export type Voucher = {
  id: string;
  mes_ref: string;
  seq: number;
  gerado_em: string;
  vence_em: string;
  status: StatusVoucher;
  sessao_id: string | null;
  imovel: string | null;
};

export type ImovelFoto = {
  id: string;
  imovel: string;
  tem_sessao_aberta: boolean;
  voucher_ja_usado: boolean;
};

export type SessaoFoto = {
  id: string;
  inicio: string;
  fim: string;
  status: StatusSessao;
  paga_por: "imobiliaria" | "corretor";
  voucher_id: string | null;
  capture_id: string;
  corretor_id: string;
  corretor_nome: string | null;
  corretor_telefone: string | null;
  imovel: string | null;
  endereco: string | null;
  valor_congelado: number | null;
  cobranca_status: "a_cobrar" | "cobrado" | null;
  cobrado_em: string | null;
  feita_em: string | null;
  cancelada_em: string | null;
  cancelada_papel: "corretor" | "fotografo" | "admin" | null;
  motivo_cancelamento: string | null;
};

export type ResumoFotos = {
  hoje: string;
  eh_fotografo: boolean;
  eh_admin: boolean;
  eh_financeiro: boolean;
  fotografo_nome: string | null;
  fotografo_id: string | null;
  valor_sessao: number;
  mes: { mes_ref: string; assinadas: number; meta: number; faltam: number; vence_em: string };
  bloqueado_ate: string | null;
  desmarcacoes_30d: number;
  vouchers: Voucher[];
  imoveis: ImovelFoto[];
  minhas_sessoes: SessaoFoto[];
};

export type FaixaAgenda = { id: string; tipo: "livre" | "bloqueio"; inicio: string; fim: string };
export type AgendaFotografo = { faixas: FaixaAgenda[]; sessoes: SessaoFoto[] };

export type FinanceiroFotos = {
  mes_ref: string;
  remax: SessaoFoto[];
  remax_total: number;
  a_cobrar: SessaoFoto[];
  a_cobrar_total: number;
};

const TZ = "America/Sao_Paulo";
const FMT_QUANDO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const FMT_DIA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
});
const FMT_CHAVE_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "qua., 12/11, 09:00" no horário de Brasília. */
export const quando = (iso: string) => FMT_QUANDO.format(new Date(iso));
export const hora = (iso: string) => FMT_HORA.format(new Date(iso));
export const diaLongo = (iso: string) => FMT_DIA.format(new Date(iso));
/** Data civil (YYYY-MM-DD) em São Paulo de um instante. */
export const chaveDia = (iso: string) => FMT_CHAVE_DIA.format(new Date(iso));
export const dinheiro = (v: number | null | undefined) => BRL.format(Number(v ?? 0));
/** "2026-02-28" → "28/02/2026" (coluna date, sem fuso). */
export const dataCurta = (d: string) => d.slice(0, 10).split("-").reverse().join("/");

export const ROTULO_VOUCHER: Record<StatusVoucher, string> = {
  disponivel: "Disponível",
  agendado: "Agendado",
  usado: "Usado",
  vencido: "Vencido",
};

export const ROTULO_SESSAO: Record<StatusSessao, string> = {
  aguardando: "Aguardando confirmação",
  confirmada: "Confirmada",
  feita: "Feita",
  cancelada: "Desmarcada",
  recusada: "Recusada",
};

/** Cor do selo de cada status (mesmos tons de components/visual/base). */
export const TOM_SESSAO: Record<StatusSessao, "amber" | "blue" | "green" | "slate" | "red"> = {
  aguardando: "amber",
  confirmada: "blue",
  feita: "green",
  cancelada: "slate",
  recusada: "red",
};

/** Barra "x de 3" do mês (não passa de 100%). Depois da meta, cada captação a mais dá +1 voucher. */
export function progressoMeta(m: { assinadas: number; meta: number }) {
  const meta = Math.max(1, m.meta);
  const feitas = Math.max(0, m.assinadas);
  const faltam = Math.max(0, meta - feitas);
  return {
    texto: `${Math.min(feitas, meta)} de ${meta}`,
    pct: Math.round((Math.min(feitas, meta) / meta) * 100),
    batida: feitas >= meta,
    extras: Math.max(0, feitas - meta),
    frase:
      faltam > 0
        ? `Falta${faltam > 1 ? "m" : ""} ${faltam} captaç${faltam > 1 ? "ões" : "ão"} assinada${faltam > 1 ? "s" : ""} este mês para ganhar 3 vouchers.`
        : `Meta do mês batida! Cada nova captação assinada este mês vale +1 voucher.`,
  };
}

/** Vouchers que podem ser usados numa sessão no dia `dia` (YYYY-MM-DD), do que vence antes. */
export function vouchersUsaveis(vouchers: Voucher[], dia: string | null): Voucher[] {
  return vouchers
    .filter((v) => v.status === "disponivel" && (!dia || dia <= v.vence_em))
    .sort((a, b) => a.vence_em.localeCompare(b.vence_em) || a.mes_ref.localeCompare(b.mes_ref));
}

export function contarVouchers(vouchers: Voucher[]) {
  const c = { disponivel: 0, agendado: 0, usado: 0, vencido: 0 } as Record<StatusVoucher, number>;
  for (const v of vouchers) c[v.status]++;
  return c;
}

/** Horários livres agrupados por dia (data de São Paulo), na ordem. */
export function agruparPorDia(horarios: string[]): { dia: string; horarios: string[] }[] {
  const mapa = new Map<string, string[]>();
  for (const h of [...horarios].sort()) {
    const k = chaveDia(h);
    mapa.set(k, [...(mapa.get(k) ?? []), h]);
  }
  return [...mapa.entries()].map(([dia, hs]) => ({ dia, horarios: hs }));
}

/**
 * Pontinho azul no dia verde que já tem reserva (Denis 05/11). Para tirar, troque para false.
 */
export const PONTO_AZUL_DIA_COM_RESERVA = true;

/**
 * Cores do calendário do Agendar fotos (regra de Denis 05/11):
 * - verde ("disponivel"): o fotógrafo liberou horário e ainda sobra horário livre;
 * - azul ("reservado"): tem reserva e não sobra nenhum horário livre;
 * - sem cor: nada liberado (não dá para reservar).
 * Dia verde que também tem reserva ganha o pontinho azul ("comIndicadorReserva").
 * `livres` = inícios livres (ISO); `reservas` = inícios das sessões ativas (ISO).
 */
export function coresCalendarioFotos(
  livres: string[],
  reservas: string[],
  pontoAzul = PONTO_AZUL_DIA_COM_RESERVA,
): { disponivel: string[]; reservado: string[]; comIndicadorReserva: string[] } {
  const diasLivres = new Set(livres.map(chaveDia));
  const diasReserva = new Set(reservas.map(chaveDia));
  const ordenar = (s: Iterable<string>) => [...s].sort();
  return {
    disponivel: ordenar(diasLivres),
    reservado: ordenar([...diasReserva].filter((d) => !diasLivres.has(d))),
    comIndicadorReserva: pontoAzul
      ? ordenar([...diasReserva].filter((d) => diasLivres.has(d)))
      : [],
  };
}

/** Sessão que ocupa o horário do fotógrafo (aguardando ou confirmada). */
export const sessaoAtiva = (s: SessaoFoto) =>
  s.status === "aguardando" || s.status === "confirmada";

/** O imóvel pode receber agendamento? E com voucher? (o banco repete as regras). */
export function situacaoImovel(i: ImovelFoto | undefined) {
  if (!i) return { pode: false, comVoucher: false, motivo: "Escolha um imóvel captado por você." };
  if (i.tem_sessao_aberta)
    return { pode: false, comVoucher: false, motivo: "Este imóvel já tem uma sessão marcada." };
  if (i.voucher_ja_usado)
    return {
      pode: true,
      comVoucher: false,
      motivo: "Este imóvel já usou um voucher (1 por imóvel). Pode agendar sem voucher.",
    };
  return { pode: true, comVoucher: true, motivo: null };
}

/** Sessões abertas (aguardando/confirmada) primeiro, depois as demais, mais recentes no topo. */
export function ordenarSessoes(s: SessaoFoto[]): SessaoFoto[] {
  const aberta = (x: SessaoFoto) => x.status === "aguardando" || x.status === "confirmada";
  return [...s].sort((a, b) => {
    if (aberta(a) !== aberta(b)) return aberta(a) ? -1 : 1;
    return aberta(a) ? a.inicio.localeCompare(b.inicio) : b.inicio.localeCompare(a.inicio);
  });
}

/** Mensagem do banco → texto para a pessoa (as RPCs escrevem sem acento). */
export function mensagemErroFoto(e: unknown, padrao: string): string {
  const msg =
    e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (!msg) return padrao;
  const mapa: [RegExp, string][] = [
    [/bloqueado ate (.+?) \(/i, "Agendamento bloqueado até $1 (3 desmarcações em 30 dias)."],
    [
      /Horario indisponivel/i,
      "Horário indisponível (sessão de 2 h + 1 h de intervalo). Escolha outro.",
    ],
    [/fora da agenda liberada/i, "Esse horário não está liberado na agenda do fotógrafo."],
    [/ja usou um voucher/i, "Este imóvel já usou um voucher (1 por imóvel)."],
    [/ja tem uma sessao marcada/i, "Este imóvel já tem uma sessão marcada."],
    [/validade do voucher/i, "A sessão precisa ser dentro da validade do voucher."],
    [/captado por voce/i, "Só é possível agendar fotos de imóvel captado por você."],
    [/nao escolheu o fotografo/i, "A imobiliária ainda não escolheu o fotógrafo."],
    [/Modulo Agendar fotos desligado/i, "O módulo Agendar fotos está desligado nesta imobiliária."],
    [/staff ativo/i, "O fotógrafo precisa ser um usuário staff ativo desta imobiliária."],
    [/ainda nao comecou/i, "A sessão ainda não começou."],
  ];
  for (const [re, txt] of mapa) {
    const m = msg.match(re);
    if (m) return txt.replace("$1", m[1] ?? "");
  }
  return padrao;
}

/** "2026-11-12" + "09:00" → ISO com o fuso de Brasília (-03:00, sem horário de verão). */
export function isoSaoPaulo(dia: string, horaMin: string): string {
  return `${dia}T${horaMin}:00-03:00`;
}

/** Soma dias a uma data civil YYYY-MM-DD. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
