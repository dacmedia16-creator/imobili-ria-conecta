import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Ban, Camera } from "lucide-react";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EscolhaDataCard, dataDeChave } from "@/components/agenda/EscolhaDataCard";
import { MeusVouchers } from "@/components/fotos/MeusVouchers";
import { fotosDb } from "@/lib/vouchers-fotos-module";
import { notifyPhotoSession } from "@/lib/photo-notifications.functions";
import { avisarFoto } from "@/lib/photo-notifications";
import {
  chaveDia,
  coresCalendarioFotos,
  dataCurta,
  hora,
  mensagemErroFoto,
  quando,
  ROTULO_SESSAO,
  sessaoAtiva,
  situacaoImovel,
  somarDias,
  TOM_SESSAO,
  vouchersUsaveis,
  type AgendaFotografo,
  type ResumoFotos,
  type SessaoFoto,
} from "@/lib/vouchers-fotos";

const SEM_VOUCHER = "__sem__";
const DUAS_HORAS = 2 * 3600_000;
const fimDoBloco = (inicio: string) =>
  new Date(new Date(inicio).getTime() + DUAS_HORAS).toISOString();
const diaPorExtenso = (dia: string) =>
  dataDeChave(dia).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

/**
 * Aba "Agendar" no mesmo layout da Reserva de salas (t_9b79f000): cartão "Escolha a data"
 * com calendário colorido e, ao lado/abaixo, a agenda do dia com os blocos de 2 h livres
 * (verde) e os reservados (azul). Tocar num horário livre abre o pedido (imóvel + voucher).
 * As regras continuam nas RPCs photo_* (nada mudou no banco).
 */
