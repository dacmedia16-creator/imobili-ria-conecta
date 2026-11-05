import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarDays, Camera, CheckCircle2, Lock, Trash2, Unlock, XCircle } from "lucide-react";
import { EmptyState, ListSkeleton, PageHeader, Pill } from "@/components/visual/base";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fotosDb, guardVouchersFotosRoute } from "@/lib/vouchers-fotos-module";
import { notifyPhotoSession } from "@/lib/photo-notifications.functions";
import { avisarFoto } from "@/lib/photo-notifications";
import { EscolhaDataCard } from "@/components/agenda/EscolhaDataCard";
import {
  chaveDia,
  coresCalendarioFotos,
  sessaoAtiva,
  diaLongo,
  hora,
  isoSaoPaulo,
  mensagemErroFoto,
  quando,
  ROTULO_SESSAO,
  somarDias,
  TOM_SESSAO,
  type AgendaFotografo,
  type ResumoFotos,
  type SessaoFoto,
} from "@/lib/vouchers-fotos";

export const Route = createFileRoute("/_authenticated/fotografo")({
  head: () => ({ meta: [{ title: "Agenda do fotógrafo" }] }),
  beforeLoad: guardVouchersFotosRoute,
  component: FotografoPage,
});

type Acao = { tipo: "recusar" | "desmarcar"; sessao: SessaoFoto } | null;

