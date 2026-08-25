import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ComparativoRowComCalculo, GrupoMensal, GrupoSecundario } from "@/lib/comparativo-comissao-types";
import { agruparPor, agruparPorMes } from "@/lib/comparativo-comissao-calc";
import { formatMoney, formatPercent } from "./format";

const mesLabel = (m: string) => {
  const [ano, mes] = m.split("-");
  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

// Mesma lógica de ícone+cor do DetailTable, adaptada pro grupo (que não tem "situacao", só o sinal
// agregado de diferenca): positivo = abaixo do padrão 6% (perda, vermelho), negativo = acima (azul).
function DiferencaIcon({ diferenca }: { diferenca: number }) {
  if (diferenca > 0) return <TrendingDown className="h-3.5 w-3.5" />;
  if (diferenca < 0) return <TrendingUp className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function GrupoRow({ label, g, zebra }: { label: string; g: GrupoMensal | GrupoSecundario; zebra: boolean }) {
  return (
    <TableRow className={zebra ? "bg-muted/25" : undefined}>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right tabular-nums">{g.quantidade}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(g.vgvReal)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(g.comissaoTotal)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatPercent(g.percentualMedioPonderado)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(g.vgvEquivalente6)}</TableCell>
      <TableCell className={`text-right tabular-nums ${g.diferenca > 0 ? "text-destructive" : g.diferenca < 0 ? "text-blue-700 dark:text-blue-400" : ""}`}>
        <span className="inline-flex items-center justify-end gap-1">
          <DiferencaIcon diferenca={g.diferenca} />
          {formatMoney(g.diferenca)}
        </span>
      </TableCell>
    </TableRow>
  );
}

function GrupoTable({ rows, labelHeader }: { rows: { label: string; g: GrupoMensal | GrupoSecundario }[]; labelHeader: string }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead>{labelHeader}</TableHead>
            <TableHead className="text-right">Vendas</TableHead>
            <TableHead className="text-right">VGV real</TableHead>
            <TableHead className="text-right">Comissão REMAX</TableHead>
            <TableHead className="text-right">% médio ponderado</TableHead>
            <TableHead className="text-right">VGV equiv. 6%</TableHead>
            <TableHead className="text-right">Diferença</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Sem dados no período/filtro selecionado.</TableCell></TableRow>
          )}
          {rows.map(({ label, g }, i) => <GrupoRow key={label} label={label} g={g} zebra={i % 2 === 1} />)}
        </TableBody>
      </Table>
    </div>
  );
}

export function MonthlyGrouping({ rows }: { rows: ComparativoRowComCalculo[] }) {
  const porMes = useMemo(() => agruparPorMes(rows), [rows]);
  const porCorretor = useMemo(() => agruparPor(rows, "corretor"), [rows]);
  const porEquipe = useMemo(() => agruparPor(rows, "equipe"), [rows]);
  const porGestor = useMemo(() => agruparPor(rows, "gestor"), [rows]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-base">Por mês</CardTitle></CardHeader>
        <CardContent>
          <GrupoTable labelHeader="Mês" rows={porMes.map((g) => ({ label: mesLabel(g.mes), g }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Agrupamento adicional</CardTitle></CardHeader>
        <CardContent>
          <Tabs defaultValue="corretor">
            <TabsList className="mb-3">
              <TabsTrigger value="corretor">Por corretor</TabsTrigger>
              <TabsTrigger value="equipe">Por equipe</TabsTrigger>
              <TabsTrigger value="gestor">Por gestor/team leader</TabsTrigger>
            </TabsList>
            <TabsContent value="corretor">
              <GrupoTable labelHeader="Corretor" rows={porCorretor.map((g) => ({ label: g.label, g }))} />
            </TabsContent>
            <TabsContent value="equipe">
              <GrupoTable labelHeader="Equipe" rows={porEquipe.map((g) => ({ label: g.label, g }))} />
            </TabsContent>
            <TabsContent value="gestor">
              <GrupoTable labelHeader="Gestor/Team leader" rows={porGestor.map((g) => ({ label: g.label, g }))} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
