import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { money, dateBR } from "@/components/vendas/shared";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import type { OccurrenceRow, OccurrenceUpdate, SaleRow } from "@/lib/database.types";

type PaymentOccurrence = Pick<
  OccurrenceRow,
  | "id"
  | "sale_id"
  | "valor_comissao"
  | "prev_recebimento_data"
  | "prev_recebimento_valor"
  | "prev_recebimento_forma"
  | "prev_recebimento_recebido_em"
  | "prev_recebimento2_data"
  | "prev_recebimento2_valor"
  | "prev_recebimento2_forma"
  | "prev_recebimento2_recebido_em"
  | "prev_recebimento3_data"
  | "prev_recebimento3_valor"
  | "prev_recebimento3_forma"
  | "prev_recebimento3_recebido_em"
  | "prev_recebimento_recebido_valor"
  | "prev_recebimento2_recebido_valor"
  | "prev_recebimento3_recebido_valor"
>;
type SaleSummary = Pick<SaleRow, "id" | "imovel_id" | "codigo_interno" | "corretor_id" | "status">;
type PaymentRow = {
  key: string;
  occId: string;
  parcela: number;
  sale: SaleSummary;
  data: string | null;
  valor: number;
  forma: string | null;
  recebidoEm: string | null;
  recebidoValor: number | null;
  status: "pendente" | "recebida";
};

export const Route = createFileRoute("/_authenticated/comissoes-a-receber")({
  head: () => ({ meta: [{ title: "Baixa de recebimentos" }] }),
  component: ComissoesAReceberPage,
});

const todayISO = () => new Date().toISOString().slice(0, 10);

const OCC_COLUMNS =
  "id, sale_id, valor_comissao, prev_recebimento_data, prev_recebimento_valor, prev_recebimento_forma, prev_recebimento_recebido_em, prev_recebimento_recebido_valor, prev_recebimento2_data, prev_recebimento2_valor, prev_recebimento2_forma, prev_recebimento2_recebido_em, prev_recebimento2_recebido_valor, prev_recebimento3_data, prev_recebimento3_valor, prev_recebimento3_forma, prev_recebimento3_recebido_em, prev_recebimento3_recebido_valor";

function ComissoesAReceberPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["financeiro", "admin", "super_admin"]);

  const [loading, setLoading] = useState(true);
  const [occs, setOccs] = useState<PaymentOccurrence[]>([]);
  const [sales, setSales] = useState<SaleSummary[]>([]);
  const [profileName, setProfileName] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [markDate, setMarkDate] = useState(todayISO());
  const [marking, setMarking] = useState(false);
  const [view, setView] = useState<"pendentes" | "recebidas" | "todas">("pendentes");
  const [search, setSearch] = useState("");
  const [brokerFilter, setBrokerFilter] = useState("todos");
  const [formFilter, setFormFilter] = useState("todos");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState<"todos" | "vencidas" | "a_vencer">("todos");

  // Carrega parcelas previstas e já recebidas para manter o histórico na mesma tela. O filtro de
  // período e a situação são aplicados localmente, sem permitir alteração em parcelas recebidas.
  const load = useCallback(async () => {
    setLoading(true);
    const paymentFilter = [1, 2, 3]
      .map((n) => {
        const suf = n === 1 ? "" : String(n);
        return `or(prev_recebimento${suf}_data.not.is.null,prev_recebimento${suf}_valor.not.is.null,prev_recebimento${suf}_recebido_em.not.is.null,prev_recebimento${suf}_recebido_valor.not.is.null)`;
      })
      .join(",");
    const { data: o } = await supabase.from("occurrences").select(OCC_COLUMNS).or(paymentFilter);
    setOccs(o ?? []);

    const saleIds = Array.from(new Set((o ?? []).map((r) => r.sale_id)));
    if (saleIds.length) {
      const { data: s } = await supabase
        .from("sales")
        .select("id, imovel_id, codigo_interno, corretor_id, status")
        .in("id", saleIds);
      setSales(s ?? []);
    } else {
      setSales([]);
    }

    const { data: prof } = await supabase.from("profiles").select("id, nome");
    const names: Record<string, string> = {};
    for (const p of prof ?? []) names[p.id] = p.nome ?? p.id;
    setProfileName(names);
    setSelected(new Set());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    load();
  }, [allowed, load]);

  const saleById = useMemo(() => {
    const m: Record<string, SaleSummary> = {};
    for (const s of sales) m[s.id] = s;
    return m;
  }, [sales]);

  const { rows: allRows, inconsistentes } = useMemo(() => {
    const out: PaymentRow[] = [];
    const semVenda: PaymentOccurrence[] = [];
    for (const o of occs) {
      const sale = saleById[o.sale_id];
      // Ocorrência sem venda resolvida é uma inconsistência de dados — não deve entrar silenciosamente
      // no total pendente (ver item 7 do pedido de padronização financeira).
      if (!sale) {
        semVenda.push(o);
        continue;
      }
      // Venda arquivada/cancelada não deve gerar cobrança pendente — a ocorrência continua existindo
      // (histórico), mas a parcela prevista não é mais um recebimento de verdade.
      if (sale.status === "arquivada" || sale.status === "cancelada") continue;
      // prev_recebimento{1,2,3}_valor já é a fatia própria — parceria externa (quando existe) nunca
      // passa por essa conta, cobrada direto pelo parceiro.
      const parcelas: [
        string | null,
        number | null,
        string | null,
        string | null,
        number | null,
      ][] = [
        [
          o.prev_recebimento_data,
          o.prev_recebimento_valor,
          o.prev_recebimento_forma,
          o.prev_recebimento_recebido_em,
          o.prev_recebimento_recebido_valor,
        ],
        [
          o.prev_recebimento2_data,
          o.prev_recebimento2_valor,
          o.prev_recebimento2_forma,
          o.prev_recebimento2_recebido_em,
          o.prev_recebimento2_recebido_valor,
        ],
        [
          o.prev_recebimento3_data,
          o.prev_recebimento3_valor,
          o.prev_recebimento3_forma,
          o.prev_recebimento3_recebido_em,
          o.prev_recebimento3_recebido_valor,
        ],
      ];
      parcelas.forEach(([data, valor, forma, recebidoEm, recebidoValor], i) => {
        if (!data && !valor && !recebidoEm && !recebidoValor) return;
        if (!recebidoEm && (!data || valor == null)) return;
        out.push({
          key: `${o.id}-${i + 1}`,
          occId: o.id,
          parcela: i + 1,
          sale,
          data,
          valor: Number(recebidoEm ? (recebidoValor ?? valor ?? 0) : valor),
          forma,
          recebidoEm,
          recebidoValor: recebidoValor == null ? null : Number(recebidoValor),
          status: recebidoEm ? "recebida" : "pendente",
        });
      });
    }
    return {
      rows: out.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "")),
      inconsistentes: semVenda,
    };
  }, [occs, saleById]);

  const hoje = todayISO();
  const saleLabel = useCallback(
    (sale: SaleSummary | undefined) =>
      sale?.imovel_id || sale?.codigo_interno || (sale ? `Venda #${sale.id.slice(0, 8)}` : "—"),
    [],
  );
  const corretorNome = useCallback(
    (sale: SaleSummary | undefined) => (sale ? (profileName[sale.corretor_id] ?? "—") : "—"),
    [profileName],
  );

  const formas = useMemo(
    () =>
      Array.from(
        new Set(allRows.map((r) => r.forma).filter((forma): forma is string => Boolean(forma))),
      ).sort(),
    [allRows],
  );
  const corretores = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.sale.corretor_id)))
        .map((id) => ({ id, name: profileName[id] ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [allRows, profileName],
  );
  const rows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return allRows.filter((row) => {
      if (view !== "todas" && row.status !== (view === "recebidas" ? "recebida" : "pendente"))
        return false;
      if (deadlineFilter !== "todos") {
        if (row.status === "recebida") return false;
        const vencida = Boolean(row.data && row.data < hoje);
        if (deadlineFilter === "vencidas" && !vencida) return false;
        if (deadlineFilter === "a_vencer" && vencida) return false;
      }
      if (brokerFilter !== "todos" && row.sale.corretor_id !== brokerFilter) return false;
      if (formFilter !== "todos" && row.forma !== formFilter) return false;
      const referenceDate = row.status === "recebida" ? (row.recebidoEm ?? row.data) : row.data;
      if (dateFrom && (!referenceDate || referenceDate < dateFrom)) return false;
      if (dateTo && (!referenceDate || referenceDate > dateTo)) return false;
      if (query) {
        const haystack =
          `${saleLabel(row.sale)} ${corretorNome(row.sale)} ${row.forma ?? ""}`.toLocaleLowerCase(
            "pt-BR",
          );
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [
    allRows,
    brokerFilter,
    corretorNome,
    dateFrom,
    dateTo,
    deadlineFilter,
    formFilter,
    hoje,
    saleLabel,
    search,
    view,
  ]);

  useEffect(() => {
    setSelected(new Set());
  }, [brokerFilter, dateFrom, dateTo, deadlineFilter, formFilter, search, view]);

  const pendingRows = allRows.filter((r) => r.status === "pendente");
  const receivedRows = allRows.filter((r) => r.status === "recebida");
  const selectableRows = rows.filter((r) => r.status === "pendente");

  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.key));
  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(selectableRows.map((r) => r.key)) : new Set());
  const toggleOne = (key: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  const selecionadas = rows.filter((r) => r.status === "pendente" && selected.has(r.key));
  const totalSelecionado = selecionadas.reduce((s, r) => s + r.valor, 0);
  const totalPendente = pendingRows.reduce((s, r) => s + r.valor, 0);
  const totalVencido = pendingRows
    .filter((r) => r.data && r.data < hoje)
    .reduce((s, r) => s + r.valor, 0);
  const totalRecebido = receivedRows.reduce((s, r) => s + r.valor, 0);

  const abrirConfirmacao = () => {
    setMarkDate(hoje);
    setConfirmOpen(true);
  };

  const confirmarSelecionadas = async () => {
    if (!selecionadas.length) return;
    setMarking(true);
    try {
      const results = await Promise.all(
        selecionadas.map((r) => {
          const patch: OccurrenceUpdate =
            r.parcela === 1
              ? { prev_recebimento_recebido_em: markDate, prev_recebimento_recebido_valor: r.valor }
              : r.parcela === 2
                ? {
                    prev_recebimento2_recebido_em: markDate,
                    prev_recebimento2_recebido_valor: r.valor,
                  }
                : {
                    prev_recebimento3_recebido_em: markDate,
                    prev_recebimento3_recebido_valor: r.valor,
                  };
          return supabase.from("occurrences").update(patch).eq("id", r.occId);
        }),
      );
      const falhas = results.filter((r) => r.error);
      if (falhas.length)
        toast.error(`${falhas.length} de ${selecionadas.length} falharam ao salvar`);
      else toast.success(`${selecionadas.length} parcela(s) marcada(s) como recebida(s)`);
      setConfirmOpen(false);
      load();
    } finally {
      setMarking(false);
    }
  };

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita ao Financeiro. Se você acredita que deveria ter acesso, peça ao
          administrador.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Baixa de recebimentos</h1>
        <p className="text-sm text-muted-foreground">
          Área operacional para confirmar parcelas recebidas. Os valores já mostram somente a fatia
          própria da imobiliária, sem parcerias externas.
        </p>
      </div>

      {inconsistentes.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">
            {inconsistentes.length} ocorrência(s) sem venda correspondente carregada — excluída(s)
            do total pendente por segurança. Verifique com o suporte técnico.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Total pendente (nossa parte)</p>
            <p className="text-xl font-semibold">{money(totalPendente)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Pendente vencido</p>
            <p className="text-xl font-semibold text-destructive">{money(totalVencido)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Total recebido</p>
            <p className="text-xl font-semibold text-emerald-700">{money(totalRecebido)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground">Selecionado</p>
            <p className="text-xl font-semibold text-primary">{money(totalSelecionado)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <Tabs
            value={view}
            onValueChange={(value) => setView(value as "pendentes" | "recebidas" | "todas")}
          >
            <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
              <TabsTrigger value="pendentes">A receber ({pendingRows.length})</TabsTrigger>
              <TabsTrigger value="recebidas">Recebidas ({receivedRows.length})</TabsTrigger>
              <TabsTrigger value="todas">Todas ({allRows.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <Input
              placeholder="Buscar imóvel, corretor ou forma..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar recebimentos"
            />
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={brokerFilter}
              onChange={(e) => setBrokerFilter(e.target.value)}
              aria-label="Filtrar por corretor"
            >
              <option value="todos">Todos os corretores</option>
              {corretores.map((corretor) => (
                <option key={corretor.id} value={corretor.id}>
                  {corretor.name}
                </option>
              ))}
            </select>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={formFilter}
              onChange={(e) => setFormFilter(e.target.value)}
              aria-label="Filtrar por forma de recebimento"
            >
              <option value="todos">Todas as formas</option>
              {formas.map((forma) => (
                <option key={forma} value={forma}>
                  {forma}
                </option>
              ))}
            </select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Data inicial"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Data final"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Label htmlFor="deadline-filter">Pendências</Label>
              <select
                id="deadline-filter"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={deadlineFilter}
                onChange={(e) => setDeadlineFilter(e.target.value as typeof deadlineFilter)}
              >
                <option value="todos">Todas</option>
                <option value="vencidas">Vencidas</option>
                <option value="a_vencer">A vencer</option>
              </select>
            </div>
            <Button size="sm" disabled={selecionadas.length === 0} onClick={abrirConfirmacao}>
              <Wallet className="mr-2 h-4 w-4" />
              Marcar {selecionadas.length > 0 ? `${selecionadas.length} ` : ""}como recebida(s)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {view === "pendentes"
              ? "A receber"
              : view === "recebidas"
                ? "Recebidas"
                : "Todas as parcelas"}{" "}
            ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => toggleAll(!!v)}
                    disabled={rows.length === 0}
                  />
                </TableHead>
                <TableHead>Imóvel</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Recebida em</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma parcela encontrada com os filtros atuais.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(r.key)}
                      onCheckedChange={(v) => toggleOne(r.key, !!v)}
                      disabled={r.status === "recebida"}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    {r.sale ? (
                      <Link to="/vendas/$id" params={{ id: r.sale.id }} className="hover:underline">
                        {saleLabel(r.sale)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{corretorNome(r.sale)}</TableCell>
                  <TableCell>{r.parcela}ª</TableCell>
                  <TableCell>{r.data ? dateBR(r.data) : "—"}</TableCell>
                  <TableCell>{r.recebidoEm ? dateBR(r.recebidoEm) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.forma ?? "—"}</TableCell>
                  <TableCell>{money(r.valor)}</TableCell>
                  <TableCell>
                    <span
                      className={
                        r.status === "recebida"
                          ? "text-emerald-700"
                          : r.data && r.data < hoje
                            ? "text-destructive"
                            : "text-muted-foreground"
                      }
                    >
                      {r.status === "recebida"
                        ? "Recebida"
                        : r.data && r.data < hoje
                          ? "Vencida"
                          : "A vencer"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!marking && !o) setConfirmOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar {selecionadas.length} parcela(s) como recebida(s)</DialogTitle>
            <DialogDescription>
              O valor recebido de cada parcela será o valor previsto ({money(totalSelecionado)} no
              total). Pra registrar um valor diferente do previsto numa parcela específica, use a
              tela de Relatórios.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs text-muted-foreground">
              Data do recebimento
            </Label>
            <Input type="date" value={markDate} onChange={(e) => setMarkDate(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={marking}>
              Cancelar
            </Button>
            <Button onClick={confirmarSelecionadas} disabled={marking || !markDate}>
              {marking ? "Salvando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
