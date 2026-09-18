import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
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
import { money, dateBR } from "@/components/vendas/shared";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import {
  catalogoOcorrenciasConcluidas,
  chaveMesAtual,
  corretoresDaEquipe,
  corretorValidoNaEquipe,
  mesesOcorrenciasConcluidas,
  resumoOcorrenciasConcluidas,
  montarOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
  relatorioOcorrenciasConcluidasSchema,
  type CorretorRelatorio,
  type OpcaoRelatorio,
  type OcorrenciaConcluidaRow,
} from "@/lib/ocorrencias-concluidas";

export const Route = createFileRoute("/_authenticated/ocorrencias-concluidas")({
  head: () => ({ meta: [{ title: "Ocorrências concluídas" }] }),
  // Menu, rota e componente compartilham papéis. A RPC verifica usuário ativo e
  // autorização do relatório global; RLS dos detalhes/escrita permanece intacta.
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (error || !podeVerOcorrenciasConcluidas(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OcorrenciasConcluidasPage,
});

type EstadoRelatorio = {
  session: Session | null;
  rolesKey: string;
  tentativa: number;
  loading: boolean;
  erro: string | null;
  rows: OcorrenciaConcluidaRow[];
  equipes: OpcaoRelatorio[];
  corretores: CorretorRelatorio[];
};

function OcorrenciasConcluidasPage() {
  const { session, roles, loading: authLoading } = useAuth();
  const allowed = podeVerOcorrenciasConcluidas(roles);
  const rolesKey = [...roles].sort().join(",");
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<EstadoRelatorio | null>(null);
  const [mesAtual] = useState(() => chaveMesAtual());
  const [mesSelecionado, setMesSelecionado] = useState("todos");
  const [equipeSelecionada, setEquipeSelecionada] = useState("todas");
  const [corretorSelecionado, setCorretorSelecionado] = useState("todos");
  const [selectedOccurrenceIds, setSelectedOccurrenceIds] = useState<string[]>([]);

  useEffect(() => {
    // Cancela ao desmontar, mudar sessão/papéis ou tentar novamente. Mesmo que o
    // transporte ignore abort, uma resposta antiga nunca substitui a sessão atual.
    const controller = new AbortController();
    let ativo = true;
    const vazio: EstadoRelatorio = {
      session,
      rolesKey,
      tentativa,
      loading: true,
      erro: null,
      rows: [],
      equipes: [],
      corretores: [],
    };
    setEstado(vazio);
    if (authLoading || !session || !allowed)
      return () => {
        ativo = false;
        controller.abort();
      };

    const carregar = async () => {
      try {
        const { data, error } = await supabase
          .rpc("relatorio_ocorrencias_concluidas")
          .abortSignal(controller.signal);
        if (!ativo) return;
        if (error) throw new Error(error.message || "Falha ao consultar o relatório.");
        const resultado = relatorioOcorrenciasConcluidasSchema.safeParse(data);
        if (!resultado.success)
          throw new Error("O relatório retornou dados inválidos. Tente novamente.");
        const relatorio = resultado.data;
        const catalogo = catalogoOcorrenciasConcluidas(relatorio);
        const rows = montarOcorrenciasConcluidas({
          ...relatorio,
          // Os mesmos rótulos distinguem homônimos no seletor e na tabela.
          nomesPorId: Object.fromEntries(catalogo.corretores.map((c) => [c.id, c.label])),
          equipesPorCorretor: new Map(catalogo.corretores.map((c) => [c.id, c.equipeIds])),
          participantesPorOcorrencia: new Map(
            relatorio.occs.map((occ) => [
              occ.id,
              relatorio.participants
                .filter((participant) => participant.occurrence_id === occ.id)
                .map((participant) => participant.user_id),
            ]),
          ),
        });
        setEstado({ ...vazio, ...catalogo, rows, loading: false });
      } catch (err) {
        if (!ativo) return;
        setEstado({
          ...vazio,
          loading: false,
          erro: err instanceof Error ? err.message : "Falha ao carregar as ocorrências concluídas.",
        });
      }
    };
    void carregar();
    return () => {
      ativo = false;
      controller.abort();
    };
  }, [allowed, authLoading, session, rolesKey, tentativa]);

  if (authLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Carregando...
      </p>
    );
  if (!session || !allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Acesso não autorizado ao relatório de ocorrências concluídas.
        </CardContent>
      </Card>
    );
  }

  // Não mostra nem por um render os dados da identidade anterior, antes do cleanup.
  if (
    !estado ||
    estado.session !== session ||
    estado.rolesKey !== rolesKey ||
    estado.tentativa !== tentativa ||
    estado.loading
  ) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Carregando...
      </p>
    );
  }
  const { erro, rows, equipes, corretores } = estado;
  const meses = mesesOcorrenciasConcluidas(rows, mesAtual);
  const equipeAtual = equipes.some((e) => e.id === equipeSelecionada) ? equipeSelecionada : "todas";
  const corretorAtual = corretorValidoNaEquipe(corretores, equipeAtual, corretorSelecionado);
  const corretoresDisponiveis = corretoresDaEquipe(corretores, equipeAtual);
  const { rows: rowsFiltradas, totalComissao } = resumoOcorrenciasConcluidas(
    rows,
    mesSelecionado,
    equipeAtual,
    corretorAtual,
  );
  const trocarEquipe = (equipeId: string) => {
    setEquipeSelecionada(equipeId);
    setCorretorSelecionado(corretorValidoNaEquipe(corretores, equipeId, corretorAtual));
  };
  const selectedRows = rows.filter((row) => selectedOccurrenceIds.includes(row.ocorrenciaId));
  const allFilteredSelected =
    rowsFiltradas.length > 0 &&
    rowsFiltradas.every((row) => selectedOccurrenceIds.includes(row.ocorrenciaId));
  const toggleOccurrence = (occurrenceId: string) => {
    setSelectedOccurrenceIds((current) =>
      current.includes(occurrenceId)
        ? current.filter((id) => id !== occurrenceId)
        : [...current, occurrenceId],
    );
  };
  const toggleFilteredOccurrences = () => {
    const filteredIds = rowsFiltradas.map((row) => row.ocorrenciaId);
    setSelectedOccurrenceIds((current) => {
      if (filteredIds.every((id) => current.includes(id)))
        return current.filter((id) => !filteredIds.includes(id));
      return [...new Set([...current, ...filteredIds])];
    });
  };
  const imprimirSelecionadas = () => {
    if (selectedRows.length === 0) {
      toast.error("Selecione ao menos uma ocorrência para imprimir.");
      return;
    }
    const query = new URLSearchParams({
      ids: selectedRows.map((row) => row.saleId).join(","),
    });
    const printWindow = window.open(`/ocorrencias-imprimir?${query.toString()}`, "_blank");
    if (!printWindow) toast.error("Permita pop-ups para imprimir as ocorrências.");
  };

  if (erro) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <p role="alert" className="font-medium text-destructive">
            Não foi possível carregar as ocorrências concluídas.
          </p>
          <p className="text-sm text-muted-foreground">{erro}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setTentativa((atual) => atual + 1)}
          >
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="min-w-0 space-y-6 print:hidden">
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Ocorrências concluídas</h1>
            <p className="text-sm text-muted-foreground">
              Relatório global somente leitura. Combine mês da assinatura, equipe e corretor.
              Equipes refletem os vínculos diretos atuais, incluindo líderes e auxiliares.
            </p>
          </div>
          <div className="grid min-w-0 gap-3 md:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <label htmlFor="mes-assinatura" className="text-sm font-medium">
                Mês da assinatura
              </label>
              <Select value={mesSelecionado} onValueChange={setMesSelecionado}>
                <SelectTrigger id="mes-assinatura" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="todos">Todos os meses</SelectItem>
                  {meses.map((mes) => (
                    <SelectItem key={mes.value} value={mes.value}>
                      {mes.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor="equipe-relatorio" className="text-sm font-medium">
                Equipe
              </label>
              <Select value={equipeAtual} onValueChange={trocarEquipe}>
                <SelectTrigger id="equipe-relatorio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="todas">Todas as equipes</SelectItem>
                  {equipes.map((equipe) => (
                    <SelectItem
                      key={equipe.id}
                      value={equipe.id}
                      className="whitespace-normal [overflow-wrap:anywhere] [&>span:last-child]:min-w-0"
                    >
                      {equipe.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor="corretor-relatorio" className="text-sm font-medium">
                Corretor
              </label>
              <Select value={corretorAtual} onValueChange={setCorretorSelecionado}>
                <SelectTrigger id="corretor-relatorio" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-2rem)]">
                  <SelectItem value="todos">Todos os corretores</SelectItem>
                  {corretoresDisponiveis.map((corretor) => (
                    <SelectItem
                      key={corretor.id}
                      value={corretor.id}
                      className="whitespace-normal [overflow-wrap:anywhere] [&>span:last-child]:min-w-0"
                    >
                      {corretor.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Ocorrências concluídas</p>
              <p className="text-xl font-semibold">{rowsFiltradas.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-xs text-muted-foreground">Total de comissões</p>
              <p className="text-xl font-semibold text-primary">{money(totalComissao)}</p>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={toggleFilteredOccurrences}
              disabled={rowsFiltradas.length === 0}
              aria-label="Selecionar todas as ocorrências exibidas"
            />
            <span>
              {selectedRows.length === 0
                ? "Selecione as ocorrências que deseja imprimir"
                : `${selectedRows.length} ocorrência(s) selecionada(s)`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedRows.length > 0 && (
              <Button variant="ghost" onClick={() => setSelectedOccurrenceIds([])}>
                Limpar seleção
              </Button>
            )}
            <Button onClick={imprimirSelecionadas} disabled={selectedRows.length === 0}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir selecionadas
            </Button>
          </div>
        </div>

        <Card className="min-w-0">
          <CardContent className="min-w-0 px-3 pt-6 sm:px-6">
            <Table aria-label="Ocorrências concluídas filtradas" className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <span className="sr-only">Selecionar</span>
                  </TableHead>
                  <TableHead>Imóvel / código</TableHead>
                  <TableHead>Corretor</TableHead>
                  <TableHead>Comissão</TableHead>
                  <TableHead>Data da assinatura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Nenhuma ocorrência concluída para os filtros selecionados.
                    </TableCell>
                  </TableRow>
                )}
                {rowsFiltradas.map((r) => (
                  <TableRow key={r.ocorrenciaId}>
                    <TableCell>
                      <Checkbox
                        checked={selectedOccurrenceIds.includes(r.ocorrenciaId)}
                        onCheckedChange={() => toggleOccurrence(r.ocorrenciaId)}
                        aria-label={`Selecionar ocorrência de ${r.imovelLabel}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link
                        to="/vendas/$id"
                        params={{ id: r.saleId }}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        aria-label={`Abrir ocorrência de ${r.imovelLabel}`}
                      >
                        {r.imovelLabel}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 break-words text-muted-foreground">
                      {r.corretorNome ?? "Não informado"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{money(r.valorComissao)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.dataAssinatura ? dateBR(r.dataAssinatura) : "Não informada"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
