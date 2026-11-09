import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Banknote, CalendarClock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, KpiTile, ListSkeleton, Pill } from "@/components/visual/base";
import { AConfirmar } from "@/components/locacao/LocacaoDetalhe";
import { errorMessage } from "@/lib/errors";
import { GARANTIA_LABEL, brl, dataBr, type Garantia } from "@/lib/locacao";
import {
  INDICES,
  MULTA_PARA_LABEL,
  SITUACAO_COB,
  SITUACAO_CT,
  competenciaLabel,
  devidoHoje,
  lerCobranca,
  lerEventosFin,
  lerPainelFin,
  mesDeslocado,
  montarExtrato,
  proprietarios,
  resumoPainel,
  type Cobranca,
  type ConfigFin,
  type Contrato,
  type EventoFin,
  type PainelFin,
} from "@/lib/locacao-fin";
import {
  ativarContratoFin,
  baixaFin,
  cancelarFin,
  contratoFin,
  desfazerRepasseFin,
  descontoFin,
  estornarFin,
  extratoFin,
  gerarCobrancasFin,
  painelFin,
  removerDescontoFin,
  repasseFeitoFin,
  salvarConfigFin,
  salvarContratoFin,
} from "@/lib/locacao-fin-db";

// Financeiro da locação — Fase 2, parte 1 (t_be750361; maquete t_de4e155c). Só para o papel "Financeiro da locação"
// (ou administrador). Nada aqui gera boleto, envia mensagem ou move dinheiro: baixa e repasse são REGISTROS manuais.

type Sub = "painel" | "contratos" | "repasse" | "regras";

const num = (v: string) => Number(v.replace(/\./g, "").replace(",", ".")) || 0;
const numSimples = (v: string) => Number(v.replace(",", ".")) || 0;

export function LocacaoFinanceiro() {
  const [comp, setComp] = useState<string | null>(null);
  const [p, setP] = useState<PainelFin | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub>("painel");
  const [cob, setCob] = useState<Cobranca | null>(null);
  const [ctSel, setCtSel] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setP(lerPainelFin(await painelFin(comp)));
      setErro(null);
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível carregar o financeiro."));
    }
  }, [comp]);
  useEffect(() => void carregar(), [carregar]);

  // Mantém a cobrança aberta no diálogo atualizada depois de cada ação.
  useEffect(() => {
    if (!cob || !p) return;
    const nova = [...p.cobrancas, ...p.atrasadasAntes].find((c) => c.id === cob.id);
    if (nova && nova !== cob) setCob(nova);
  }, [p, cob]);

  if (erro) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{erro}</p>
        <Button variant="outline" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );
  }
  if (!p) return <ListSkeleton />;

  return (
    <div className="space-y-4" data-testid="locacao-financeiro">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        Baixa e repasse são <b>registros manuais</b>: o ADM MAX não gera boleto, não recebe Pix e
        não transfere dinheiro nesta fase. Regras marcadas <AConfirmar /> são exemplo até o
        financeiro confirmar.
      </div>
      <Tabs value={sub} onValueChange={(v) => setSub(v as Sub)}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="contratos">
            Contratos ({p.contratos.length})
            {p.contratos.some((c) => c.situacao === "a_completar") && (
              <Pill tom="amber" className="ml-1">
                {p.contratos.filter((c) => c.situacao === "a_completar").length} a completar
              </Pill>
            )}
          </TabsTrigger>
          <TabsTrigger value="repasse">Repasse e extrato</TabsTrigger>
          {p.podeRegras && <TabsTrigger value="regras">Regras financeiras</TabsTrigger>}
        </TabsList>
        <TabsContent value="painel">
          <Painel p={p} setComp={setComp} onAbrir={setCob} onMudou={carregar} />
        </TabsContent>
        <TabsContent value="contratos">
          <Contratos p={p} sel={ctSel} setSel={setCtSel} onMudou={carregar} onAbrir={setCob} />
        </TabsContent>
        <TabsContent value="repasse">
          <Repasse p={p} onAbrir={setCob} />
        </TabsContent>
        <TabsContent value="regras">
          {p.podeRegras && <RegrasFin config={p.config} onSalvo={carregar} />}
        </TabsContent>
      </Tabs>
      {cob && (
        <CobrancaDialog
          c={cob}
          cfg={p.config}
          hoje={p.hoje}
          onFechar={() => setCob(null)}
          onMudou={carregar}
        />
      )}
    </div>
  );
}

