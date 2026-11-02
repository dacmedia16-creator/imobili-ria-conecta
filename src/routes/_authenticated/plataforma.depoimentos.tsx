// Moderação dos depoimentos da página de vendas (t_c7cfaf00). Só o dono da plataforma
// (guardPlatformRoute + o banco recusa os demais). Aprovar / recusar / remover com um clique.
// O texto do autor nunca é editado: "Corrigir digitação" grava uma versão corrigida ao lado,
// com registro de quem e quando; a vitrine passa a mostrar a corrigida.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Hourglass, Lock, Megaphone, MessageSquareQuote, PenLine } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, KpiTile, ListSkeleton, PageHeader } from "@/components/visual/base";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Estrelas } from "@/components/depoimentos/DepoimentoForm";
import {
  STATUS_DEP_LABEL,
  acoesModeracao,
  contarPorStatus,
  filtrarModeracao,
  linkDepoimento,
  textoVitrine,
  type DepModeracao,
  type FiltroModeracao,
} from "@/lib/depoimentos";
import { corrigirDepoimento, listarModeracao, moderarDepoimento } from "@/lib/depoimentos-db";
import { guardPlatformRoute } from "./plataforma.imobiliarias";

export const Route = createFileRoute("/_authenticated/plataforma/depoimentos")({
  head: () => ({ meta: [{ title: "Depoimentos" }] }),
  beforeLoad: guardPlatformRoute,
  component: ModeracaoDepoimentos,
});

const FILTROS: { id: FiltroModeracao; label: string }[] = [
  { id: "pendente", label: "Pendentes" },
  { id: "aprovado", label: "Aprovados" },
  { id: "recusado", label: "Recusados" },
  { id: "removido", label: "Removidos" },
  { id: "interno", label: "Feedback interno" },
  { id: "todos", label: "Todos" },
];

const ROTULO_ACAO = { aprovar: "Aprovar", recusar: "Recusar", remover: "Remover da vitrine" } as const;

const dataHora = (s: string | null) =>
  s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

