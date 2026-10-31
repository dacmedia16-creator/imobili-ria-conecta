import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { AgingBadge } from "@/components/AgingBadge";
import {
  ESTEIRA_AGING_LIMITES,
  ESTEIRA_FILTER,
  ESTEIRA_STATUSES,
  VENDIDOS_FILTER,
  VENDIDOS_STATUSES,
  STATUS_LABEL,
  VEZ_DE_AGIR_LABEL,
  proximoResponsavelRoles,
  statusDaVezDeAgir,
  vezDeAgir,
  type SaleStatus,
  type VezDeAgir,
} from "@/lib/status";
import { canDeleteSale } from "@/lib/permissions";
import { excluirVenda } from "@/lib/excluir-venda.functions";
import { fetchLedMemberIds } from "@/lib/team";
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  ChevronRight,
  House,
  Info,
  Plus,
  Trash2,
  SlidersHorizontal,
  ChevronDown,
  FileText,
} from "lucide-react";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/visual/base";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { periodoInicialVendas, periodoMesAnterior, periodoMesAtual } from "@/lib/vendas-periodo";
import {
  aplicarFiltrosEfetivacao,
  calcularResumo,
  filtrosPadraoFinanceiro,
} from "@/lib/financeiro-dashboard-calc";
import { fetchFinanceiroBundle } from "@/lib/financeiro-dashboard-query";
import { resolverResumoOpcional } from "@/lib/vendas-resumo";
import { criarCacheConsultas, ehErroDePermissao, type CacheConsultas } from "@/lib/cache-consultas";
import { fetchVendasComerciaisPaginadas } from "@/lib/vendas-comerciais-query";
import { registrarVendaAction } from "@/lib/registrar-venda";
import { corretoresDaLinha, responsaveisDaLinha } from "@/lib/sale-permissions";
import type { SaleRow } from "@/lib/database.types";
import { errorMessage } from "@/lib/errors";
import {
  MIDIA_FILTER_OPTIONS,
  fetchSaleIdsPorMidia,
  filtrarPorSaleIds,
  midiaFilterParam,
  midiaFilterValido,
} from "@/lib/vendas-midia-filtro";
import {
  PAGAMENTO_FILTER_OPTIONS,
  fetchSelecaoPorPagamento,
  filtrarPorPagamento,
  pagamentoFilterParam,
  pagamentoFilterValido,
} from "@/lib/vendas-pagamento-filtro";
import { FinanciadaBadge } from "@/components/FinanciadaBadge";
import { datasDaVendaNaLista, type DatasVendaLista } from "@/lib/vendas-lista-datas";

/** "Criada em …" + "Assinada em …" / "Ainda não assinada" (legenda de cada data). */
function DatasVendaLegenda({ datas, className }: { datas: DatasVendaLista; className?: string }) {
  return (
    <div className={className}>
      <div>Criada em {datas.criadaEm ?? "—"}</div>
      <div>{datas.assinadaEm ? `Assinada em ${datas.assinadaEm}` : "Ainda não assinada"}</div>
    </div>
  );
}

type RawSale = Pick<
  SaleRow,
  | "id"
  | "status"
  | "valor_negociado"
  | "imovel_id"
  | "codigo_interno"
  | "corretor_captador"
  | "corretor_vendedor"
  | "updated_at"
  | "created_at"
  | "corretor_id"
  | "modalidade"
  | "data_assinatura"
>;
type SalesListRow = RawSale & {
  data_venda: string;
  corretores_ids?: string[] | null;
  pagamento_tipo?: string | null;
  pagamento_banco?: string | null;
  pagamento_correspondente?: string | null;
  pagamento_oba?: boolean | null;
};

/** Nomes dos corretores participantes (não de quem cadastrou a venda). */
function nomesCorretores(s: SalesListRow, profileName: Record<string, string>): string {
  return corretoresDaLinha(s)
    .map((id) => profileName[id] ?? "—")
    .join(", ");
}
function nomesLideres(
  s: SalesListRow,
  profileName: Record<string, string>,
  liderIdByCorretor: Record<string, string>,
): string {
  const ids = [
    ...new Set(
      corretoresDaLinha(s)
        .map((id) => liderIdByCorretor[id])
        .filter(Boolean),
    ),
  ];
  return ids.map((id) => profileName[id] ?? "—").join(", ");
}

const brl0 = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const Route = createFileRoute("/_authenticated/vendas/")({
  head: () => ({ meta: [{ title: "Vendas" }] }),
  component: SalesList,
});

const PAGE_SIZE = 10;
/** Ordenação escolhida na tabela (sem escolha = ordem padrão da consulta). */
type Ordem = { campo: "valor" | "dias"; dir: "asc" | "desc" };
/** Espera depois da última troca de filtro/tecla antes de consultar o banco. */
export const FILTRO_DEBOUNCE_MS = 400;
/** Validade do pacote financeiro do resumo dentro da mesma abertura da tela. */
const RESUMO_CACHE_MS = 60_000;
const SALES_LIST_STATE_KEY = "adm-max:vendas-list-state";
const SALES_LIST_RESTORE_KEY = "adm-max:vendas-list-restore";
type SalesListState = {
  statusFilter: string;
  vezFilter: string;
  diasFilter: number | null;
  dataDe: string;
  dataAte: string;
  q: string;
  soMinhaVez: boolean;
  equipeFilter: string;
  midiaFilter: string;
  pagamentoFilter: string;
};

function markSalesListForReturn() {
  try {
    window.sessionStorage.setItem(SALES_LIST_RESTORE_KEY, "1");
  } catch {
    // A navegação continua funcionando mesmo quando o navegador bloqueia o armazenamento.
  }
}

function readSalesListState(): Partial<SalesListState> | null {
  if (typeof window === "undefined") return null;
  try {
    if (window.sessionStorage.getItem(SALES_LIST_RESTORE_KEY) !== "1") return null;
    window.sessionStorage.removeItem(SALES_LIST_RESTORE_KEY);
    const raw = window.sessionStorage.getItem(SALES_LIST_STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<SalesListState>) : null;
  } catch {
    return null;
  }
}

// Lê apenas parâmetros conhecidos; valores inválidos não alteram a consulta nem o estado salvo.
function readSalesFiltersFromUrl(): Partial<SalesListState> | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("filtros")) return null;
  const result: Partial<SalesListState> = {};
  const status = params.get("status");
  if (
    status &&
    (status === "todas" ||
      status === ESTEIRA_FILTER ||
      status === VENDIDOS_FILTER ||
      status in STATUS_LABEL)
  )
    result.statusFilter = status;
  const vez = params.get("vez");
  if (vez && (vez === "todas" || vez in VEZ_DE_AGIR_LABEL)) result.vezFilter = vez;
  const validDate = (value: string | null) =>
    value !== null &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (validDate(params.get("de"))) result.dataDe = params.get("de")!;
  if (validDate(params.get("ate"))) result.dataAte = params.get("ate")!;
  if (params.get("de") === "") result.dataDe = "";
  if (params.get("ate") === "") result.dataAte = "";
  if (params.has("q")) result.q = (params.get("q") ?? "").slice(0, 200);
  if (params.get("minhaVez") === "1") result.soMinhaVez = true;
  const equipe = params.get("equipe");
  if (equipe && /^[0-9a-f-]{36}$/i.test(equipe)) result.equipeFilter = equipe;
  const midia = params.get("midia");
  if (midiaFilterValido(midia)) result.midiaFilter = midia;
  const pagamento = params.get("pagamento");
  if (pagamentoFilterValido(pagamento)) result.pagamentoFilter = pagamento;
  return result;
}

