import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { type Saver, useAutosave, AutosaveStatus, FieldGrid, Field, CurrencyInput } from "./shared";

export function PaymentStep({ saleId, payment, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; payment: any; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const [p, setP] = useState<any>(payment ?? {});
  const [dp, setDp] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = dp;

  // Não sincroniza por cima de uma edição local ainda não salva: o pai recarrega os dados da venda
  // (load()) por várias ações que não têm nada a ver com esta aba (upload de contrato, troca de
  // status em outra etapa, etc.) — sem essa trava, a prop "payment" chegava com um objeto novo a
  // cada reload e apagava silenciosamente o que a pessoa estava digitando aqui, cancelando o
  // autosave agendado (dirty virava false e o useAutosave desistia do timer pendente).
  useEffect(() => { if (!dp) setP(payment ?? {}); }, [payment]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const updP = (k: string, v: any) => { setP((f: any) => ({ ...f, [k]: v })); setDp(true); };

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      if (dp) {
        const { error } = await supabase.from("sale_payment").upsert({ sale_id: saleId, ...p });
        if (error) { toast.error(error.message); return false; }
      }
      setDp(false);
      onSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [dp, p, saleId, onSaved]);

  useEffect(() => { registerSaver(save); return () => registerSaver(null); }, [save, registerSaver]);
  useAutosave(editable && dirty, [p], save);

  return (
    <div className="space-y-4">
      {editable && <AutosaveStatus saving={saving} dirty={dirty} />}
      <Card>
        <CardHeader><CardTitle className="text-base">Forma de pagamento</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Entrada — valor"><CurrencyInput value={p.entrada_valor} onChange={(v) => updP("entrada_valor", v)} disabled={!editable} /></Field>
            <Field label="Entrada — quando"><Input value={p.entrada_data ?? ""} placeholder="Ex.: Na assinatura do contrato" onChange={(e) => updP("entrada_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — valor"><CurrencyInput value={p.parcela1_valor} onChange={(v) => updP("parcela1_valor", v)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — quando"><Input value={p.parcela1_data ?? ""} placeholder="Ex.: 30 dias após a assinatura" onChange={(e) => updP("parcela1_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — valor"><CurrencyInput value={p.parcela2_valor} onChange={(v) => updP("parcela2_valor", v)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — quando"><Input value={p.parcela2_data ?? ""} placeholder="Ex.: Na entrega das chaves" onChange={(e) => updP("parcela2_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Pagamento final — valor"><CurrencyInput value={p.pagamento_final_valor} onChange={(v) => updP("pagamento_final_valor", v)} disabled={!editable} /></Field>
            <Field label="Pagamento final — quando"><Input value={p.pagamento_final_data ?? ""} placeholder="Ex.: Na liberação do financiamento" onChange={(e) => updP("pagamento_final_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="FGTS"><div className="flex items-center gap-2"><Switch checked={!!p.fgts} onCheckedChange={(v) => updP("fgts", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
            <Field label="FGTS — valor"><CurrencyInput value={p.fgts_valor} onChange={(v) => updP("fgts_valor", v)} disabled={!editable} /></Field>
            <Field label="Tipo de pagamento">
              <Select
                value={p.tipo_pagamento ?? "vista"}
                onValueChange={(v) => {
                  updP("tipo_pagamento", v);
                  updP("financiamento", v === "financiamento");
                  if (v !== "financiamento") {
                    updP("financiamento_banco", null);
                    updP("financiamento_correspondente", null);
                    updP("financiamento_valor", null);
                    updP("financiamento_previsao", null);
                    updP("oba_credito", false);
                  }
                  if (v !== "consorcio") {
                    updP("consorcio_nome", null);
                    updP("consorcio_grupo", null);
                    updP("consorcio_cota", null);
                    updP("consorcio_valor", null);
                  }
                }}
                disabled={!editable}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vista">Vista</SelectItem>
                  <SelectItem value="financiamento">Financiamento</SelectItem>
                  <SelectItem value="consorcio">Consórcio</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {p.tipo_pagamento === "financiamento" && (
              <>
                <Field label="Financiamento — valor"><CurrencyInput value={p.financiamento_valor} onChange={(v) => updP("financiamento_valor", v)} disabled={!editable} /></Field>
                <Field label="Banco financiador">
                  <Input value={p.financiamento_banco ?? ""} disabled={!editable} onChange={(e) => updP("financiamento_banco", e.target.value)} />
                </Field>
                <Field label="Correspondente bancário">
                  <Input value={p.financiamento_correspondente ?? ""} disabled={!editable} onChange={(e) => updP("financiamento_correspondente", e.target.value)} />
                </Field>
                <Field label="Oba Crédito"><div className="flex items-center gap-2"><Switch checked={!!p.oba_credito} onCheckedChange={(v) => updP("oba_credito", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
                <Field label="Previsão da liberação do crédito">
                  <Input type="date" value={p.financiamento_previsao ?? ""} disabled={!editable} onChange={(e) => updP("financiamento_previsao", e.target.value || null)} />
                </Field>
              </>
            )}
            {p.tipo_pagamento === "consorcio" && (
              <>
                <Field label="Valor da carta de consórcio">
                  <CurrencyInput value={p.consorcio_valor} onChange={(v) => updP("consorcio_valor", v)} disabled={!editable} />
                </Field>
                <Field label="Nome do consórcio">
                  <Input value={p.consorcio_nome ?? ""} disabled={!editable} onChange={(e) => updP("consorcio_nome", e.target.value)} />
                </Field>
                <Field label="Grupo">
                  <Input value={p.consorcio_grupo ?? ""} disabled={!editable} onChange={(e) => updP("consorcio_grupo", e.target.value)} />
                </Field>
                <Field label="Cota">
                  <Input value={p.consorcio_cota ?? ""} disabled={!editable} onChange={(e) => updP("consorcio_cota", e.target.value)} />
                </Field>
              </>
            )}
            <Field label="Observações gerais" colSpan={2}><Textarea value={p.observacoes ?? ""} onChange={(e) => updP("observacoes", e.target.value)} disabled={!editable} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>
    </div>
  );
}
