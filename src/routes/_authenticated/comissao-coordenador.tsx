import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function Figure({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`font-mono text-sm font-semibold ${dim ? "font-medium text-muted-foreground" : ""}`}
      >
        {money(value)}
      </span>
    </span>
  );
}

function FigurePair({ comissao, vgv6pct }: { comissao: number; vgv6pct: number }) {
  return (
    <span className="flex gap-5">
      <Figure label="Comissão" value={comissao} />
      <Figure label="VGV a 6%" value={vgv6pct} dim />
    </span>
  );
}

const HEAD_CLASS = "h-auto py-1 text-right text-[10px] font-semibold uppercase tracking-wide";

function SecaoCard({ secao }: { secao: Secao }) {
  // Só vale a pena separar coordenação de venda própria quando a pessoa tem os dois — senão o
  // "sub total" já É a coordenação (ou já É a venda), repetir a linha só some.
  const temAmbos = secao.subtotalComissaoCoordenacao > 0 && secao.subtotalComissaoCorretor > 0;

  return (
    <div>
      <div className="mb-1.5 flex items-start justify-between">
        <h3 className="text-sm font-semibold">{secao.nome}</h3>
        <FigurePair comissao={secao.subtotalComissao} vgv6pct={secao.subtotalVgv6pct} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-auto py-1"></TableHead>
            <TableHead className={HEAD_CLASS}>Comissão</TableHead>
            <TableHead className={HEAD_CLASS}>VGV a 6%</TableHead>
          </TableRow>
        </TableHeader>
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
              <TableCell className="py-1.5 text-right font-mono text-sm">
                {money(item.valor)}
              </TableCell>
              <TableCell className="py-1.5 text-right font-mono text-sm text-muted-foreground">
                {money(Math.round((item.valor / 0.06) * 100) / 100)}
              </TableCell>
            </TableRow>
          ))}
          {temAmbos && (
            <>
              <TableRow>
                <TableCell className="py-1 text-xs text-muted-foreground">Coordenação</TableCell>
                <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">
                  {money(secao.subtotalComissaoCoordenacao)}
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-xs text-muted-foreground">
                  {money(secao.subtotalVgv6pctCoordenacao)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="py-1 text-xs font-medium text-primary">Corretores</TableCell>
                <TableCell className="py-1 text-right font-mono text-xs font-medium text-primary">
                  {money(secao.subtotalComissaoCorretor)}
                </TableCell>
                <TableCell className="py-1 text-right font-mono text-xs font-medium text-primary">
                  {money(secao.subtotalVgv6pctCorretor)}
                </TableCell>
              </TableRow>
            </>
          )}
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

function BlocoResumo({
  totalBloco,
}: {
  totalBloco: RelatorioComissaoCoordenador["blocos"][number];
}) {
  return (
    <div className="grid grid-cols-3 divide-x rounded-md border bg-muted/30 text-sm">
      <div className="flex flex-col gap-1 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coordenação
        </span>
        <span className="font-mono text-base font-semibold">
          {money(totalBloco.comissaoCoordenacao)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          VGV a 6%: {money(totalBloco.vgv6pctCoordenacao)}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
          Corretores
        </span>
        <span className="font-mono text-base font-semibold text-primary">
          {money(totalBloco.comissaoCorretor)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          VGV a 6%: {money(totalBloco.vgv6pctCorretor)}
        </span>
      </div>
      <div className="flex flex-col gap-1 px-4 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Total do bloco
        </span>
        <span className="font-mono text-base font-semibold">{money(totalBloco.comissao)}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          VGV a 6%: {money(totalBloco.vgv6pct)}
        </span>
      </div>
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
          <p className="text-sm text-muted-foreground print:hidden">
            Ocorrências concluídas no mês selecionado, agrupadas pelo gestor/team leader responsável
            por cada venda.
          </p>
          <p className="hidden text-sm text-muted-foreground print:block">
            {meses.find((m) => m.value === mes)?.label}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
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
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir / baixar
          </Button>
        </div>
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
              <CardHeader className="flex flex-row items-start justify-between">
                <CardTitle>{BLOCO_LABEL[bloco]}</CardTitle>
                {totalBloco && (
                  <FigurePair comissao={totalBloco.comissao} vgv6pct={totalBloco.vgv6pct} />
                )}
              </CardHeader>
              <CardContent className="space-y-5">
                {totalBloco && <BlocoResumo totalBloco={totalBloco} />}
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
        VGV a 6% é a comissão dividida por 0,06 — um VGV equivalente assumindo taxa fixa de 6%, não
        o valor negociado real da venda. "(coordenação)" é a comissão de supervisão do gestor/team
        leader sobre a venda de outra pessoa — nunca conta como uma venda própria dele. Quando a
        pessoa tem os dois tipos de comissão no mês, a seção mostra "Coordenação" e "Corretores"
        separados, e o card acima soma essa mesma divisão pro bloco inteiro.
      </p>
    </div>
  );
}
