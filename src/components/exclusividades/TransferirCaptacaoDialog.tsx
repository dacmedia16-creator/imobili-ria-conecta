// Transferir captação para outro corretor (t_997545e5). Um único diálogo para os dois modos:
// - avulso: aberto na ficha, com a captação já escolhida;
// - lote: aberto na lista, escolhe o corretor de origem, mostra a prévia e permite desmarcar.
// Quem pode e o que muda é decidido pelo banco (exclusive_transferir); a tela só explica e confirma.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import {
  MOTIVOS_TRANSFERENCIA,
  MOTIVO_MAX,
  TEXTO_CONTRATO,
  destinosTransferencia,
  erroMotivo,
  marcadosIniciais,
  previaTransferencia,
  resumoLote,
  transferirCaptacoes,
  type ItemPrevia,
} from "@/lib/captacao-transferencia";

const SELECT = "h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground";
const OUTRO = "__outro__";

export function TransferirCaptacaoDialog({
  open,
  onOpenChange,
  avulsa,
  origens = [],
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Modo avulso: a captação da ficha (captor_id = corretor atual). */
  avulsa?: { id: string; captorId: string; captorNome: string; endereco: string; item: ItemPrevia | null };
  /** Modo lote: corretores que têm captação. */
  origens?: { id: string; nome: string }[];
  onDone: () => void;
}) {
  const [destinos, setDestinos] = useState<{ id: string; nome: string }[]>([]);
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const [motivoSel, setMotivoSel] = useState("");
  const [motivoOutro, setMotivoOutro] = useState("");
  const [previa, setPrevia] = useState<ItemPrevia[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const origem = avulsa ? avulsa.captorId : de;

  useEffect(() => {
    if (!open) return;
    setPara("");
    setMotivoSel("");
    setMotivoOutro("");
    setConfirmando(false);
    setErro(null);
    setDe("");
    setPrevia(avulsa ? (avulsa.item ? [avulsa.item] : []) : null);
    setMarcados(avulsa?.item && !avulsa.item.bloqueio ? new Set([avulsa.id]) : new Set());
    destinosTransferencia()
      .then(setDestinos)
      .catch((e) => setErro(errorMessage(e, "Não foi possível concluir a transferência.")));
  }, [open, avulsa]);

  useEffect(() => {
    if (!open || avulsa || !de) return;
    setPrevia(null);
    let vivo = true;
    previaTransferencia(de)
      .then((itens) => {
        if (!vivo) return;
        setPrevia(itens);
        setMarcados(marcadosIniciais(itens));
      })
      .catch((e) => vivo && setErro(errorMessage(e, "Não foi possível concluir a transferência.")));
    return () => {
      vivo = false;
    };
  }, [open, avulsa, de]);

  const motivo = motivoSel === OUTRO ? motivoOutro : motivoSel;
  const resumo = useMemo(() => resumoLote(previa ?? [], marcados), [previa, marcados]);
  const destinosValidos = destinos.filter((d) => d.id !== origem);
  const nomePara = destinos.find((d) => d.id === para)?.nome ?? "";
  const nomeDe = avulsa ? avulsa.captorNome : (origens.find((o) => o.id === de)?.nome ?? "");
  const faltando = !origem
    ? "Escolha o corretor de origem."
    : !para
      ? "Escolha o novo corretor."
      : resumo.total === 0
        ? "Nenhuma captação marcada para transferir."
        : erroMotivo(motivo);

  async function confirmar() {
    setBusy(true);
    setErro(null);
    try {
      const r = await transferirCaptacoes(resumo.ids, para, motivo);
      toast.success(
        r.transferidas === 1
          ? `Captação transferida para ${nomePara}.`
          : `${r.transferidas} captações transferidas para ${nomePara}.`,
      );
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErro(errorMessage(e, "Não foi possível concluir a transferência."));
      setConfirmando(false);
    } finally {
      setBusy(false);
    }
  }

  function alternar(id: string, on: boolean) {
    setMarcados((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="transferir-dialog">
        <DialogHeader>
          <DialogTitle>{avulsa ? "Transferir captação" : "Transferir captações de um corretor"}</DialogTitle>
          <DialogDescription>
            O imóvel, quem vê e edita, os alertas e os próximos leads e vendas passam para o novo
            corretor. Vendas fechadas, comissões já lançadas e o contrato já assinado não mudam. Nos
            painéis, a captação continua contando para quem captou.
          </DialogDescription>
        </DialogHeader>

        {!confirmando ? (
          <div className="space-y-4 text-sm">
            {avulsa ? (
              <p>
                <strong>{avulsa.endereco || "Captação"}</strong> · hoje com{" "}
                <strong>{avulsa.captorNome}</strong>
              </p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="transf-de">1. De quem? (corretor que saiu)</Label>
                <select id="transf-de" className={SELECT} value={de} onChange={(e) => setDe(e.target.value)}>
                  <option value="">— escolha —</option>
                  {origens.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="transf-para">{avulsa ? "Para quem? (novo corretor)" : "2. Para quem? (novo corretor)"}</Label>
              <select id="transf-para" className={SELECT} value={para} onChange={(e) => setPara(e.target.value)}>
                <option value="">— escolha —</option>
                {destinosValidos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Só aparecem corretores ativos desta imobiliária.</p>
            </div>

            {avulsa ? (
              avulsa.item && (
                <p
                  className={
                    avulsa.item.bloqueio
                      ? "rounded-md border border-red-300 bg-red-50 p-2 text-red-900"
                      : "rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900"
                  }
                  data-testid="transferir-aviso-contrato"
                >
                  {TEXTO_CONTRATO[avulsa.item.contrato]}
                </p>
              )
            ) : (
              <div className="space-y-1">
                <Label>3. Prévia — confira e desmarque o que não deve ir</Label>
                {!de ? (
                  <p className="text-muted-foreground">Escolha o corretor de origem.</p>
                ) : previa === null ? (
                  <p className="text-muted-foreground">Carregando…</p>
                ) : previa.length === 0 ? (
                  <p className="text-muted-foreground">Esse corretor não tem captações que você possa transferir.</p>
                ) : (
                  <ul className="max-h-64 divide-y overflow-y-auto rounded-md border" data-testid="transferir-previa">
                    {previa.map((i) => (
                      <li key={i.id} className="flex items-start gap-2 p-2">
                        <Checkbox
                          id={`transf-${i.id}`}
                          checked={marcados.has(i.id) && !i.bloqueio}
                          disabled={!!i.bloqueio}
                          onCheckedChange={(v) => alternar(i.id, v === true)}
                        />
                        <label htmlFor={`transf-${i.id}`} className="flex-1">
                          <span className="font-medium">{i.endereco}</span>
                          {i.bairro ? ` · ${i.bairro}` : ""}
                          {i.arquivada ? " · arquivada" : ""}
                          <span className="block text-xs text-muted-foreground">
                            {i.bloqueio ?? TEXTO_CONTRATO[i.contrato]}
                            {i.leads_abertos > 0 ? ` · ${i.leads_abertos} lead(s) aberto(s) vão junto` : ""}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {previa && previa.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {resumo.total} de {previa.length} marcada(s)
                    {resumo.bloqueadas ? ` · ${resumo.bloqueadas} em assinatura (não podem ir agora)` : ""}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="transf-motivo">{avulsa ? "Motivo (obrigatório)" : "4. Motivo (obrigatório)"}</Label>
              <select
                id="transf-motivo"
                className={SELECT}
                value={motivoSel}
                onChange={(e) => setMotivoSel(e.target.value)}
              >
                <option value="">— escolha —</option>
                {MOTIVOS_TRANSFERENCIA.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value={OUTRO}>Outro</option>
              </select>
              {motivoSel === OUTRO && (
                <Input
                  aria-label="Descreva o motivo"
                  maxLength={MOTIVO_MAX}
                  value={motivoOutro}
                  onChange={(e) => setMotivoOutro(e.target.value)}
                  placeholder="Descreva o motivo"
                />
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm" data-testid="transferir-confirmacao">
            <p>
              Transferir <strong>{resumo.total === 1 ? "1 captação" : `${resumo.total} captações`}</strong> de{" "}
              <strong>{nomeDe}</strong> para <strong>{nomePara}</strong>.
            </p>
            <ul className="list-disc pl-5">
              {resumo.atualizados > 0 && (
                <li>{resumo.atualizados} com contrato ainda não assinado: passa a sair no nome de {nomePara}.</li>
              )}
              {resumo.mantidos > 0 && (
                <li>{resumo.mantidos} com contrato assinado: o PDF fica no nome de quem assinou.</li>
              )}
              {resumo.leads > 0 && <li>{resumo.leads} lead(s) aberto(s) vão junto.</li>}
              <li>Motivo: {motivo.trim()}</li>
              <li>{nomePara} recebe um aviso no sino do sistema (sem e-mail e sem WhatsApp).</li>
            </ul>
          </div>
        )}

        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}

        <DialogFooter>
          {!confirmando ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                disabled={!!faltando}
                title={faltando ?? undefined}
                onClick={() => setConfirmando(true)}
                data-testid="transferir-revisar"
              >
                Revisar e confirmar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setConfirmando(false)}>
                Voltar
              </Button>
              <Button disabled={busy} onClick={confirmar} data-testid="transferir-confirmar">
                {busy ? "Transferindo…" : "Confirmar transferência"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
