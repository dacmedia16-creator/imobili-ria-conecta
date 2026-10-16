import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Target, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/exclusive-captures-dashboard";
import {
  calcularFunil,
  diasUteisRestantes,
  falta,
  normalizarRealizado,
  periodoAtual,
  projecao,
  taxasEfetivas,
  type MinhaMeta,
  type Realizado,
  type Taxas,
  type TaxasRow,
} from "@/lib/minha-carreira";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ListSkeleton, Pill } from "@/components/visual/base";

// Minha carreira, PR 2 (card t_0219ca7f): bloco "Meu mês" e resumo do ano. Tabelas minhas_metas e
// carreira_taxas e RPC meu_realizado (migração 20261016120000), ainda fora de types.ts. O banco
// garante: só a linha do próprio corretor, na imobiliária ativa (auth.uid() + current_org_id()).
const db = supabase as unknown as SupabaseClient;

type Form = { comissao: string; vgv: string; vendas: string; captacoes: string };
const VAZIO: Form = { comissao: "", vgv: "", vendas: "", captacoes: "" };
const paraForm = (m: MinhaMeta | undefined): Form =>
  m
    ? {
        comissao: m.meta_comissao?.toString() ?? "",
        vgv: m.meta_vgv?.toString() ?? "",
        vendas: m.meta_vendas?.toString() ?? "",
        captacoes: m.meta_captacoes?.toString() ?? "",
      }
    : VAZIO;
const numOuNull = (s: string) => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : NaN;
};
const toMeta = (r: Record<string, unknown>): MinhaMeta => ({
  id: r.id as string,
  periodo: r.periodo as "mes" | "ano",
  inicio: r.inicio as string,
  meta_comissao: r.meta_comissao == null ? null : Number(r.meta_comissao),
  meta_vgv: r.meta_vgv == null ? null : Number(r.meta_vgv),
  meta_vendas: r.meta_vendas == null ? null : Number(r.meta_vendas),
  meta_captacoes: r.meta_captacoes == null ? null : Number(r.meta_captacoes),
});
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

type Dados = {
  metas: MinhaMeta[];
  taxasRows: TaxasRow[];
  mes: Realizado;
  ano: Realizado;
};

