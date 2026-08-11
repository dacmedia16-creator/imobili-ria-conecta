import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Send, Loader2 } from "lucide-react";
import { MIDIA_OPTIONS, LANCAMENTO_COMISSAO_PAPEIS } from "@/lib/status";
import { notifySaleStatusChange } from "@/lib/sale-notifications.functions";
import { useAutosave, AutosaveStatus, SaleSection, FieldGrid, Field, CurrencyInput, money } from "@/components/vendas/shared";

/** Tela única (sem wizard) da venda de Lançamento: sem documentos, sem jurídico, sem contrato — só
 * o formulário que o corretor/coordenador preenche, e que já sai direto pro financeiro ao enviar
 * (ver criar_ocorrencia_lancamento). Documentos/Partes/Pagamento do fluxo normal não se aplicam aqui
 * (são feitos pra pessoa física com CPF/RG/indicador — overkill e confuso pra uma venda de lançamento). */
export function LancamentoDetail({ saleId, sale, parties, commissionExtras, onChange }: {
  saleId: string;
  sale: any;
  parties: Record<string, any>;
  commissionExtras: any[];
  onChange: () => void | Promise<void>;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const isOwner = sale.corretor_id === user?.id;
  const canEdit = sale.status === "rascunho" && isOwner;

  // ----- Resumo: campos direto em sales -----
  const [form, setForm] = useState(() => ({
    imovel_id: sale.imovel_id ?? "",
    data_assinatura: sale.data_assinatura ?? "",
    nota_fiscal_obrigatoria: !!sale.nota_fiscal_obrigatoria,
    midia: sale.midia ?? "",
    valor_anunciado: sale.valor_anunciado ?? null,
    valor_negociado: sale.valor_negociado ?? null,
    percentual_comissao: sale.percentual_comissao ?? null,
    valor_total_comissao: sale.valor_total_comissao ?? null,
    premio_valor: sale.premio_valor ?? null,
    previsao_recebimento_valor: sale.previsao_recebimento_valor ?? null,
    previsao_recebimento_data: sale.previsao_recebimento_data ?? "",
    previsao_recebimento_forma: sale.previsao_recebimento_forma ?? "",
    negociacao_observacoes: sale.negociacao_observacoes ?? "",
  }));
  const [dirty, setDirty] = useState(false);
  const upd = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };
  const saveForm = useCallback(async () => {
    const { error } = await supabase.from("sales").update(form).eq("id", saleId);
    if (error) { toast.error(error.message); return false; }
    setDirty(false);
    return true;
  }, [form, saleId]);
  useAutosave(canEdit && dirty, [form], saveForm);

  // ----- Construtora (vendedor_1) + compradores: sale_parties -----
  // Números de comprador além do 1º (que sempre existe, criado junto com a venda) — mesmo padrão de
  // "extras sob demanda" usado em DocumentsPanel pra comprador_N/vendedor_N.
  const [compradorNums, setCompradorNums] = useState<number[]>(() => {
    const nums = Object.keys(parties)
      .map((p) => p.match(/^comprador_(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number)
      .filter((n) => n > 1);
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  });
  const partiesPapeis = ["vendedor_1", "comprador_1", ...compradorNums.map((n) => `comprador_${n}`)];
  const [partiesForm, setPartiesForm] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const papel of partiesPapeis) {
      const p = parties[papel] ?? {};
      init[papel] = papel === "vendedor_1"
        ? { razao_social: p.razao_social ?? "", cnpj: p.cnpj ?? "", email: p.email ?? "", telefone: p.telefone ?? "" }
        : { nome: p.nome ?? "", cpf_cnpj: p.cpf_cnpj ?? "", rg: p.rg ?? "", email: p.email ?? "", telefone: p.telefone ?? "" };
    }
    return init;
  });
  const [partiesDirty, setPartiesDirty] = useState(false);
  const updParty = (papel: string, patch: any) => {
    setPartiesForm((f) => ({ ...f, [papel]: { ...f[papel], ...patch } }));
    setPartiesDirty(true);
  };
  const addComprador = () => {
    const next = compradorNums.length ? Math.max(...compradorNums) + 1 : 2;
    setCompradorNums((nums) => [...nums, next]);
    setPartiesForm((f) => ({ ...f, [`comprador_${next}`]: { nome: "", cpf_cnpj: "", rg: "", email: "", telefone: "" } }));
    setPartiesDirty(true);
  };
  const savePartiesForm = useCallback(async () => {
    for (const papel of partiesPapeis) {
      const data = partiesForm[papel];
      if (!data) continue;
      const existing = parties[papel];
      const { error } = existing?.id
        ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
        : await supabase.from("sale_parties").insert({ sale_id: saleId, papel, tipo_pessoa: papel === "vendedor_1" ? "juridica" : "fisica", ...data });
      if (error) { toast.error(error.message); return false; }
    }
    setPartiesDirty(false);
    await onChange();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partiesForm, partiesPapeis, parties, saleId, onChange]);
  useAutosave(canEdit && partiesDirty, [partiesForm], savePartiesForm);

  // ----- Divisão da comissão: sale_commission_extras -----
  const [commRows, setCommRows] = useState<any[]>(() => commissionExtras.map((c) => ({ ...c })));
  const [commDirty, setCommDirty] = useState(false);
  const updComm = (id: string, patch: any) => {
    setCommRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setCommDirty(true);
  };
  const addComm = () => {
    setCommRows((rows) => [...rows, { id: `new-${crypto.randomUUID()}`, papel: "corretor_vendedor", nome: "", percentual: null, valor: null, _new: true }]);
    setCommDirty(true);
  };
  const delComm = (id: string) => {
    setCommRows((rows) => rows.filter((r) => r.id !== id));
    setCommDirty(true);
  };
  const saveComm = useCallback(async () => {
    const currentIds = new Set(commRows.filter((r) => !r._new).map((r) => r.id));
    const removedIds = commissionExtras.filter((c) => !currentIds.has(c.id)).map((c) => c.id);
    if (removedIds.length) {
      const { error } = await supabase.from("sale_commission_extras").delete().in("id", removedIds);
      if (error) { toast.error(error.message); return false; }
    }
    for (const r of commRows) {
      const payload = { sale_id: saleId, papel: r.papel, nome: r.nome || null, percentual: r.percentual, valor: r.valor };
      const { error } = r._new
        ? await supabase.from("sale_commission_extras").insert(payload)
        : await supabase.from("sale_commission_extras").update(payload).eq("id", r.id);
      if (error) { toast.error(error.message); return false; }
    }
    setCommDirty(false);
    await onChange();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commRows, commissionExtras, saleId, onChange]);
  useAutosave(canEdit && commDirty, [commRows], saveComm);

  // ----- Enviar ao financeiro -----
  const [sending, setSending] = useState(false);
  const anyDirty = dirty || partiesDirty || commDirty;
  const enviarFinanceiro = async () => {
    if (anyDirty) { toast.error("Aguarde salvar as últimas alterações antes de enviar (alguns segundos)."); return; }
    setSending(true);
    try {
      const { error } = await supabase.rpc("criar_ocorrencia_lancamento", { p_sale_id: saleId });
      if (error) { toast.error(error.message); return; }
      notifySaleStatusChange({ data: { saleId, status: "ocorrencia_analise_financeiro" } }).catch(() => {});
      toast.success("Lançamento enviado ao financeiro");
      await onChange();
    } finally {
      setSending(false);
    }
  };

  const somaComissao = commRows.reduce((s, c) => s + Number(c.valor ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/vendas" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />Voltar
        </Button>
        <StatusBadge status={sale.status} />
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{sale.imovel_id || `Lançamento #${sale.id.slice(0, 8)}`}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Venda de lançamento — em parceria com construtora.</p>
      </div>

      <SaleSection title="Imóvel e negociação">
        <FieldGrid>
          <Field label="Código do imóvel"><Input value={form.imovel_id} disabled={!canEdit} onChange={(e) => upd({ imovel_id: e.target.value })} /></Field>
          <Field label="Data de assinatura"><Input type="date" value={form.data_assinatura ?? ""} disabled={!canEdit} onChange={(e) => upd({ data_assinatura: e.target.value || null })} /></Field>
          <Field label="Mídia">
            <Select value={form.midia || undefined} disabled={!canEdit} onValueChange={(v) => upd({ midia: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{MIDIA_OPTIONS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Nota fiscal obrigatória">
            <div className="flex h-9 items-center gap-2">
              <Switch checked={form.nota_fiscal_obrigatoria} disabled={!canEdit} onCheckedChange={(v) => upd({ nota_fiscal_obrigatoria: v })} />
              <span className="text-sm text-muted-foreground">{form.nota_fiscal_obrigatoria ? "Sim" : "Não"}</span>
            </div>
          </Field>
        </FieldGrid>
      </SaleSection>

      <SaleSection title="Construtora">
        <FieldGrid>
          <Field label="Nome da construtora"><Input value={partiesForm.vendedor_1?.razao_social ?? ""} disabled={!canEdit} onChange={(e) => updParty("vendedor_1", { razao_social: e.target.value })} /></Field>
          <Field label="CNPJ"><Input value={partiesForm.vendedor_1?.cnpj ?? ""} disabled={!canEdit} onChange={(e) => updParty("vendedor_1", { cnpj: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={partiesForm.vendedor_1?.email ?? ""} disabled={!canEdit} onChange={(e) => updParty("vendedor_1", { email: e.target.value })} /></Field>
          <Field label="Celular"><Input value={partiesForm.vendedor_1?.telefone ?? ""} disabled={!canEdit} onChange={(e) => updParty("vendedor_1", { telefone: e.target.value })} /></Field>
        </FieldGrid>
      </SaleSection>

      <SaleSection title="Comprador(es)">
        <div className="space-y-4">
          {["comprador_1", ...compradorNums.map((n) => `comprador_${n}`)].map((papel, i) => (
            <div key={papel} className={i > 0 ? "border-t pt-4" : ""}>
              <FieldGrid>
                <Field label="Nome"><Input value={partiesForm[papel]?.nome ?? ""} disabled={!canEdit} onChange={(e) => updParty(papel, { nome: e.target.value })} /></Field>
                <Field label="CPF/CNPJ"><Input value={partiesForm[papel]?.cpf_cnpj ?? ""} disabled={!canEdit} onChange={(e) => updParty(papel, { cpf_cnpj: e.target.value })} /></Field>
                <Field label="RG"><Input value={partiesForm[papel]?.rg ?? ""} disabled={!canEdit} onChange={(e) => updParty(papel, { rg: e.target.value })} /></Field>
                <Field label="E-mail"><Input type="email" value={partiesForm[papel]?.email ?? ""} disabled={!canEdit} onChange={(e) => updParty(papel, { email: e.target.value })} /></Field>
                <Field label="Celular"><Input value={partiesForm[papel]?.telefone ?? ""} disabled={!canEdit} onChange={(e) => updParty(papel, { telefone: e.target.value })} /></Field>
              </FieldGrid>
            </div>
          ))}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={addComprador}><Plus className="mr-1 h-4 w-4" />Adicionar comprador</Button>
          )}
        </div>
      </SaleSection>

      <SaleSection title="Resumo da transação">
        <FieldGrid>
          <Field label="Valor anunciado"><CurrencyInput value={form.valor_anunciado} disabled={!canEdit} onChange={(v) => upd({ valor_anunciado: v })} /></Field>
          <Field label="Valor negociado"><CurrencyInput value={form.valor_negociado} disabled={!canEdit} onChange={(v) => upd({ valor_negociado: v })} /></Field>
          <Field label="Percentual de comissão">
            <Input type="number" step="0.01" value={form.percentual_comissao ?? ""} disabled={!canEdit} onChange={(e) => upd({ percentual_comissao: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label="Valor total da comissão"><CurrencyInput value={form.valor_total_comissao} disabled={!canEdit} onChange={(v) => upd({ valor_total_comissao: v })} /></Field>
          <Field label="Prêmio"><CurrencyInput value={form.premio_valor} disabled={!canEdit} onChange={(v) => upd({ premio_valor: v })} /></Field>
        </FieldGrid>
      </SaleSection>

      <SaleSection title="Divisão da comissão">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Total distribuído: {money(somaComissao) ?? "R$ 0,00"}</p>
          {commRows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma linha adicionada.</p>}
          {commRows.map((c) => (
            <div key={c.id} className="grid grid-cols-1 items-end gap-2 rounded-md border p-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label className="mb-1 block text-xs text-muted-foreground">Papel</Label>
                <Select value={c.papel} disabled={!canEdit} onValueChange={(v) => updComm(c.id, { papel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LANCAMENTO_COMISSAO_PAPEIS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                <Input value={c.nome ?? ""} disabled={!canEdit} onChange={(e) => updComm(c.id, { nome: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">%</Label>
                <Input type="number" step="0.001" value={c.percentual ?? ""} disabled={!canEdit} onChange={(e) => updComm(c.id, { percentual: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">Valor (R$)</Label>
                <CurrencyInput value={c.valor} disabled={!canEdit} onChange={(v) => updComm(c.id, { valor: v })} />
              </div>
              {canEdit && (
                <div className="md:col-span-1">
                  <Button variant="ghost" size="sm" onClick={() => delComm(c.id)} className="w-full">×</Button>
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <Button size="sm" variant="outline" onClick={addComm}><Plus className="mr-1 h-4 w-4" />Adicionar linha</Button>
          )}
        </div>
      </SaleSection>

      <SaleSection title="Previsão de recebimento">
        <FieldGrid>
          <Field label="Valor"><CurrencyInput value={form.previsao_recebimento_valor} disabled={!canEdit} onChange={(v) => upd({ previsao_recebimento_valor: v })} /></Field>
          <Field label="Data"><Input type="date" value={form.previsao_recebimento_data ?? ""} disabled={!canEdit} onChange={(e) => upd({ previsao_recebimento_data: e.target.value || null })} /></Field>
          <Field label="Forma de pagamento"><Input value={form.previsao_recebimento_forma ?? ""} disabled={!canEdit} onChange={(e) => upd({ previsao_recebimento_forma: e.target.value })} /></Field>
        </FieldGrid>
      </SaleSection>

      <SaleSection title="Observações">
        <Textarea value={form.negociacao_observacoes ?? ""} disabled={!canEdit} onChange={(e) => upd({ negociacao_observacoes: e.target.value })} rows={4} />
      </SaleSection>

      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <AutosaveStatus saving={false} dirty={anyDirty} />
          <Button onClick={enviarFinanceiro} disabled={sending || anyDirty}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Enviar ao financeiro
          </Button>
        </div>
      )}

      {sale.status !== "rascunho" && (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          Este lançamento já foi enviado ao financeiro e não pode mais ser editado por aqui.
        </div>
      )}
    </div>
  );
}