function SalesList() {
  const { user, roles, hasAny } = useAuth();
  const router = useRouter();
  const periodoInicialRef = useRef(periodoInicialVendas());
  const [savedListState] = useState(() => readSalesFiltersFromUrl() ?? readSalesListState());
  const [sales, setSales] = useState<SalesListRow[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(0);
  const [stageSince, setStageSince] = useState<Record<string, string>>({});
  // Vendas com ao menos um contrato_assinado no histórico (legenda "Assinada em" da lista).
  const [assinadasHist, setAssinadasHist] = useState<Record<string, true>>({});
  const [statusFilter, setStatusFilter] = useState<string>(savedListState?.statusFilter ?? "todas");
  const [vezFilter, setVezFilter] = useState<string>(savedListState?.vezFilter ?? "todas");
  const [diasFilter, setDiasFilter] = useState<number | null>(savedListState?.diasFilter ?? null);
  const [dataDe, setDataDe] = useState(savedListState?.dataDe ?? periodoInicialRef.current.de);
  const [dataAte, setDataAte] = useState(savedListState?.dataAte ?? periodoInicialRef.current.ate);
  const [q, setQ] = useState(savedListState?.q ?? "");
  const [loading, setLoading] = useState(true);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<SalesListRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [totalValor, setTotalValor] = useState(0);
  const [contratosAssinadosCount, setContratosAssinadosCount] = useState(0);
  const [contratosAssinadosValor, setContratosAssinadosValor] = useState(0);
  const [efetivadasValorCheio, setEfetivadasValorCheio] = useState(0);
  const [efetivadasComParceria, setEfetivadasComParceria] = useState(0);
  const [parceriaValorCheio, setParceriaValorCheio] = useState(0);
  const [soMinhaVez, setSoMinhaVez] = useState(savedListState?.soMinhaVez ?? false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [teamOptions, setTeamOptions] = useState<{ id: string; label: string }[]>([]);
  const [memberIdsByTeam, setMemberIdsByTeam] = useState<Record<string, string[]>>({});
  const [equipeFilter, setEquipeFilter] = useState<string>(savedListState?.equipeFilter ?? "todas");
  const [liderIdByCorretor, setLiderIdByCorretor] = useState<Record<string, string>>({});
  const [tipoVendaOpen, setTipoVendaOpen] = useState(false);
  const [teamOptionsLoaded, setTeamOptionsLoaded] = useState(false);
  const [midiaFilter, setMidiaFilter] = useState<string>(() => {
    const salvo = savedListState?.midiaFilter;
    return midiaFilterValido(salvo) ? salvo : "todas";
  });
  const [pagamentoFilter, setPagamentoFilter] = useState<string>(() => {
    const salvo = savedListState?.pagamentoFilter;
    return pagamentoFilterValido(salvo) ? salvo : "todas";
  });
  // Esteira: todas as vendas abertas antes da assinatura, carregadas inteiras para ordenar por
  // dias parados e somar por etapa (são poucas dezenas; a paginação passa a ser local).
  const [esteiraRows, setEsteiraRows] = useState<SalesListRow[]>([]);
  const [esteiraEtapa, setEsteiraEtapa] = useState<string>("todas");
  const esteira = statusFilter === ESTEIRA_FILTER;
  // Ordenação da tabela por valor ou por dias na etapa. Para ordenar o resultado inteiro (e não
  // só as 10 linhas da página), a lista é carregada inteira, como a esteira já faz.
  const [ordem, setOrdem] = useState<Ordem | null>(null);
  const carregarTudo = esteira || ordem !== null;
  const esteiraTotalRef = useRef(0);
  const esteiraPendingKeyRef = useRef("");

  const canFilterByTeam = hasAny(["juridico", "admin", "super_admin", "financeiro"]);
  // Filtros guardados em "Mais filtros" (computador). Abre sozinho se algum já vier ligado (URL/sessão).
  const maisFiltrosAtivos =
    (canFilterByTeam && equipeFilter !== "todas" ? 1 : 0) +
    (midiaFilter !== "todas" ? 1 : 0) +
    (pagamentoFilter !== "todas" ? 1 : 0);
  const [maisFiltrosOpen, setMaisFiltrosOpen] = useState(() => maisFiltrosAtivos > 0);
  const waitingForSavedTeamFilter =
    canFilterByTeam && equipeFilter !== "todas" && !teamOptionsLoaded;

  useEffect(() => {
    // Atualiza apenas esta entrada de histórico; um link compartilhado reproduz os filtros.
    // Preserva window.history.state para não quebrar o roteador nas próximas navegações.
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    params.set("filtros", "1");
    if (statusFilter !== "todas") params.set("status", statusFilter);
    if (vezFilter !== "todas") params.set("vez", vezFilter);
    params.set("de", dataDe);
    params.set("ate", dataAte);
    if (q) params.set("q", q);
    if (soMinhaVez) params.set("minhaVez", "1");
    if (equipeFilter !== "todas" && canFilterByTeam) params.set("equipe", equipeFilter);
    if (midiaFilter !== "todas") params.set("midia", midiaFilter);
    if (pagamentoFilter !== "todas") params.set("pagamento", pagamentoFilter);
    url.search = params.toString();
    if (window.location.href !== url.href)
      window.history.replaceState(window.history.state, "", url);
  }, [
    statusFilter,
    vezFilter,
    dataDe,
    dataAte,
    q,
    soMinhaVez,
    equipeFilter,
    canFilterByTeam,
    midiaFilter,
    pagamentoFilter,
  ]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        SALES_LIST_STATE_KEY,
        JSON.stringify({
          statusFilter,
          vezFilter,
          diasFilter,
          dataDe,
          dataAte,
          q,
          soMinhaVez,
          equipeFilter,
          midiaFilter,
          pagamentoFilter,
        } satisfies SalesListState),
      );
    } catch {
      // A listagem continua funcionando mesmo quando o navegador bloqueia o armazenamento.
    }
  }, [
    statusFilter,
    vezFilter,
    diasFilter,
    dataDe,
    dataAte,
    q,
    soMinhaVez,
    equipeFilter,
    midiaFilter,
    pagamentoFilter,
  ]);

  const aplicarPeriodo = (periodo: { de: string; ate: string }) => {
    setDiasFilter(null);
    setDataDe(periodo.de);
    setDataAte(periodo.ate);
  };

  const periodoAtual = periodoMesAtual();
  const mesAtualSelecionado = dataDe === periodoAtual.de && dataAte === periodoAtual.ate;

  useEffect(() => {
    if (!user) return;
    if (!hasAny(["gestor", "team_leader"])) return;
    fetchLedMemberIds(user.id).then(setTeamIds);
  }, [user, hasAny]);

  // Jurídico/financeiro/admin/super admin enxergam vendas de todas as equipes por definição —
  // esse filtro deixa restringir a visão a uma equipe específica. Gestor/team_leader já enxerga
  // só a própria equipe (via RLS), então não precisam desse seletor.
  useEffect(() => {
    if (!hasAny(["juridico", "admin", "super_admin", "financeiro"])) return;
    (async () => {
      const [{ data: teams }, { data: members }, { data: coLeaders }] = await Promise.all([
        supabase.from("teams").select("id, nome, parent_team_id, lider_id"),
        supabase.from("team_members").select("membro_id, team_id"),
        supabase.from("team_co_leaders").select("user_id, team_id"),
      ]);
      const byId: Record<
        string,
        { nome: string; parent_team_id: string | null; lider_id: string | null }
      > = {};
      (teams ?? []).forEach((t) => {
        byId[t.id] = t;
      });
      const byTeam: Record<string, string[]> = {};
      // Líder e líder(es) auxiliar(es) também entram no filtro por equipe, não só quem está em
      // team_members — sem isso, uma venda cujo dono é o próprio líder (ex: papel Lançamento
      // acumulado com Gestor, que sobe a venda em nome próprio, não como membro de ninguém) sumia
      // do filtro por não estar em team_members.
      (teams ?? []).forEach((t) => {
        if (t.lider_id) (byTeam[t.id] ??= []).push(t.lider_id);
      });
      (coLeaders ?? []).forEach((c) => {
        (byTeam[c.team_id] ??= []).push(c.user_id);
      });
      (members ?? []).forEach((m) => {
        (byTeam[m.team_id] ??= []).push(m.membro_id);
      });
      const topTeams = [...(teams ?? [])]
        .filter((t) => !t.parent_team_id)
        .sort((a, b) => a.nome.localeCompare(b.nome));
      const options: { id: string; label: string }[] = [];
      for (const top of topTeams) {
        const subs = (teams ?? [])
          .filter((t) => t.parent_team_id === top.id)
          .sort((a, b) => a.nome.localeCompare(b.nome));
        for (const t of [top, ...subs]) {
          options.push({
            id: t.id,
            label: t.parent_team_id ? `${byId[t.parent_team_id]?.nome ?? ""} → ${t.nome}` : t.nome,
          });
        }
      }
      setTeamOptions(options);
      setMemberIdsByTeam(byTeam);

      // Corretor → líder da equipe (mesma resolução membro/líder/líder-auxiliar de cima, mas
      // invertida: de quem é membro para quem lidera) — pra mostrar de qual gestor/team_leader
      // cada corretor é na coluna "Gestor/Líder", já que quem vê vendas de várias equipes ao mesmo
      // tempo (jurídico/financeiro/admin) não tem como saber isso de cabeça.
      const teamIdByCorretor: Record<string, string> = {};
      (members ?? []).forEach((m) => {
        if (!teamIdByCorretor[m.membro_id]) teamIdByCorretor[m.membro_id] = m.team_id;
      });
      (teams ?? []).forEach((t) => {
        if (t.lider_id && !teamIdByCorretor[t.lider_id]) teamIdByCorretor[t.lider_id] = t.id;
      });
      (coLeaders ?? []).forEach((c) => {
        if (!teamIdByCorretor[c.user_id]) teamIdByCorretor[c.user_id] = c.team_id;
      });
      const liderByCorretor: Record<string, string> = {};
      for (const [corretorId, teamId] of Object.entries(teamIdByCorretor)) {
        const liderId = byId[teamId]?.lider_id;
        if (liderId) liderByCorretor[corretorId] = liderId;
      }
      setLiderIdByCorretor(liderByCorretor);
    })().finally(() => setTeamOptionsLoaded(true));
  }, [hasAny]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("profiles").select("id, nome");
      const names: Record<string, string> = {};
      for (const p of data ?? []) names[p.id] = p.nome ?? p.id;
      setProfileName(names);
    })();
  }, []);

  // Só os membros da equipe escolhida entram na consulta: chegar a lista de equipes com o filtro
  // em "todas" não recria buildFilters/load (antes isso disparava uma 2ª consulta ao abrir a tela).
  const membrosEquipeFiltro = equipeFilter !== "todas" ? memberIdsByTeam[equipeFilter] : undefined;

  const buildFilters = useCallback(() => {
    const filters: {
      status?: string;
      statuses?: string[];
      desde?: string;
      ate?: string;
      q?: string;
      corretorIds?: string[];
      midia?: string;
      pagamento?: string;
    } = {};
    if (statusFilter === ESTEIRA_FILTER) {
      const daVez =
        vezFilter !== "todas" ? new Set<string>(statusDaVezDeAgir(vezFilter as VezDeAgir)) : null;
      const lista = ESTEIRA_STATUSES.filter((s) => !daVez || daVez.has(s));
      // Nenhuma etapa da esteira é da vez escolhida: status impossível em vez de "sem filtro".
      filters.statuses = lista.length ? lista : ["__nenhum__"];
    } else if (statusFilter === VENDIDOS_FILTER) {
      const daVez =
        vezFilter !== "todas" ? new Set<string>(statusDaVezDeAgir(vezFilter as VezDeAgir)) : null;
      const lista = VENDIDOS_STATUSES.filter((s) => !daVez || daVez.has(s));
      filters.statuses = lista.length ? lista : ["__nenhum__"];
    } else if (statusFilter !== "todas") filters.status = statusFilter;
    if (statusFilter === "todas" && vezFilter !== "todas")
      filters.statuses = statusDaVezDeAgir(vezFilter as VezDeAgir);
    // Sem membro nenhum na equipe escolhida (equipe recém-criada, sem corretor vinculado): usa um
    // uuid que nunca bate em vez de deixar o array vazio ser interpretado como ausência de filtro.
    if (equipeFilter !== "todas")
      filters.corretorIds = membrosEquipeFiltro?.length
        ? membrosEquipeFiltro
        : ["00000000-0000-0000-0000-000000000000"];
    if (statusFilter === ESTEIRA_FILTER) {
      // A esteira é o que está aberto hoje: não depende do período.
    } else if (diasFilter) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - diasFilter);
      filters.desde = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
    } else {
      if (dataDe) filters.desde = dataDe;
      if (dataAte) filters.ate = dataAte;
    }
    filters.q = q.replace(/[,()]/g, "").trim() || undefined;
    filters.midia = midiaFilterParam(midiaFilter);
    filters.pagamento = pagamentoFilterParam(pagamentoFilter);
    return filters;
  }, [
    statusFilter,
    vezFilter,
    diasFilter,
    dataDe,
    dataAte,
    q,
    equipeFilter,
    membrosEquipeFiltro,
    midiaFilter,
    pagamentoFilter,
  ]);

  const fetchSales = useCallback(
    async (page: number, signal?: AbortSignal) => {
      const filters = buildFilters();
      return fetchVendasComerciaisPaginadas({
        page,
        pageSize: PAGE_SIZE,
        soMinhaVez,
        ...filters,
        signal,
      });
    },
    [buildFilters, soMinhaVez],
  );

  // Pacote financeiro (13 consultas) e IDs por mídia não dependem de busca, status, vez, equipe
  // nem página: ficam em cache por 60 s e chamadas simultâneas reaproveitam a mesma requisição.
  // Sem isso, cada filtro/tecla disparava o pacote inteiro de novo e lotava o pool do banco.
  const resumoCacheRef = useRef<CacheConsultas | null>(null);
  // Falta de permissão (403/42501, ex.: gestor no pacote financeiro) também fica guardada pelos
  // mesmos 60 s: o resultado seria o mesmo e repetir só gasta conexões do banco.
  resumoCacheRef.current ??= criarCacheConsultas(RESUMO_CACHE_MS, {
    guardarErro: ehErroDePermissao,
  });

  // A segunda linha mantém o indicador financeiro existente, cujo marco é a efetivação.
  // Retornar o resultado sem setters permite descartar respostas de filtros antigos.
  const fetchSummary = useCallback(async () => {
    const cache = resumoCacheRef.current!;
    return !esteira && dataDe && dataAte
      ? resolverResumoOpcional(
          Promise.all([
            cache.buscar("bundle", fetchFinanceiroBundle),
            cache.buscar(`midia:${midiaFilter}`, () => fetchSaleIdsPorMidia(midiaFilter)),
            cache.buscar(`pagamento:${pagamentoFilter}`, () =>
              fetchSelecaoPorPagamento(pagamentoFilter),
            ),
          ]).then(([bundle, idsDaMidia, selecaoPagamento]) => {
            // O cartão de efetivadas também segue os filtros de Mídia e Pagamento (só restringem o
            // que já é visível).
            const efetivadas = filtrarPorPagamento(
              filtrarPorSaleIds(
                aplicarFiltrosEfetivacao(bundle.efetivadas, {
                  ...filtrosPadraoFinanceiro(),
                  dataDe,
                  dataAte,
                }),
                idsDaMidia,
              ),
              selecaoPagamento,
            );
            const resumo = calcularResumo({
              parcelas: [],
              comissoes: [],
              efetivadas,
              divergenciasAbertas: bundle.divergencias.length,
              hoje: dataAte,
            });
            const vgvCheio = efetivadas.reduce((s, e) => s + Number(e.valorNegociado || 0), 0);
            return {
              quantidade: efetivadas.length,
              vgv: resumo.vgvEfetivado,
              vgvCheio: Number(vgvCheio.toFixed(2)),
              comParceria: efetivadas.filter((e) => Number(e.parceriaExterna ?? 0) > 0).length,
              comParceriaValorCheio: Number(
                efetivadas
                  .filter((e) => Number(e.parceriaExterna ?? 0) > 0)
                  .reduce((s, e) => s + Number(e.valorNegociado || 0), 0)
                  .toFixed(2),
              ),
            };
          }),
        )
      : Promise.resolve(null);
  }, [dataDe, dataAte, esteira, midiaFilter, pagamentoFilter]);

  // "Nesta etapa há X dias": timestamp da última troca de status (fallback: criação da venda, se nunca mudou)
  const mergeStageSince = async (ids: string[], requestId: number, signal?: AbortSignal) => {
    if (!ids.length) return;
    // Lotes de 100 ids: a lista inteira (esteira/ordenação) não estoura o tamanho da URL.
    const lotes: string[][] = [];
    for (let i = 0; i < ids.length; i += 100) lotes.push(ids.slice(i, i + 100));
    const respostas = await Promise.all(
      lotes.map((lote) => {
        const consulta = supabase
          .from("sale_status_history")
          .select("sale_id, created_at, para")
          .in("sale_id", lote)
          .order("created_at", { ascending: false });
        return signal ? consulta.abortSignal(signal) : consulta;
      }),
    );
    const hist = respostas.flatMap((r) => r.data ?? []);
    if (requestIdRef.current !== requestId) return;
    setStageSince((prev) => {
      const next = { ...prev };
      for (const h of hist ?? []) {
        if (!next[h.sale_id]) next[h.sale_id] = h.created_at;
      }
      return next;
    });
    setAssinadasHist((prev) => {
      const next = { ...prev };
      for (const h of hist ?? []) {
        if (h.para === "contrato_assinado") next[h.sale_id] = true;
      }
      return next;
    });
  };

  // Cada tecla digitada na busca dispara uma nova query, sem cancelar a anterior — sem essa
  // trava, uma resposta de uma busca mais antiga (com termo menor, resultado mais amplo) podia
  // chegar depois da mais recente e sobrescrever a lista com um resultado errado/desatualizado.
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (pageToLoad: number, signal?: AbortSignal) => {
      const myRequestId = ++requestIdRef.current;
      setLoading(true);
      setLoadError(false);
      try {
        if (carregarTudo) {
          // Carrega a lista inteira (lotes de 50, limite da RPC): a esteira para ordenar e somar
          // por etapa; as demais quando o usuário pede ordenação por valor/dias.
          // shortcut: no máximo 40 lotes (2.000 vendas) por carga.
          const filters = buildFilters();
          const todas: SalesListRow[] = [];
          let primeiroLote: { total_count: number; total_valor: number } | null = null;
          const resumoPromise = esteira ? Promise.resolve(null) : fetchSummary();
          for (let p = 0; p < 40; p++) {
            const lote = await fetchVendasComerciaisPaginadas({
              page: p,
              pageSize: 50,
              soMinhaVez,
              ...filters,
              signal,
            });
            if (requestIdRef.current !== myRequestId) return;
            primeiroLote ??= lote;
            todas.push(...(lote.rows as unknown as SalesListRow[]));
            if (lote.rows.length < 50 || todas.length >= lote.total_count) break;
          }
          const resumoFinanceiro = await resumoPromise;
          if (requestIdRef.current !== myRequestId) return;
          setEsteiraRows(todas);
          setSales(esteira ? [] : todas);
          if (esteira) {
            setTotalCount(todas.length);
            setTotalValor(todas.reduce((acc, s) => acc + (Number(s.valor_negociado) || 0), 0));
          } else {
            // Mesmos totais da carga paginada (vêm da RPC, não da soma local).
            setTotalCount(primeiroLote?.total_count ?? todas.length);
            setTotalValor(Number(primeiroLote?.total_valor) || 0);
          }
          setContratosAssinadosCount(resumoFinanceiro?.quantidade ?? 0);
          setContratosAssinadosValor(resumoFinanceiro?.vgv ?? 0);
          setEfetivadasValorCheio(resumoFinanceiro?.vgvCheio ?? 0);
          setEfetivadasComParceria(resumoFinanceiro?.comParceria ?? 0);
          setParceriaValorCheio(resumoFinanceiro?.comParceriaValorCheio ?? 0);
          setStageSince({});
          await mergeStageSince(
            todas.map((s) => s.id),
            myRequestId,
            signal,
          );
          if (requestIdRef.current === myRequestId)
            esteiraLoadedKeyRef.current = esteiraPendingKeyRef.current;
          return;
        }
        const [pageResult, resumoFinanceiro] = await Promise.all([
          fetchSales(pageToLoad, signal),
          fetchSummary(),
        ]);
        if (requestIdRef.current !== myRequestId) return;
        const rows = pageResult.rows as unknown as SalesListRow[];
        setSales(rows);
        setTotalCount(pageResult.total_count);
        setTotalValor(Number(pageResult.total_valor) || 0);
        setContratosAssinadosCount(resumoFinanceiro?.quantidade ?? 0);
        setContratosAssinadosValor(resumoFinanceiro?.vgv ?? 0);
        setEfetivadasValorCheio(resumoFinanceiro?.vgvCheio ?? 0);
        setEfetivadasComParceria(resumoFinanceiro?.comParceria ?? 0);
        setParceriaValorCheio(resumoFinanceiro?.comParceriaValorCheio ?? 0);
        setStageSince({});
        await mergeStageSince(
          rows.map((s) => s.id),
          myRequestId,
          signal,
        );
      } catch {
        if (requestIdRef.current !== myRequestId) return;
        setSales([]);
        setTotalCount(null);
        setLoadError(true);
        toast.error("Não foi possível carregar as vendas. Tente novamente.");
      } finally {
        if (requestIdRef.current === myRequestId) setLoading(false);
      }
    },
    [fetchSales, fetchSummary, esteira, carregarTudo, buildFilters, soMinhaVez],
  );

  const filterKey = [
    statusFilter,
    vezFilter,
    diasFilter,
    dataDe,
    dataAte,
    q,
    soMinhaVez,
    equipeFilter,
    midiaFilter,
    pagamentoFilter,
  ].join("|");
  const previousFilterKeyRef = useRef(filterKey);
  // Na esteira a paginação é local: trocar de página não recarrega do banco.
  const esteiraLoadedKeyRef = useRef("");
  const previousLoadRef = useRef(load);
  // Filtros da última carga disparada (null = ainda não carregou nenhuma vez).
  const loadedFilterKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (waitingForSavedTeamFilter) return;
    if (previousFilterKeyRef.current !== filterKey) {
      previousFilterKeyRef.current = filterKey;
      if (page !== 0) {
        setPage(0);
        return;
      }
    }
    const loadMudou = previousLoadRef.current !== load;
    previousLoadRef.current = load;
    const chaveEsteira = `${filterKey}|${refreshKey}`;
    // Só pula quando a esteira já terminou de carregar com os mesmos filtros (troca de página).
    if (carregarTudo && !loadMudou && esteiraLoadedKeyRef.current === chaveEsteira) return;
    esteiraLoadedKeyRef.current = "";
    esteiraPendingKeyRef.current = chaveEsteira;
    // Troca de filtro/tecla espera FILTRO_DEBOUNCE_MS sem nova mudança antes de consultar; a
    // primeira carga, a troca de página e o recarregar depois de excluir continuam imediatos.
    const filtroMudou =
      loadedFilterKeyRef.current !== null && loadedFilterKeyRef.current !== filterKey;
    // Cancela no navegador a requisição anterior (lista + histórico) quando o filtro muda.
    const controller = new AbortController();
    const disparar = () => {
      loadedFilterKeyRef.current = filterKey;
      void load(page, controller.signal);
    };
    const timer = filtroMudou ? setTimeout(disparar, FILTRO_DEBOUNCE_MS) : null;
    if (!filtroMudou) disparar();
    return () => {
      if (timer) clearTimeout(timer);
      requestIdRef.current += 1;
      controller.abort();
    };
  }, [load, page, refreshKey, waitingForSavedTeamFilter, filterKey, carregarTudo]);

  const goToPage = (nextPage: number) => {
    const total = carregarTudo ? esteiraTotalRef.current : totalCount;
    if (loading || nextPage < 0 || (total !== null && nextPage * PAGE_SIZE >= total)) return;
    setPage(nextPage);
  };

  const onConfirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await excluirVenda({ data: { saleId: toDelete.id } });
      toast.success("Venda excluída");
      setToDelete(null);
      resumoCacheRef.current?.limpar();
      setRefreshKey((k) => k + 1);
      router.invalidate();
    } catch (err: unknown) {
      toast.error(errorMessage(err, "Falha ao excluir venda"));
    } finally {
      setDeleting(false);
    }
  };

  // admin/super_admin enxerga tudo por definição — "Sua vez" é pra quem tem uma fila operacional
  // de verdade, não pra quem só está supervisionando o sistema.
  const isOverseer = hasAny(["admin", "super_admin"]);
  const podeTerFila =
    !isOverseer && hasAny(["corretor", "gestor", "team_leader", "juridico", "financeiro"]);
  const saleIsMinhaVez = useCallback(
    (s: SalesListRow) => {
      if (isOverseer) return false;
      return proximoResponsavelRoles(s.status as SaleStatus).some((papel) =>
        papel === "corretor"
          ? !!user?.id && responsaveisDaLinha(s).includes(user.id)
          : // gestor/team_leader só é "a vez dele" se ele lidera o corretor da venda — sem esse filtro,
            // quem também é jurídico/financeiro (e por isso enxerga vendas de times que não lidera) via
            // o badge acender pra toda venda parada numa etapa do gestor, mesmo fora da própria equipe.
            // "Corretor da venda" = participantes, não quem cadastrou.
            papel === "gestor"
            ? hasAny(["gestor", "team_leader"]) &&
              responsaveisDaLinha(s).some((id) => teamIds.has(id))
            : hasAny([papel]),
      );
    },
    [isOverseer, user?.id, hasAny, teamIds],
  );
  // Quando "Só minha vez" está ativo, a RPC já filtra antes da paginação. Não filtre a página
  // novamente no navegador: isso faria a fila voltar a depender apenas das 10 linhas carregadas.
  const diasNaEtapa = (s: SalesListRow) =>
    Date.now() - new Date(stageSince[s.id] ?? s.created_at).getTime();
  const esteiraPorEtapa = ESTEIRA_STATUSES.map((st) => {
    const linhas = esteiraRows.filter((s) => s.status === st);
    return {
      status: st,
      quantidade: linhas.length,
      valor: linhas.reduce((acc, s) => acc + (Number(s.valor_negociado) || 0), 0),
    };
  }).filter((e) => e.quantidade > 0);
  const comparar = (a: SalesListRow, b: SalesListRow) => {
    if (!ordem) return diasNaEtapa(b) - diasNaEtapa(a);
    const sinal = ordem.dir === "asc" ? 1 : -1;
    if (ordem.campo === "dias") return sinal * (diasNaEtapa(a) - diasNaEtapa(b));
    // Valor pendente fica sempre no fim, nas duas direções.
    const va = a.valor_negociado ? Number(a.valor_negociado) : null;
    const vb = b.valor_negociado ? Number(b.valor_negociado) : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return sinal * (va - vb);
  };
  const esteiraFiltrada = carregarTudo
    ? esteiraRows
        .filter((s) => !esteira || esteiraEtapa === "todas" || s.status === esteiraEtapa)
        .sort(comparar)
    : [];
  const esteiraParadas = esteiraRows.filter(
    (s) => diasNaEtapa(s) >= ESTEIRA_AGING_LIMITES.cobrar * 86_400_000,
  ).length;
  esteiraTotalRef.current = esteiraFiltrada.length;
  const listTotal = carregarTudo ? esteiraFiltrada.length : totalCount;
  const displayedSales = carregarTudo
    ? esteiraFiltrada.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    : sales;
  const alternarOrdem = (campo: Ordem["campo"]) => {
    setOrdem((atual) =>
      !atual || atual.campo !== campo
        ? { campo, dir: "desc" }
        : atual.dir === "desc"
          ? { campo, dir: "asc" }
          : null,
    );
    setPage(0);
  };
  const ariaSort = (campo: Ordem["campo"]) =>
    ordem?.campo === campo ? (ordem.dir === "asc" ? "ascending" : "descending") : "none";
  const iconeOrdem = (campo: Ordem["campo"]) => {
    const Icone = ordem?.campo !== campo ? ArrowUpDown : ordem.dir === "asc" ? ArrowUp : ArrowDown;
    return <Icone className="ml-1 h-3.5 w-3.5" aria-hidden />;
  };

  // Celular: quantos filtros estão ligados (fora a busca, que fica sempre à vista).
  const periodoPadrao = periodoInicialRef.current;
  const filtrosLigados =
    (statusFilter !== "todas" ? 1 : 0) +
    (vezFilter !== "todas" ? 1 : 0) +
    (!esteira && (dataDe !== periodoPadrao.de || dataAte !== periodoPadrao.ate) ? 1 : 0) +
    (soMinhaVez ? 1 : 0) +
    maisFiltrosAtivos;
  const limparFiltros = () => {
    setStatusFilter("todas");
    setVezFilter("todas");
    setDiasFilter(null);
    setDataDe(periodoPadrao.de);
    setDataAte(periodoPadrao.ate);
    setSoMinhaVez(false);
    setEquipeFilter("todas");
    setMidiaFilter("todas");
    setPagamentoFilter("todas");
    setEsteiraEtapa("todas");
  };
  const isMobile = useCelular();
  const totalPages = listTotal ? Math.ceil(listTotal / PAGE_SIZE) : 0;
  const hasPreviousPage = page > 0;
  const hasNextPage = listTotal !== null && (page + 1) * PAGE_SIZE < listTotal;
  const agingLimites = esteira ? ESTEIRA_AGING_LIMITES : undefined;
  const registrarAction = registrarVendaAction(roles);
  const abrirVenda = (id: string) => {
    markSalesListForReturn();
    router.navigate({ to: "/vendas/$id", params: { id } });
  };

  const registrarVendaButton =
    registrarAction === "venda_padrao" ? (
      <Button asChild>
        <Link to="/vendas/nova">
          <Plus className="mr-2 h-4 w-4" />
          Registrar venda
        </Link>
      </Button>
    ) : registrarAction === "lancamento" ? (
      <Button asChild>
        <Link to="/vendas/lancamento/nova">
          <Plus className="mr-2 h-4 w-4" />
          Registrar venda
        </Link>
      </Button>
    ) : registrarAction === "escolher" ? (
      <Button type="button" onClick={() => setTipoVendaOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Registrar venda
      </Button>
    ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileText}
        title="Vendas"
        description="Acompanhe cada venda, veja de quem é a vez de agir e abra os detalhes."
        actions={registrarVendaButton}
      />

      <Dialog open={tipoVendaOpen} onOpenChange={setTipoVendaOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Qual tipo de venda você quer registrar?</DialogTitle>
            <DialogDescription>
              Escolha o fluxo correto antes de criar o rascunho. O tipo não poderá ser alterado
              depois.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/vendas/nova"
              onClick={() => setTipoVendaOpen(false)}
              className="group rounded-lg border p-4 transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-md bg-primary/10 p-2 text-primary">
                  <House className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <p className="font-semibold">Venda padrão</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Fluxo completo, com documentos e Jurídico.
              </p>
            </Link>
            <Link
              to="/vendas/lancamento/nova"
              onClick={() => setTipoVendaOpen(false)}
              className="group rounded-lg border p-4 transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="rounded-md bg-primary/10 p-2 text-primary">
                  <Building2 className="h-5 w-5" />
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
              </div>
              <p className="font-semibold">Lançamento</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Fluxo simplificado para venda com construtora.
              </p>
            </Link>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label="Buscar por código, imóvel ou pessoa envolvida"
              placeholder={
                isMobile
                  ? "Código, imóvel ou pessoa…"
                  : "Buscar por código, imóvel, endereço, bairro ou pessoa"
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="flex-1 md:max-w-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 md:hidden"
              aria-expanded={filtersOpen}
              aria-controls="vendas-filtros"
              aria-label={filtrosLigados > 0 ? `Filtros, ${filtrosLigados} ligados` : "Filtros"}
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              {filtrosLigados > 0 ? `Filtros (${filtrosLigados})` : "Filtros"}
            </Button>
          </div>
          <div
            id="vendas-filtros"
            className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 md:flex md:flex-row md:flex-wrap md:items-center`}
          >
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setEsteiraEtapa("todas");
              }}
            >
              <SelectTrigger aria-label="Status" className="md:w-64">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ESTEIRA_FILTER}>Na esteira (sem contrato assinado)</SelectItem>
                <SelectItem value={VENDIDOS_FILTER}>Vendidos (contrato assinado)</SelectItem>
                <SelectItem value="todas">Todos os status</SelectItem>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={vezFilter} onValueChange={setVezFilter}>
              <SelectTrigger aria-label="Aguardando ação de" className="md:w-56">
                <SelectValue placeholder="Aguardando ação de" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Aguardando ação de…</SelectItem>
                {Object.entries(VEZ_DE_AGIR_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={dataDe}
                onChange={(e) => {
                  setDataDe(e.target.value);
                  setDiasFilter(null);
                }}
                className="w-[9.5rem]"
                disabled={esteira}
                aria-label="Data da venda de"
              />
              <span className="text-sm text-muted-foreground">até</span>
              <Input
                type="date"
                value={dataAte}
                onChange={(e) => {
                  setDataAte(e.target.value);
                  setDiasFilter(null);
                }}
                className="w-[9.5rem]"
                disabled={esteira}
                aria-label="Data da venda até"
              />
              {!esteira && (dataDe || dataAte) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDataDe("");
                    setDataAte("");
                  }}
                >
                  Limpar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mesAtualSelecionado && !esteira ? "default" : "outline"}
                size="sm"
                disabled={esteira}
                onClick={() => aplicarPeriodo(periodoAtual)}
              >
                Mês atual
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={esteira}
                onClick={() => aplicarPeriodo(periodoMesAnterior())}
              >
                Mês anterior
              </Button>
            </div>
            {podeTerFila && (
              <Button
                type="button"
                variant={soMinhaVez ? "default" : "outline"}
                size="sm"
                aria-pressed={soMinhaVez}
                onClick={() => setSoMinhaVez((v) => !v)}
              >
                Só minha vez
              </Button>
            )}
            <Button
              type="button"
              variant={maisFiltrosAtivos > 0 ? "secondary" : "outline"}
              size="sm"
              className="hidden md:inline-flex"
              aria-expanded={maisFiltrosOpen}
              aria-controls="vendas-mais-filtros"
              onClick={() => setMaisFiltrosOpen((v) => !v)}
            >
              <SlidersHorizontal className="mr-1 h-4 w-4" />
              {maisFiltrosAtivos > 0 ? `Mais filtros (${maisFiltrosAtivos})` : "Mais filtros"}
              <ChevronDown
                className={`ml-1 h-4 w-4 transition-transform ${maisFiltrosOpen ? "rotate-180" : ""}`}
              />
            </Button>
            {filtrosLigados > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            )}
            {/* Celular: sempre dentro do painel de filtros. Computador: só com "Mais filtros". */}
            <div
              id="vendas-mais-filtros"
              className={`flex flex-col gap-3 md:basis-full md:flex-row md:flex-wrap md:items-center ${maisFiltrosOpen ? "md:flex" : "md:hidden"}`}
            >
              {canFilterByTeam && teamOptions.length > 0 && (
                <Select value={equipeFilter} onValueChange={setEquipeFilter}>
                  <SelectTrigger aria-label="Equipe" className="md:w-56">
                    <SelectValue placeholder="Equipe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as equipes</SelectItem>
                    {teamOptions.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={midiaFilter} onValueChange={setMidiaFilter}>
                <SelectTrigger aria-label="Mídia" className="md:w-56">
                  <SelectValue placeholder="Mídia" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as mídias</SelectItem>
                  {MIDIA_FILTER_OPTIONS.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={pagamentoFilter} onValueChange={setPagamentoFilter}>
                <SelectTrigger aria-label="Pagamento" className="md:w-56">
                  <SelectValue placeholder="Pagamento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos os pagamentos</SelectItem>
                  {PAGAMENTO_FILTER_OPTIONS.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {esteira && (
            <p className="text-xs text-muted-foreground">
              O filtro de mês não vale para a esteira: ela mostra tudo o que está aberto hoje.
            </p>
          )}
          {!loading && esteira && totalCount !== null && (
            <div className="space-y-2">
              <p className="text-sm">
                <b>
                  {totalCount} {totalCount === 1 ? "venda na esteira" : "vendas na esteira"}
                </b>
                {` · ${totalValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} sem contrato assinado`}
                {esteiraParadas > 0 && (
                  <span className="font-semibold text-destructive">
                    {` · ${esteiraParadas} parada${esteiraParadas === 1 ? "" : "s"} há mais de 20 dias`}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  { status: "todas", quantidade: totalCount, valor: totalValor },
                  ...esteiraPorEtapa,
                ].map((e) => (
                  <Button
                    key={e.status}
                    type="button"
                    size="sm"
                    variant={esteiraEtapa === e.status ? "default" : "outline"}
                    className="h-auto rounded-full px-3 py-1 text-xs"
                    onClick={() => {
                      setEsteiraEtapa(e.status);
                      setPage(0);
                    }}
                  >
                    {e.status === "todas"
                      ? "Todas as etapas"
                      : `${STATUS_LABEL[e.status as SaleStatus]} · ${e.quantidade}`}
                    <span className="ml-1 opacity-70">
                      {e.valor.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Parada na etapa: até 7 dias em dia · 8 a 20 dias atenção · mais de 20 dias cobrar.
                Lista começa pelas paradas há mais tempo.
              </p>
            </div>
          )}
          {!loading && !esteira && totalCount !== null && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ResumoCartao
                titulo="Efetivadas"
                destaque
                valor={brl0(contratosAssinadosValor)}
                linha={`${contratosAssinadosCount} ${contratosAssinadosCount === 1 ? "venda" : "vendas"} · VGV REMAX`}
                aviso="Não segue o filtro de status."
                explicacao={
                  <>
                    Vendas com contrato assinado no período.{" "}
                    <span>VGV REMAX, sem a parte de parceiros.</span>{" "}
                    <span>O cartão de efetivadas não segue o filtro de status.</span>
                  </>
                }
              />
              <ResumoCartao
                titulo="Lançadas"
                valor={brl0(totalValor)}
                linha={`${totalCount} ${totalCount === 1 ? "venda" : "vendas"} no período`}
                explicacao={
                  <>
                    Vendas lançadas no período, com o valor cheio, incluindo vendas com parceria
                    (com a parte dos parceiros) · sem canceladas.
                  </>
                }
              />
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading && <ListSkeleton rows={6} label="Carregando vendas" />}
          {!loading && loadError && (
            <div role="alert" className="py-8 text-center text-sm">
              Não foi possível carregar as vendas.
              <Button
                variant="outline"
                className="ml-2"
                onClick={() => setRefreshKey((key) => key + 1)}
              >
                Tentar novamente
              </Button>
            </div>
          )}
          {!loading && !loadError && displayedSales.length === 0 && (
            <EmptyState icon={FileText} action={registrarVendaButton}>
              {hasAny(["corretor"]) &&
                !hasAny([
                  "gestor",
                  "team_leader",
                  "juridico",
                  "financeiro",
                  "admin",
                  "super_admin",
                ]) && (
                  <>
                    Você ainda não criou nenhuma venda. Clique em <b>Registrar venda</b> para
                    começar.
                  </>
                )}
              {hasAny(["lancamento"]) &&
                !hasAny([
                  "corretor",
                  "gestor",
                  "team_leader",
                  "juridico",
                  "financeiro",
                  "admin",
                  "super_admin",
                ]) && (
                  <>
                    Você ainda não criou nenhum lançamento. Clique em <b>Registrar venda</b> para
                    começar.
                  </>
                )}
              {hasAny(["gestor", "team_leader"]) &&
                !hasAny(["financeiro", "admin", "super_admin"]) && (
                  <>
                    Nenhuma venda visível. Peça ao administrador para vincular corretores à sua
                    equipe.
                  </>
                )}
              {hasAny(["juridico"]) && !hasAny(["financeiro", "admin", "super_admin"]) && (
                <>
                  Nenhuma venda aprovada pelo gestor ainda. Você só enxerga vendas a partir dessa
                  etapa.
                </>
              )}
              {hasAny(["financeiro", "admin", "super_admin"]) && (
                <>Nenhuma venda encontrada com o filtro atual.</>
              )}
            </EmptyState>
          )}
          {!loading && displayedSales.length > 0 && (
            <>
              {!esteira && listTotal !== null && (
                <p
                  className="mb-3 text-sm font-medium"
                  role="status"
                  data-testid="vendas-encontradas"
                >
                  {listTotal} {listTotal === 1 ? "venda encontrada" : "vendas encontradas"}
                </p>
              )}
              {/* Mobile: cards empilhados — a tabela força colunas largas demais e corta o texto
                  do status numa tela estreita. A partir de md, volta pra tabela (mais densa, melhor
                  pra comparar várias vendas de uma vez, o que faz sentido numa tela maior). */}
              <div className="space-y-2 md:hidden">
                {displayedSales.map((s) => {
                  const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
                  const minhaVez = saleIsMinhaVez(s);
                  return (
                    <div
                      key={s.id}
                      className={`cursor-pointer rounded-md border p-3 ${minhaVez ? "border-primary/40 bg-primary/5" : ""}`}
                      onClick={() => abrirVenda(s.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <LinkVenda s={s} className="truncate" />
                          <div className="truncate text-sm text-muted-foreground">
                            {nomesCorretores(s, profileName)}
                            {hasAny(["juridico", "admin", "super_admin", "financeiro"]) &&
                              nomesLideres(s, profileName, liderIdByCorretor) && (
                                <> · {nomesLideres(s, profileName, liderIdByCorretor)}</>
                              )}
                          </div>
                        </div>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="-mr-2 -mt-1 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setToDelete(s);
                            }}
                            aria-label="Excluir venda"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={s.status as SaleStatus} />
                        <VezDeAgirBadge status={s.status as SaleStatus} />
                        <FinanciadaBadge
                          tipo={s.pagamento_tipo}
                          banco={s.pagamento_banco}
                          correspondente={s.pagamento_correspondente}
                          obaCredito={s.pagamento_oba}
                        />
                        {minhaVez && <SuaVezBadge />}
                        <AgingBadge
                          since={stageSince[s.id] ?? s.created_at}
                          limites={agingLimites}
                          prefixo="Nesta etapa"
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-semibold tabular-nums">
                          {s.valor_negociado
                            ? `R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}`
                            : "Valor pendente"}
                        </span>
                        <DatasVendaLegenda
                          datas={datasDaVendaNaLista(s, Boolean(assinadasHist[s.id]))}
                          className="text-right text-xs text-muted-foreground"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Imóvel / código</TableHead>
                      <TableHead>Corretor</TableHead>
                      {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && (
                        <TableHead>Gestor/Líder</TableHead>
                      )}
                      <TableHead className="text-right" aria-sort={ariaSort("valor")}>
                        <button
                          type="button"
                          className="-mr-1 inline-flex items-center rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => alternarOrdem("valor")}
                          aria-label="Ordenar por valor"
                        >
                          Valor
                          {iconeOrdem("valor")}
                        </button>
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Vez de agir</TableHead>
                      <TableHead aria-sort={ariaSort("dias")}>
                        <button
                          type="button"
                          className="-ml-1 inline-flex items-center rounded px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => alternarOrdem("dias")}
                          aria-label="Ordenar por dias nesta etapa"
                        >
                          Nesta etapa
                          {iconeOrdem("dias")}
                        </button>
                      </TableHead>
                      <TableHead>Datas</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedSales.map((s) => {
                      const canDelete = canDeleteSale(user?.id, hasAny, s, teamIds);
                      const minhaVez = saleIsMinhaVez(s);
                      return (
                        <TableRow
                          key={s.id}
                          className={`cursor-pointer ${minhaVez ? "bg-primary/5" : ""}`}
                          onClick={() => abrirVenda(s.id)}
                        >
                          <TableCell>
                            <LinkVenda s={s} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {nomesCorretores(s, profileName)}
                          </TableCell>
                          {hasAny(["juridico", "admin", "super_admin", "financeiro"]) && (
                            <TableCell className="text-muted-foreground">
                              {nomesLideres(s, profileName, liderIdByCorretor) || "—"}
                            </TableCell>
                          )}
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {s.valor_negociado ? (
                              <span className="font-semibold">
                                {`R$ ${Number(s.valor_negociado).toLocaleString("pt-BR")}`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Pendente</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <StatusBadge status={s.status as SaleStatus} />
                              <FinanciadaBadge
                                tipo={s.pagamento_tipo}
                                banco={s.pagamento_banco}
                                correspondente={s.pagamento_correspondente}
                                obaCredito={s.pagamento_oba}
                              />
                              {minhaVez && <SuaVezBadge />}
                            </div>
                          </TableCell>
                          <TableCell>
                            <VezDeAgirBadge status={s.status as SaleStatus} />
                          </TableCell>
                          <TableCell>
                            <AgingBadge
                              since={stageSince[s.id] ?? s.created_at}
                              limites={agingLimites}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            <DatasVendaLegenda
                              datas={datasDaVendaNaLista(s, Boolean(assinadasHist[s.id]))}
                            />
                          </TableCell>
                          <TableCell>
                            {canDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setToDelete(s);
                                }}
                                aria-label="Excluir venda"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(page - 1)}
                    disabled={!hasPreviousPage || loading}
                  >
                    ← Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Página {page + 1} de {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(page + 1)}
                    disabled={!hasNextPage || loading}
                  >
                    Próxima →
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta venda?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete && (
                <>
                  <b>
                    {toDelete.imovel_id ||
                      toDelete.codigo_interno ||
                      `Venda #${toDelete.id.slice(0, 8)}`}
                  </b>{" "}
                  será excluída permanentemente. Todos os documentos, partes, pagamentos,
                  comentários e ocorrências relacionados serão removidos. Essa ação não pode ser
                  desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo…" : "Excluir venda"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Celular (< 768 px), só para o texto da busca; sem matchMedia (ex.: testes) vale computador. */
function useCelular() {
  const [celular, setCelular] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(max-width: 767px)");
    const atualizar = () => setCelular(mql.matches);
    atualizar();
    mql.addEventListener("change", atualizar);
    return () => mql.removeEventListener("change", atualizar);
  }, []);
  return celular;
}

