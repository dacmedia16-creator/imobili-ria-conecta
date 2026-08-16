import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { money } from "@/components/vendas/shared";
import {
  agruparComissoes,
  agruparParcelasPorMes,
  calcularAging,
} from "@/lib/financeiro-dashboard-calc";
import type {
  AgingFaixa,
  ComissaoCalculada,
  ParcelaRecebimento,
} from "@/lib/financeiro-dashboard-types";

const mesLabel = (m: string) => {
  if (!m || m === "sem_data") return "—";
  const [ano, mes] = m.split("-");
  return new Date(Number(ano), Number(mes) - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
    .replace(".", "");
};

const previstoRecebidoConfig = {
  previsto: { label: "Previsto", color: "var(--color-chart-1)" },
  recebido: { label: "Recebido", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

const vencidoConfig = {
  valor: { label: "Vencido", color: "var(--color-chart-5)" },
} satisfies ChartConfig;
const papelConfig = {
  valorTotal: { label: "Comissão calculada", color: "var(--color-chart-3)" },
} satisfies ChartConfig;

/** Todo gráfico usa exatamente a mesma base (já filtrada) que alimenta os cards e as tabelas —
 * nunca recalcula, só agrupa/reformata pra visualização (ver item 13 do pedido original). */
export function OverviewCharts({
  parcelas,
  comissoes,
  hoje,
}: {
  parcelas: ParcelaRecebimento[];
  comissoes: ComissaoCalculada[];
  hoje: string;
}) {
  const porMes = agruparParcelasPorMes(parcelas);
  const { vencido }: { vencido: AgingFaixa[] } = calcularAging(parcelas, hoje);
  const vencidoData = vencido
    .filter((f) => f.quantidade > 0)
    .map((f) => ({ label: f.label.replace("Vencido ", ""), valor: f.valor }));
  const porPapel = agruparComissoes(comissoes, "papel").slice(0, 8);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Previsto × Recebido por mês</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={previstoRecebidoConfig} className="aspect-auto h-[180px] w-full">
            <BarChart data={porMes} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="mes"
                tickFormatter={mesLabel}
                tickLine={false}
                axisLine={false}
                fontSize={10}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                fontSize={10}
                width={32}
                tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(l) => mesLabel(String(l))}
                    formatter={(v) => money(Number(v)) ?? ""}
                  />
                }
              />
              <Bar dataKey="previsto" fill="var(--color-previsto)" radius={3} />
              <Bar dataKey="recebido" fill="var(--color-recebido)" radius={3} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vencido por faixa de atraso</CardTitle>
        </CardHeader>
        <CardContent>
          {vencidoData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nada vencido no filtro atual.
            </p>
          ) : (
            <ChartContainer config={vencidoConfig} className="aspect-auto h-[180px] w-full">
              <BarChart data={vencidoData} margin={{ left: -20 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={9}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  width={32}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => money(Number(v)) ?? ""} />}
                />
                <Bar dataKey="valor" fill="var(--color-valor)" radius={3} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comissão calculada por papel</CardTitle>
        </CardHeader>
        <CardContent>
          {porPapel.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma comissão calculada no filtro atual.
            </p>
          ) : (
            <ChartContainer config={papelConfig} className="aspect-auto h-[180px] w-full">
              <BarChart data={porPapel} margin={{ left: -20 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  fontSize={9}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={40}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  fontSize={10}
                  width={32}
                  tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => money(Number(v)) ?? ""} />}
                />
                <Bar dataKey="valorTotal" fill="var(--color-valorTotal)" radius={3} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
