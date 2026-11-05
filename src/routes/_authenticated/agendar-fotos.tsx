import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ban, Camera, CalendarClock, CalendarDays, Clock3 } from "lucide-react";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MeusVouchers } from "@/components/fotos/MeusVouchers";
import { ConfigFotos } from "@/components/fotos/ConfigFotos";
import { FinanceiroFotos } from "@/components/fotos/FinanceiroFotos";
import { fotosDb, guardVouchersFotosRoute } from "@/lib/vouchers-fotos-module";
import { notifyPhotoSession } from "@/lib/photo-notifications.functions";
import { avisarFoto } from "@/lib/photo-notifications";
import {
  agruparPorDia,
  chaveDia,
  dataCurta,
  diaLongo,
  hora,
  mensagemErroFoto,
  ordenarSessoes,
  quando,
  ROTULO_SESSAO,
  situacaoImovel,
  somarDias,
  TOM_SESSAO,
  vouchersUsaveis,
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

const SEM_VOUCHER = "__sem__";

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
            <Agendar resumo={resumo} captacao={captacao} onFeito={carregar} />
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

function Agendar({
  resumo,
  captacao,
  onFeito,
}: {
  resumo: ResumoFotos;
  captacao?: string;
  onFeito: () => void;
}) {
  const notify = useServerFn(notifyPhotoSession);
  const inicial = resumo.imoveis.find((i) => i.id === captacao)?.id ?? "";
  const [imovelId, setImovelId] = useState(inicial);
  const [horarios, setHorarios] = useState<string[] | null>(null);
  const [horario, setHorario] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<string>(SEM_VOUCHER);
  const [enviando, setEnviando] = useState(false);
  const imovel = resumo.imoveis.find((i) => i.id === imovelId);
  const sit = situacaoImovel(imovel);
  const usaveis = useMemo(
    () => (sit.comVoucher ? vouchersUsaveis(resumo.vouchers, horario ? chaveDia(horario) : null) : []),
    [resumo.vouchers, horario, sit.comVoucher],
  );
  // Oferece o voucher que vence antes, quando houver (o corretor pode trocar para "sem voucher").
  useEffect(() => {
    setVoucher((v) =>
      v !== SEM_VOUCHER && usaveis.some((u) => u.id === v) ? v : (usaveis[0]?.id ?? SEM_VOUCHER),
    );
  }, [usaveis]);

  useEffect(() => {
    void fotosDb
      .rpc("photo_horarios_livres", { _de: resumo.hoje, _ate: somarDias(resumo.hoje, 30) })
      .then(({ data, error }) => {
        if (error) toast.error(mensagemErroFoto(error, "Não foi possível carregar os horários."));
        setHorarios(((data as string[] | null) ?? []).map(String));
      });
  }, [resumo.hoje]);
  const dias = useMemo(() => agruparPorDia(horarios ?? []), [horarios]);

  if (resumo.bloqueado_ate)
    return (
      <Alert variant="destructive" data-testid="aviso-bloqueio">
        <Ban className="h-4 w-4" />
        <AlertTitle>Agendamento bloqueado até {quando(resumo.bloqueado_ate)}</AlertTitle>
        <AlertDescription>
          Você desmarcou 3 sessões em 30 dias. Depois dessa data o agendamento volta a ser liberado.
        </AlertDescription>
      </Alert>
    );
  if (!resumo.fotografo_id)
    return (
      <EmptyState icon={Camera}>
        A imobiliária ainda não escolheu o fotógrafo. Fale com a administração.
      </EmptyState>
    );

  const agendar = async () => {
    if (!imovel || !horario) return;
    setEnviando(true);
    const { data, error } = await fotosDb.rpc("photo_agendar", {
      _capture: imovel.id,
      _inicio: horario,
      _voucher: voucher === SEM_VOUCHER ? null : voucher,
    });
    setEnviando(false);
    if (error) return toast.error(mensagemErroFoto(error, "Não foi possível agendar."));
    toast.success("Pedido enviado! Aguarde a confirmação do fotógrafo.");
    void avisarFoto(String(data), "marcada", notify);
    setHorario(null);
    setHorarios((hs) => (hs ? hs.filter((h) => h !== horario) : hs));
    onFeito();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Novo agendamento</CardTitle>
          <p className="text-sm text-muted-foreground">
            Fotógrafo: {resumo.fotografo_nome ?? "—"}. A sessão dura 2 h e fica aguardando a
            confirmação dele.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">1. Imóvel (captado por você)</span>
            <Select value={imovelId} onValueChange={setImovelId}>
              <SelectTrigger aria-label="Imóvel" data-testid="select-imovel">
                <SelectValue placeholder="Escolha o imóvel" />
              </SelectTrigger>
              <SelectContent>
                {resumo.imoveis.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.imovel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {resumo.imoveis.length === 0 && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Nenhuma captação aprovada sua. Só imóveis com exclusividade assinada podem ser
                fotografados.
              </span>
            )}
            {imovel && sit.motivo && (
              <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                {sit.motivo}
              </span>
            )}
          </label>

          <div className="text-sm">
            <span className="mb-1 block font-medium">2. Horário livre</span>
            {!horarios ? (
              <ListSkeleton />
            ) : dias.length === 0 ? (
              <EmptyState icon={CalendarClock}>
                Nenhum horário liberado nos próximos 30 dias.
              </EmptyState>
            ) : (
              <div className="max-h-80 space-y-3 overflow-y-auto pr-1" data-testid="horarios-livres">
                {dias.map((d) => (
                  <div key={d.dia}>
                    <p className="mb-1 text-xs font-medium capitalize text-muted-foreground">
                      {diaLongo(d.horarios[0])}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {d.horarios.map((h) => (
                        <Button
                          key={h}
                          type="button"
                          size="sm"
                          variant={horario === h ? "default" : "outline"}
                          disabled={!sit.pode}
                          onClick={() => setHorario(h)}
                          aria-pressed={horario === h}
                        >
                          {hora(h)}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">3. Pagamento</span>
            <Select value={voucher} onValueChange={setVoucher} disabled={!sit.pode}>
              <SelectTrigger aria-label="Voucher" data-testid="select-voucher">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {usaveis.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    Usar voucher (vale até {dataCurta(v.vence_em)})
                  </SelectItem>
                ))}
                <SelectItem value={SEM_VOUCHER}>Sem voucher — eu pago a sessão</SelectItem>
              </SelectContent>
            </Select>
            <span className="mt-1 block text-xs text-muted-foreground">
              {voucher === SEM_VOUCHER
                ? "Sem voucher, o Financeiro cobra a sessão de você depois que ela for feita."
                : "Com voucher, a RE/MAX paga a sessão. Se desmarcar, o voucher volta."}
            </span>
          </label>

          <Button
            onClick={() => void agendar()}
            disabled={!imovel || !horario || !sit.pode || enviando}
            data-testid="botao-agendar"
          >
            <Camera className="mr-1 h-4 w-4" aria-hidden />
            {horario ? `Pedir sessão em ${quando(horario)}` : "Pedir sessão"}
          </Button>
        </CardContent>
      </Card>
      <MeusVouchers resumo={resumo} comBotao={false} />
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