function codigoDaVenda(s: Pick<SalesListRow, "id" | "imovel_id" | "codigo_interno">) {
  return s.imovel_id || s.codigo_interno || `Venda #${s.id.slice(0, 8)}`;
}

/**
 * Código do imóvel como link de verdade: abre pelo teclado (Tab + Enter) e aceita
 * Ctrl/Cmd+clique ou botão do meio para abrir em nova aba. O clique não chega à linha.
 */
function LinkVenda({ s, className }: { s: SalesListRow; className?: string }) {
  const codigo = codigoDaVenda(s);
  return (
    <Link
      to="/vendas/$id"
      params={{ id: s.id }}
      onClick={(e) => {
        e.stopPropagation();
        markSalesListForReturn();
      }}
      aria-label={`Abrir venda ${codigo}`}
      className={`inline-flex max-w-full items-center gap-0.5 rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${className ?? ""}`}
    >
      <span className="truncate">{codigo}</span>
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
    </Link>
  );
}

/** "Sua vez" no azul da marca (vermelho fica só para atraso e exclusão). */
function SuaVezBadge() {
  return (
    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
      Sua vez
    </span>
  );
}

/** Cartão de resumo: nome curto, número, 1 linha de apoio e um "i" com a explicação. */
function ResumoCartao({
  titulo,
  valor,
  linha,
  aviso,
  explicacao,
  destaque = false,
}: {
  titulo: string;
  valor: string;
  linha: string;
  aviso?: string;
  explicacao: ReactNode;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${destaque ? "border-primary/30 bg-primary/5" : "bg-muted/30"}`}
      data-testid={`resumo-${titulo.toLowerCase()}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{titulo}</p>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`O que entra em ${titulo}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="h-4 w-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-72 text-sm">
            {explicacao}
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-lg font-semibold leading-tight tabular-nums">{valor}</p>
      <p className="text-sm text-muted-foreground">{linha}</p>
      {aviso && <p className="mt-1 text-xs text-muted-foreground">{aviso}</p>}
    </div>
  );
}

const VEZ_DE_AGIR_TONE: Record<VezDeAgir, string> = {
  corretor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  gestor: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  financeiro: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  juridico: "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
  concluido: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
};

function VezDeAgirBadge({ status }: { status: SaleStatus }) {
  const responsavel = vezDeAgir(status);
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${VEZ_DE_AGIR_TONE[responsavel]}`}
    >
      {VEZ_DE_AGIR_LABEL[responsavel]}
    </span>
  );
}
