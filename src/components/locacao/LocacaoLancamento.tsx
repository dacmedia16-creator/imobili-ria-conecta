// Lançamento para comissão (t_8f09d406, item 6): a Fernanda (papel vistoria) confere e lança captador, locador,
// gestor, team leader, aluguel, taxa e parceria nas etapas pós-assinatura, chaves e comissão. Não trava a entrega
// das chaves (dúvida para a Cris). O banco valida tudo (locacao_lancamento_salvar).
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import { brl, reaisNumero, reaisParaTela } from "@/lib/locacao";
import { corretoresLocacao, lerLancamento, salvarLancamento } from "@/lib/locacao-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60";

export type Parceria = "nenhuma" | "remax" | "externa";
export const PARCERIA_LABEL: Record<Parceria, string> = {
  nenhuma: "Sem parceria",
  remax: "Parceria com outra RE/MAX",
  externa: "Parceria com imobiliária externa",
};

export type LancamentoValores = {
  captadorId: string;
  locador: string;
  gestorId: string;
  teamLeaderId: string;
  aluguel: string;
  taxaAdm: string;
  parceria: Parceria;
  parceriaUnidade: string;
  parceriaCorretor: string;
  parceriaImobiliaria: string;
  observacao: string;
};

export type LancamentoLido = {
  podeEditar: boolean;
  lancado: boolean;
  valores: LancamentoValores;
  nomes: { captador: string | null; gestor: string | null; teamLeader: string | null };
  lancadoPorNome: string | null;
  atualizadoEm: string | null;
};

const o = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const t = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
const tn = (v: unknown): string | null => t(v) || null;

export function lerLancamentoCompleto(raw: unknown): LancamentoLido {
  const x = o(raw);
  const v = o(x.valores);
  const nomes = o(x.nomes);
  const p = v.parceria === "remax" || v.parceria === "externa" ? v.parceria : "nenhuma";
  const aluguel = Number(v.aluguel);
  return {
    podeEditar: x.pode_editar === true,
    lancado: x.lancado === true,
    valores: {
      captadorId: t(v.captador_id),
      locador: t(v.locador),
      gestorId: t(v.gestor_id),
      teamLeaderId: t(v.team_leader_id),
      aluguel: Number.isFinite(aluguel) && aluguel > 0 ? reaisParaTela(aluguel) : "",
      taxaAdm: t(v.taxa_adm),
      parceria: p,
      parceriaUnidade: t(v.parceria_unidade),
      parceriaCorretor: t(v.parceria_corretor),
      parceriaImobiliaria: t(v.parceria_imobiliaria),
      observacao: t(v.observacao),
    },
    nomes: {
      captador: tn(nomes.captador),
      gestor: tn(nomes.gestor),
      teamLeader: tn(nomes.team_leader),
    },
    lancadoPorNome: tn(x.lancado_por_nome),
    atualizadoEm: tn(x.atualizado_em),
  };
}

/** O que vai ao banco. Igual às regras do banco: parceria RE/MAX pede unidade e corretor; externa, a imobiliária. */
export function lancamentoParaBanco(v: LancamentoValores): Record<string, string | null> {
  const s = (x: string) => (x.trim() === "" ? null : x.trim());
  return {
    captador_id: s(v.captadorId),
    locador: s(v.locador),
    gestor_id: s(v.gestorId),
    team_leader_id: s(v.teamLeaderId),
    aluguel: reaisNumero(v.aluguel) === null ? null : String(reaisNumero(v.aluguel)),
    taxa_adm: s(v.taxaAdm.replace(",", ".")),
    parceria: v.parceria,
    parceria_unidade: v.parceria === "remax" ? s(v.parceriaUnidade) : null,
    parceria_corretor: v.parceria === "remax" ? s(v.parceriaCorretor) : null,
    parceria_imobiliaria: v.parceria === "externa" ? s(v.parceriaImobiliaria) : null,
    observacao: s(v.observacao),
  };
}

export function faltasLancamento(v: LancamentoValores): string[] {
  const f: string[] = [];
  const alu = reaisNumero(v.aluguel);
  if (alu === null || !(alu > 0)) f.push("aluguel");
  const tx = Number(v.taxaAdm.replace(",", "."));
  if (!(tx > 0) || tx > 30) f.push("taxa de administração");
  if (v.parceria === "remax") {
    if (v.parceriaUnidade.trim().length < 2) f.push("unidade RE/MAX parceira");
    if (v.parceriaCorretor.trim().length < 2) f.push("corretor parceiro");
  }
  if (v.parceria === "externa" && v.parceriaImobiliaria.trim().length < 2) {
    f.push("imobiliária parceira");
  }
  return f;
}

/** Lê o lançamento da locação (para o quadro e para a comissão da ficha). */
export function useLancamento(id: string) {
  const [dados, setDados] = useState<LancamentoLido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try {
      setDados(lerLancamentoCompleto(await lerLancamento(id)));
      setErro(null);
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível ler o lançamento."));
    }
  }, [id]);
  useEffect(() => void carregar(), [carregar]);
  return { dados, erro, carregar };
}