function FotografoPage() {
  const notify = useServerFn(notifyPhotoSession);
  const [resumo, setResumo] = useState<ResumoFotos | null>(null);
  const [agenda, setAgenda] = useState<AgendaFotografo | null>(null);
  const [historico, setHistorico] = useState<AgendaFotografo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao>(null);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [livres, setLivres] = useState<string[]>([]);

  const carregar = useCallback(async () => {
    const r = await fotosDb.rpc("photo_meu_resumo");
    if (r.error) return setErro(mensagemErroFoto(r.error, "Não foi possível carregar."));
    const res = r.data as ResumoFotos;
    setResumo(res);
    if (!res.eh_fotografo && !res.eh_admin) return;
    const [a, h, l] = await Promise.all([
      fotosDb.rpc("photo_agenda_listar", { _de: res.hoje, _ate: somarDias(res.hoje, 30) }),
      fotosDb.rpc("photo_agenda_listar", { _de: somarDias(res.hoje, -90), _ate: res.hoje }),
      fotosDb.rpc("photo_horarios_livres", { _de: res.hoje, _ate: somarDias(res.hoje, 30) }),
    ]);
    if (a.error) setErro(mensagemErroFoto(a.error, "Não foi possível carregar a agenda."));
    else setAgenda(a.data as AgendaFotografo);
    setLivres(((l.data as string[] | null) ?? []).map(String));
    setHistorico((h.data as AgendaFotografo | null) ?? { faixas: [], sessoes: [] });
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rodar = async (
    id: string,
    fn: string,
    args: Record<string, unknown>,
    ok: string,
    evento?: "confirmada" | "recusada" | "desmarcada",
  ) => {
    setOcupado(id);
    const { error } = await fotosDb.rpc(fn, args);
    setOcupado(null);
    if (error) return toast.error(mensagemErroFoto(error, "Não foi possível salvar."));
    toast.success(ok);
    if (evento) void avisarFoto(id, evento, notify);
    void carregar();
  };

  const proximas = useMemo(
    () =>
      (agenda?.sessoes ?? []).filter((s) => s.status === "aguardando" || s.status === "confirmada"),
    [agenda],
  );
  const passadas = useMemo(
    () =>
      [...(historico?.sessoes ?? []), ...(agenda?.sessoes ?? [])]
        .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
        .filter((s) => !(s.status === "aguardando" || s.status === "confirmada"))
        .sort((a, b) => b.inicio.localeCompare(a.inicio)),
    [agenda, historico],
  );

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (!resumo) return <ListSkeleton />;
  if (!resumo.eh_fotografo && !resumo.eh_admin)
    return (
      <EmptyState icon={Camera} action={<Link to="/agendar-fotos">Voltar ao Agendar fotos</Link>}>
        Esta tela é só do fotógrafo da imobiliária e da administração.
      </EmptyState>
    );

  const hojeChave = resumo.hoje;
  const semanaFim = somarDias(hojeChave, 6);
  const cartao = (s: SessaoFoto, comAcoes = true) => (
    <li key={s.id} className="space-y-2 py-3 text-sm" data-testid="sessao-fotografo">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tom={TOM_SESSAO[s.status]}>{ROTULO_SESSAO[s.status]}</Pill>
        <span className="font-medium">
          {quando(s.inicio)} – {hora(s.fim)}
        </span>
        <span className="text-xs text-muted-foreground">
          {s.voucher_id ? "com voucher (RE/MAX paga)" : "sem voucher (corretor paga)"}
        </span>
      </div>
      <p>
        <span className="text-muted-foreground">Corretor: </span>
        {s.corretor_nome ?? "—"}
        {s.corretor_telefone ? ` · ${s.corretor_telefone}` : ""}
      </p>
      <p className="break-words">
        <span className="text-muted-foreground">Imóvel: </span>
        {s.imovel ?? "—"}
        {s.endereco ? ` — ${s.endereco}` : ""}
      </p>
      {s.motivo_cancelamento && (
        <p className="text-xs text-muted-foreground">Motivo: {s.motivo_cancelamento}</p>
      )}
      {comAcoes && (
        <div className="flex flex-wrap gap-2">
          {s.status === "aguardando" && (
            <>
              <Button
                size="sm"
                disabled={ocupado === s.id}
                data-testid="botao-confirmar"
                onClick={() =>
                  void rodar(
                    s.id,
                    "photo_responder",
                    { _session: s.id, _confirmar: true, _motivo: null },
                    "Sessão confirmada. O corretor foi avisado.",
                    "confirmada",
                  )
                }
              >
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden /> Confirmar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={ocupado === s.id}
                data-testid="botao-recusar"
                onClick={() => {
                  setMotivo("");
                  setAcao({ tipo: "recusar", sessao: s });
                }}
              >
                <XCircle className="mr-1 h-4 w-4" aria-hidden /> Recusar
              </Button>
            </>
          )}
          {new Date(s.inicio).getTime() <= Date.now() && (
            <Button
              size="sm"
              variant="secondary"
              disabled={ocupado === s.id}
              data-testid="botao-feita"
              onClick={() =>
                void rodar(
                  s.id,
                  "photo_marcar_feita",
                  { _session: s.id },
                  "Sessão marcada como feita.",
                )
              }
            >
              Marcar como feita
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado === s.id}
            onClick={() => {
              setMotivo("");
              setAcao({ tipo: "desmarcar", sessao: s });
            }}
          >
            Desmarcar
          </Button>
        </div>
      )}
    </li>
  );

  const doDia = proximas.filter((s) => chaveDia(s.inicio) === hojeChave);
  const daSemana = proximas.filter((s) => {
    const k = chaveDia(s.inicio);
    return k > hojeChave && k <= semanaFim;
  });
  const depois = proximas.filter((s) => chaveDia(s.inicio) > semanaFim);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Agenda do fotógrafo"
        description={`Fotógrafo: ${resumo.fotografo_nome ?? "não definido"}. Sessões de 2 h com 1 h de intervalo obrigatório.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/agendar-fotos">Agendar fotos</Link>
          </Button>
        }
      />
      {!agenda ? (
        <ListSkeleton />
      ) : (
        <Tabs defaultValue="sessoes">
          <TabsList className="h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="sessoes">
              Sessões{proximas.length ? ` (${proximas.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="faixas">Dias e horários</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="sessoes" className="space-y-4">
            {[
              ["Hoje", doDia],
              ["Próximos 7 dias", daSemana],
              ["Mais adiante", depois],
            ].map(([titulo, lista]) => (
              <Card key={titulo as string}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{titulo as string}</CardTitle>
                </CardHeader>
                <CardContent>
                  {(lista as SessaoFoto[]).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma sessão.</p>
                  ) : (
                    <ul className="divide-y">{(lista as SessaoFoto[]).map((s) => cartao(s))}</ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
          <TabsContent value="faixas">
            <Faixas
              hoje={hojeChave}
              agenda={agenda}
              livres={livres}
              ocupado={ocupado}
              onSalvar={(tipo, dia, ini, fim) =>
                void rodar(
                  `${dia}${ini}`,
                  "photo_faixa_salvar",
                  { _tipo: tipo, _inicio: isoSaoPaulo(dia, ini), _fim: isoSaoPaulo(dia, fim) },
                  tipo === "livre" ? "Horário liberado." : "Horário bloqueado.",
                )
              }
              onRemover={(id) =>
                void rodar(id, "photo_faixa_remover", { _id: id }, "Faixa removida.")
              }
            />
          </TabsContent>
          <TabsContent value="historico">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Histórico (últimos 90 dias)</CardTitle>
              </CardHeader>
              <CardContent>
                {passadas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem histórico ainda.</p>
                ) : (
                  <ul className="divide-y" data-testid="historico-fotografo">
                    {passadas.map((s) => cartao(s, false))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!acao} onOpenChange={(o) => !o && setAcao(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {acao?.tipo === "recusar" ? "Recusar esta sessão?" : "Desmarcar esta sessão?"}
            </DialogTitle>
            <DialogDescription>
              O horário é liberado e, se havia voucher, ele volta para o corretor. Isso não conta
              como desmarcação do corretor. O corretor recebe um aviso.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
            placeholder="Motivo (opcional, o corretor vê)"
            aria-label="Motivo"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcao(null)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              data-testid="confirmar-acao-fotografo"
              onClick={() => {
                const a = acao;
                setAcao(null);
                if (!a) return;
                const m = motivo.trim() || null;
                if (a.tipo === "recusar")
                  void rodar(
                    a.sessao.id,
                    "photo_responder",
                    { _session: a.sessao.id, _confirmar: false, _motivo: m },
                    "Sessão recusada. O corretor foi avisado.",
                    "recusada",
                  );
                else
                  void rodar(
                    a.sessao.id,
                    "photo_desmarcar",
                    { _session: a.sessao.id, _motivo: m },
                    "Sessão desmarcada. O corretor foi avisado.",
                    "desmarcada",
                  );
              }}
            >
              {acao?.tipo === "recusar" ? "Recusar" : "Desmarcar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Faixas({
  hoje,
  agenda,
  livres,
  ocupado,
  onSalvar,
  onRemover,
}: {
  hoje: string;
  agenda: AgendaFotografo;
  /** Inícios livres (photo_horarios_livres), para pintar o calendário com a mesma regra. */
  livres: string[];
  ocupado: string | null;
  onSalvar: (tipo: "livre" | "bloqueio", dia: string, ini: string, fim: string) => void;
  onRemover: (id: string) => void;
}) {
  const [dia, setDia] = useState(somarDias(hoje, 1));
  const [ini, setIni] = useState("09:00");
  const [fim, setFim] = useState("18:00");
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia >= hoje && ini < fim;
  const cores = useMemo(
    () =>
      coresCalendarioFotos(
        livres,
        agenda.sessoes.filter(sessaoAtiva).map((s) => s.inicio),
      ),
    [livres, agenda.sessoes],
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <EscolhaDataCard selected={dia} onSelect={setDia} cores={cores} aPartirDe={hoje}>
        <div className="space-y-3" data-testid="liberar-bloquear">
          <div>
            <div className="text-sm font-medium">Liberar ou bloquear</div>
            <p className="text-xs text-muted-foreground">
              Corretores só conseguem marcar dentro de horários liberados. Um bloqueio vence a faixa
              liberada.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block">Das</span>
              <Input type="time" step={1800} value={ini} onChange={(e) => setIni(e.target.value)} />
            </label>
            <label className="block flex-1 text-sm">
              <span className="mb-1 block">Até</span>
              <Input type="time" step={1800} value={fim} onChange={(e) => setFim(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!valido || ocupado === `${dia}${ini}`}
              onClick={() => onSalvar("livre", dia, ini, fim)}
              data-testid="botao-liberar"
            >
              <Unlock className="mr-1 h-4 w-4" aria-hidden /> Liberar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!valido || ocupado === `${dia}${ini}`}
              onClick={() => onSalvar("bloqueio", dia, ini, fim)}
            >
              <Lock className="mr-1 h-4 w-4" aria-hidden /> Bloquear
            </Button>
          </div>
        </div>
      </EscolhaDataCard>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Próximos 30 dias</CardTitle>
        </CardHeader>
        <CardContent>
          {agenda.faixas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum horário liberado ainda.</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="faixas-fotografo">
              {agenda.faixas.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Pill tom={f.tipo === "livre" ? "green" : "red"}>
                    {f.tipo === "livre" ? "Liberado" : "Bloqueado"}
                  </Pill>
                  <span className="min-w-0 flex-1 capitalize">
                    {diaLongo(f.inicio)} · {hora(f.inicio)}–{hora(f.fim)}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remover faixa"
                    disabled={ocupado === f.id}
                    onClick={() => onRemover(f.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
