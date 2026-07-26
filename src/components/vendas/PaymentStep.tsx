import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Wizard } from "@/components/Wizard";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { type Saver, useAutosave, AutosaveStatus, FieldGrid, Field, CurrencyInput } from "./shared";

export function PaymentStep({ saleId, payment, bank, parties, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; payment: any; bank: any; parties: Record<string, any>; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const [p, setP] = useState<any>(payment ?? {});
  const [b, setB] = useState<any>(bank ?? {});
  const [dp, setDp] = useState(false);
  const [db, setDb] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = dp || db;

  useEffect(() => { setP(payment ?? {}); setDp(false); }, [payment]);
  useEffect(() => { setB(bank ?? {}); setDb(false); }, [bank]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const updP = (k: string, v: any) => { setP((f: any) => ({ ...f, [k]: v })); setDp(true); };
  const updB = (k: string, v: any) => { setB((f: any) => ({ ...f, [k]: v })); setDb(true); };

  // Titular da conta quase sempre é o próprio vendedor, já cadastrado na etapa "Partes" —
  // evita digitar o nome de novo.
  const pullTitular = () => {
    const nome = parties?.vendedor_1?.nome;
    if (!nome) { toast.error("Preencha o nome do vendedor/proprietário na etapa Partes primeiro"); return; }
    updB("titular", nome);
    toast.success("Nome do vendedor/proprietário aplicado ao titular");
  };

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      if (dp) {
        const { error } = await supabase.from("sale_payment").upsert({ sale_id: saleId, ...p });
        if (error) { toast.error(error.message); return false; }
      }
      if (db) {
        const existing = bank?.id ? bank : null;
        const { error } = existing
          ? await supabase.from("sale_bank_accounts").update(b).eq("id", existing.id)
          : await supabase.from("sale_bank_accounts").insert({ sale_id: saleId, ...b });
        if (error) { toast.error(error.message); return false; }
      }
      setDp(false); setDb(false);
      onSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [dp, db, p, b, bank, saleId, onSaved]);

  useEffect(() => { registerSaver(save); return () => registerSaver(null); }, [save, registerSaver]);
  useAutosave(editable && dirty, [p, b], save);

  const [activeBlock, setActiveBlock] = useState<"forma" | "banco">("forma");

  return (
    <div className="space-y-4">
      {editable && <AutosaveStatus saving={saving} dirty={dirty} />}
      <Wizard
        steps={[
          {
            key: "forma",
            label: "Forma de pagamento",
            content: (
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
        <CardContent className="flex justify-end pt-0">
          <Button size="sm" variant="ghost" onClick={() => setActiveBlock("banco")}>
            Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
            ),
          },
          {
            key: "banco",
            label: "Dados bancários do vendedor/proprietário",
            content: (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dados bancários do vendedor/proprietário</CardTitle>
          {editable && <Button size="sm" variant="outline" onClick={pullTitular}>Puxar nome do vendedor/proprietário</Button>}
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Titular"><Input value={b.titular ?? ""} onChange={(e) => updB("titular", e.target.value)} disabled={!editable} /></Field>
            <Field label="Banco"><Input value={b.banco ?? ""} onChange={(e) => updB("banco", e.target.value)} disabled={!editable} /></Field>
            <Field label="Agência"><Input value={b.agencia ?? ""} onChange={(e) => updB("agencia", e.target.value)} disabled={!editable} /></Field>
            <Field label="Conta"><Input value={b.conta ?? ""} onChange={(e) => updB("conta", e.target.value)} disabled={!editable} /></Field>
            <Field label="PIX" colSpan={2}><Input value={b.pix ?? ""} onChange={(e) => updB("pix", e.target.value)} disabled={!editable} /></Field>
          </FieldGrid>
        </CardContent>
        <CardContent className="flex justify-end pt-0">
          <Button size="sm" variant="ghost" onClick={() => setActiveBlock("forma")}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </CardContent>
      </Card>
            ),
          },
        ]}
        current={activeBlock}
        onChange={(k) => setActiveBlock(k as "forma" | "banco")}
        hideNav
      />
    </div>
  );
}
