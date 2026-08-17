import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Send, Loader2, XCircle, CheckCircle2, RotateCcw, AlertTriangle, Printer } from "lucide-react";
import { MIDIA_OPTIONS, LANCAMENTO_COMISSAO_PAPEIS } from "@/lib/status";
import { notifySaleStatusChange } from "@/lib/sale-notifications.functions";
import { useAutosave, AutosaveStatus, SaleSection, FieldGrid, Field, CurrencyInput, money } from "@/components/vendas/shared";
import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { mesclarPessoasAtivas, resolverSelecaoBeneficiario, SEM_CADASTRO_VALUE } from "@/lib/lancamento-pessoas";

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
  const { user, hasAny } = useAuth();
  const router = useRouter();
  const isOwner = sale.corretor_id === user?.id;
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);
  const canEdit = (sale.status === "rascunho" || sale.status === "devolvida_ajuste") && isOwner;
  const isResend = sale.status === "devolvida_ajuste";

  // Motivo da devolução mais recente — a venda de Lançamento não tem painel de comentários/histórico
  // próprio (tela única, sem wizard), então mostra direto o motivo gravado pelo financeiro em
  // sale_status_history no momento de devolver.
  const [motivoDevolucao, setMotivoDevolucao] = useState<string | null>(null);
  useEffect(() => {
    if (sale.status !== "devolvida_ajuste") { setMotivoDevolucao(null); return; }
    supabase.from("sale_status_history").select("motivo").eq("sale_id", saleId).eq("para", "devolvida_ajuste")
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setMotivoDevolucao(data?.motivo ?? null));
  }, [sale.status, saleId]);

  // Ocorrência já criada (qualquer status além de rascunho/devolvida_ajuste) — busca pra exibir a
  // mesma tela formatada "Ocorrência de compra e venda" que as vendas normais têm, em vez de repetir
  // os campos do formulário desabilitados.
  const [occ, setOcc] = useState<any>(null);
  const [occCommissions, setOccCommissions] = useState<any[]>([]);
  const [loadingOcc, setLoadingOcc] = useState(false);
  useEffect(() => {
    if (sale.status === "rascunho" || sale.status === "devolvida_ajuste") { setOcc(null); return; }
    setLoadingOcc(true);
    (async () => {
      const { data: o } = await supabase.from("occurrences").select("*").eq("sale_id", saleId).maybeSingle();
      setOcc(o);
      if (o) {
        const { data: c } = await supabase.from("occurrence_commissions").select("*").eq("occurrence_id", o.id).order("created_at");
        setOccCommissions(c ?? []);
      }
      setLoadingOcc(false);
    })();
  }, [sale.status, saleId]);

  // ----- Ações do financeiro sobre a Ocorrência já criada: devolver pro dono corrigir, concluir,
  // reabrir depois de concluída — mesmas ações que as vendas normais têm, adaptadas ao fluxo de
  // Lançamento (sem gestor no meio, então "devolver" volta direto pro corretor/coordenador). -----
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState("");
  const [returning, setReturning] = useState(false);
  const submitReturn = async () => {
    if (!returnMotivo.trim()) { toast.error("Motivo é obrigatório"); return; }
    setReturning(true);
    try {
      const { error } = await supabase.rpc("change_sale_status", { _sale_id: saleId, _new_status: "devolvida_ajuste", _motivo: returnMotivo });
      if (error) { toast.error(error.message); return; }
      notifySaleStatusChange({ data: { saleId, status: "devolvida_ajuste", motivo: returnMotivo } }).catch(() => {});
      toast.success("Lançamento devolvido");
      setReturnOpen(false);
      await onChange();
    } finally {
      setReturning(false);
    }
  };

  const [concluding, setConcluding] = useState(false);
  const concluirOcorrencia = async () => {
    setConcluding(true);
    try {
      const { error } = await supabase.rpc("change_sale_status", { _sale_id: saleId, _new_status: "ocorrencia_concluida" });
      if (error) { toast.error(error.message); return; }
      toast.success("Ocorrência concluída");
      await onChange();
    } finally {
      setConcluding(false);
    }
  };

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState("");
  const [reopening, setReopening] = useState(false);
  const submitReopen = async () => {
    if (!reopenMotivo.trim()) { toast.error("Motivo é obrigatório"); return; }
    setReopening(true);
    try {
      const { error } = await supabase.rpc("change_sale_status", { _sale_id: saleId, _new_status: "ocorrencia_analise_financeiro", _motivo: `Reaberta: ${reopenMotivo}` });
      if (error) { toast.error(error.message); return; }
      toast.success("Ocorrência reaberta");
      setReopenOpen(false);
      setReopenMotivo("");
      await onChange();
    } finally {
      setReopening(false);
    }
  };

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
  // Pessoas selecionáveis pra "Nome" — mesmas 3 RPCs já usadas no fluxo padrão (vendas.$id.tsx) pra
  // listar corretor/gestor/team_leader ativos, sem expor a tabela profiles inteira via RLS. Uma
  // pessoa de Lançamento pode estar em qualquer um dos 3 papéis (ex.: um gestor atuando como
  // "corretor vendedor" na venda), por isso as 3 listas são combinadas numa só, ao contrário do
  // fluxo padrão que usa cada lista separada pro campo equivalente.
  const [pessoasAtivas, setPessoasAtivas] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    (async () => {
      const [{ data: corretores }, { data: gestores }, { data: teamLeaders }] = await Promise.all([
        supabase.rpc("list_active_corretores"),
        supabase.rpc("list_active_gestores"),
        supabase.rpc("list_active_team_leaders"),
      ]);
      const norm = (rows: { id: string; nome: string | null }[] | null) =>
        (rows ?? []).map((p) => ({ id: p.id, nome: p.nome ?? p.id }));
      setPessoasAtivas(mesclarPessoasAtivas(norm(corretores), norm(gestores), norm(teamLeaders)));
    })();
  }, []);

  const [commRows, setCommRows] = useState<any[]>(() => commissionExtras.map((c) => ({ ...c })));
  const [commDirty, setCommDirty] = useState(false);
  const updComm = (id: string, patch: any) => {
    setCommRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setCommDirty(true);
  };
  const addComm = () => {
    setCommRows((rows) => [...rows, { id: `new-${crypto.randomUUID()}`, papel: "corretor_vendedor", nome: "", user_id: null, percentual: null, valor: null, _new: true }]);
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
      const payload = {
        sale_id: saleId,
        papel: r.papel,
        nome: r.nome || null,
        user_id: r.user_id || null,
        percentual: r.percentual,
        valor: r.valor,
        sem_cadastro_confirmado: !!r.sem_cadastro_confirmado,
      };
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
      toast.success(isResend ? "Lançamento reenviado ao financeiro" : "Lançamento enviado ao financeiro");
      await onChange();
    } finally {
      setSending(false);
    }
  };

  const somaComissao = commRows.reduce((s, c) => s + Number(c.valor ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={() => router.navigate({ to: "/vendas" })}>
          <ArrowLeft className="mr-2 h-4 w-4" />Voltar
        </Button>
        <StatusBadge status={sale.status} />
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{sale.imovel_id || `Lançamento #${sale.id.slice(0, 8)}`}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Venda de lançamento — em parceria com construtora.</p>
      </div>

      {sale.status === "devolvida_ajuste" && (
        <div className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <b>O financeiro devolveu este lançamento para ajuste.</b>
            {motivoDevolucao && <p className="mt-1">{motivoDevolucao}</p>}
          </div>
        </div>
      )}

      {canEdit && <>
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
              <div className="md:col-span-4 space-y-1">
                <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                {(() => {
                  const foraDaLista = !!c.user_id && !pessoasAtivas.some((p) => p.id === c.user_id);
                  return (
                    <Select
                      value={c.user_id || SEM_CADASTRO_VALUE}
                      disabled={!canEdit}
                      onValueChange={(v) => updComm(c.id, resolverSelecaoBeneficiario(v, pessoasAtivas, c.nome))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_CADASTRO_VALUE}>Sem cadastro / parceiro externo (digitar nome)</SelectItem>
                        {foraDaLista && <SelectItem value={c.user_id}>{c.nome} (inativo)</SelectItem>}
                        {pessoasAtivas.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  );
                })()}
                <Input
                  value={c.nome ?? ""}
                  disabled={!canEdit || !!c.user_id}
                  placeholder={c.user_id ? undefined : "Nome de quem não tem cadastro"}
                  onChange={(e) => updComm(c.id, { nome: e.target.value })}
                />
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
      </>}

      {!canEdit && loadingOcc && <p className="py-8 text-center text-sm text-muted-foreground">Carregando ocorrência...</p>}

      {!canEdit && !loadingOcc && occ && (
        <div className="rounded-lg border p-4 print:border-0 print:p-0">
          <div className="mb-3 flex justify-end print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />Imprimir / baixar
            </Button>
          </div>
          <OccurrenceReportBody
            sale={sale}
            occ={occ}
            commissions={occCommissions}
            partners={[]}
            parties={parties}
            papeis={LANCAMENTO_COMISSAO_PAPEIS}
          />
        </div>
      )}

      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <AutosaveStatus saving={false} dirty={anyDirty} />
          <Button onClick={enviarFinanceiro} disabled={sending || anyDirty}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {isResend ? "Reenviar ao financeiro" : "Enviar ao financeiro"}
          </Button>
        </div>
      )}

      {!canEdit && isFinanceiro && sale.status === "ocorrencia_analise_financeiro" && (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 print:hidden">
          <p className="text-sm text-muted-foreground">Ocorrência em análise — devolva pro corretor/coordenador corrigir, ou conclua.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReturnOpen(true)}><XCircle className="mr-2 h-4 w-4" />Devolver</Button>
            <Button onClick={concluirOcorrencia} disabled={concluding}>
              {concluding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Concluir ocorrência
            </Button>
          </div>
        </div>
      )}

      {!canEdit && isFinanceiro && sale.status === "ocorrencia_concluida" && (
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 print:hidden">
          <p className="text-sm text-muted-foreground">Ocorrência concluída.</p>
          <Button variant="outline" onClick={() => setReopenOpen(true)}><RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência</Button>
        </div>
      )}

      {!canEdit && !loadingOcc && !occ && sale.status !== "devolvida_ajuste" && (
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          Este lançamento já foi enviado ao financeiro e não pode mais ser editado por aqui.
        </div>
      )}

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver lançamento para ajuste</DialogTitle>
            <DialogDescription>Descreva o motivo. O corretor/coordenador que enviou será notificado.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo da devolução (obrigatório)" value={returnMotivo} onChange={(e) => setReturnMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancelar</Button>
            <Button onClick={submitReturn} disabled={!returnMotivo.trim() || returning}>
              {returning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Devolver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir ocorrência</DialogTitle>
            <DialogDescription>Descreva o motivo da reabertura.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo (obrigatório)" value={reopenMotivo} onChange={(e) => setReopenMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>Cancelar</Button>
            <Button onClick={submitReopen} disabled={!reopenMotivo.trim() || reopening}>
              {reopening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Reabrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
