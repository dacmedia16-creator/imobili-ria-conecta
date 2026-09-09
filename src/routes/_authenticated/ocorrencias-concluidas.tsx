import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
  chaveMesConclusao,
  mesesOcorrenciasConcluidas,
  resumoOcorrenciasConcluidas,
  montarOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
  ultimaConclusaoPorSale,
  type OcorrenciaConcluidaRow,
} from "@/lib/ocorrencias-concluidas";

export const Route = createFileRoute("/_authenticated/ocorrencias-concluidas")({
  head: () => ({ meta: [{ title: "Ocorrências concluídas" }] }),
  // Mesma proteção em 3 camadas do Financeiro: rota (aqui), componente (useAuth) e RLS no banco.
  // Aqui não há nenhuma query sem filtro de papel: o banco já entrega só o que can_view_sale/
  // is_lead_of permitem (gestor/team_leader → própria equipe; financeiro/admin/super_admin → tudo).
  beforeLoad: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id);
    const roles = (data ?? []).map((r) => r.role);
    if (!podeVerOcorrenciasConcluidas(roles)) {
      toast.error("Acesso não autorizado.");
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OcorrenciasConcluidasPage,
});

const OCC_COLUMNS = "id, sale_id, valor_comissao, updated_at";

function OcorrenciasConcluidasPage() {
  const { hasAny, loading: authLoading } = useAuth();
  const router = useRouter();
  const allowed = hasAny(["gestor", "team_leader", "admin", "super_admin", "financeiro"]);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [rows, setRows] = useState<OcorrenciaConcluidaRow[]>([]);
  const [mesAtual] = useState(() => chaveMesConclusao());
  const [mesSelecionado, setMesSelecionado] = useState("todos");

  const carregar = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const { data: occs } = await supabase
        .from("occurrences")
        .select(OCC_COLUMNS)
        .eq("status", "concluida");
      const saleIds = Array.from(new Set((occs ?? []).map((o) => o.sale_id)));

      const [salesRes, profilesRes, historyRes] = await Promise.all([
        saleIds.length
          ? supabase
              .from("sales")
              .select("id, codigo_interno, imovel_id, corretor_id")
              .in("id", saleIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                codigo_interno: string | null;
                imovel_id: string | null;
                corretor_id: string | null;
              }[],
              error: null,
            }),
        supabase.from("profiles").select("id, nome"),
        saleIds.length
          ? supabase
              .from("sale_status_history")
              .select("sale_id, created_at")
              .eq("para", "ocorrencia_concluida")
              .in("sale_id", saleIds)
          : Promise.resolve({
              data: [] as { sale_id: string; created_at: string }[],
              error: null,
            }),
      ]);

      const nomesPorId: Record<string, string> = {};
      for (const p of profilesRes.data ?? []) nomesPorId[p.id] = p.nome ?? p.id;

      setRows(
        montarOcorrenciasConcluidas({
          occs: occs ?? [],
          sales: salesRes.data ?? [],
          nomesPorId,
          conclusoesPorSale: ultimaConclusaoPorSale(historyRes.data ?? []),
        }),
      );
    } catch (err) {
      setRows([]);
      setErro(err instanceof Error ? err.message : "Falha ao carregar as ocorrências concluídas.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const meses = mesesOcorrenciasConcluidas(rows, mesAtual);
  const { rows: rowsFiltradas, totalComissao } = resumoOcorrenciasConcluidas(rows, mesSelecionado);
  const mesLabel = meses.find((mes) => mes.value === mesSelecionado)?.label;

  if (authLoading || loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a gestores, team leaders, financeiro e administradores.
        </CardContent>
      </Card>
    );
  }

  if (erro) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="space-y-3 py-8 text-center">
          <p className="font-medium text-destructive">
            Não foi possível carregar as ocorrências concluídas.
          </p>
          <p className="text-sm text-muted-foreground">{erro}</p>
          <Button type="button" variant="outline" onClick={() => void carregar()}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ocorrências concluídas</h1>
          <p className="text-sm text-muted-foreground">
            Consulte as ocorrências financeiras já concluídas por mês ou todo o histórico.
          </p>
        </div>
        <div className="w-full space-y-1 sm:w-56 sm:shrink-0">
          <label htmlFor="mes-conclusao" className="text-sm font-medium">
            Mês
          </label>
          <Select value={mesSelecionado} onValueChange={setMesSelecionado}>
            <SelectTrigger id="mes-conclusao">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {meses.map((mes) => (
                <SelectItem key={mes.value} value={mes.value}>
                  {mes.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel / código</TableHead>
                <TableHead>Corretor</TableHead>
                <TableHead>Comissão</TableHead>
                <TableHead>Data de conclusão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rowsFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    {mesSelecionado === "todos"
                      ? "Nenhuma ocorrência concluída."
                      : `Nenhuma ocorrência concluída em ${mesLabel?.toLocaleLowerCase("pt-BR")}.`}
                  </TableCell>
                </TableRow>
              )}
              {rowsFiltradas.map((r) => (
                <TableRow
                  key={r.saleId}
                  className="cursor-pointer"
                  onClick={() => router.navigate({ to: "/vendas/$id", params: { id: r.saleId } })}
                >
                  <TableCell className="font-medium">{r.imovelLabel}</TableCell>
                  <TableCell className="text-muted-foreground">{r.corretorNome ?? "—"}</TableCell>
                  <TableCell>{money(r.valorComissao)}</TableCell>
                  <TableCell className="text-muted-foreground">{dateBR(r.dataConclusao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
