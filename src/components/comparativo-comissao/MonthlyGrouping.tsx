import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ComparativoRowComCalculo, GrupoMensal, GrupoSecundario } from "@/lib/comparativo-comissao-types";
import { agruparPor, agruparPorMes } from "@/lib/comparativo-comissao-calc";
import { formatMoney, formatPercent } from "./format";

const mesLabel = (m: string) => {
  const [ano, mes] = m.split("-");
  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
};

function GrupoRow({ label, g }: { label: string; g: GrupoMensal | GrupoSecundario }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right">{g.quantidade}</TableCell>
      <TableCell className="text-right">{formatMoney(g.vgvReal)}</TableCell>
      <TableCell className="text-right">{formatMoney(g.comissaoTotal)}</TableCell>
      <TableCell className="text-right">{formatPercent(g.percentualMedioPonderado)}</TableCell>
      <TableCell className="text-right">{formatMoney(g.vgvEquivalente6)}</TableCell>
      <TableCell className={`text-right ${g.diferenca > 0 ? "text-destructive" : ""}`}>{formatMoney(g.diferenca)}</TableCell>
    </TableRow>
  );
}

function GrupoTable({ rows, labelHeader }: { rows: { label: string; g: GrupoMensal | GrupoSecundario }[]; labelHeader: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labelHeader}</TableHead>
          <TableHead className="text-right">Vendas</TableHead>
          <TableHead className="text-right">VGV real</TableHead>
          <TableHead className="text-right">Comissão total</TableHead>
          <TableHead className="text-right">% médio ponderado</TableHead>
          <TableHead className="text-right">VGV equiv. 6%</TableHead>
          <TableHead className="text-right">Diferença</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Sem dados no período/filtro selecionado.</TableCell></TableRow>
        )}
        {rows.map(({ label, g }) => <GrupoRow key={label} label={label} g={g} />)}
      </TableBody>
    </Table>
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