export function LocacaoLancamento({ id, onSalvo }: { id: string; onSalvo?: () => void }) {
  const { dados, erro, carregar } = useLancamento(id);
  const [v, setV] = useState<LancamentoValores | null>(null);
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (dados) setV(dados.valores);
  }, [dados]);
  useEffect(() => {
    if (!dados?.podeEditar) return;
    let vivo = true;
    corretoresLocacao()
      .then((l) => {
        if (!vivo) return;
        setPessoas(
          (Array.isArray(l) ? l : [])
            .map((x) => x as { id?: unknown; nome?: unknown })
            .filter((x) => typeof x.id === "string")
            .map((x) => ({ id: String(x.id), nome: typeof x.nome === "string" ? x.nome : "—" })),
        );
      })
      .catch(() => setPessoas([]));
    return () => {
      vivo = false;
    };
  }, [dados?.podeEditar]);

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (!dados || !v) return null;
  const editar = dados.podeEditar;
  const set = <K extends keyof LancamentoValores>(k: K, x: LancamentoValores[K]) =>
    setV((a) => (a ? { ...a, [k]: x } : a));
  const faltas = faltasLancamento(v);

  // Pessoa do lançamento que não está na lista (ex.: inativa): mostra pelo nome lido.
  const opcoes = (atual: string, nome: string | null) =>
    atual && !pessoas.some((p) => p.id === atual)
      ? [{ id: atual, nome: nome ?? "—" }, ...pessoas]
      : pessoas;
  const pessoaSel = (
    k: "captadorId" | "gestorId" | "teamLeaderId",
    label: string,
    nome: string | null,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`lan-${k}`}>{label}</Label>
      {editar ? (
        <select
          id={`lan-${k}`}
          className={SELECT}
          value={v[k]}
          onChange={(e) => set(k, e.target.value)}
        >
          <option value="">—</option>
          {opcoes(v[k], nome).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      ) : (
        <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
          {nome ?? "—"}
        </p>
      )}
    </div>
  );
  const texto = (
    k: keyof LancamentoValores,
    label: string,
    extra: Record<string, unknown> = {},
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`lan-${k}`}>{label}</Label>
      <Input
        id={`lan-${k}`}
        disabled={!editar}
        value={String(v[k])}
        onChange={(e) => set(k, e.target.value as never)}
        {...extra}
      />
    </div>
  );

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await salvarLancamento(id, lancamentoParaBanco(v));
      toast.success(r?.novo ? "Lançamento registrado" : "Lançamento atualizado");
      await carregar();
      onSalvo?.();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar o lançamento."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Card data-testid="locacao-lancamento">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">💼 Lançamento para comissão (vistoria)</CardTitle>
        {dados.lancado ? (
          <Pill tom="green">
            lançado{dados.lancadoPorNome ? ` por ${dados.lancadoPorNome}` : ""}
            {dados.atualizadoEm
              ? ` em ${new Date(dados.atualizadoEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
              : ""}
          </Pill>
        ) : (
          <Pill tom="amber">ainda não lançado</Pill>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!dados.lancado && (
          <p className="text-xs text-muted-foreground">
            Valores sugeridos a partir da pré-análise e da equipe gravada na abertura. Confira e
            salve. Não trava a entrega das chaves.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {pessoaSel("captadorId", "Corretor captador", dados.nomes.captador)}
          {texto("locador", "Locador (proprietário)", { maxLength: 200 })}
          {pessoaSel("gestorId", "Gestor", dados.nomes.gestor)}
          {pessoaSel("teamLeaderId", "Team Leader", dados.nomes.teamLeader)}
          {texto("aluguel", "Aluguel (R$)", { inputMode: "decimal", placeholder: "0,00" })}
          {texto("taxaAdm", "Taxa de administração (%)", { inputMode: "decimal" })}
          <div className="space-y-1">
            <Label htmlFor="lan-parceria">Parceria</Label>
            <select
              id="lan-parceria"
              className={SELECT}
              disabled={!editar}
              value={v.parceria}
              onChange={(e) => set("parceria", e.target.value as Parceria)}
            >
              {(Object.keys(PARCERIA_LABEL) as Parceria[]).map((p) => (
                <option key={p} value={p}>
                  {PARCERIA_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          {v.parceria === "remax" && texto("parceriaUnidade", "Unidade RE/MAX", { maxLength: 200 })}
          {v.parceria === "remax" &&
            texto("parceriaCorretor", "Corretor parceiro", { maxLength: 200 })}
          {v.parceria === "externa" &&
            texto("parceriaImobiliaria", "Imobiliária parceira", { maxLength: 200 })}
        </div>
        <div className="space-y-1">
          <Label htmlFor="lan-observacao">Observação</Label>
          <Textarea
            id="lan-observacao"
            disabled={!editar}
            rows={2}
            maxLength={1000}
            value={v.observacao}
            onChange={(e) => set("observacao", e.target.value)}
          />
        </div>
        {editar ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {faltas.length > 0 && (
              <span className="text-xs text-muted-foreground">Falta: {faltas.join(", ")}.</span>
            )}
            <Button
              disabled={salvando || faltas.length > 0}
              data-testid="locacao-lancamento-salvar"
              onClick={() => void salvar()}
            >
              {dados.lancado ? "Atualizar lançamento" : "Registrar lançamento"}
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Só a vistoria (Fernanda) lança, nas etapas pós-assinatura, chaves e comissão.
            {dados.lancado && reaisNumero(v.aluguel)
              ? ` Valor lançado: ${brl(reaisNumero(v.aluguel) ?? 0)}.`
              : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
