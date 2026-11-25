// Dados de pagamento do parceiro na parceria (t_756c1c63). Visível só para o Financeiro da locação e a gestão: o banco
// devolve {pode:false} sem dado nenhum para os demais e aí este quadro não aparece. Grava em locacao_parceiro_pag_salvar.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/visual/base";
import { errorMessage } from "@/lib/errors";
import { brl } from "@/lib/locacao";
import { lerPagamentoParceiro, salvarPagamentoParceiro } from "@/lib/locacao-db";
import {
  FAVORECIDO_LABEL,
  PAGAMENTO_VAZIO,
  faltasPagamento,
  lerPagamento,
  pagamentoParaBanco,
  resumoPagamento,
  type FavorecidoTipo,
  type PagamentoValores,
} from "@/lib/locacao-parceiro";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm disabled:cursor-not-allowed disabled:opacity-60";

export function LocacaoParceiroPagamento({
  id,
  valor,
  onSalvo,
}: {
  id: string;
  /** Metade de 1 aluguel, sem participação na administração ou comissão interna. */
  valor?: number;
  onSalvo?: () => void;
}) {
  const [pode, setPode] = useState<boolean | null>(null);
  const [salvo, setSalvo] = useState<PagamentoValores | null>(null);
  const [v, setV] = useState<PagamentoValores>(PAGAMENTO_VAZIO);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = (await lerPagamentoParceiro(id)) as { pode?: unknown; dados?: unknown } | null;
      const ok = r?.pode === true;
      setPode(ok);
      const p = ok ? lerPagamento(r?.dados) : null;
      setSalvo(p);
      setV(p ?? PAGAMENTO_VAZIO);
      setEditando(ok && !p);
      setErro(null);
    } catch (e) {
      // Falha de rede/banco não é "sem permissão": mostra o erro (sem dado nenhum).
      setErro(errorMessage(e, "Não foi possível ler os dados de pagamento do parceiro."));
    }
  }, [id]);
  useEffect(() => void carregar(), [carregar]);

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (!pode) return null;
  const set = <K extends keyof PagamentoValores>(k: K, x: PagamentoValores[K]) =>
    setV((a) => ({ ...a, [k]: x }));
  const faltas = faltasPagamento(v);
  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarPagamentoParceiro(id, pagamentoParaBanco(v));
      toast.success("Dados de pagamento do parceiro salvos");
      await carregar();
      onSalvo?.();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível salvar os dados de pagamento."));
    } finally {
      setSalvando(false);
    }
  };
  const campo = (k: keyof PagamentoValores, label: string, extra: Record<string, unknown> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`pag-${id}-${k}`}>{label}</Label>
      <Input
        id={`pag-${id}-${k}`}
        value={String(v[k])}
        onChange={(e) => set(k, e.target.value as never)}
        {...extra}
      />
    </div>
  );

  return (
    <div
      className="space-y-3 rounded-md border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/20"
      data-testid="locacao-parceiro-pagamento"
    >
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">🔒 Pagamento do parceiro</b>
        {valor !== undefined && <Pill tom="violet">Valor do parceiro: {brl(valor)}</Pill>}
        <span className="text-xs text-muted-foreground">
          Visível só para o Financeiro da locação e a gestão.
        </span>
        <span className="flex-1" />
        {salvo && !editando && (
          <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
            Editar
          </Button>
        )}
      </div>
      {salvo && !editando ? (
        <p className="text-sm" data-testid="locacao-parceiro-pagamento-resumo">
          {FAVORECIDO_LABEL[salvo.favorecidoTipo as FavorecidoTipo]}: {resumoPagamento(salvo)}
          {salvo.telefone || salvo.email ? (
            <span className="block text-xs text-muted-foreground">
              Contato: {[salvo.telefone, salvo.email].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor={`pag-${id}-tipo`}>Favorecido do pagamento</Label>
              <select
                id={`pag-${id}-tipo`}
                className={SELECT}
                value={v.favorecidoTipo}
                onChange={(e) => set("favorecidoTipo", e.target.value as FavorecidoTipo | "")}
              >
                <option value="">—</option>
                {(Object.keys(FAVORECIDO_LABEL) as FavorecidoTipo[]).map((x) => (
                  <option key={x} value={x}>
                    {FAVORECIDO_LABEL[x]}
                  </option>
                ))}
              </select>
            </div>
            {campo(
              "favorecidoNome",
              v.favorecidoTipo === "imobiliaria" ? "Razão social / nome" : "Nome do favorecido",
              { maxLength: 200 },
            )}
            {campo("documento", v.favorecidoTipo === "imobiliaria" ? "CNPJ" : "CPF", {
              inputMode: "numeric",
              maxLength: 18,
              placeholder:
                v.favorecidoTipo === "imobiliaria" ? "00.000.000/0000-00" : "000.000.000-00",
            })}
            {campo("pix", "Chave PIX", { maxLength: 140 })}
            {campo("banco", "Banco (sem PIX)", { maxLength: 100 })}
            <div className="grid grid-cols-2 gap-2">
              {campo("agencia", "Agência", { maxLength: 20 })}
              {campo("conta", "Conta", { maxLength: 30 })}
            </div>
            {campo("telefone", "Telefone", { maxLength: 30, inputMode: "tel" })}
            {campo("email", "E-mail", { maxLength: 200, type: "email" })}
            <div className="space-y-1">
              <Label htmlFor={`pag-${id}-nf`}>Emite nota fiscal?</Label>
              <select
                id={`pag-${id}-nf`}
                className={SELECT}
                value={v.emiteNf}
                onChange={(e) => set("emiteNf", e.target.value as PagamentoValores["emiteNf"])}
              >
                <option value="">—</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {faltas.length > 0 && (
              <span className="text-xs text-muted-foreground">Falta: {faltas.join(", ")}.</span>
            )}
            {salvo && (
              <Button
                variant="ghost"
                onClick={() => {
                  setV(salvo);
                  setEditando(false);
                }}
              >
                Cancelar
              </Button>
            )}
            <Button
              disabled={salvando || faltas.length > 0}
              data-testid="locacao-parceiro-pagamento-salvar"
              onClick={() => void salvar()}
            >
              Salvar dados de pagamento
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
