import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  fetchComissaoPorCoordenador,
  type RelatorioComissaoCoordenador,
  type Secao,
} from "@/lib/comissao-coordenador";

export const Route = createFileRoute("/_authenticated/comissao-coordenador")({
  head: () => ({ meta: [{ title: "Comissão por Coordenador" }] }),
  component: ComissaoCoordenador,
});

const BLOCO_LABEL = { AGENTES: "Agentes", TEAM_LEADERS: "Team Leaders" } as const;

const money = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

/** Últimos 12 meses (mês atual primeiro) — value no formato "YYYY-MM-01", que é o que a RPC espera. */
function ultimosMeses(): { value: string; label: string }[] {
  const hoje = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return { value, label: label.charAt(0).toUpperCase() + label.slice(1) };
  });
}

function SecaoCard({ secao }: { secao: Secao }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{secao.nome}</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {money(secao.subtotalComissao)} · {money(secao.subtotalVgv6pct)}
        </span>
      </div>
      <Table>
        <TableBody>
          {secao.itens.map((item, i) => (
            <TableRow key={`${item.occurrenceId}-${item.tipo}-${i}`}>
              <TableCell className="py-1.5">
                {item.tipo === "coordenacao" ? (
                  <span className="italic text-muted-foreground">
                    (coordenação)
                    {item.vendaDe && <span> — venda de {item.vendaDe}</span>}
                  </span>
                ) : (
                  <span>
                    {item.nome}
                    {item.vendeuElaMesma && (
                      <span className="text-muted-foreground"> — vendeu ela/ele mesma(o)</span>
                    )}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={`ml-2 align-middle text-[10px] ${item.modalidade === "lancamento" ? "border-amber-400 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                >
                  {item.modalidade === "lancamento" ? "Lançamento" : "Padrão"}
                </Badge>
              </TableCell>
              <TableCell className="py-1.5 text-right font-mono text-sm">{money(item.valor)}</TableCell>
              <TableCell className="py-1.5 text-right font-mono text-sm text-muted-foreground">
                {money(Math.round((item.valor / 0.06) * 100) / 100)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t">
            <TableCell className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sub total
            </TableCell>
            <TableCell className="py-1.5 text-right font-mono text-sm font-semibold">
              {money(secao.subtotalComissao)}
            </TableCell>
            <TableCell className="py-1.5 text-right font-mono text-sm font-semibold">
              {money(secao.subtotalVgv6pct)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function ComissaoCoordenador() {
  const { hasAny, loading: authLoading } = useAuth();
  const allowed = hasAny(["admin", "super_admin", "financeiro"]);
  const meses = useMemo(ultimosMeses, []);
  const [mes, setMes] = useState(meses[0].value);
  const [relatorio, setRelatorio] = useState<RelatorioComissaoCoordenador | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelado = false;
    setLoading(true);
    setErro(null);
    fetchComissaoPorCoordenador(mes)
      .then((r) => {
        if (!cancelado) setRelatorio(r);
      })
      .catch((e: unknown) => {
        console.error("fetchComissaoPorCoordenador:", e);
        if (!cancelado) setErro("Não foi possível carregar o relatório.");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [mes, allowed]);

  if (authLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!allowed) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Esta área é restrita a administradores e ao financeiro.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Comissão por Coordenador</h1>
          <p className="text-sm text-muted-foreground">
            Ocorrências concluídas no mês selecionado, agrupadas pelo gestor/team leader responsável
            por cada venda.
          </p>
        </div>
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {meses.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {!loading && !erro && relatorio && relatorio.secoes.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma ocorrência concluída neste mês.
          </CardContent>
        </Card>
      )}

      {!loading &&
        !erro &&
        relatorio &&
        (["AGENTES", "TEAM_LEADERS"] as const).map((bloco) => {
          const secoesDoBloco = relatorio.secoes.filter((s) => s.bloco === bloco);
          if (secoesDoBloco.length === 0) return null;
          const totalBloco = relatorio.blocos.find((b) => b.bloco === bloco);
          return (
            <Card key={bloco}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{BLOCO_LABEL[bloco]}</CardTitle>
                {totalBloco && (
                  <span className="font-mono text-sm font-semibold">
                    {money(totalBloco.comissao)} · {money(totalBloco.vgv6pct)}
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                {secoesDoBloco.map((secao) => (
                  <SecaoCard key={secao.chave} secao={secao} />
                ))}
              </CardContent>
            </Card>
          );
        })}

      {!loading && !erro && relatorio && relatorio.secoes.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <span className="text-base font-semibold">Total geral</span>
            <span className="font-mono text-lg font-semibold">
              {money(relatorio.totalComissao)}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                VGV a 6%: {money(relatorio.totalVgv6pct)}
              </span>
            </span>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        VGV a 6% é a comissão dividida por 0,06 — um VGV equivalente assumindo taxa fixa de 6%, não o
        valor negociado real da venda. "(coordenação)" é a comissão de supervisão do gestor/team
        leader sobre a venda de outra pessoa — nunca conta como uma venda própria dele.
      </p>
    </div>
  );
}