export function AgendarSessao({
  resumo,
  captacao,
  onFeito,
}: {
  resumo: ResumoFotos;
  captacao?: string;
  onFeito: () => void;
}) {
  const notify = useServerFn(notifyPhotoSession);
  const fim = somarDias(resumo.hoje, 30);
  const [horarios, setHorarios] = useState<string[] | null>(null);
  const [agendaGeral, setAgendaGeral] = useState<SessaoFoto[] | null>(null);
  const [dia, setDia] = useState(resumo.hoje);
  const [diaEscolhido, setDiaEscolhido] = useState(false);
  const [horario, setHorario] = useState<string | null>(null);
  const [imovelId, setImovelId] = useState(resumo.imoveis.find((i) => i.id === captacao)?.id ?? "");
  const [voucher, setVoucher] = useState<string>(SEM_VOUCHER);
  const [enviando, setEnviando] = useState(false);

  const imovel = resumo.imoveis.find((i) => i.id === imovelId);
  const sit = situacaoImovel(imovel);
  const usaveis = useMemo(
    () =>
      sit.comVoucher ? vouchersUsaveis(resumo.vouchers, horario ? chaveDia(horario) : null) : [],
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
      .rpc("photo_horarios_livres", { _de: resumo.hoje, _ate: fim })
      .then(({ data, error }) => {
        if (error) toast.error(mensagemErroFoto(error, "Não foi possível carregar os horários."));
        setHorarios(((data as string[] | null) ?? []).map(String));
      });
  }, [resumo.hoje, fim]);

  // Fotógrafo e admin enxergam todas as reservas; o corretor, só as dele (o banco não mostra as
  // dos outros). shortcut: para o corretor, horário tomado por outro corretor só some da lista.
  useEffect(() => {
    if (!resumo.eh_fotografo && !resumo.eh_admin) return;
    void fotosDb.rpc("photo_agenda_listar", { _de: resumo.hoje, _ate: fim }).then(({ data }) => {
      setAgendaGeral((data as AgendaFotografo | null)?.sessoes ?? []);
    });
  }, [resumo.hoje, resumo.eh_fotografo, resumo.eh_admin, fim, resumo.minhas_sessoes]);

  const reservas = useMemo(
    () => (agendaGeral ?? resumo.minhas_sessoes).filter(sessaoAtiva),
    [agendaGeral, resumo.minhas_sessoes],
  );
  const minhas = useMemo(
    () => new Set(resumo.minhas_sessoes.map((s) => s.id)),
    [resumo.minhas_sessoes],
  );
  const cores = useMemo(
    () =>
      coresCalendarioFotos(
        horarios ?? [],
        reservas.map((s) => s.inicio),
      ),
    [horarios, reservas],
  );

  // Abre no primeiro dia com horário livre (o corretor ainda pode escolher outro).
  useEffect(() => {
    if (!diaEscolhido && cores.disponivel[0]) setDia(cores.disponivel[0]);
  }, [cores.disponivel, diaEscolhido]);

  const livresDoDia = (horarios ?? []).filter((h) => chaveDia(h) === dia);
  const reservasDoDia = reservas
    .filter((s) => chaveDia(s.inicio) === dia)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

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

  const semImovel = resumo.imoveis.length === 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <EscolhaDataCard
          selected={dia}
          onSelect={(d) => {
            setDiaEscolhido(true);
            setDia(d);
          }}
          cores={cores}
          aPartirDe={resumo.hoje}
        >
          <div className="space-y-1" data-testid="bloco-fotografo">
            <div className="text-sm font-medium">Fotógrafo</div>
            <div className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
              <Camera className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{resumo.fotografo_nome ?? "—"}</span>
            </div>
          </div>
          <div className="rounded-lg border bg-primary/5 p-3 text-sm">
            <div className="font-medium capitalize">{diaPorExtenso(dia)}</div>
            <div className="mt-1 tabular-nums text-muted-foreground">
              {livresDoDia.length} horário{livresDoDia.length === 1 ? "" : "s"} livre
              {livresDoDia.length === 1 ? "" : "s"} · {reservasDoDia.length} reservado
              {reservasDoDia.length === 1 ? "" : "s"}
            </div>
          </div>
        </EscolhaDataCard>

        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Agenda do dia</CardTitle>
                <CardDescription>
                  {horarios === null
                    ? "Carregando a agenda do fotógrafo…"
                    : "Sessões de 2 h. Toque em um horário livre para pedir a sessão."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Livre
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Reservado
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4" data-testid="agenda-do-dia">
            {semImovel && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Nenhuma captação aprovada sua. Só imóveis com exclusividade assinada podem ser
                fotografados.
              </p>
            )}
            {horarios === null ? (
              <ListSkeleton />
            ) : (
              <>
                {reservasDoDia.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Reservados</div>
                    <ul className="space-y-2" data-testid="reservados-do-dia">
                      {reservasDoDia.map((s) => (
                        <li
                          key={s.id}
                          className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950/30"
                        >
                          <span className="shrink-0 font-medium tabular-nums text-blue-700 dark:text-blue-300">
                            {hora(s.inicio)}–{hora(s.fim)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {minhas.has(s.id) ? "Você" : (s.corretor_nome ?? "Reservado")}
                            {s.imovel ? ` · ${s.imovel}` : ""}
                          </span>
                          <Pill tom={TOM_SESSAO[s.status]}>{ROTULO_SESSAO[s.status]}</Pill>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {livresDoDia.length > 0 ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Horários livres</div>
                    <div className="flex flex-wrap gap-2" data-testid="horarios-livres">
                      {livresDoDia.map((h) => (
                        <button
                          key={h}
                          type="button"
                          disabled={semImovel}
                          className="min-h-10 rounded-md border border-dashed border-emerald-300 bg-emerald-50/60 px-3 text-sm tabular-nums text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-950/20 dark:text-emerald-300"
                          onClick={() => setHorario(h)}
                          aria-label={`Pedir sessão das ${hora(h)} às ${hora(fimDoBloco(h))}`}
                        >
                          {hora(h)}–{hora(fimDoBloco(h))}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {cores.disponivel.length === 0
                      ? "O fotógrafo ainda não liberou horários nos próximos 30 dias."
                      : "Sem horário livre neste dia. Escolha um dia verde no calendário."}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <MeusVouchers resumo={resumo} comBotao={false} />

      <Dialog open={!!horario} onOpenChange={(o) => !o && setHorario(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pedir sessão de fotos</DialogTitle>
            <DialogDescription>
              {horario ? `${quando(horario)} às ${hora(fimDoBloco(horario))}` : ""} · Fotógrafo:{" "}
              {resumo.fotografo_nome ?? "—"}. A sessão fica aguardando a confirmação dele.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Imóvel (captado por você)</span>
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
              {imovel && sit.motivo && (
                <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                  {sit.motivo}
                </span>
              )}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Pagamento</span>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHorario(null)}>
              Voltar
            </Button>
            <Button
              onClick={() => void agendar()}
              disabled={!imovel || !horario || !sit.pode || enviando}
              data-testid="botao-agendar"
            >
              <Camera className="mr-1 h-4 w-4" aria-hidden /> Pedir sessão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
