import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, DOC_TYPES, COMISSAO_PAPEIS, validarProntaParaRevisao, type SaleStatus } from "@/lib/status";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileCheck, FileX, CheckCircle2, XCircle, Send, Gavel, DollarSign, AlertTriangle, RotateCcw, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  head: () => ({ meta: [{ title: "Detalhe da venda" }] }),
  component: SaleDetail,
});

function SaleDetail() {
  const { id } = Route.useParams();
  const { user, hasAny, hasRole } = useAuth();
  const [sale, setSale] = useState<any>(null);
  const [parties, setParties] = useState<Record<string, any>>({});
  const [payment, setPayment] = useState<any>(null);
  const [bank, setBank] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState("");
  const [returnTarget, setReturnTarget] = useState<SaleStatus>("devolvida_ajuste");

  const load = useCallback(async () => {
    setLoading(true);
    const [s, p, pay, ba, d, c, h] = await Promise.all([
      supabase.from("sales").select("*").eq("id", id).maybeSingle(),
      supabase.from("sale_parties").select("*").eq("sale_id", id),
      supabase.from("sale_payment").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_bank_accounts").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_documents").select("*").eq("sale_id", id).order("created_at"),
      supabase.from("sale_comments").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("sale_status_history").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
    ]);
    setSale(s.data);
    const partyMap: Record<string, any> = {};
    (p.data ?? []).forEach((row: any) => { partyMap[row.papel] = row; });
    setParties(partyMap);
    setPayment(pay.data ?? {});
    setBank(ba.data ?? {});
    setDocs(d.data ?? []);
    setComments(c.data ?? []);
    setHistory(h.data ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading || !sale) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  const status = sale.status as SaleStatus;
  const isOwner = sale.corretor_id === user?.id;
  const editable = (isOwner && (status === "rascunho" || status === "devolvida_ajuste")) || hasAny(["admin"]);
  const isGestor = hasAny(["gestor", "coordenador"]);
  const isJuridico = hasRole("juridico");
  const isFinanceiro = hasAny(["financeiro", "admin"]);

  const pendencias = validarProntaParaRevisao(sale, parties, payment, docs);
  const totalChecks = 8 + DOC_TYPES.filter(t => t.obrigatorio).length;
  const progress = Math.round(((totalChecks - pendencias.length) / totalChecks) * 100);

  const requiredTypes = DOC_TYPES.map(d => d.key);
  const docsApproved = requiredTypes.filter(t => docs.some(d => d.tipo === t && d.status === "aprovado")).length;

  const logActivity = async (tipo: string, dados?: any) => {
    await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, tipo, dados: dados ?? null });
  };

  const saveSale = async (patch: any) => {
    setSaving(true);
    const { error } = await supabase.from("sales").update(patch).eq("id", id);
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Salvo"); load(); }
  };

  const saveParty = async (papel: string, data: any) => {
    setSaving(true);
    const existing = parties[papel];
    let error;
    if (existing) {
      ({ error } = await supabase.from("sale_parties").update(data).eq("id", existing.id));
    } else {
      ({ error } = await supabase.from("sale_parties").insert({ sale_id: id, papel, ...data }));
    }
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Salvo"); load(); }
  };

  const savePayment = async (data: any) => {
    setSaving(true);
    const { error } = await supabase.from("sale_payment").upsert({ sale_id: id, ...data });
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Salvo"); load(); }
  };

  const saveBank = async (data: any) => {
    setSaving(true);
    const existing = bank?.id ? bank : null;
    let error;
    if (existing) ({ error } = await supabase.from("sale_bank_accounts").update(data).eq("id", existing.id));
    else ({ error } = await supabase.from("sale_bank_accounts").insert({ sale_id: id, ...data }));
    setSaving(false);
    if (error) toast.error(error.message); else { toast.success("Salvo"); load(); }
  };

  const notifyRoles = async (rolesToNotify: string[], titulo: string, mensagem?: string) => {
    const { data: users } = await supabase.from("user_roles").select("user_id").in("role", rolesToNotify as any);
    const uniqIds = Array.from(new Set((users ?? []).map((u: any) => u.user_id)));
    if (uniqIds.length === 0) return;
    await supabase.from("notifications").insert(uniqIds.map(uid => ({
      user_id: uid, sale_id: id, tipo: "status_change", titulo, mensagem: mensagem ?? null,
    })));
  };

  const changeStatus = async (next: SaleStatus, motivo?: string) => {
    const prev = sale.status as SaleStatus;
    const { error } = await supabase.from("sales").update({ status: next }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("sale_status_history").insert({ sale_id: id, de: prev, para: next, autor_id: user!.id, motivo });
    await logActivity("status_change", { de: prev, para: next, motivo });

    // Notificar o corretor da venda
    if (sale.corretor_id !== user?.id) {
      await supabase.from("notifications").insert({
        user_id: sale.corretor_id, sale_id: id,
        tipo: "status_change", titulo: `Venda agora está: ${STATUS_LABEL[next]}`,
        mensagem: motivo ?? null,
      });
    }

    // Regras automáticas
    if (next === "contrato_assinado") {
      const { error: e2 } = await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", id);
      if (!e2) {
        await supabase.from("sale_status_history").insert({ sale_id: id, de: "contrato_assinado", para: "ocorrencia_pendente", autor_id: user!.id, motivo: "Automático: contrato assinado" });
        await notifyRoles(["financeiro", "admin"], `Ocorrência pendente na venda ${sale.imovel_id ?? sale.codigo_interno ?? sale.id.slice(0, 8)}`, "Contrato assinado — gerar ocorrência");
      }
    }
    toast.success(`Status alterado para "${STATUS_LABEL[next]}"`);
    load();
  };

  const openReturnDialog = (target: SaleStatus) => {
    setReturnTarget(target);
    setReturnMotivo("");
    setReturnOpen(true);
  };

  const submitReturn = async () => {
    if (!returnMotivo.trim()) { toast.error("Motivo é obrigatório"); return; }
    await changeStatus(returnTarget, returnMotivo);
    await supabase.from("sale_comments").insert({ sale_id: id, autor_id: user!.id, escopo: "revisao", texto: returnMotivo });
    setReturnOpen(false);
  };

  const attemptSendForReview = () => setReviewOpen(true);

  const confirmSendForReview = async () => {
    if (pendencias.length > 0) { toast.error("Corrija as pendências antes de enviar"); return; }
    setReviewOpen(false);
    await changeStatus("enviada_revisao");
    await notifyRoles(["gestor", "coordenador"], `Nova venda para revisão: ${sale.imovel_id ?? sale.codigo_interno ?? sale.id.slice(0, 8)}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm"><Link to="/vendas"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{sale.imovel_id || sale.codigo_interno || `Venda #${sale.id.slice(0, 8)}`}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Criada em {new Date(sale.created_at).toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Corretor */}
          {isOwner && (status === "rascunho" || status === "devolvida_ajuste") && (
            <Button onClick={attemptSendForReview}><Send className="mr-2 h-4 w-4" />Enviar para revisão</Button>
          )}

          {/* Gestor */}
          {isGestor && status === "enviada_revisao" && (
            <>
              <Button onClick={() => changeStatus("aprovada_gestor")}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar p/ jurídico</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver</Button>
            </>
          )}

          {/* Jurídico */}
          {isJuridico && (status === "aprovada_gestor" || status === "enviada_juridico") && (
            <>
              <Button onClick={() => changeStatus("em_elaboracao_contrato")}><Gavel className="mr-2 h-4 w-4" />Iniciar contrato</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver</Button>
            </>
          )}
          {isJuridico && status === "em_elaboracao_contrato" && (
            <Button onClick={() => changeStatus("aguardando_assinatura")}>Aguardando assinatura</Button>
          )}
          {isJuridico && status === "aguardando_assinatura" && (
            <Button onClick={() => changeStatus("contrato_assinado")}>Marcar contrato assinado</Button>
          )}

          {/* Financeiro */}
          {isFinanceiro && status === "contrato_assinado" && (
            <Button onClick={() => changeStatus("ocorrencia_pendente")}><DollarSign className="mr-2 h-4 w-4" />Abrir ocorrência</Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progresso do checklist</span>
            <span className="font-medium">{progress}% • Documentos aprovados: {docsApproved}/{requiredTypes.length}</span>
          </div>
          <Progress value={progress} />
          {pendencias.length > 0 && isOwner && (
            <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <div className="mb-1 font-medium">Pendências para envio:</div>
              <ul className="list-inside list-disc space-y-0.5">
                {pendencias.slice(0, 4).map(p => <li key={p.campo}>{p.mensagem}</li>)}
                {pendencias.length > 4 && <li>e mais {pendencias.length - 4}…</li>}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="partes">Vendedores/Compradores</TabsTrigger>
          <TabsTrigger value="pagamento">Pagamento</TabsTrigger>
          <TabsTrigger value="bancario">Bancário</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="comentarios">Comentários</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          <TabsTrigger value="ocorrencia" disabled={!(status === "contrato_assinado" || status === "ocorrencia_pendente" || status === "ocorrencia_concluida")}>Ocorrência</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="space-y-4 pt-4">
          <SaleSection title="Imóvel">
            <FieldGrid>
              <Field label="ID do imóvel"><Input defaultValue={sale.imovel_id ?? ""} disabled={!editable} onBlur={(e) => e.target.value !== (sale.imovel_id ?? "") && saveSale({ imovel_id: e.target.value || null })} /></Field>
              <Field label="Matrícula"><Input defaultValue={sale.matricula ?? ""} disabled={!editable} onBlur={(e) => saveSale({ matricula: e.target.value || null })} /></Field>
              <Field label="IPTU"><Input defaultValue={sale.iptu ?? ""} disabled={!editable} onBlur={(e) => saveSale({ iptu: e.target.value || null })} /></Field>
              <Field label="Código interno"><Input defaultValue={sale.codigo_interno ?? ""} disabled={!editable} onBlur={(e) => saveSale({ codigo_interno: e.target.value || null })} /></Field>
              <Field label="Observações do imóvel" colSpan={2}><Textarea defaultValue={sale.imovel_observacoes ?? ""} disabled={!editable} onBlur={(e) => saveSale({ imovel_observacoes: e.target.value || null })} /></Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Equipe">
            <FieldGrid>
              <Field label="Corretor captador"><Input defaultValue={sale.corretor_captador ?? ""} disabled={!editable} onBlur={(e) => saveSale({ corretor_captador: e.target.value || null })} /></Field>
              <Field label="Corretor vendedor"><Input defaultValue={sale.corretor_vendedor ?? ""} disabled={!editable} onBlur={(e) => saveSale({ corretor_vendedor: e.target.value || null })} /></Field>
              <Field label="Indicador"><Input defaultValue={sale.indicador ?? ""} disabled={!editable} onBlur={(e) => saveSale({ indicador: e.target.value || null })} /></Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Valores e negociação">
            <FieldGrid>
              <Field label="Valor anunciado (R$)"><Input type="number" step="0.01" defaultValue={sale.valor_anunciado ?? ""} disabled={!editable} onBlur={(e) => saveSale({ valor_anunciado: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Valor negociado (R$)"><Input type="number" step="0.01" defaultValue={sale.valor_negociado ?? ""} disabled={!editable} onBlur={(e) => saveSale({ valor_negociado: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="% Comissão"><Input type="number" step="0.001" defaultValue={sale.percentual_comissao ?? ""} disabled={!editable} onBlur={(e) => saveSale({ percentual_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Valor total da comissão (R$)"><Input type="number" step="0.01" defaultValue={sale.valor_total_comissao ?? ""} disabled={!editable} onBlur={(e) => saveSale({ valor_total_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Forma de pagamento" colSpan={2}><Input defaultValue={sale.forma_pagamento ?? ""} disabled={!editable} onBlur={(e) => saveSale({ forma_pagamento: e.target.value || null })} /></Field>
              <Field label="Observações" colSpan={2}><Textarea defaultValue={sale.negociacao_observacoes ?? ""} disabled={!editable} onBlur={(e) => saveSale({ negociacao_observacoes: e.target.value || null })} /></Field>
            </FieldGrid>
          </SaleSection>

          <SaleSection title="Posse">
            <FieldGrid>
              <Field label="Data de entrega da posse"><Input type="date" defaultValue={sale.posse_data ?? ""} disabled={!editable} onBlur={(e) => saveSale({ posse_data: e.target.value || null })} /></Field>
              <Field label="Observações" colSpan={2}><Textarea defaultValue={sale.posse_observacoes ?? ""} disabled={!editable} onBlur={(e) => saveSale({ posse_observacoes: e.target.value || null })} /></Field>
            </FieldGrid>
          </SaleSection>
        </TabsContent>

        <TabsContent value="partes" className="space-y-4 pt-4">
          {["vendedor_1", "vendedor_2", "comprador_1", "comprador_2"].map((p) => (
            <PartyEditor key={p} papel={p} data={parties[p] ?? {}} editable={editable} onSave={(d) => saveParty(p, d)} />
          ))}
        </TabsContent>

        <TabsContent value="pagamento" className="space-y-4 pt-4">
          <PaymentEditor data={payment ?? {}} editable={editable} onSave={savePayment} />
        </TabsContent>

        <TabsContent value="bancario" className="space-y-4 pt-4">
          <BankEditor data={bank ?? {}} editable={editable} onSave={saveBank} />
        </TabsContent>

        <TabsContent value="documentos" className="space-y-4 pt-4">
          <DocumentsPanel saleId={id} docs={docs} editable={editable} canModerate={isGestor || isJuridico} onChange={load} />
        </TabsContent>

        <TabsContent value="comentarios" className="space-y-4 pt-4">
          <CommentsPanel saleId={id} comments={comments} onAdd={load} />
        </TabsContent>

        <TabsContent value="historico" className="space-y-4 pt-4">
          <Card>
            <CardHeader><CardTitle>Histórico de status</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {history.length === 0 && <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>}
              {history.map((h) => (
                <div key={h.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-muted-foreground">{h.de ? STATUS_LABEL[h.de as SaleStatus] : "—"}</span>
                      {" → "}
                      <span className="font-medium">{STATUS_LABEL[h.para as SaleStatus]}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")}</span>
                  </div>
                  {h.motivo && <p className="mt-1 text-muted-foreground">{h.motivo}</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ocorrencia" className="space-y-4 pt-4">
          <OccurrencePanel saleId={id} sale={sale} payment={payment} parties={parties} canEdit={isFinanceiro || isGestor} onChange={load} />
        </TabsContent>
      </Tabs>

      {saving && <p className="fixed bottom-4 right-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow">Salvando...</p>}

      {/* Modal de conferência para envio */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferência antes de enviar</DialogTitle>
            <DialogDescription>Confira os itens abaixo antes de enviar para o gestor.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {pendencias.length === 0 ? (
              <div className="rounded-md bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />Venda pronta para revisão. Todos os itens obrigatórios estão preenchidos.
              </div>
            ) : (
              <>
                <div className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />{pendencias.length} pendência(s). Corrija antes de enviar.
                </div>
                <ul className="space-y-1 pl-2">
                  {pendencias.map(p => <li key={p.campo} className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{p.mensagem}</span></li>)}
                </ul>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>Cancelar</Button>
            <Button onClick={confirmSendForReview} disabled={pendencias.length > 0}>Confirmar envio</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de devolução */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver venda para ajuste</DialogTitle>
            <DialogDescription>Descreva o motivo. O corretor será notificado.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo da devolução (obrigatório)" value={returnMotivo} onChange={(e) => setReturnMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReturnOpen(false)}>Cancelar</Button>
            <Button onClick={submitReturn} disabled={!returnMotivo.trim()}>Devolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}
function Field({ label, children, colSpan }: { label: string; children: React.ReactNode; colSpan?: number }) {
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : ""}>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function PartyEditor({ papel, data, editable, onSave }: { papel: string; data: any; editable: boolean; onSave: (d: any) => void }) {
  const labels: Record<string, string> = { vendedor_1: "Vendedor 01", vendedor_2: "Vendedor 02", comprador_1: "Comprador 01", comprador_2: "Comprador 02" };
  const [form, setForm] = useState(data);
  useEffect(() => setForm(data), [data]);
  const upd = (k: string, v: string) => setForm({ ...form, [k]: v });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">{labels[papel]}</CardTitle>
        {editable && <Button size="sm" onClick={() => onSave(form)}>Salvar</Button>}
      </CardHeader>
      <CardContent>
        <FieldGrid>
          <Field label="Nome"><Input value={form.nome ?? ""} onChange={(e) => upd("nome", e.target.value)} disabled={!editable} /></Field>
          <Field label="RG"><Input value={form.rg ?? ""} onChange={(e) => upd("rg", e.target.value)} disabled={!editable} /></Field>
          <Field label="CPF/CNPJ"><Input value={form.cpf_cnpj ?? ""} onChange={(e) => upd("cpf_cnpj", e.target.value)} disabled={!editable} /></Field>
          <Field label="Profissão"><Input value={form.profissao ?? ""} onChange={(e) => upd("profissao", e.target.value)} disabled={!editable} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email ?? ""} onChange={(e) => upd("email", e.target.value)} disabled={!editable} /></Field>
          <Field label="Telefone"><Input value={form.telefone ?? ""} onChange={(e) => upd("telefone", e.target.value)} disabled={!editable} /></Field>
        </FieldGrid>
      </CardContent>
    </Card>
  );
}

function PaymentEditor({ data, editable, onSave }: { data: any; editable: boolean; onSave: (d: any) => void }) {
  const [f, setF] = useState(data);
  useEffect(() => setF(data), [data]);
  const upd = (k: string, v: any) => setF({ ...f, [k]: v });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Forma de pagamento</CardTitle>
        {editable && <Button size="sm" onClick={() => onSave(f)}>Salvar</Button>}
      </CardHeader>
      <CardContent>
        <FieldGrid>
          <Field label="Entrada — valor"><Input type="number" step="0.01" value={f.entrada_valor ?? ""} onChange={(e) => upd("entrada_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
          <Field label="Entrada — data"><Input type="date" value={f.entrada_data ?? ""} onChange={(e) => upd("entrada_data", e.target.value || null)} disabled={!editable} /></Field>
          <Field label="Parcela 1 — valor"><Input type="number" step="0.01" value={f.parcela1_valor ?? ""} onChange={(e) => upd("parcela1_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
          <Field label="Parcela 1 — data"><Input type="date" value={f.parcela1_data ?? ""} onChange={(e) => upd("parcela1_data", e.target.value || null)} disabled={!editable} /></Field>
          <Field label="Parcela 2 — valor"><Input type="number" step="0.01" value={f.parcela2_valor ?? ""} onChange={(e) => upd("parcela2_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
          <Field label="Parcela 2 — data"><Input type="date" value={f.parcela2_data ?? ""} onChange={(e) => upd("parcela2_data", e.target.value || null)} disabled={!editable} /></Field>
          <Field label="FGTS"><div className="flex items-center gap-2"><Switch checked={!!f.fgts} onCheckedChange={(v) => upd("fgts", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
          <Field label="FGTS — valor"><Input type="number" step="0.01" value={f.fgts_valor ?? ""} onChange={(e) => upd("fgts_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
          <Field label="Financiamento"><div className="flex items-center gap-2"><Switch checked={!!f.financiamento} onCheckedChange={(v) => upd("financiamento", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
          <Field label="Financiamento — valor"><Input type="number" step="0.01" value={f.financiamento_valor ?? ""} onChange={(e) => upd("financiamento_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
          <Field label="Observações gerais" colSpan={2}><Textarea value={f.observacoes ?? ""} onChange={(e) => upd("observacoes", e.target.value)} disabled={!editable} /></Field>
        </FieldGrid>
      </CardContent>
    </Card>
  );
}

function BankEditor({ data, editable, onSave }: { data: any; editable: boolean; onSave: (d: any) => void }) {
  const [f, setF] = useState(data);
  useEffect(() => setF(data), [data]);
  const upd = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-base">Dados bancários do vendedor</CardTitle>
        {editable && <Button size="sm" onClick={() => onSave(f)}>Salvar</Button>}
      </CardHeader>
      <CardContent>
        <FieldGrid>
          <Field label="Titular"><Input value={f.titular ?? ""} onChange={(e) => upd("titular", e.target.value)} disabled={!editable} /></Field>
          <Field label="Banco"><Input value={f.banco ?? ""} onChange={(e) => upd("banco", e.target.value)} disabled={!editable} /></Field>
          <Field label="Agência"><Input value={f.agencia ?? ""} onChange={(e) => upd("agencia", e.target.value)} disabled={!editable} /></Field>
          <Field label="Conta"><Input value={f.conta ?? ""} onChange={(e) => upd("conta", e.target.value)} disabled={!editable} /></Field>
          <Field label="PIX" colSpan={2}><Input value={f.pix ?? ""} onChange={(e) => upd("pix", e.target.value)} disabled={!editable} /></Field>
        </FieldGrid>
      </CardContent>
    </Card>
  );
}

function DocumentsPanel({ saleId, docs, editable, canModerate, onChange }: { saleId: string; docs: any[]; editable: boolean; canModerate: boolean; onChange: () => void }) {
  const { user } = useAuth();

  const upload = async (tipo: string, file: File) => {
    const ext = file.name.split(".").pop();
    const path = `${saleId}/${tipo}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("sale-documents").upload(path, file, { upsert: false });
    if (error) { toast.error(error.message); return; }
    const { error: insErr } = await supabase.from("sale_documents").insert({
      sale_id: saleId, tipo, storage_path: path, file_name: file.name,
      uploaded_by: user!.id, status: "enviado",
    });
    if (insErr) toast.error(insErr.message); else { toast.success("Documento enviado"); onChange(); }
  };

  const download = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 60);
    if (error || !data) { toast.error("Falha ao gerar link"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const approve = async (doc: any) => {
    const { error } = await supabase.from("sale_documents").update({ status: "aprovado", motivo_recusa: null }).eq("id", doc.id);
    if (error) toast.error(error.message); else onChange();
  };
  const reject = async (doc: any) => {
    const motivo = prompt("Motivo da recusa (obrigatório):");
    if (!motivo?.trim()) return;
    const { error } = await supabase.from("sale_documents").update({ status: "recusado", motivo_recusa: motivo }).eq("id", doc.id);
    if (error) toast.error(error.message);
    else { await supabase.from("sale_comments").insert({ sale_id: saleId, autor_id: user!.id, escopo: "revisao", texto: `Documento recusado: ${motivo}`, doc_id: doc.id }); onChange(); }
  };

  return (
    <div className="space-y-3">
      {DOC_TYPES.map((t) => {
        const list = docs.filter(d => d.tipo === t.key);
        const latest = list[list.length - 1];
        return (
          <Card key={t.key}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{t.label}{t.obrigatorio && <span className="ml-1 text-destructive">*</span>}</div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">{t.grupo === "pessoal" ? "Pessoal" : "Imóvel"}</div>
                </div>
                <div className="flex items-center gap-2">
                  {latest && <DocStatusBadge status={latest.status} />}
                  {editable && (
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                      <Upload className="h-4 w-4" />
                      <span>Enviar</span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(t.key, e.target.files[0])} />
                    </label>
                  )}
                </div>
              </div>
              {list.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-2 text-sm">
                  <button className="truncate text-left hover:underline" onClick={() => download(d)}>{d.file_name}</button>
                  <div className="flex items-center gap-2">
                    <DocStatusBadge status={d.status} />
                    {d.motivo_recusa && <span className="text-xs text-destructive">({d.motivo_recusa})</span>}
                    {canModerate && d.status !== "aprovado" && (
                      <Button size="sm" variant="ghost" onClick={() => approve(d)}><FileCheck className="h-4 w-4" /></Button>
                    )}
                    {canModerate && d.status !== "recusado" && (
                      <Button size="sm" variant="ghost" onClick={() => reject(d)}><FileX className="h-4 w-4" /></Button>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function DocStatusBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pendente: "bg-muted text-muted-foreground",
    enviado: "bg-blue-100 text-blue-900",
    aprovado: "bg-emerald-100 text-emerald-900",
    recusado: "bg-destructive/15 text-destructive",
  };
  const label: Record<string, string> = { pendente: "Pendente", enviado: "Enviado", aprovado: "Aprovado", recusado: "Recusado" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone[status]}`}>{label[status]}</span>;
}

function CommentsPanel({ saleId, comments, onAdd }: { saleId: string; comments: any[]; onAdd: () => void }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [escopo, setEscopo] = useState("revisao");
  const add = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("sale_comments").insert({ sale_id: saleId, autor_id: user!.id, escopo, texto: text });
    if (error) toast.error(error.message); else { setText(""); onAdd(); }
  };
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Comentários</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2">
          <Select value={escopo} onValueChange={setEscopo}>
            <SelectTrigger className="md:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="revisao">Revisão</SelectItem>
              <SelectItem value="juridico">Jurídico</SelectItem>
              <SelectItem value="interno">Interno</SelectItem>
            </SelectContent>
          </Select>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva um comentário..." />
          <Button onClick={add} className="self-start">Adicionar</Button>
        </div>
        <div className="space-y-2">
          {comments.length === 0 && <p className="text-sm text-muted-foreground">Sem comentários.</p>}
          {comments.map((c) => (
            <div key={c.id} className="rounded-md border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="uppercase">{c.escopo}</span>
                <span>{new Date(c.created_at).toLocaleString("pt-BR")}</span>
              </div>
              <p>{c.texto}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OccurrencePanel({ saleId, sale, payment, parties, canEdit, onChange }: { saleId: string; sale: any; payment: any; parties: Record<string, any>; canEdit: boolean; onChange: () => void }) {
  const { user, hasAny } = useAuth();
  const [occ, setOcc] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: o } = await supabase.from("occurrences").select("*").eq("sale_id", saleId).maybeSingle();
    setOcc(o);
    if (o) {
      const [c, p] = await Promise.all([
        supabase.from("occurrence_commissions").select("*").eq("occurrence_id", o.id).order("created_at"),
        supabase.from("occurrence_partners").select("*").eq("occurrence_id", o.id).order("created_at"),
      ]);
      setCommissions(c.data ?? []);
      setPartners(p.data ?? []);
    }
    setLoading(false);
  }, [saleId]);
  useEffect(() => { load(); }, [load]);

  const createOcc = async () => {
    const vendedor = parties?.vendedor_1;
    const comprador = parties?.comprador_1;
    const { data, error } = await supabase.from("occurrences").insert({
      sale_id: saleId,
      codigo_imovel: sale.imovel_id ?? sale.codigo_interno,
      data_assinatura: new Date().toISOString().slice(0, 10),
      valor_anunciado: sale.valor_anunciado,
      valor_negociado: sale.valor_negociado,
      percentual_comissao: sale.percentual_comissao,
      valor_comissao: sale.valor_total_comissao,
      financiamento: payment?.financiamento ?? false,
      financiamento_valor: payment?.financiamento_valor ?? null,
      observacoes: [vendedor?.nome && `Vendedor: ${vendedor.nome}`, comprador?.nome && `Comprador: ${comprador.nome}`].filter(Boolean).join(" | ") || null,
      status: "pendente",
    }).select("*").single();
    if (error) { toast.error(error.message); return; }
    // Cria linhas de comissão para os 6 papéis (vazias)
    await supabase.from("occurrence_commissions").insert(
      COMISSAO_PAPEIS.map(p => ({ occurrence_id: data.id, papel: p.key }))
    );
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, tipo: "occurrence_created", dados: { occurrence_id: data.id } });
    toast.success("Ocorrência criada");
    onChange();
    load();
  };

  const updateOcc = async (patch: any) => {
    const { error } = await supabase.from("occurrences").update(patch).eq("id", occ.id);
    if (error) toast.error(error.message); else load();
  };

  const addCommission = async () => {
    const { error } = await supabase.from("occurrence_commissions").insert({ occurrence_id: occ.id, papel: "corretor_vendedor" });
    if (error) toast.error(error.message); else load();
  };

  const updCommission = async (row: any, patch: any) => {
    // Recalcula automaticamente se % ou valor foi editado
    const total = Number(occ.valor_comissao ?? 0);
    const merged = { ...row, ...patch };
    if (total > 0) {
      if ("percentual" in patch && patch.percentual != null && patch.percentual !== "") {
        merged.valor = Number(((Number(patch.percentual) / 100) * total).toFixed(2));
      } else if ("valor" in patch && patch.valor != null && patch.valor !== "") {
        merged.percentual = Number(((Number(patch.valor) / total) * 100).toFixed(3));
      }
    }
    const { error } = await supabase.from("occurrence_commissions").update({ papel: merged.papel, nome: merged.nome, percentual: merged.percentual, valor: merged.valor }).eq("id", row.id);
    if (error) toast.error(error.message); else load();
  };
  const delCommission = async (id: string) => {
    await supabase.from("occurrence_commissions").delete().eq("id", id);
    load();
  };

  const addPartner = async () => {
    const { error } = await supabase.from("occurrence_partners").insert({ occurrence_id: occ.id, nome: "" });
    if (error) toast.error(error.message); else load();
  };
  const updPartner = async (id: string, patch: any) => {
    const { error } = await supabase.from("occurrence_partners").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  };
  const delPartner = async (id: string) => {
    await supabase.from("occurrence_partners").delete().eq("id", id);
    load();
  };

  const somaComissoes = commissions.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const total = Number(occ?.valor_comissao ?? 0);
  const excedido = total > 0 && somaComissoes > total + 0.01;

  const conclude = async () => {
    if (excedido) {
      if (!confirm(`Soma das comissões (R$ ${somaComissoes.toFixed(2)}) excede a comissão total (R$ ${total.toFixed(2)}). Continuar mesmo assim?`)) return;
    }
    await updateOcc({ status: "concluida" });
    const { error } = await supabase.from("sales").update({ status: "ocorrencia_concluida" }).eq("id", saleId);
    if (error) { toast.error(error.message); return; }
    await supabase.from("sale_status_history").insert({ sale_id: saleId, de: sale.status, para: "ocorrencia_concluida", autor_id: user!.id, motivo: "Ocorrência finalizada" });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, tipo: "occurrence_concluded", dados: { valor_total: total } });
    toast.success("Ocorrência finalizada");
    onChange();
  };

  const reopen = async () => {
    const motivo = prompt("Justificativa para reabrir a ocorrência (obrigatório):");
    if (!motivo?.trim()) return;
    await updateOcc({ status: "pendente" });
    await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", saleId);
    await supabase.from("sale_status_history").insert({ sale_id: saleId, de: "ocorrencia_concluida", para: "ocorrencia_pendente", autor_id: user!.id, motivo: `Reaberta: ${motivo}` });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, tipo: "occurrence_reopened", dados: { motivo } });
    toast.success("Ocorrência reaberta");
    onChange();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!occ) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">Nenhuma ocorrência criada para esta venda.</p>
          {canEdit && <Button onClick={createOcc}><Plus className="mr-2 h-4 w-4" />Criar ocorrência a partir dos dados da venda</Button>}
        </CardContent>
      </Card>
    );
  }

  const concluida = occ.status === "concluida";
  const canWrite = canEdit && !concluida;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Ocorrência de compra e venda</CardTitle>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${concluida ? "bg-emerald-100 text-emerald-900" : "bg-orange-100 text-orange-900"}`}>{concluida ? "Concluída" : "Pendente"}</span>
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Código do imóvel"><Input defaultValue={occ.codigo_imovel ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ codigo_imovel: e.target.value || null })} /></Field>
            <Field label="Tempo de venda"><Input defaultValue={occ.tempo_venda ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ tempo_venda: e.target.value || null })} placeholder="Ex: 45 dias" /></Field>
            <Field label="Data de assinatura"><Input type="date" defaultValue={occ.data_assinatura ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ data_assinatura: e.target.value || null })} /></Field>
            <Field label="Mídia"><Input defaultValue={occ.midia ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ midia: e.target.value || null })} placeholder="Instagram, Portal, Placa..." /></Field>
            <Field label="Nota fiscal obrigatória"><div className="flex items-center gap-2"><Switch checked={!!occ.nota_fiscal_obrigatoria} onCheckedChange={(v) => updateOcc({ nota_fiscal_obrigatoria: v })} disabled={!canWrite} /><span className="text-sm text-muted-foreground">{occ.nota_fiscal_obrigatoria ? "Sim" : "Não"}</span></div></Field>
            <Field label="Valor anunciado"><Input type="number" step="0.01" defaultValue={occ.valor_anunciado ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ valor_anunciado: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Valor negociado"><Input type="number" step="0.01" defaultValue={occ.valor_negociado ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ valor_negociado: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="% Comissão"><Input type="number" step="0.001" defaultValue={occ.percentual_comissao ?? ""} disabled={!canWrite} onBlur={(e) => {
              const p = e.target.value ? Number(e.target.value) : null;
              const neg = Number(occ.valor_negociado ?? 0);
              const patch: any = { percentual_comissao: p };
              if (p != null && neg > 0) patch.valor_comissao = Number(((p / 100) * neg).toFixed(2));
              updateOcc(patch);
            }} /></Field>
            <Field label="Valor da comissão (total)"><Input type="number" step="0.01" defaultValue={occ.valor_comissao ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ valor_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Financiamento</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Tem financiamento?"><div className="flex items-center gap-2"><Switch checked={!!occ.financiamento} onCheckedChange={(v) => updateOcc({ financiamento: v })} disabled={!canWrite} /><span className="text-sm text-muted-foreground">{occ.financiamento ? "Sim" : "Não"}</span></div></Field>
            <Field label="Valor financiado"><Input type="number" step="0.01" defaultValue={occ.financiamento_valor ?? ""} disabled={!canWrite || !occ.financiamento} onBlur={(e) => updateOcc({ financiamento_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Banco"><Input defaultValue={occ.financiamento_banco ?? ""} disabled={!canWrite || !occ.financiamento} onBlur={(e) => updateOcc({ financiamento_banco: e.target.value || null })} /></Field>
            <Field label="Correspondente bancário"><Input defaultValue={occ.financiamento_correspondente ?? ""} disabled={!canWrite || !occ.financiamento} onBlur={(e) => updateOcc({ financiamento_correspondente: e.target.value || null })} /></Field>
            <Field label="Previsão de liberação"><Input type="date" defaultValue={occ.financiamento_previsao ?? ""} disabled={!canWrite || !occ.financiamento} onBlur={(e) => updateOcc({ financiamento_previsao: e.target.value || null })} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recebimento da 1ª parcela</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Valor da primeira parcela"><Input type="number" step="0.01" defaultValue={occ.prev_recebimento_valor ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ prev_recebimento_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Data prevista"><Input type="date" defaultValue={occ.prev_recebimento_data ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ prev_recebimento_data: e.target.value || null })} /></Field>
            <Field label="Forma de pagamento" colSpan={2}><Input defaultValue={occ.prev_recebimento_forma ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ prev_recebimento_forma: e.target.value || null })} placeholder="PIX, TED, boleto..." /></Field>
            <Field label="Observações" colSpan={2}><Textarea defaultValue={occ.observacoes ?? ""} disabled={!canWrite} onBlur={(e) => updateOcc({ observacoes: e.target.value || null })} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Divisão de comissão</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Total: R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · Distribuído: R$ {somaComissoes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
          </div>
          {canWrite && <Button size="sm" variant="outline" onClick={addCommission}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>}
        </CardHeader>
        <CardContent className="space-y-2">
          {excedido && (
            <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              <AlertTriangle className="mr-2 inline h-4 w-4" />
              A soma das comissões (R$ {somaComissoes.toFixed(2)}) ultrapassa o valor total (R$ {total.toFixed(2)}).
            </div>
          )}
          {commissions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma comissão adicionada.</p>}
          {commissions.map((c) => (
            <div key={c.id} className="grid grid-cols-1 items-end gap-2 rounded-md border p-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label className="mb-1 block text-xs text-muted-foreground">Papel</Label>
                <Select value={c.papel} onValueChange={(v) => updCommission(c, { papel: v })} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMISSAO_PAPEIS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                <Input defaultValue={c.nome ?? ""} onBlur={(e) => e.target.value !== (c.nome ?? "") && updCommission(c, { nome: e.target.value || null })} disabled={!canWrite} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">%</Label>
                <Input type="number" step="0.001" defaultValue={c.percentual ?? ""} onBlur={(e) => updCommission(c, { percentual: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">Valor (R$)</Label>
                <Input type="number" step="0.01" defaultValue={c.valor ?? ""} onBlur={(e) => updCommission(c, { valor: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} />
              </div>
              {canWrite && (
                <div className="md:col-span-1">
                  <Button variant="ghost" size="sm" onClick={() => delCommission(c.id)} className="w-full">×</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Parcerias</CardTitle>
          {canWrite && <Button size="sm" variant="outline" onClick={addPartner}><Plus className="mr-1 h-4 w-4" />Adicionar parceria</Button>}
        </CardHeader>
        <CardContent className="space-y-2">
          {partners.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parceria adicionada.</p>}
          {partners.map(p => (
            <div key={p.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-4">
              <Field label="Corretor/Imobiliária"><Input defaultValue={p.nome ?? ""} onBlur={(e) => updPartner(p.id, { nome: e.target.value || null })} disabled={!canWrite} /></Field>
              <Field label="CPF/CNPJ"><Input defaultValue={p.cpf_cnpj ?? ""} onBlur={(e) => updPartner(p.id, { cpf_cnpj: e.target.value || null })} disabled={!canWrite} /></Field>
              <Field label="%"><Input type="number" step="0.001" defaultValue={p.percentual ?? ""} onBlur={(e) => updPartner(p.id, { percentual: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} /></Field>
              <Field label="Valor"><Input type="number" step="0.01" defaultValue={p.valor ?? ""} onBlur={(e) => updPartner(p.id, { valor: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} /></Field>
              <Field label="Banco"><Input defaultValue={p.banco ?? ""} onBlur={(e) => updPartner(p.id, { banco: e.target.value || null })} disabled={!canWrite} /></Field>
              <Field label="Agência"><Input defaultValue={p.agencia ?? ""} onBlur={(e) => updPartner(p.id, { agencia: e.target.value || null })} disabled={!canWrite} /></Field>
              <Field label="Conta"><Input defaultValue={p.conta ?? ""} onBlur={(e) => updPartner(p.id, { conta: e.target.value || null })} disabled={!canWrite} /></Field>
              {canWrite && (
                <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => delPartner(p.id)}>Remover</Button></div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && !concluida && (
          <Button onClick={conclude}><CheckCircle2 className="mr-2 h-4 w-4" />Finalizar ocorrência</Button>
        )}
        {hasAny(["financeiro", "admin"]) && concluida && (
          <Button variant="outline" onClick={reopen}><RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência</Button>
        )}
      </div>
    </div>
  );
}
