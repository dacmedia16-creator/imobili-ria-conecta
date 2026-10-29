import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import type { Lead, MotivoPerda } from "@/lib/leads";
import type { ExclusiveUnit } from "@/lib/exclusive-captures";
import {
  FUNIL,
  funilDe,
  hojeSP,
  nomeEtapa,
  somarDias,
  validarProximo,
  type Etapa,
  type Pedido,
} from "@/lib/crm";
import { converterCaptacao, converterVenda, moverLead, salvarProximo } from "@/lib/crm-db";

const SELECT =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export type PedidoMover = {
  lead: Lead;
  para: Etapa;
  tipo: Exclude<Pedido, "nada" | "bloqueado">;
};

/**
 * Diálogo único do CRM: próximo contato (mover para etapa aberta ou só remarcar), motivo da perda e
 * fechar (converter em venda/captação ou só mover). O banco repete todas as regras.
 */
export function CrmMoverDialog({
  pedido,
  motivos,
  captacaoLigada,
  unidades,
  onClose,
  onDone,
}: {
  pedido: PedidoMover | { lead: Lead; para: null; tipo: "proximo" } | null;
  motivos: MotivoPerda[];
  captacaoLigada: boolean;
  unidades: ExclusiveUnit[];
  onClose: () => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const hoje = hojeSP();
  const [data, setData] = useState(somarDias(hoje, 1));
  const [motivo, setMotivo] = useState("");
  const [perda, setPerda] = useState("");
  const [obs, setObs] = useState("");
  const [unidade, setUnidade] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(pedido?.lead.proximo_contato_em && pedido.lead.proximo_contato_em >= hoje ? pedido.lead.proximo_contato_em : somarDias(hoje, 1));
    setMotivo(pedido?.para === null ? (pedido.lead.proximo_contato_motivo ?? "") : "");
    setPerda("");
    setObs("");
    setUnidade(unidades.length === 1 ? unidades[0].id : "");
  }, [pedido, hoje, unidades]);

  if (!pedido) return null;
  const { lead, para, tipo } = pedido;
  const f = funilDe(lead);
  const ativas = unidades.filter((u) => (u as { ativo?: boolean }).ativo !== false);
  const erroProximo = tipo === "proximo" ? validarProximo(data, motivo, hoje) : null;

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onDone();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Não foi possível concluir."));
    } finally {
      setBusy(false);
    }
  };

  const titulo =
    para === null
      ? "Próximo contato"
      : tipo === "perda"
        ? "Marcar como perdido"
        : tipo === "fechar"
          ? `${nomeEtapa(f, "ganho")}: ${lead.nome}`
          : `Mover para ${nomeEtapa(f, para)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="break-words">{titulo}</DialogTitle>
          <DialogDescription className="break-words">
            {lead.nome} · {FUNIL[f].nome}
          </DialogDescription>
        </DialogHeader>

        {tipo === "proximo" && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Todo lead em andamento precisa de um próximo passo: data e motivo do próximo contato.
            </p>
            <label className="block">
              <span className="text-xs text-muted-foreground">Data do próximo contato</span>
              <Input
                type="date"
                value={data}
                min={hoje}
                max={somarDias(hoje, 366)}
                onChange={(e) => setData(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Motivo</span>
              <Input
                value={motivo}
                maxLength={200}
                placeholder="Ex.: ligar para confirmar a visita"
                onChange={(e) => setMotivo(e.target.value)}
              />
            </label>
            {erroProximo && motivo && <p className="text-xs text-red-600">{erroProximo}</p>}
          </div>
        )}

        {tipo === "perda" && (
          <div className="space-y-2 text-sm">
            <select
              className={SELECT}
              value={perda}
              onChange={(e) => setPerda(e.target.value)}
              aria-label="Motivo da perda"
            >
              <option value="">Motivo da perda…</option>
              {motivos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
            <Textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              maxLength={1000}
              placeholder="Observação (opcional)"
            />
          </div>
        )}

        {tipo === "fechar" && (
          <div className="space-y-3 text-sm">
            {f === "venda" ? (
              <p className="text-muted-foreground">
                “Converter em venda” cria a venda já preenchida (comprador, imóvel e captador quando
                houver) e vincula ao lead. Depois é só completar na tela da venda.
              </p>
            ) : captacaoLigada ? (
              <>
                <p className="text-muted-foreground">
                  “Converter em captação” cria a captação exclusiva com o proprietário já preenchido. Você
                  vira o captador.
                </p>
                <select
                  className={SELECT}
                  value={unidade}
                  onChange={(e) => setUnidade(e.target.value)}
                  aria-label="Unidade da captação"
                >
                  <option value="">Unidade da captação…</option>
                  {ativas.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-muted-foreground">
                A Captação exclusiva está desligada nesta imobiliária: o lead só muda de etapa.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          {tipo === "proximo" && (
            <Button
              disabled={busy || Boolean(erroProximo)}
              onClick={() =>
                para === null
                  ? run(() => salvarProximo(lead.id, data, motivo), "Próximo contato salvo.")
                  : run(
                      () => moverLead(lead.id, para, { proximoEm: data, proximoMotivo: motivo }),
                      `Movido para ${nomeEtapa(f, para)}.`,
                    )
              }
            >
              {para === null ? "Salvar" : "Mover"}
            </Button>
          )}
          {tipo === "perda" && (
            <Button
              variant="destructive"
              disabled={busy || !perda}
              onClick={() =>
                run(
                  () => moverLead(lead.id, "perdido", { motivoPerdaId: perda, obs }),
                  "Lead marcado como perdido.",
                )
              }
            >
              Marcar perdido
            </Button>
          )}
          {tipo === "fechar" && (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => moverLead(lead.id, "ganho"), `Movido para ${nomeEtapa(f, "ganho")}.`)}
              >
                Só mover (vincular depois)
              </Button>
              {f === "venda" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const id = await converterVenda(lead.id);
                      void navigate({ to: "/vendas/$id", params: { id } });
                    }, "Venda criada a partir do lead.")
                  }
                >
                  Converter em venda
                </Button>
              )}
              {f === "captacao" && captacaoLigada && (
                <Button
                  disabled={busy || !unidade}
                  onClick={() =>
                    run(async () => {
                      const id = await converterCaptacao(lead.id, unidade);
                      void navigate({ to: "/exclusividades/$id", params: { id } });
                    }, "Captação criada a partir do lead.")
                  }
                >
                  Converter em captação
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
