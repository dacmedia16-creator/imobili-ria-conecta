import { Card, CardContent } from "@/components/ui/card";
import { money } from "@/components/vendas/shared";
import type { ResumoFinanceiro } from "@/lib/financeiro-dashboard-types";

function Card1({ label, valor, tone }: { label: string; valor: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-semibold ${tone ?? ""}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ resumo }: { resumo: ResumoFinanceiro }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Card1 label="VGV efetivado" valor={money(resumo.vgvEfetivado) ?? "—"} />
      <Card1 label="Comissão bruta das vendas" valor={money(resumo.comissaoBruta) ?? "—"} />
      <Card1
        label="Comissões calculadas (beneficiários)"
        valor={money(resumo.comissoesCalculadasTotal) ?? "—"}
      />
      <Card1
        label="Divergências abertas"
        valor={String(resumo.divergenciasAbertas)}
        tone={resumo.divergenciasAbertas > 0 ? "text-destructive" : ""}
      />
      <Card1
        label="Previsto para a imobiliária receber"
        valor={money(resumo.previstoImobiliaria) ?? "—"}
      />
      <Card1
        label="Recebido pela imobiliária"
        valor={money(resumo.recebidoImobiliaria) ?? "—"}
        tone="text-emerald-700 dark:text-emerald-400"
      />
      <Card1 label="Saldo a receber" valor={money(resumo.saldoAReceber) ?? "—"} />
      <Card1
        label="Vencido"
        valor={money(resumo.vencido) ?? "—"}
        tone={resumo.vencido > 0 ? "text-destructive" : ""}
      />
      <Card1 label="A vencer" valor={money(resumo.aVencer) ?? "—"} />
      <Card1 label="Previsão 30 dias" valor={money(resumo.previsao30) ?? "—"} />
      <Card1 label="Previsão 60 dias" valor={money(resumo.previsao60) ?? "—"} />
      <Card1 label="Previsão 90 dias" valor={money(resumo.previsao90) ?? "—"} />
    </div>
  );
}
