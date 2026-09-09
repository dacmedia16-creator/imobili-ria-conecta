import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="min-w-0 space-y-6">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ocorrências concluídas</h1>
          <p className="text-sm text-muted-foreground">
            Relatório global somente leitura. Combine mês da assinatura, equipe e corretor. Equipes
            refletem os vínculos diretos atuais, incluindo líderes e auxiliares.
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

      <Card className="min-w-0">
        <CardContent className="min-w-0 px-3 pt-6 sm:px-6">
          <Table aria-label="Ocorrências concluídas filtradas" className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel / código</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Comissão</TableHead>
                <TableHead>Data da assinatura</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma ocorrência concluída para os filtros selecionados.
                  </TableCell>
                </TableRow>
              )}
              {rowsFiltradas.map((r) => (
                <TableRow key={r.ocorrenciaId}>
                  <TableCell className="font-medium">{r.imovelLabel}</TableCell>
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
  );
}
