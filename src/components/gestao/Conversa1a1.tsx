import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListSkeleton } from "@/components/visual/base";
import {
  MAX_COMBINADOS,
  MAX_TEXTO_COMBINADO,
  montarPauta,
  normalizarCombinados,
  proximaSugerida,
  type Combinado,
  type LinhaFarol,
} from "@/lib/inteligencia-gestao";
import {
  ROTULO_EXTRA,
  dataComDia,
  type FarolPessoa,
  type PendenciaExtra,
} from "@/lib/inteligencia-gestao-tela";
import { ROTULO_PENDENCIA, type PendenciaKind } from "@/lib/minha-carreira";
import {
  erroGestao,
  pendenciasDoCorretor,
  salvar1a1,
  type PendenciaCorretor,
} from "@/lib/inteligencia-gestao-db";
import { SinalPill } from "./SinalPill";

// Conversa 1:1 (cartão t_01d580b6, Parte 4 do briefing): único bloco novo, sem menu novo. Abre ao clicar
// no corretor no farol do Painel da Equipe. Pauta automática + combinados; grava pela RPC gestao_1a1_salvar
// (o banco confere gestor = imobiliária, TL = própria equipe). O corretor vê tudo o que fica registrado.

const somarDias = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

type Pend = { kind: string; imovel: string | null; detalhe: string };