export function MeuMes({ userId }: { userId: string }) {
  const p = useMemo(() => periodoAtual(), []);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<"mes" | "ano">("mes");
  const [form, setForm] = useState<Form>(VAZIO);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [tx, setTx] = useState<Taxas | null>(null);

  const carregar = useCallback(async () => {
    const [m, t, rm, ra] = await Promise.all([
      db
        .from("minhas_metas")
        .select("id,periodo,inicio,meta_comissao,meta_vgv,meta_vendas,meta_captacoes")
        .in("inicio", [p.mes, p.ano]),
      db
        .from("carreira_taxas")
        .select(
          "user_id,comissao_media,ligacoes_por_visita,visitas_por_acm,acms_por_venda,acms_por_captacao",
        ),
      db.rpc("meu_realizado", { _inicio: p.mes, _fim: p.fimMes }),
      db.rpc("meu_realizado", { _inicio: p.ano, _fim: p.fimAno }),
    ]);
    const e = m.error ?? t.error ?? rm.error ?? ra.error;
    if (e) {
      setErro(errorMessage(e, "Não foi possível carregar a sua meta."));
      return;
    }
    const first = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Record<string, unknown>;
    setDados({
      metas: ((m.data ?? []) as Record<string, unknown>[]).map(toMeta),
      taxasRows: (t.data ?? []) as TaxasRow[],
      mes: normalizarRealizado(first(rm.data)),
      ano: normalizarRealizado(first(ra.data)),
    });
  }, [p]);

  useEffect(() => {
    void carregar();
  }, [carregar, userId]);

  const meta = dados?.metas.find((x) => x.periodo === aba);
  const efetivas = useMemo(
    () => (dados ? taxasEfetivas(dados.taxasRows, userId) : null),
    [dados, userId],
  );
  useEffect(() => {
    if (efetivas) setTx(efetivas.taxas);
  }, [efetivas]);
  useEffect(() => {
    setForm(paraForm(meta));
    setEditando(false);
  }, [meta, aba]);

  async function salvarMeta() {
    const v = {
      meta_comissao: numOuNull(form.comissao),
      meta_vgv: numOuNull(form.vgv),
      meta_vendas: numOuNull(form.vendas),
      meta_captacoes: numOuNull(form.captacoes),
    };
    if (Object.values(v).some((x) => Number.isNaN(x))) {
      toast.error("Use só números positivos.");
      return;
    }
    if (Object.values(v).every((x) => x == null)) {
      toast.error("Preencha pelo menos um campo da meta.");
      return;
    }
    if (
      (v.meta_vendas != null && !Number.isInteger(v.meta_vendas)) ||
      (v.meta_captacoes != null && !Number.isInteger(v.meta_captacoes))
    ) {
      toast.error("Vendas e captações são números inteiros.");
      return;
    }
    setSalvando(true);
    const inicio = aba === "mes" ? p.mes : p.ano;
    const r = meta?.id
      ? await db.from("minhas_metas").update(v).eq("id", meta.id)
      : await db.from("minhas_metas").insert({ periodo: aba, inicio, ...v });
    setSalvando(false);
    if (r.error) {
      toast.error(errorMessage(r.error, "Não foi possível salvar a meta."));
      return;
    }
    toast.success("Meta salva");
    await carregar();
  }

  async function salvarTaxas() {
    if (!tx) return;
    const ok = [
      tx.ligacoes_por_visita,
      tx.visitas_por_acm,
      tx.acms_por_venda,
      tx.acms_por_captacao,
    ].every((x) => Number.isFinite(x) && x > 0 && x <= 1000);
    if (!ok || (tx.comissao_media != null && !(tx.comissao_media > 0))) {
      toast.error("As taxas precisam ser maiores que zero.");
      return;
    }
    const linha = { user_id: userId, ...tx };
    const existe = dados?.taxasRows.some((r) => r.user_id === userId);
    const r = existe
      ? await db.from("carreira_taxas").update(tx).eq("user_id", userId)
      : await db.from("carreira_taxas").insert(linha);
    if (r.error) {
      toast.error(errorMessage(r.error, "Não foi possível salvar as suas taxas."));
      return;
    }
    toast.success("Suas taxas foram salvas");
    await carregar();
  }

  const real = dados ? (aba === "mes" ? dados.mes : dados.ano) : null;
  const diaPer = aba === "mes" ? p.dia : diaDoAno(p.hoje);
  const diasPer = aba === "mes" ? p.diasMes : diasNoAno(p.ano);
  const fimPer = aba === "mes" ? p.fimMes : p.fimAno;
  const nomePer = aba === "mes" ? MESES[Number(p.mes.slice(5, 7)) - 1] : p.ano.slice(0, 4);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" aria-hidden /> Meu mês
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Você define a sua meta. Só você altera; ela vale só para você, nesta imobiliária.
        </p>
        <div className="flex gap-2 pt-1" role="group" aria-label="Período da meta">
          <Button
            size="sm"
            variant={aba === "mes" ? "default" : "outline"}
            onClick={() => setAba("mes")}
          >
            Mês
          </Button>
          <Button
            size="sm"
            variant={aba === "ano" ? "default" : "outline"}
            onClick={() => setAba("ano")}
          >
            Ano
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="meu-mes">
        {erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : !dados || !real || !tx ? (
          <ListSkeleton />
        ) : (
          <>
            {!meta || editando ? (
              <div className="space-y-3">
                {!meta ? (
                  <EmptyState icon={Target}>
                    Você ainda não definiu sua meta de {nomePer}. Preencha o que fizer sentido para
                    você (comissão, VGV, vendas ou captações).
                  </EmptyState>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-4">
                  <Campo
                    id="m-com"
                    label="Comissão (R$)"
                    value={form.comissao}
                    onChange={(x) => setForm({ ...form, comissao: x })}
                  />
                  <Campo
                    id="m-vgv"
                    label="VGV (R$)"
                    value={form.vgv}
                    onChange={(x) => setForm({ ...form, vgv: x })}
                  />
                  <Campo
                    id="m-ven"
                    label="Vendas"
                    value={form.vendas}
                    onChange={(x) => setForm({ ...form, vendas: x })}
                  />
                  <Campo
                    id="m-cap"
                    label="Captações"
                    value={form.captacoes}
                    onChange={(x) => setForm({ ...form, captacoes: x })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={salvando} onClick={salvarMeta}>
                    {salvando ? "Salvando…" : "Salvar minha meta"}
                  </Button>
                  {meta ? (
                    <Button size="sm" variant="outline" onClick={() => setEditando(false)}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <Progresso
                meta={meta}
                real={real}
                diaPer={diaPer}
                diasPer={diasPer}
                onEditar={() => setEditando(true)}
              />
            )}

            {meta ? (
              <Calculadora
                tx={tx}
                setTx={setTx}
                proprias={efetivas?.proprias ?? false}
                onSalvar={salvarTaxas}
                faltam={{
                  vendas: falta(meta.meta_vendas, real.vendas),
                  comissao: falta(meta.meta_comissao, real.comissao),
                  captacoes:
                    real.captacoes == null ? null : falta(meta.meta_captacoes, real.captacoes),
                }}
                diasUteis={diasUteisRestantes(p.hoje, fimPer)}
                ate={fimPer}
              />
            ) : null}

            <ResumoAno ano={dados.ano} label={p.ano.slice(0, 4)} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Campo(props: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        inputMode="decimal"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

function Progresso(props: {
  meta: MinhaMeta;
  real: Realizado;
  diaPer: number;
  diasPer: number;
  onEditar: () => void;
}) {
  const { meta, real, diaPer, diasPer } = props;
  // Indicador principal: comissão; senão VGV; senão vendas.
  const principal =
    meta.meta_comissao != null
      ? { nome: "comissão", alvo: meta.meta_comissao, feito: real.comissao, fmt: brl }
      : meta.meta_vgv != null
        ? { nome: "VGV", alvo: meta.meta_vgv, feito: real.vgv, fmt: brl }
        : meta.meta_vendas != null
          ? {
              nome: "vendas",
              alvo: meta.meta_vendas,
              feito: real.vendas,
              fmt: (x: number) => String(x),
            }
          : null;
  const proj = principal ? projecao(principal.feito, diaPer, diasPer) : null;
  const pct =
    principal && principal.alvo > 0 ? Math.min(100, (principal.feito / principal.alvo) * 100) : 0;
  const esperado = Math.min(100, (diaPer / diasPer) * 100);
  const bate = principal && proj != null ? proj >= principal.alvo : false;

  return (
    <div className="space-y-3">
      {principal ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={`Minha meta (${principal.nome})`} value={principal.fmt(principal.alvo)} />
            <Kpi label="Já fiz" value={principal.fmt(principal.feito)} />
            <Kpi
              label="Falta"
              value={principal.fmt(Math.max(0, principal.alvo - principal.feito))}
            />
            <Kpi
              label="Projeção no ritmo"
              value={principal.fmt(proj ?? 0)}
              className={bate ? "text-emerald-600" : "text-amber-600"}
            />
          </div>
          <div
            className="relative h-3 rounded-full bg-muted"
            aria-label={`${pct.toFixed(0)}% da meta`}
          >
            <div className="h-3 rounded-full bg-primary" style={{ width: `${pct}%` }} />
            <div
              className="absolute -top-1 h-5 w-0.5 bg-red-500"
              style={{ left: `${esperado}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {pct.toFixed(0)}% da meta · linha vermelha = onde deveria estar hoje (dia {diaPer})
          </p>
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {meta.meta_captacoes != null ? (
          <Pill tom="blue">
            Captações {real.captacoes ?? "sem dado"}/{meta.meta_captacoes}
          </Pill>
        ) : null}
        {meta.meta_vendas != null ? (
          <Pill tom="blue">
            Vendas {real.vendas}/{meta.meta_vendas}
          </Pill>
        ) : null}
        {meta.meta_vgv != null && principal?.nome !== "VGV" ? (
          <Pill tom="blue">
            VGV {brl(real.vgv)}/{brl(meta.meta_vgv)}
          </Pill>
        ) : null}
        {principal && proj != null ? (
          <Pill tom={bate ? "green" : "amber"}>
            {bate
              ? "No ritmo atual você bate a meta"
              : `No ritmo atual faltam ${principal.fmt(principal.alvo - proj)}`}
          </Pill>
        ) : null}
        <Button size="sm" variant="outline" onClick={props.onEditar}>
          Atualizar minha meta
        </Button>
      </div>
    </div>
  );
}

function Kpi({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function Calculadora(props: {
  tx: Taxas;
  setTx: (t: Taxas) => void;
  proprias: boolean;
  onSalvar: () => void;
  faltam: { vendas: number | null; comissao: number | null; captacoes: number | null };
  diasUteis: number;
  ate: string;
}) {
  const { tx, setTx } = props;
  const f = calcularFunil(tx, props.faltam);
  const set = (k: keyof Taxas) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", "."));
    setTx({ ...tx, [k]: k === "comissao_media" ? v : (v ?? 0) });
  };
  const ate = props.ate.split("-").reverse().slice(0, 2).join("/");
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3" data-testid="calculadora">
      <h3 className="text-sm font-semibold">
        Calculadora de trás para frente: o que falta fazer até {ate}
      </h3>
      <div className="flex flex-wrap items-center gap-2 text-center">
        <Etapa n={f.ligacoes} label="ligações" />→<Etapa n={f.visitas} label="visitas" />→
        <Etapa n={f.acms} label="ACMs" />→<Etapa n={f.vendas} label="vendas" />
        {f.captacoes > 0 ? <Etapa n={f.captacoes} label="captações" /> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        ≈ {Math.ceil(f.ligacoes / props.diasUteis)} ligações por dia útil ({props.diasUteis} dias
        úteis).
        {props.faltam.comissao != null && !tx.comissao_media
          ? " Informe a comissão média por venda para a meta em R$ entrar na conta."
          : ""}
      </p>
      <div className="grid gap-2 text-xs sm:grid-cols-5">
        <TaxaInput
          label="Comissão média por venda (R$)"
          value={tx.comissao_media}
          onChange={set("comissao_media")}
        />
        <TaxaInput
          label="ACMs por venda"
          value={tx.acms_por_venda}
          onChange={set("acms_por_venda")}
        />
        <TaxaInput
          label="ACMs por captação"
          value={tx.acms_por_captacao}
          onChange={set("acms_por_captacao")}
        />
        <TaxaInput
          label="Visitas por ACM"
          value={tx.visitas_por_acm}
          onChange={set("visitas_por_acm")}
        />
        <TaxaInput
          label="Ligações por visita"
          value={tx.ligacoes_por_visita}
          onChange={set("ligacoes_por_visita")}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={props.onSalvar}>
          Salvar minhas taxas
        </Button>
        <span className="text-xs text-muted-foreground">
          {props.proprias ? "Usando as suas taxas." : "Usando o padrão da imobiliária."}
        </span>
      </div>
    </div>
  );
}

function Etapa({ n, label }: { n: number; label: string }) {
  return (
    <div className="min-w-16 rounded-md border bg-background px-2 py-1">
      <p className="text-base font-semibold">{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function TaxaInput(props: {
  label: string;
  value: number | null;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-muted-foreground">{props.label}</span>
      <Input
        inputMode="decimal"
        value={props.value ?? ""}
        onChange={props.onChange}
        className="h-8"
      />
    </label>
  );
}

function ResumoAno({ ano, label }: { ano: Realizado; label: string }) {
  return (
    <div className="space-y-2 border-t pt-3" data-testid="resumo-ano">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Trophy className="h-4 w-4" aria-hidden /> Minhas vendas em {label}
      </h3>
      {ano.como_captador === 0 && ano.como_vendedor === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma venda sua com contrato assinado em {label} ainda. Quando houver, ela aparece aqui.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            label="Como captador"
            value={`${ano.como_captador} venda${ano.como_captador === 1 ? "" : "s"} · ${brl(ano.vgv_captador)}`}
          />
          <Kpi
            label="Como vendedor"
            value={`${ano.como_vendedor} venda${ano.como_vendedor === 1 ? "" : "s"} · ${brl(ano.vgv_vendedor)}`}
          />
        </div>
      )}
    </div>
  );
}

function diaDoAno(hoje: string) {
  const d = new Date(`${hoje}T12:00:00Z`);
  const ini = Date.UTC(d.getUTCFullYear(), 0, 1, 12);
  return Math.round((d.getTime() - ini) / 86_400_000) + 1;
}
function diasNoAno(ano: string) {
  const y = Number(ano.slice(0, 4));
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}