// --- Painel ----------------------------------------------------------------------------------------------------------
function Painel({
  p,
  setComp,
  onAbrir,
  onMudou,
}: {
  p: PainelFin;
  setComp: (c: string) => void;
  onAbrir: (c: Cobranca) => void;
  onMudou: () => Promise<void>;
}) {
  const t = resumoPainel(p.cobrancas, p.atrasadasAntes);
  const [gerando, setGerando] = useState(false);
  const aCompletar = p.contratos.filter((c) => c.situacao === "a_completar");
  const pendRepasse = p.cobrancas.filter((c) => c.status === "paga" && !c.repasse);
  const atrasadas = [...p.atrasadasAntes, ...p.cobrancas.filter((c) => c.situacao === "atraso")];

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await gerarCobrancasFin(p.competencia);
      toast.success(
        r.geradas ? `${r.geradas} cobrança(s) gerada(s).` : "Nenhuma cobrança nova para gerar.",
      );
      await onMudou();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível gerar as cobranças."));
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setComp(mesDeslocado(p.competencia, -1))}
        >
          ‹ Anterior
        </Button>
        <b className="min-w-[90px] text-center" data-testid="fin-competencia">
          {competenciaLabel(p.competencia)}
        </b>
        <Button variant="outline" size="sm" onClick={() => setComp(mesDeslocado(p.competencia, 1))}>
          Próximo ›
        </Button>
        <span className="flex-1" />
        <Button size="sm" disabled={gerando || p.faltamGerar === 0} onClick={() => void gerar()}>
          Gerar cobranças de {competenciaLabel(p.competencia)}
          {p.faltamGerar > 0 ? ` (${p.faltamGerar})` : ""}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="fin-kpis">
        <KpiTile
          label="A receber (a vencer)"
          value={brl(t.aReceber)}
          icon={CalendarClock}
          tom="blue"
        />
        <KpiTile label="Recebido no mês" value={brl(t.recebido)} icon={Wallet} tom="green" />
        <KpiTile label="Em atraso" value={brl(t.emAtraso)} icon={AlertTriangle} tom="red">
          {t.qtdAtraso} cobrança(s) · com multa e juros de hoje
        </KpiTile>
        <KpiTile
          label="Repasses do mês"
          value={brl(t.repassesTotal)}
          icon={ArrowLeftRight}
          tom="violet"
        >
          feitos {brl(t.repassesFeitos)} · pendentes {brl(t.repassesPendentes)}
        </KpiTile>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">O que precisa do Financeiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!atrasadas.length && !aCompletar.length && !pendRepasse.length && !p.faltamGerar && (
              <p className="text-muted-foreground">Nada pendente nesta competência.</p>
            )}
            {aCompletar.map((c) => (
              <p key={c.id}>
                <Pill tom="amber">a completar</Pill> <b>{c.codigo}</b> ({c.locacaoCodigo}) — chave
                entregue; falta completar proprietário/dados de repasse e ativar.
              </p>
            ))}
            {p.faltamGerar > 0 && (
              <p>
                <Pill tom="amber">gerar</Pill> {p.faltamGerar} contrato(s) ativo(s) sem cobrança de{" "}
                {competenciaLabel(p.competencia)}.
              </p>
            )}
            {atrasadas.map((c) => (
              <button
                key={c.id}
                type="button"
                className="block w-full text-left hover:underline"
                onClick={() => onAbrir(c)}
              >
                <Pill tom="red">atraso {c.diasAtraso}d</Pill> <b>{c.contratoCodigo}</b> ·{" "}
                {c.inquilinoNome} · {competenciaLabel(c.competencia)} — {brl(devidoHoje(c))}
              </button>
            ))}
            {pendRepasse.map((c) => (
              <button
                key={c.id}
                type="button"
                className="block w-full text-left hover:underline"
                onClick={() => onAbrir(c)}
              >
                <Pill tom="violet">repasse</Pill> <b>{c.contratoCodigo}</b> → {c.proprietarioNome}:{" "}
                {brl(c.repasseCalc?.total ?? 0)} previsto {dataBr(c.repasseCalc?.previsto)}
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Resumo de {competenciaLabel(p.competencia)}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                <Linha t="Taxas da imobiliária (sobre o já recebido)" v={brl(t.taxasImobiliaria)} />
                <Linha t="Repasses já feitos" v={brl(t.repassesFeitos)} />
                <Linha t="Repasses pendentes" v={brl(t.repassesPendentes)} />
                <Linha
                  t="Inadimplência do mês (atraso ÷ cobrado)"
                  v={`${t.inadimplenciaPct.toFixed(1).replace(".", ",")}%`}
                />
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Cobranças de {competenciaLabel(p.competencia)}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!p.cobrancas.length ? (
            <EmptyState icon={Banknote}>
              Nenhuma cobrança nesta competência. Use “Gerar cobranças”.
            </EmptyState>
          ) : (
            <TabelaCobrancas cobs={p.cobrancas} onAbrir={onAbrir} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Linha({ t, v, forte }: { t: string; v: string; forte?: boolean }) {
  return (
    <tr className={forte ? "border-t font-semibold" : "border-t"}>
      <td className="py-1.5 pr-2">{t}</td>
      <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}

function SituacaoPill({ c }: { c: Cobranca }) {
  const s = SITUACAO_COB[c.situacao];
  const extra =
    c.situacao === "atraso"
      ? ` há ${c.diasAtraso}d`
      : c.situacao === "paga"
        ? ` ${dataBr(c.pagoEm)}${c.pagoEm && c.pagoEm > c.vencimento ? " (atraso)" : ""}`
        : "";
  return (
    <Pill tom={s.tom}>
      {s.label}
      {extra}
    </Pill>
  );
}

function TabelaCobrancas({ cobs, onAbrir }: { cobs: Cobranca[]; onAbrir: (c: Cobranca) => void }) {
  return (
    <table className="w-full min-w-[820px] text-sm" data-testid="fin-cobrancas">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1">Contrato</th>
          <th>Inquilino</th>
          <th>Proprietário</th>
          <th>Vencimento</th>
          <th className="text-right">Valor</th>
          <th>Situação</th>
          <th>Repasse</th>
        </tr>
      </thead>
      <tbody>
        {cobs.map((c) => (
          <tr
            key={c.id}
            className="cursor-pointer border-t align-top hover:bg-muted/40"
            onClick={() => onAbrir(c)}
          >
            <td className="py-2 font-medium text-primary underline">{c.contratoCodigo}</td>
            <td>{c.inquilinoNome}</td>
            <td className="text-xs">{c.proprietarioNome}</td>
            <td>{dataBr(c.vencimento)}</td>
            <td className="text-right tabular-nums">{brl(devidoHoje(c) || c.valor)}</td>
            <td>
              <SituacaoPill c={c} />
            </td>
            <td className="text-xs">
              {c.repasse ? (
                <Pill tom="green">feito {dataBr(c.repasse.feitoEm)}</Pill>
              ) : c.status === "paga" ? (
                `${brl(c.repasseCalc?.total ?? 0)} · prev. ${dataBr(c.repasseCalc?.previsto)}`
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Cobrança (diálogo: baixa, desconto, repasse, estorno, cancelamento) ----------------------------------------------
function CobrancaDialog({
  c,
  cfg,
  hoje,
  onFechar,
  onMudou,
}: {
  c: Cobranca;
  cfg: ConfigFin;
  hoje: string;
  onFechar: () => void;
  onMudou: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pagoEm, setPagoEm] = useState(hoje);
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [descDesc, setDescDesc] = useState("");
  const [descValor, setDescValor] = useState("");
  const [repEm, setRepEm] = useState(hoje);
  const [comprov, setComprov] = useState("");
  const [motivo, setMotivo] = useState("");

  // Prévia dos encargos na data escolhida (mesma regra do banco; o banco recalcula ao gravar).
  const previa = useMemo(() => {
    const dias = Math.max(
      0,
      Math.round(
        (Date.parse(pagoEm + "T12:00:00Z") - Date.parse(c.vencimento + "T12:00:00Z")) / 864e5,
      ),
    );
    const base = cfg.multaSobre === "total" ? c.valor : c.aluguel;
    const multa = dias > 0 ? Math.round(base * cfg.multaPct) / 100 : 0;
    const juros =
      dias > 0 ? Math.round(((base * cfg.jurosPctMes) / 100 / 30) * dias * 100) / 100 : 0;
    return { dias, multa, juros, total: Math.round((c.valor + multa + juros) * 100) / 100 };
  }, [pagoEm, c, cfg]);

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      setMotivo("");
      await onMudou();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="fin-cobranca">
        <DialogHeader>
          <DialogTitle className="text-base">
            {c.contratoCodigo} · {competenciaLabel(c.competencia)} <SituacaoPill c={c} />
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {c.inquilinoNome} → {c.proprietarioNome} · {c.endereco}
          </p>
        </DialogHeader>

        <table className="w-full text-sm">
          <tbody>
            <Linha t="Aluguel" v={brl(c.aluguel)} />
            {c.condominio > 0 && <Linha t="Condomínio" v={brl(c.condominio)} />}
            {c.iptu > 0 && <Linha t="IPTU (parcela)" v={brl(c.iptu)} />}
            <Linha t={`Total (vence ${dataBr(c.vencimento)})`} v={brl(c.valor)} forte />
            {c.status === "paga" && (
              <>
                {c.multa + c.juros > 0 && (
                  <Linha
                    t={`Multa ${brl(c.multa)} + juros ${brl(c.juros)}`}
                    v={brl(c.multa + c.juros)}
                  />
                )}
                <Linha
                  t={`Pago em ${dataBr(c.pagoEm)}${c.baixaPorNome ? ` · baixa por ${c.baixaPorNome}` : ""}`}
                  v={brl(c.valorPago ?? 0)}
                  forte
                />
              </>
            )}
          </tbody>
        </table>
        {c.obs && <p className="text-xs text-muted-foreground">Obs.: {c.obs}</p>}

        {c.status === "aberta" && (
          <section className="space-y-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">
              Dar baixa (pagamento recebido fora do sistema)
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="fin-pago-em">Pago em</Label>
                <Input
                  id="fin-pago-em"
                  type="date"
                  max={hoje}
                  value={pagoEm}
                  onChange={(e) => setPagoEm(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-valor">Valor pago</Label>
                <Input
                  id="fin-valor"
                  inputMode="decimal"
                  placeholder={previa.total.toFixed(2).replace(".", ",")}
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-obs">Observação</Label>
                <Input id="fin-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="fin-previa">
              {previa.dias > 0
                ? `Atraso de ${previa.dias} dia(s): multa ${cfg.multaPct}% = ${brl(previa.multa)} + juros ${cfg.jurosPctMes}% a.m. pró-rata = ${brl(previa.juros)}. `
                : "Em dia: sem multa e juros. "}
              Devido: <b>{brl(previa.total)}</b>. Valor diferente exige observação. <AConfirmar />
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void acao(
                    () =>
                      baixaFin(c.id, pagoEm, valor ? num(valor) : previa.total, obs.trim() || null),
                    "Baixa registrada",
                  )
                }
              >
                Registrar baixa
              </Button>
            </div>
          </section>
        )}

        {c.status === "paga" && c.repasseCalc && (
          <section className="space-y-2 rounded-md border p-3" data-testid="fin-repasse">
            <h3 className="text-sm font-semibold">Repasse ao proprietário</h3>
            <table className="w-full text-sm">
              <tbody>
                {c.repasseCalc.linhas.map((l, i) => (
                  <Linha key={i} t={l.t} v={(l.v < 0 ? "− " : "") + brl(Math.abs(l.v))} />
                ))}
                <Linha t="= Valor a repassar" v={brl(c.repasseCalc.total)} forte />
              </tbody>
            </table>
            {c.repasseCalc.retencaoPrimeiro && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                1º aluguel retido pela imobiliária (taxa de locação) <AConfirmar />
              </p>
            )}
            {c.repasseCalc.total < 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Saldo negativo: os descontos passaram do valor a repassar neste mês.
              </p>
            )}
            {c.descontos.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-xs">
                <span className="flex-1">
                  Desconto: {d.descricao} — {brl(d.valor)}
                </span>
                {!c.repasse && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void acao(() => removerDescontoFin(d.id), "Desconto removido")}
                  >
                    remover
                  </Button>
                )}
              </div>
            ))}
            {c.repasse ? (
              <div className="space-y-2">
                <p className="text-sm">
                  <Pill tom="green">repasse feito</Pill> {dataBr(c.repasse.feitoEm)} ·{" "}
                  {brl(c.repasse.valor)}
                  {c.repasse.comprovante ? ` · ${c.repasse.comprovante}` : ""}
                </p>
                <MotivoAcao
                  motivo={motivo}
                  setMotivo={setMotivo}
                  busy={busy}
                  label="Desfazer registro do repasse"
                  onClick={() =>
                    void acao(
                      () => desfazerRepasseFin(c.repasse!.id, motivo),
                      "Registro de repasse desfeito",
                    )
                  }
                />
              </div>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                  <Input
                    aria-label="Descrição do desconto"
                    placeholder="Desconto (ex.: conserto autorizado)"
                    value={descDesc}
                    onChange={(e) => setDescDesc(e.target.value)}
                  />
                  <Input
                    aria-label="Valor do desconto"
                    inputMode="decimal"
                    placeholder="Valor"
                    value={descValor}
                    onChange={(e) => setDescValor(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !descDesc.trim() || !descValor}
                    onClick={() =>
                      void acao(async () => {
                        await descontoFin(c.id, descDesc.trim(), num(descValor));
                        setDescDesc("");
                        setDescValor("");
                      }, "Desconto lançado")
                    }
                  >
                    + Desconto
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Previsto para {dataBr(c.repasseCalc.previsto)} ({cfg.diasRepasse} dias após o
                  pagamento) <AConfirmar />
                </p>
                <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
                  <Input
                    aria-label="Data do repasse"
                    type="date"
                    max={hoje}
                    value={repEm}
                    onChange={(e) => setRepEm(e.target.value)}
                  />
                  <Input
                    aria-label="Comprovante"
                    placeholder="Comprovante (Pix/TED) — opcional"
                    value={comprov}
                    onChange={(e) => setComprov(e.target.value)}
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void acao(
                        () => repasseFeitoFin(c.id, repEm, comprov.trim() || null),
                        "Repasse registrado",
                      )
                    }
                  >
                    Marcar repasse feito
                  </Button>
                </div>
                <MotivoAcao
                  motivo={motivo}
                  setMotivo={setMotivo}
                  busy={busy}
                  label="Desfazer baixa"
                  onClick={() => void acao(() => estornarFin(c.id, motivo), "Baixa desfeita")}
                />
              </>
            )}
          </section>
        )}

        {c.status === "aberta" && (
          <MotivoAcao
            motivo={motivo}
            setMotivo={setMotivo}
            busy={busy}
            label="Cancelar cobrança"
            onClick={() => void acao(() => cancelarFin(c.id, motivo), "Cobrança cancelada")}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MotivoAcao({
  motivo,
  setMotivo,
  busy,
  label,
  onClick,
}: {
  motivo: string;
  setMotivo: (s: string) => void;
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">{label}…</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input
          aria-label={`Motivo — ${label}`}
          className="min-w-[200px] flex-1"
          placeholder="Motivo (obrigatório)"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy || motivo.trim().length < 5}
          onClick={onClick}
        >
          {label}
        </Button>
      </div>
    </details>
  );
}

// --- Contratos ---------------------------------------------------------------------------------------------------------
function Contratos({
  p,
  sel,
  setSel,
  onMudou,
  onAbrir,
}: {
  p: PainelFin;
  sel: string | null;
  setSel: (id: string | null) => void;
  onMudou: () => Promise<void>;
  onAbrir: (c: Cobranca) => void;
}) {
  if (!p.contratos.length) {
    return (
      <EmptyState icon={Banknote}>
        Nenhum contrato ainda. O contrato nasce sozinho quando a esteira registra a entrega das
        chaves.
      </EmptyState>
    );
  }
  const atual = p.contratos.find((c) => c.id === sel) ?? null;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="overflow-x-auto pt-4">
          <table className="w-full min-w-[760px] text-sm" data-testid="fin-contratos">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1">Contrato</th>
                <th>Imóvel</th>
                <th>Inquilino · Proprietário</th>
                <th className="text-right">Aluguel</th>
                <th>Vence</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {p.contratos.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t align-top hover:bg-muted/40"
                  onClick={() => setSel(c.id)}
                >
                  <td className="py-2 font-medium text-primary underline">{c.codigo}</td>
                  <td className="max-w-[240px] text-xs">{c.endereco || "—"}</td>
                  <td className="text-xs">
                    {c.inquilinoNome || "—"} · {c.proprietarioNome || <i>falta proprietário</i>}
                  </td>
                  <td className="text-right tabular-nums">{brl(c.aluguel)}</td>
                  <td>dia {c.diaVencimento}</td>
                  <td>
                    <Pill tom={SITUACAO_CT[c.situacao].tom}>{SITUACAO_CT[c.situacao].label}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {atual && <ContratoDetalhe key={atual.id} ct={atual} onMudou={onMudou} onAbrir={onAbrir} />}
    </div>
  );
}

function ContratoDetalhe({
  ct,
  onMudou,
  onAbrir,
}: {
  ct: Contrato;
  onMudou: () => Promise<void>;
  onAbrir: (c: Cobranca) => void;
}) {
  const [f, setF] = useState(() => ({
    endereco: ct.endereco,
    inquilino_nome: ct.inquilinoNome,
    proprietario_nome: ct.proprietarioNome,
    proprietario_doc: ct.proprietarioDoc,
    dados_repasse: ct.dadosRepasse,
    aluguel: String(ct.aluguel).replace(".", ","),
    taxa_adm: String(ct.taxaAdm).replace(".", ","),
    condominio: String(ct.condominio).replace(".", ","),
    iptu: String(ct.iptu).replace(".", ","),
    dia_vencimento: String(ct.diaVencimento),
    inicio: ct.inicio,
    proximo_reajuste: ct.proximoReajuste,
    indice: ct.indice,
    garantia: ct.garantia,
  }));
  const [hist, setHist] = useState<{ cobs: Cobranca[]; ev: EventoFin[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const carregarHist = useCallback(async () => {
    try {
      const raw = await contratoFin(ct.id);
      const o = (raw ?? {}) as { cobrancas?: unknown[] };
      setHist({ cobs: (o.cobrancas ?? []).map(lerCobranca), ev: lerEventosFin(raw) });
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível carregar o histórico."));
    }
  }, [ct.id]);
  useEffect(() => void carregarHist(), [carregarHist]);

  const salvar = async (ativar: boolean) => {
    setBusy(true);
    try {
      await salvarContratoFin(ct.id, {
        ...f,
        aluguel: num(f.aluguel),
        taxa_adm: numSimples(f.taxa_adm),
        condominio: num(f.condominio),
        iptu: num(f.iptu),
        dia_vencimento: Number(f.dia_vencimento) || 0,
      });
      if (ativar) await ativarContratoFin(ct.id);
      toast.success(ativar ? "Contrato ativado" : "Contrato salvo");
      await onMudou();
      await carregarHist();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar o contrato."));
    } finally {
      setBusy(false);
    }
  };

  const campo = (k: keyof typeof f, label: string, extra?: { type?: string; conf?: boolean }) => (
    <div className="space-y-1">
      <Label htmlFor={`ct-${k}`}>
        {label}
        {extra?.conf && <AConfirmar />}
      </Label>
      <Input
        id={`ct-${k}`}
        type={extra?.type ?? "text"}
        value={f[k]}
        disabled={ct.situacao === "encerrado"}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
      />
    </div>
  );

  return (
    <Card data-testid="fin-contrato">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {ct.codigo} <span className="text-xs text-muted-foreground">({ct.locacaoCodigo})</span>
          <Pill tom={SITUACAO_CT[ct.situacao].tom}>{SITUACAO_CT[ct.situacao].label}</Pill>
          {ct.chaveEm && (
            <span className="text-xs font-normal text-muted-foreground">
              chaves {dataBr(ct.chaveEm)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {campo("endereco", "Imóvel")}
          {campo("inquilino_nome", "Inquilino")}
          {campo("proprietario_nome", "Proprietário")}
          {campo("proprietario_doc", "CPF/CNPJ do proprietário")}
          {campo("dados_repasse", "Dados para repasse (banco/Pix)")}
          <div className="space-y-1">
            <Label htmlFor="ct-garantia">Garantia</Label>
            <select
              id="ct-garantia"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={f.garantia}
              onChange={(e) => setF((x) => ({ ...x, garantia: e.target.value }))}
            >
              {(Object.keys(GARANTIA_LABEL) as Garantia[]).map((g) => (
                <option key={g} value={g}>
                  {GARANTIA_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          {campo("aluguel", "Aluguel (R$)")}
          {campo("taxa_adm", "Taxa de administração (%)")}
          {campo("dia_vencimento", "Dia de vencimento (1–28)")}
          {campo("condominio", "Condomínio (R$)")}
          {campo("iptu", "IPTU mensal (R$)")}
          {campo("inicio", "Início", { type: "date" })}
          {campo("proximo_reajuste", "Próximo reajuste", { type: "date" })}
          <div className="space-y-1">
            <Label htmlFor="ct-indice">
              Índice de reajuste <AConfirmar />
            </Label>
            <select
              id="ct-indice"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={f.indice}
              onChange={(e) => setF((x) => ({ ...x, indice: e.target.value }))}
            >
              {INDICES.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>
        {ct.situacao !== "encerrado" && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void salvar(false)}>
              Salvar
            </Button>
            {ct.situacao === "a_completar" && (
              <Button disabled={busy} onClick={() => void salvar(true)}>
                Salvar e ativar contrato
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Histórico financeiro</h3>
          {!hist ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              {hist.cobs.length > 0 && (
                <div className="overflow-x-auto">
                  <TabelaCobrancas cobs={hist.cobs} onAbrir={onAbrir} />
                </div>
              )}
              <ul className="max-h-64 space-y-1 overflow-y-auto text-xs" data-testid="fin-eventos">
                {hist.ev.map((e, i) => (
                  <li key={i} className="border-t pt-1">
                    <span className="text-muted-foreground">
                      {new Date(e.em).toLocaleString("pt-BR")} · {e.atorNome || "sistema"}
                    </span>{" "}
                    — {e.descricao}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Repasse e extrato -------------------------------------------------------------------------------------------------
function Repasse({ p, onAbrir }: { p: PainelFin; onAbrir: (c: Cobranca) => void }) {
  const props = proprietarios(p.contratos);
  const [prop, setProp] = useState<string>(props[0] ?? "");
  const [cobs, setCobs] = useState<Cobranca[] | null>(null);
  const atual = props.includes(prop) ? prop : (props[0] ?? "");

  useEffect(() => {
    if (!atual) return;
    let vivo = true;
    setCobs(null);
    extratoFin(atual)
      .then((raw) => {
        const o = (raw ?? {}) as { cobrancas?: unknown[] };
        if (vivo) setCobs((o.cobrancas ?? []).map(lerCobranca));
      })
      .catch((e) => toast.error(errorMessage(e, "Não foi possível carregar o extrato.")));
    return () => {
      vivo = false;
    };
  }, [atual, p]);

  const pendentes = p.cobrancas.filter((c) => c.status === "paga" && !c.repasse);
  const extrato = cobs ? montarExtrato(cobs) : [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Repasses a fazer — {competenciaLabel(p.competencia)}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Recebido − taxa de administração − descontos = valor a repassar. Data prevista:{" "}
            {p.config.diasRepasse} dias após o pagamento <AConfirmar />
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!pendentes.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum repasse pendente nesta competência.
            </p>
          ) : (
            <TabelaCobrancas cobs={pendentes} onAbrir={onAbrir} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Extrato do proprietário
            <select
              aria-label="Proprietário"
              className="h-9 max-w-full rounded-md border bg-background px-2 text-sm font-normal"
              value={atual}
              onChange={(e) => setProp(e.target.value)}
            >
              {props.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!props.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhum proprietário cadastrado nos contratos ainda.
            </p>
          ) : !cobs ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : !extrato.length ? (
            <p className="text-sm text-muted-foreground">Nenhum pagamento recebido ainda.</p>
          ) : (
            <table className="w-full min-w-[680px] text-sm" data-testid="fin-extrato">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Data</th>
                  <th>Contrato</th>
                  <th>Competência</th>
                  <th>Lançamento</th>
                  <th className="text-right">Valor</th>
                  <th className="text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {extrato.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1.5">{dataBr(l.data)}</td>
                    <td>{l.contrato}</td>
                    <td>{competenciaLabel(l.competencia)}</td>
                    <td>{l.descricao}</td>
                    <td className="text-right tabular-nums">{brl(l.valor)}</td>
                    <td className="text-right tabular-nums">{brl(l.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// --- Regras financeiras ------------------------------------------------------------------------------------------------
function RegrasFin({ config, onSalvo }: { config: ConfigFin; onSalvo: () => Promise<void> }) {
  const [f, setF] = useState(config);
  const [busy, setBusy] = useState(false);
  const salvar = async () => {
    setBusy(true);
    try {
      await salvarConfigFin({
        multa_pct: f.multaPct,
        juros_pct_mes: f.jurosPctMes,
        multa_sobre: f.multaSobre,
        multa_para: f.multaPara,
        dias_repasse: f.diasRepasse,
        condominio_no_boleto: f.condominioNoBoleto,
        iptu_no_boleto: f.iptuNoBoleto,
        iptu_repassa_proprietario: f.iptuRepassaProprietario,
        indice: f.indice,
        retem_primeiro_aluguel: f.retemPrimeiroAluguel,
      });
      toast.success("Regras financeiras salvas");
      await onSalvo();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar as regras."));
    } finally {
      setBusy(false);
    }
  };
  const numero = (k: "multaPct" | "jurosPctMes" | "diasRepasse", label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`rf-${k}`}>
        {label} <AConfirmar />
      </Label>
      <Input
        id={`rf-${k}`}
        inputMode="decimal"
        value={String(f[k]).replace(".", ",")}
        onChange={(e) => setF((x) => ({ ...x, [k]: numSimples(e.target.value) }))}
      />
    </div>
  );
  const chk = (
    k: "condominioNoBoleto" | "iptuNoBoleto" | "iptuRepassaProprietario" | "retemPrimeiroAluguel",
    label: string,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={f[k]}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.checked }))}
      />
      {label} <AConfirmar />
    </label>
  );
  return (
    <Card data-testid="fin-regras">
      <CardHeader>
        <CardTitle className="text-base">Regras financeiras desta imobiliária</CardTitle>
        <p className="text-sm text-muted-foreground">
          Valores de exemplo da maquete. Valem a partir da próxima geração/baixa; o que já foi
          baixado guarda a regra usada. Toda mudança fica no histórico.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {numero("multaPct", "Multa por atraso (%)")}
        {numero("jurosPctMes", "Juros ao mês (%, pró-rata dia)")}
        {numero("diasRepasse", "Repasse: dias após o pagamento")}
        <div className="space-y-1">
          <Label htmlFor="rf-sobre">
            Multa e juros sobre <AConfirmar />
          </Label>
          <select
            id="rf-sobre"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={f.multaSobre}
            onChange={(e) =>
              setF((x) => ({ ...x, multaSobre: e.target.value as ConfigFin["multaSobre"] }))
            }
          >
            <option value="aluguel">Só o aluguel</option>
            <option value="total">Total da cobrança</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rf-para">
            Multa e juros ficam com <AConfirmar />
          </Label>
          <select
            id="rf-para"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={f.multaPara}
            onChange={(e) =>
              setF((x) => ({ ...x, multaPara: e.target.value as ConfigFin["multaPara"] }))
            }
          >
            {(Object.keys(MULTA_PARA_LABEL) as ConfigFin["multaPara"][]).map((k) => (
              <option key={k} value={k}>
                {MULTA_PARA_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="rf-indice">
            Índice padrão de reajuste <AConfirmar />
          </Label>
          <select
            id="rf-indice"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={f.indice}
            onChange={(e) => setF((x) => ({ ...x, indice: e.target.value as ConfigFin["indice"] }))}
          >
            {INDICES.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2 md:col-span-3">
          {chk("retemPrimeiroAluguel", "Imobiliária retém o 1º aluguel (taxa de locação)")}
          {chk("condominioNoBoleto", "Condomínio entra na cobrança do inquilino")}
          {chk("iptuNoBoleto", "IPTU entra na cobrança do inquilino")}
          {chk("iptuRepassaProprietario", "IPTU cobrado vai para o proprietário no repasse")}
        </div>
        <div className="flex justify-end md:col-span-3">
          <Button disabled={busy} onClick={() => void salvar()}>
            Salvar regras financeiras
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
