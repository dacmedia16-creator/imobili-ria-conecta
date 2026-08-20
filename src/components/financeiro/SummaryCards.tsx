import { Card, CardContent } from "@/components/ui/card";
import { InfoDot } from "@/components/dashboard/shared";
import { money } from "@/components/vendas/shared";
import type { ResumoFinanceiro } from "@/lib/financeiro-dashboard-types";

function Card1({
  label,
  valor,
  tone,
  info,
}: {
  label: string;
  valor: string;
  tone?: string;
  info?: string;
}) {
  return (
    <Card className="relative">
      {info && <InfoDot text={info} />}
      <CardContent className="pt-6">
        <p className="text-xs text-muted-foreground pr-4">{label}</p>
        <p className={`text-xl font-semibold ${tone ?? ""}`}>{valor}</p>
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ resumo }: { resumo: ResumoFinanceiro }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <Card1
        label="VGV efetivado"
        valor={money(resumo.vgvEfetivado) ?? "—"}
        info="Soma do valor negociado das vendas que efetivaram (contrato assinado, ou em Lançamento avançou pro financeiro) dentro do período e filtros aplicados."
      />
      <Card1
        label="Comissão bruta das vendas"
        valor={money(resumo.comissaoBruta) ?? "—"}
        info="Soma do valor total de comissão gravado em cada venda efetivada no período — ainda não desconta parceria externa nem divide entre beneficiários."
      />
      <Card1
        label="Comissões calculadas (beneficiários)"
        valor={money(resumo.comissoesCalculadasTotal) ?? "—"}
        info="Soma da comissão já calculada por beneficiário (corretor, captador, gestor, team leader etc.) nas vendas do período — pode diferir da comissão bruta porque é por pessoa, não por venda."
      />
      <Card1
        label="Divergências abertas"
        valor={String(resumo.divergenciasAbertas)}
        tone={resumo.divergenciasAbertas > 0 ? "text-destructive" : ""}
        info="Quantidade de divergências entre previsto e recebido (ou de beneficiário sem vínculo de usuário) ainda não resolvidas — ver aba Divergências."
      />
      <Card1
        label="Previsto para a imobiliária receber"
        valor={money(resumo.previstoImobiliaria) ?? "—"}
        info="Soma do valor líquido previsto (já descontada a parceria externa) de todas as parcelas ativas — recebidas ou não — dentro do período e filtros aplicados."
      />
      <Card1
        label="Recebido pela imobiliária"
        valor={money(resumo.recebidoImobiliaria) ?? "—"}
        tone="text-emerald-700 dark:text-emerald-400"
        info="Soma do valor efetivamente recebido nas parcelas ativas que já têm data de recebimento registrada."
      />
      <Card1
        label="Saldo a receber"
        valor={money(resumo.saldoAReceber) ?? "—"}
        info="Previsto para a imobiliária receber menos recebido pela imobiliária — o que ainda falta entrar, entre vencido e a vencer."
      />
      <Card1
        label="Vencido"
        valor={money(resumo.vencido) ?? "—"}
        tone={resumo.vencido > 0 ? "text-destructive" : ""}
        info="Soma do valor líquido previsto das parcelas cuja data prevista já passou e que ainda não foram recebidas."
      />
      <Card1
        label="A vencer"
        valor={money(resumo.aVencer) ?? "—"}
        info="Soma do valor líquido previsto das parcelas ainda não recebidas cuja data prevista está no futuro."
      />
      <Card1
        label="Previsão 30 dias"
        valor={money(resumo.previsao30) ?? "—"}
        info="Do valor 'A vencer', soma só das parcelas com data prevista até 30 dias a partir de hoje."
      />
      <Card1
        label="Previsão 60 dias"
        valor={money(resumo.previsao60) ?? "—"}
        info="Do valor 'A vencer', soma só das parcelas com data prevista até 60 dias a partir de hoje."
      />
      <Card1
        label="Previsão 90 dias"
        valor={money(resumo.previsao90) ?? "—"}
        info="Do valor 'A vencer', soma só das parcelas com data prevista até 90 dias a partir de hoje."
      />
    </div>
  );
}
