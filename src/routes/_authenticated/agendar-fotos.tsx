import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, CalendarClock, CalendarDays, Clock3 } from "lucide-react";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AgendarSessao } from "@/components/fotos/AgendarSessao";
import { ConfigFotos } from "@/components/fotos/ConfigFotos";
import { FinanceiroFotos } from "@/components/fotos/FinanceiroFotos";
import { fotosDb, guardVouchersFotosRoute } from "@/lib/vouchers-fotos-module";
import { notifyPhotoSession } from "@/lib/photo-notifications.functions";
import { avisarFoto } from "@/lib/photo-notifications";
import {
  hora,
  mensagemErroFoto,
  ordenarSessoes,
  quando,
  ROTULO_SESSAO,
  TOM_SESSAO,
  type ResumoFotos,
  type SessaoFoto,
} from "@/lib/vouchers-fotos";

type Busca = { captacao?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/agendar-fotos")({
  head: () => ({ meta: [{ title: "Agendar fotos" }] }),
  validateSearch: (raw: Record<string, unknown>): Busca =>
    typeof raw.captacao === "string" && UUID.test(raw.captacao) ? { captacao: raw.captacao } : {},
  beforeLoad: guardVouchersFotosRoute,
  component: AgendarFotosPage,
});

function AgendarFotosPage() {
  const { captacao } = Route.useSearch();
  const [resumo, setResumo] = useState<ResumoFotos | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await fotosDb.rpc("photo_meu_resumo");
    if (error) setErro(mensagemErroFoto(error, "Não foi possível carregar o Agendar fotos."));
    else setResumo(data as ResumoFotos);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const podeFinanceiro = resumo?.eh_financeiro === true;
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Camera}
        title="Agendar fotos"
        description="Sessões de 2 horas com o fotógrafo da imobiliária, com ou sem voucher."
        actions={
          resumo && (resumo.eh_fotografo || resumo.eh_admin) ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/fotografo" data-testid="link-agenda-fotografo">
                <CalendarDays className="mr-1 h-4 w-4" aria-hidden /> Agenda do fotógrafo
              </Link>
            </Button>
          ) : null
        }
      />
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !resumo ? (
        <ListSkeleton />
      ) : (
        <Tabs defaultValue="agendar">
          <div className="overflow-x-auto">
            <TabsList className="h-auto flex-wrap justify-start gap-1">
              <TabsTrigger value="agendar">Agendar</TabsTrigger>
              <TabsTrigger value="agenda">Minha agenda</TabsTrigger>
              {podeFinanceiro && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
              {resumo.eh_admin && <TabsTrigger value="config">Configurações</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="agendar" className="space-y-4">
            <AgendarSessao resumo={resumo} captacao={captacao} onFeito={carregar} />
          </TabsContent>
          <TabsContent value="agenda" className="space-y-4">
            <MinhaAgenda resumo={resumo} onFeito={carregar} />
          </TabsContent>
          {podeFinanceiro && (
            <TabsContent value="financeiro">
              <FinanceiroFotos hoje={resumo.hoje} />
            </TabsContent>
          )}
          {resumo.eh_admin && (
            <TabsContent value="config">
              <ConfigFotos resumo={resumo} onSalvo={carregar} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

function MinhaAgenda({ resumo, onFeito }: { resumo: ResumoFotos; onFeito: () => void }) {
  const notify = useServerFn(notifyPhotoSession);
  const [desmarcando, setDesmarcando] = useState<SessaoFoto | null>(null);
  const sessoes = ordenarSessoes(resumo.minhas_sessoes);

  const desmarcar = async (s: SessaoFoto) => {
    const { data, error } = await fotosDb.rpc("photo_desmarcar", { _session: s.id, _motivo: null });
    if (error) return toast.error(mensagemErroFoto(error, "Não foi possível desmarcar."));
    const r = data as { bloqueado_ate: string | null; desmarcacoes_30d: number };
    toast.success(
      r.bloqueado_ate
        ? `Sessão desmarcada. Com 3 desmarcações em 30 dias, o agendamento fica bloqueado até ${quando(r.bloqueado_ate)}.`
        : "Sessão desmarcada." + (s.voucher_id ? " O voucher voltou para você." : ""),
    );
    void avisarFoto(s.id, "desmarcada", notify);
    onFeito();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Minhas sessões</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pode desmarcar a qualquer momento e o voucher volta. Atenção: 3 desmarcações em 30 dias
            bloqueiam novos agendamentos por 7 dias
            {resumo.desmarcacoes_30d > 0 ? ` (você tem ${resumo.desmarcacoes_30d}).` : "."}
          </p>
        </CardHeader>
        <CardContent>
          {sessoes.length === 0 ? (
            <EmptyState icon={CalendarClock}>Você ainda não tem sessões de fotos.</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="minhas-sessoes">
              {sessoes.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <Pill tom={TOM_SESSAO[s.status]}>{ROTULO_SESSAO[s.status]}</Pill>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <Clock3 className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                      {quando(s.inicio)} – {hora(s.fim)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.imovel ?? "Imóvel"} · {s.voucher_id ? "com voucher" : "sem voucher"}
                      {s.motivo_cancelamento ? ` · motivo: ${s.motivo_cancelamento}` : ""}
                    </p>
                  </div>
                  {(s.status === "aguardando" || s.status === "confirmada") && (
                    <Button size="sm" variant="outline" onClick={() => setDesmarcando(s)}>
                      Desmarcar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!desmarcando}
        onOpenChange={(o) => !o && setDesmarcando(null)}
        title="Desmarcar esta sessão?"
        description={
          resumo.desmarcacoes_30d >= 2
            ? "Esta será sua 3ª desmarcação em 30 dias: o agendamento fica bloqueado por 7 dias."
            : "O horário é liberado e, se a sessão usava voucher, ele volta para você."
        }
        confirmLabel="Desmarcar"
        destructive
        onConfirm={() => {
          const s = desmarcando;
          setDesmarcando(null);
          if (s) void desmarcar(s);
        }}
      />
    </>
  );
}