export function Conversa1a1({
  aberta,
  onClose,
  pessoa,
  linha,
  numeros,
  extras,
  hoje,
  onSalvo,
}: {
  aberta: boolean;
  onClose: () => void;
  pessoa: FarolPessoa | null;
  linha: LinhaFarol | null;
  numeros: Record<string, number | string | null>;
  /** Lead sem resposta / reunião de 45 dias do corretor (mesma regra do "O que fazer hoje" dele). */
  extras: PendenciaExtra[];
  hoje: string;
  onSalvo?: () => void;
}) {
  const [pend, setPend] = useState<PendenciaCorretor[] | null>(null);
  const [erroPend, setErroPend] = useState<string | null>(null);
  const [anteriores, setAnteriores] = useState<Combinado[]>([]);
  const [novos, setNovos] = useState<string[]>([""]);
  const [data, setData] = useState(hoje);
  const [proxima, setProxima] = useState(proximaSugerida(hoje));
  const [proximaMexida, setProximaMexida] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const id = pessoa?.user_id ?? null;

  useEffect(() => {
    if (!aberta || !id) return;
    let vivo = true;
    setPend(null);
    setErroPend(null);
    setAnteriores((pessoa?.ultima_1a1?.combinados ?? []).map((c) => ({ ...c, feito: null })));
    setNovos([""]);
    setData(hoje);
    setProxima(proximaSugerida(hoje));
    setProximaMexida(false);
    pendenciasDoCorretor(id)
      .then((p) => vivo && setPend(p))
      .catch((e) => vivo && setErroPend(erroGestao(e, "Não foi possível carregar as pendências.")));
    return () => {
      vivo = false;
    };
    // pessoa muda junto com id; hoje é fixo na tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta, id]);

  const pendencias: Pend[] = useMemo(
    () => [
      ...(pend ?? []).map((p) => ({
        kind: ROTULO_PENDENCIA[p.kind as PendenciaKind] ?? p.kind,
        imovel: p.imovel,
        detalhe: p.detalhe,
      })),
      ...extras.map((x) => ({ kind: ROTULO_EXTRA[x.kind], imovel: x.imovel, detalhe: x.detalhe })),
    ],
    [pend, extras],
  );

  function mudarData(v: string) {
    const d = v || hoje;
    setData(d);
    if (!proximaMexida) setProxima(proximaSugerida(d));
  }

  async function salvar() {
    if (!pessoa || !linha) return;
    if (data > hoje || data < somarDias(hoje, -31)) {
      toast.error("Data da 1:1: de hoje até 31 dias atrás.");
      return;
    }
    if (!proxima || proxima < data || proxima > somarDias(data, 180)) {
      toast.error("Próxima 1:1: entre a data da conversa e 180 dias depois.");
      return;
    }
    const pauta = montarPauta({ numeros, farol: linha, pendencias, anteriores });
    setSalvando(true);
    try {
      await salvar1a1({
        corretor: pessoa.user_id,
        data,
        pauta,
        combinados: normalizarCombinados(novos.map((texto) => ({ texto, feito: null }))),
        proxima,
      });
      toast.success(`1:1 salva. Próxima: ${dataComDia(proxima)}.`);
      onSalvo?.();
      onClose();
    } catch (e) {
      toast.error(erroGestao(e, "Não foi possível salvar a 1:1."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conversa 1:1{pessoa ? ` — ${pessoa.nome}` : ""}</DialogTitle>
          <DialogDescription>
            Pauta montada automaticamente. Tudo o que for salvo aqui o corretor também vê.
          </DialogDescription>
        </DialogHeader>
        {!pessoa || !linha ? null : (
          <div className="space-y-5 text-sm" data-testid="conversa-1a1">
            <section className="space-y-1.5">
              <h3 className="font-semibold">1. Números do mês</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {Object.entries(numeros).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="font-medium tabular-nums">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-1.5">
              <h3 className="font-semibold">2. Sinais que acenderam o farol</h3>
              {linha.farol === "novo" ? (
                <p className="text-muted-foreground">
                  Corretor novo (menos de 60 dias na equipe): sem farol de produção ainda.
                </p>
              ) : linha.acesos.length === 0 ? (
                <p className="text-muted-foreground">Nenhum sinal aceso.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {linha.acesos.map((s) => (
                    <SinalPill key={s.chave} s={s} />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="font-semibold">3. Pendências do “O que fazer hoje”</h3>
              {erroPend ? (
                <p className="text-destructive">{erroPend}</p>
              ) : !pend ? (
                <ListSkeleton />
              ) : pendencias.length === 0 ? (
                <p className="text-muted-foreground">Nenhuma pendência.</p>
              ) : (
                <ul className="list-disc space-y-0.5 pl-5" data-testid="pauta-pendencias">
                  {pendencias.map((p, i) => (
                    <li key={i}>
                      <span className="font-medium">{p.kind}:</span> {p.detalhe}
                      {p.imovel ? (
                        <span className="text-muted-foreground"> · {p.imovel}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="font-semibold">4. Combinados da conversa anterior</h3>
              {anteriores.length === 0 ? (
                <p className="text-muted-foreground">
                  {pessoa.ultima_1a1 ? "Nada foi combinado na última." : "Primeira 1:1 registrada."}
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="pauta-anteriores">
                  {anteriores.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1">{c.texto}</span>
                      <div className="flex gap-1" role="group" aria-label={`Combinado: ${c.texto}`}>
                        {[
                          { v: true, t: "Feito" },
                          { v: false, t: "Não feito" },
                        ].map((o) => (
                          <Button
                            key={o.t}
                            type="button"
                            size="sm"
                            variant={c.feito === o.v ? "default" : "outline"}
                            aria-pressed={c.feito === o.v}
                            onClick={() =>
                              setAnteriores((l) =>
                                l.map((x, j) =>
                                  j === i ? { ...x, feito: x.feito === o.v ? null : o.v } : x,
                                ),
                              )
                            }
                          >
                            {o.t}
                          </Button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="font-semibold">5. Novos combinados</h3>
              <ul className="space-y-1.5">
                {novos.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <Input
                      value={t}
                      maxLength={MAX_TEXTO_COMBINADO}
                      placeholder="Ex.: ligar para 5 proprietários do Campolim"
                      aria-label={`Novo combinado ${i + 1}`}
                      onChange={(e) =>
                        setNovos((l) => l.map((x, j) => (j === i ? e.target.value : x)))
                      }
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Tirar combinado ${i + 1}`}
                      onClick={() =>
                        setNovos((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [""]))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              {novos.length < MAX_COMBINADOS ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setNovos((l) => [...l, ""])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" aria-hidden /> Mais um combinado
                </Button>
              ) : null}
            </section>

            <section className="flex flex-wrap items-end gap-3 border-t pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Data da conversa</span>
                <Input
                  type="date"
                  className="h-9 w-40"
                  value={data}
                  min={somarDias(hoje, -31)}
                  max={hoje}
                  onChange={(e) => mudarData(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Próxima 1:1 (sugerida em 14 dias)
                </span>
                <Input
                  type="date"
                  className="h-9 w-40"
                  value={proxima}
                  min={data}
                  max={somarDias(data, 180)}
                  data-testid="proxima-1a1"
                  onChange={(e) => {
                    setProxima(e.target.value);
                    setProximaMexida(true);
                  }}
                />
              </label>
              <Button
                className="ml-auto"
                disabled={salvando || !pend}
                onClick={() => void salvar()}
                data-testid="salvar-1a1"
              >
                {salvando ? "Salvando…" : "Salvar 1:1"}
              </Button>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
