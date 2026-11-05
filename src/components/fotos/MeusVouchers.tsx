import { Link } from "@tanstack/react-router";
import { Camera, Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState, Pill, type Tom } from "@/components/visual/base";
import {
  contarVouchers,
  dataCurta,
  progressoMeta,
  ROTULO_VOUCHER,
  type ResumoFotos,
  type StatusVoucher,
} from "@/lib/vouchers-fotos";

const TOM_VOUCHER: Record<StatusVoucher, Tom> = {
  disponivel: "green",
  agendado: "blue",
  usado: "slate",
  vencido: "red",
};

/** Barra "x de 3" do mês + vouchers com status e validade (Minha carreira e Agendar fotos). */
export function MeusVouchers({ resumo, comBotao = true }: { resumo: ResumoFotos; comBotao?: boolean }) {
  const p = progressoMeta(resumo.mes);
  const c = contarVouchers(resumo.vouchers);
  return (
    <Card data-testid="meus-vouchers">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ticket className="h-5 w-5" aria-hidden /> Vouchers de fotos
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          3 captações exclusivas assinadas no mês = 3 vouchers de sessão de fotos. Cada captação a
          mais no mesmo mês vale +1.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5" data-testid="barra-meta">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Captações assinadas este mês</span>
            <span className="text-sm font-semibold tabular-nums">
              {p.texto}
              {p.extras > 0 ? ` (+${p.extras})` : ""}
            </span>
          </div>
          <Progress value={p.pct} aria-label={`Meta do mês: ${p.texto}`} />
          <p className="text-xs text-muted-foreground">{p.frase}</p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Pill tom="green">{c.disponivel} disponíve{c.disponivel === 1 ? "l" : "is"}</Pill>
          <Pill tom="blue">{c.agendado} agendado{c.agendado === 1 ? "" : "s"}</Pill>
          <Pill tom="slate">{c.usado} usado{c.usado === 1 ? "" : "s"}</Pill>
          {c.vencido > 0 && <Pill tom="red">{c.vencido} vencido{c.vencido === 1 ? "" : "s"}</Pill>}
        </div>

        {resumo.vouchers.length === 0 ? (
          <EmptyState icon={Ticket}>Você ainda não tem vouchers de fotos.</EmptyState>
        ) : (
          <ul className="divide-y rounded-md border" data-testid="lista-vouchers">
            {resumo.vouchers.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Pill tom={TOM_VOUCHER[v.status]}>{ROTULO_VOUCHER[v.status]}</Pill>
                <span className="min-w-0 flex-1 truncate">
                  {v.imovel ?? `Voucher ${v.seq} de ${dataCurta(v.mes_ref).slice(3)}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  Vale até {dataCurta(v.vence_em)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {comBotao && (
          <Button asChild size="sm">
            <Link to="/agendar-fotos">
              <Camera className="mr-1 h-4 w-4" aria-hidden /> Agendar fotos
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