function ModeracaoDepoimentos() {
  const [lista, setLista] = useState<DepModeracao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<FiltroModeracao>("pendente");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState<DepModeracao | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await listarModeracao());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const contagem = useMemo(() => contarPorStatus(lista), [lista]);
  const visiveis = useMemo(() => filtrarModeracao(lista, filtro), [lista, filtro]);

  const agir = async (d: DepModeracao, acao: "aprovar" | "recusar" | "remover") => {
    setOcupado(d.id);
    try {
      await moderarDepoimento(d.id, acao);
      toast.success(
        acao === "aprovar" ? "Aprovado: já aparece na vitrine." : "Feito: não aparece na vitrine.",
      );
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível.");
    } finally {
      setOcupado(null);
    }
  };

  const copiarLink = async () => {
    const link = linkDepoimento(window.location.origin);
    try {
      await navigator.clipboard.writeText(link);
      toast.success(`Link copiado: ${link}`);
    } catch {
      toast.message(link);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquareQuote}
        title="Depoimentos"
        description="Aprove o que aparece na página de vendas. Só entram notas 4 e 5 com autorização do autor."
        actions={
          <Button variant="outline" onClick={() => void copiarLink()}>
            <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Copiar link para o WhatsApp
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Pendentes" value={contagem.pendente} icon={Hourglass} tom="amber" destaque={contagem.pendente > 0} />
        <KpiTile label="Na vitrine" value={contagem.aprovado} icon={Megaphone} tom="green" />
        <KpiTile label="Feedback interno" value={contagem.interno} icon={Lock} />
        <KpiTile label="Total" value={contagem.todos} icon={MessageSquareQuote} />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por status">
        {FILTROS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            role="tab"
            aria-selected={filtro === f.id}
            variant={filtro === f.id ? "default" : "outline"}
            onClick={() => setFiltro(f.id)}
          >
            {f.label} ({contagem[f.id]})
          </Button>
        ))}
      </div>

      {carregando ? (
        <ListSkeleton />
      ) : visiveis.length === 0 ? (
        <EmptyState icon={MessageSquareQuote}>Nada por aqui. Quando alguém enviar, aparece nesta lista.</EmptyState>
      ) : (
        <div className="space-y-3">
          {visiveis.map((d) => {
            const v = textoVitrine(d);
            const acoes = acoesModeracao(d);
            return (
              <Card key={d.id} data-testid="dep-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar className="h-10 w-10">
                      {d.foto_url ? <AvatarImage src={d.foto_url} alt="" /> : null}
                      <AvatarFallback>{d.nome_exibicao.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="font-semibold">
                        {d.nome_completo}{" "}
                        <span className="font-normal text-muted-foreground">
                          (na vitrine: {d.nome_exibicao})
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {d.papel} · {d.imobiliaria}
                        {d.cidade ? ` · ${d.cidade}` : ""} · {dataHora(d.criado_em)} · via{" "}
                        {d.origem === "link" ? "link" : "convite"}
                      </div>
                    </div>
                    <Estrelas valor={d.nota} tamanho="h-4 w-4" />
                    <Badge variant={d.status === "aprovado" ? "default" : "secondary"}>
                      {STATUS_DEP_LABEL[d.status]}
                    </Badge>
                  </div>

                  {d.status === "interno" ? (
                    <div className="space-y-1 text-sm">
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        {d.nota <= 3 ? "Nota baixa: nunca vai para a vitrine." : "Sem autorização: nunca vai para a vitrine."}
                      </p>
                      {d.melhorar ? <p><b>O que melhorar:</b> {d.melhorar}</p> : null}
                      {d.mudou ? <p><b>O que mudou:</b> {d.mudou}</p> : null}
                      {d.frase ? <p><b>Frase:</b> {d.frase}</p> : null}
                    </div>
                  ) : (
                    <div className="space-y-1 text-sm">
                      {v.frase ? <p className="text-base font-semibold">“{v.frase}”</p> : null}
                      <p>{v.texto}</p>
                      {v.tarefa ? (
                        <p className="text-muted-foreground"><b>Tarefa mais fácil:</b> {v.tarefa}</p>
                      ) : null}
                      {d.melhorar ? (
                        <p className="text-muted-foreground"><b>Sugestão (interna):</b> {d.melhorar}</p>
                      ) : null}
                      {d.corrigido_em ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Digitação corrigida em {dataHora(d.corrigido_em)} (o original do autor está guardado).
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Autorização {d.consentimento_versao ?? "—"} em {dataHora(d.consentimento_em)}
                        {d.revogado_em ? ` · retirado pelo autor em ${dataHora(d.revogado_em)}` : ""}
                      </p>
                    </div>
                  )}

                  {acoes.length > 0 || (d.status !== "interno" && !d.revogado_em) ? (
                    <div className="flex flex-wrap gap-2">
                      {acoes.map((a) => (
                        <Button
                          key={a}
                          size="sm"
                          variant={a === "aprovar" ? "default" : "outline"}
                          disabled={ocupado === d.id}
                          onClick={() => void agir(d, a)}
                        >
                          {ROTULO_ACAO[a]}
                        </Button>
                      ))}
                      {d.status !== "interno" && !d.revogado_em ? (
                        <Button size="sm" variant="ghost" onClick={() => setCorrigindo(d)}>
                          <PenLine className="mr-1.5 h-4 w-4" aria-hidden /> Corrigir digitação
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CorrigirDialog
        dep={corrigindo}
        onClose={() => setCorrigindo(null)}
        onSalvo={async () => {
          setCorrigindo(null);
          await carregar();
        }}
      />
    </div>
  );
}

function CorrigirDialog({
  dep,
  onClose,
  onSalvo,
}: {
  dep: DepModeracao | null;
  onClose: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [campos, setCampos] = useState({ mudou: "", tarefa: "", frase: "" });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (dep) {
      const v = textoVitrine(dep);
      setCampos({ mudou: v.texto ?? "", tarefa: v.tarefa ?? "", frase: v.frase ?? "" });
    }
  }, [dep]);
  if (!dep) return null;
  const salvar = async () => {
    setSalvando(true);
    try {
      await corrigirDepoimento(dep.id, campos);
      toast.success("Correção salva (com registro).");
      await onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };
  const campo = (k: "mudou" | "tarefa" | "frase", rotulo: string, original: string | null) =>
    original ? (
      <div className="space-y-1">
        <Label htmlFor={`cor-${k}`}>{rotulo}</Label>
        <Textarea
          id={`cor-${k}`}
          rows={k === "mudou" ? 4 : 2}
          value={campos[k]}
          onChange={(e) => setCampos((c) => ({ ...c, [k]: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">Original: {original}</p>
      </div>
    ) : null;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Corrigir digitação</DialogTitle>
          <DialogDescription>
            Só acentos, letras trocadas e pontuação. O banco recusa reescrever o texto. O original
            do autor fica guardado e a correção é registrada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {campo("frase", "Frase de destaque", dep.frase)}
          {campo("mudou", "O que mudou", dep.mudou)}
          {campo("tarefa", "Tarefa mais fácil", dep.tarefa)}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar correção"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
