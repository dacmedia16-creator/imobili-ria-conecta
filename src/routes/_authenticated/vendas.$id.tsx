import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wizard, type WizardStep } from "@/components/Wizard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { STATUS_LABEL, DOC_TYPES, DOC_GRUPO_LABEL, COMISSAO_PAPEIS, validarProntaParaRevisao, proximoResponsavel, type SaleStatus, type DocGrupo } from "@/lib/status";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileCheck, FileX, CheckCircle2, XCircle, Send, Gavel, DollarSign, AlertTriangle, RotateCcw, Plus, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  head: () => ({ meta: [{ title: "Detalhe da venda" }] }),
  component: SaleDetail,
});

type Saver = () => Promise<boolean>;

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
  const [step, setStep] = useState<string>("resumo");

  // Buffered Resumo form
  const [formSale, setFormSale] = useState<any>({});
  const [dirtyResumo, setDirtyResumo] = useState(false);

  // Per-step savers registered by child editors
  const saversRef = useRef<Record<string, Saver>>({});
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const registerSaver = useCallback((key: string, fn: Saver | null) => {
    if (fn) saversRef.current[key] = fn;
    else delete saversRef.current[key];
  }, []);
  const setStepDirty = useCallback((key: string, v: boolean) => {
    setDirtyMap((m) => (m[key] === v ? m : { ...m, [key]: v }));
  }, []);

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
    setFormSale(s.data ?? {});
    setDirtyResumo(false);
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

  const logActivity = async (acao: string, payload?: any) => {
    await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, acao, payload: payload ?? null });
  };

  // ---- Resumo (buffered) save ----
  const updResumo = (patch: any) => { setFormSale((f: any) => ({ ...f, ...patch })); setDirtyResumo(true); };
  const saveResumo = async (): Promise<boolean> => {
    if (!sale) return false;
    const fields = [
      "imovel_id","matricula","iptu","codigo_interno","imovel_observacoes",
      "corretor_captador","corretor_vendedor","indicador",
      "valor_anunciado","valor_negociado","percentual_comissao","valor_total_comissao",
      "forma_pagamento","negociacao_observacoes","posse_data","posse_observacoes",
    ];
    const patch: any = {};
    for (const k of fields) {
      const v = formSale?.[k];
      const orig = sale?.[k];
      if ((v ?? null) !== (orig ?? null)) patch[k] = v === "" ? null : v;
    }
    if (Object.keys(patch).length === 0) { setDirtyResumo(false); return true; }
    setSaving(true);
    const { error } = await supabase.from("sales").update(patch).eq("id", id);
    setSaving(false);
    if (error) { toast.error(error.message); return false; }
    setDirtyResumo(false);
    toast.success("Alterações salvas");
    await load();
    return true;
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
    if (sale.corretor_id !== user?.id) {
      await supabase.from("notifications").insert({
        user_id: sale.corretor_id, sale_id: id,
        tipo: "status_change", titulo: `Venda agora está: ${STATUS_LABEL[next]}`,
        mensagem: motivo ?? null,
      });
    }
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

  const openReturnDialog = (target: SaleStatus) => { setReturnTarget(target); setReturnMotivo(""); setReturnOpen(true); };
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

  // Wizard: on leaving a step, run its saver if dirty
  const onBeforeLeave = async (from: string): Promise<boolean> => {
    if (from === "resumo" && dirtyResumo) return await saveResumo();
    if (dirtyMap[from]) {
      const fn = saversRef.current[from];
      if (fn) return await fn();
    }
    return true;
  };

  const currentDirty = step === "resumo" ? dirtyResumo : !!dirtyMap[step];

  const canOccurrence = status === "contrato_assinado" || status === "ocorrencia_pendente" || status === "ocorrencia_concluida";
  const steps: WizardStep[] = [
    {
      key: "resumo",
      label: "Resumo",
      content: (
        <div className="space-y-4">
          {editable && dirtyResumo && (
            <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <span>Você tem alterações não salvas nesta etapa.</span>
              <Button size="sm" onClick={saveResumo}><Save className="mr-1 h-4 w-4" />Salvar</Button>
            </div>
          )}
          <SaleSection title="Imóvel">
            <FieldGrid>
              <Field label="ID do imóvel"><Input value={formSale.imovel_id ?? ""} disabled={!editable} onChange={(e) => updResumo({ imovel_id: e.target.value })} /></Field>
              <Field label="Matrícula"><Input value={formSale.matricula ?? ""} disabled={!editable} onChange={(e) => updResumo({ matricula: e.target.value })} /></Field>
              <Field label="IPTU"><Input value={formSale.iptu ?? ""} disabled={!editable} onChange={(e) => updResumo({ iptu: e.target.value })} /></Field>
              <Field label="Código interno"><Input value={formSale.codigo_interno ?? ""} disabled={!editable} onChange={(e) => updResumo({ codigo_interno: e.target.value })} /></Field>
              <Field label="Observações do imóvel" colSpan={2}><Textarea value={formSale.imovel_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ imovel_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <SaleSection title="Equipe">
            <FieldGrid>
              <Field label="Corretor captador"><Input value={formSale.corretor_captador ?? ""} disabled={!editable} onChange={(e) => updResumo({ corretor_captador: e.target.value })} /></Field>
              <Field label="Corretor vendedor"><Input value={formSale.corretor_vendedor ?? ""} disabled={!editable} onChange={(e) => updResumo({ corretor_vendedor: e.target.value })} /></Field>
              <Field label="Indicador"><Input value={formSale.indicador ?? ""} disabled={!editable} onChange={(e) => updResumo({ indicador: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <SaleSection title="Valores e negociação">
            <FieldGrid>
              <Field label="Valor anunciado (R$)"><Input type="number" step="0.01" value={formSale.valor_anunciado ?? ""} disabled={!editable} onChange={(e) => updResumo({ valor_anunciado: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Valor negociado (R$)"><Input type="number" step="0.01" value={formSale.valor_negociado ?? ""} disabled={!editable} onChange={(e) => updResumo({ valor_negociado: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="% Comissão"><Input type="number" step="0.001" value={formSale.percentual_comissao ?? ""} disabled={!editable} onChange={(e) => updResumo({ percentual_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Valor total da comissão (R$)"><Input type="number" step="0.01" value={formSale.valor_total_comissao ?? ""} disabled={!editable} onChange={(e) => updResumo({ valor_total_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Forma de pagamento" colSpan={2}><Input value={formSale.forma_pagamento ?? ""} disabled={!editable} onChange={(e) => updResumo({ forma_pagamento: e.target.value })} /></Field>
              <Field label="Observações" colSpan={2}><Textarea value={formSale.negociacao_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ negociacao_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <SaleSection title="Posse">
            <FieldGrid>
              <Field label="Data de entrega da posse"><Input type="date" value={formSale.posse_data ?? ""} disabled={!editable} onChange={(e) => updResumo({ posse_data: e.target.value || null })} /></Field>
              <Field label="Observações" colSpan={2}><Textarea value={formSale.posse_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ posse_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
        </div>
      ),
    },
    {
      key: "partes",
      label: "Partes",
      content: (
        <PartiesStep
          saleId={id}
          parties={parties}
          editable={editable}
          onSaved={load}
          registerSaver={(fn) => registerSaver("partes", fn)}
          onDirtyChange={(d) => setStepDirty("partes", d)}
        />
      ),
    },
    {
      key: "pagamento",
      label: "Pagamento",
      content: (
        <PaymentStep
          saleId={id}
          payment={payment}
          bank={bank}
          editable={editable}
          onSaved={load}
          registerSaver={(fn) => registerSaver("pagamento", fn)}
          onDirtyChange={(d) => setStepDirty("pagamento", d)}
        />
      ),
    },
    {
      key: "documentos",
      label: "Documentos",
      content: <DocumentsPanel saleId={id} docs={docs} editable={editable} canModerate={isGestor || isJuridico} onChange={load} />,
    },
    {
      key: "ocorrencia",
      label: "Ocorrência",
      disabled: !canOccurrence,
      content: (
        <OccurrencePanel
          saleId={id}
          sale={sale}
          payment={payment}
          parties={parties}
          canEdit={isFinanceiro || isGestor}
          onChange={load}
          registerSaver={(fn) => registerSaver("ocorrencia", fn)}
          onDirtyChange={(d) => setStepDirty("ocorrencia", d)}
        />
      ),
    },
    {
      key: "historico",
      label: "Histórico",
      content: (
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
      ),
    },
    {
      key: "comentarios",
      label: "Comentários",
      content: <CommentsPanel saleId={id} comments={comments} onAdd={load} />,
    },
  ];

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
          {isOwner && (status === "rascunho" || status === "devolvida_ajuste") && (
            <Button onClick={attemptSendForReview}><Send className="mr-2 h-4 w-4" />Enviar para revisão</Button>
          )}
          {isGestor && status === "enviada_revisao" && (
            <>
              <Button onClick={() => changeStatus("aprovada_gestor")}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar p/ jurídico</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver</Button>
            </>
          )}
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
          {isFinanceiro && status === "contrato_assinado" && (
            <Button onClick={() => changeStatus("ocorrencia_pendente")}><DollarSign className="mr-2 h-4 w-4" />Abrir ocorrência</Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 p-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Próxima etapa</div>
              <div className="font-medium">{proximoResponsavel(status).titulo}</div>
            </div>
            <div className="text-xs text-muted-foreground">Responsável: <span className="font-medium text-foreground">{proximoResponsavel(status).papel}</span></div>
          </div>
          {!editable && isOwner && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Esta venda está travada para edição enquanto está em <b>{STATUS_LABEL[status]}</b>.
            </div>
          )}
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

      <Wizard
        steps={steps}
        current={step}
        onChange={setStep}
        dirty={currentDirty}
        onBeforeLeave={onBeforeLeave}
      />

      {saving && <p className="fixed bottom-4 right-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow">Salvando...</p>}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferência antes de enviar</DialogTitle>
            <DialogDescription>Confira os itens abaixo antes de enviar para o gestor.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {pendencias.length === 0 ? (
              <div className="rounded-md bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />Venda pronta para revisão.
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

// -------- Partes step (buffered) --------
function PartiesStep({ saleId, parties, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; parties: Record<string, any>; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const papeis = ["vendedor_1", "vendedor_2", "comprador_1", "comprador_2"];
  const [forms, setForms] = useState<Record<string, any>>(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { m[p] = parties[p] ?? {}; });
    return m;
  });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const anyDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty]);

  useEffect(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { m[p] = parties[p] ?? {}; });
    setForms(m);
    setDirty({});
  }, [parties]);

  useEffect(() => { onDirtyChange(anyDirty); }, [anyDirty, onDirtyChange]);

  const update = (papel: string, k: string, v: string) => {
    setForms(f => ({ ...f, [papel]: { ...f[papel], [k]: v } }));
    setDirty(d => ({ ...d, [papel]: true }));
  };

  const saveAll = useCallback(async (): Promise<boolean> => {
    for (const papel of papeis) {
      if (!dirty[papel]) continue;
      const existing = parties[papel];
      const data = { nome: forms[papel].nome ?? null, rg: forms[papel].rg ?? null, cpf_cnpj: forms[papel].cpf_cnpj ?? null, profissao: forms[papel].profissao ?? null, email: forms[papel].email ?? null, telefone: forms[papel].telefone ?? null };
      const { error } = existing
        ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
        : await supabase.from("sale_parties").insert({ sale_id: saleId, papel, ...data });
      if (error) { toast.error(error.message); return false; }
    }
    toast.success("Partes salvas");
    setDirty({});
    onSaved();
    return true;
  }, [dirty, forms, parties, saleId, onSaved]);

  useEffect(() => { registerSaver(saveAll); return () => registerSaver(null); }, [saveAll, registerSaver]);

  const labels: Record<string, string> = { vendedor_1: "Vendedor 01", vendedor_2: "Vendedor 02", comprador_1: "Comprador 01", comprador_2: "Comprador 02" };
  return (
    <div className="space-y-4">
      {editable && anyDirty && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>Você tem alterações não salvas nesta etapa.</span>
          <Button size="sm" onClick={saveAll}><Save className="mr-1 h-4 w-4" />Salvar</Button>
        </div>
      )}
      {papeis.map((p) => (
        <Card key={p}>
          <CardHeader><CardTitle className="text-base">{labels[p]}</CardTitle></CardHeader>
          <CardContent>
            <FieldGrid>
              <Field label="Nome"><Input value={forms[p].nome ?? ""} onChange={(e) => update(p, "nome", e.target.value)} disabled={!editable} /></Field>
              <Field label="RG"><Input value={forms[p].rg ?? ""} onChange={(e) => update(p, "rg", e.target.value)} disabled={!editable} /></Field>
              <Field label="CPF/CNPJ"><Input value={forms[p].cpf_cnpj ?? ""} onChange={(e) => update(p, "cpf_cnpj", e.target.value)} disabled={!editable} /></Field>
              <Field label="Profissão"><Input value={forms[p].profissao ?? ""} onChange={(e) => update(p, "profissao", e.target.value)} disabled={!editable} /></Field>
              <Field label="E-mail"><Input type="email" value={forms[p].email ?? ""} onChange={(e) => update(p, "email", e.target.value)} disabled={!editable} /></Field>
              <Field label="Telefone"><Input value={forms[p].telefone ?? ""} onChange={(e) => update(p, "telefone", e.target.value)} disabled={!editable} /></Field>
            </FieldGrid>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// -------- Pagamento step (buffered) --------
function PaymentStep({ saleId, payment, bank, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; payment: any; bank: any; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const [p, setP] = useState<any>(payment ?? {});
  const [b, setB] = useState<any>(bank ?? {});
  const [dp, setDp] = useState(false);
  const [db, setDb] = useState(false);
  const dirty = dp || db;

  useEffect(() => { setP(payment ?? {}); setDp(false); }, [payment]);
  useEffect(() => { setB(bank ?? {}); setDb(false); }, [bank]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  const updP = (k: string, v: any) => { setP((f: any) => ({ ...f, [k]: v })); setDp(true); };
  const updB = (k: string, v: any) => { setB((f: any) => ({ ...f, [k]: v })); setDb(true); };

  const save = useCallback(async (): Promise<boolean> => {
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
    toast.success("Pagamento salvo");
    setDp(false); setDb(false);
    onSaved();
    return true;
  }, [dp, db, p, b, bank, saleId, onSaved]);

  useEffect(() => { registerSaver(save); return () => registerSaver(null); }, [save, registerSaver]);

  return (
    <div className="space-y-4">
      {editable && dirty && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>Você tem alterações não salvas nesta etapa.</span>
          <Button size="sm" onClick={save}><Save className="mr-1 h-4 w-4" />Salvar</Button>
        </div>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">Forma de pagamento</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Entrada — valor"><Input type="number" step="0.01" value={p.entrada_valor ?? ""} onChange={(e) => updP("entrada_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
            <Field label="Entrada — data"><Input type="date" value={p.entrada_data ?? ""} onChange={(e) => updP("entrada_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — valor"><Input type="number" step="0.01" value={p.parcela1_valor ?? ""} onChange={(e) => updP("parcela1_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — data"><Input type="date" value={p.parcela1_data ?? ""} onChange={(e) => updP("parcela1_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — valor"><Input type="number" step="0.01" value={p.parcela2_valor ?? ""} onChange={(e) => updP("parcela2_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — data"><Input type="date" value={p.parcela2_data ?? ""} onChange={(e) => updP("parcela2_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="FGTS"><div className="flex items-center gap-2"><Switch checked={!!p.fgts} onCheckedChange={(v) => updP("fgts", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
            <Field label="FGTS — valor"><Input type="number" step="0.01" value={p.fgts_valor ?? ""} onChange={(e) => updP("fgts_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
            <Field label="Financiamento"><div className="flex items-center gap-2"><Switch checked={!!p.financiamento} onCheckedChange={(v) => updP("financiamento", v)} disabled={!editable} /><span className="text-sm">Sim/Não</span></div></Field>
            <Field label="Financiamento — valor"><Input type="number" step="0.01" value={p.financiamento_valor ?? ""} onChange={(e) => updP("financiamento_valor", e.target.value ? Number(e.target.value) : null)} disabled={!editable} /></Field>
            <Field label="Observações gerais" colSpan={2}><Textarea value={p.observacoes ?? ""} onChange={(e) => updP("observacoes", e.target.value)} disabled={!editable} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Dados bancários do vendedor</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Titular"><Input value={b.titular ?? ""} onChange={(e) => updB("titular", e.target.value)} disabled={!editable} /></Field>
            <Field label="Banco"><Input value={b.banco ?? ""} onChange={(e) => updB("banco", e.target.value)} disabled={!editable} /></Field>
            <Field label="Agência"><Input value={b.agencia ?? ""} onChange={(e) => updB("agencia", e.target.value)} disabled={!editable} /></Field>
            <Field label="Conta"><Input value={b.conta ?? ""} onChange={(e) => updB("conta", e.target.value)} disabled={!editable} /></Field>
            <Field label="PIX" colSpan={2}><Input value={b.pix ?? ""} onChange={(e) => updB("pix", e.target.value)} disabled={!editable} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>
    </div>
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

// -------- Occurrence step (buffered) --------
function OccurrencePanel({ saleId, sale, payment, parties, canEdit, onChange, registerSaver, onDirtyChange }: {
  saleId: string; sale: any; payment: any; parties: Record<string, any>; canEdit: boolean; onChange: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const { user, hasAny } = useAuth();
  const [occ, setOcc] = useState<any>(null);
  const [formOcc, setFormOcc] = useState<any>({});
  const [dirtyOcc, setDirtyOcc] = useState(false);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [formComms, setFormComms] = useState<any[]>([]);
  const [dirtyComms, setDirtyComms] = useState(false);
  const [partners, setPartners] = useState<any[]>([]);
  const [formPartners, setFormPartners] = useState<any[]>([]);
  const [dirtyPartners, setDirtyPartners] = useState(false);
  const [loading, setLoading] = useState(true);

  const anyDirty = dirtyOcc || dirtyComms || dirtyPartners;
  useEffect(() => { onDirtyChange(anyDirty); }, [anyDirty, onDirtyChange]);

  const load = useCallback(async () => {
    const { data: o } = await supabase.from("occurrences").select("*").eq("sale_id", saleId).maybeSingle();
    setOcc(o);
    setFormOcc(o ?? {});
    setDirtyOcc(false);
    if (o) {
      const [c, p] = await Promise.all([
        supabase.from("occurrence_commissions").select("*").eq("occurrence_id", o.id).order("created_at"),
        supabase.from("occurrence_partners").select("*").eq("occurrence_id", o.id).order("created_at"),
      ]);
      setCommissions(c.data ?? []);
      setFormComms(c.data ?? []);
      setDirtyComms(false);
      setPartners(p.data ?? []);
      setFormPartners(p.data ?? []);
      setDirtyPartners(false);
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
    await supabase.from("occurrence_commissions").insert(
      COMISSAO_PAPEIS.map(p => ({ occurrence_id: data.id, papel: p.key }))
    );
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "occurrence_created", payload: { occurrence_id: data.id } });
    toast.success("Ocorrência criada");
    onChange();
    load();
  };

  const updOcc = (patch: any) => { setFormOcc((f: any) => ({ ...f, ...patch })); setDirtyOcc(true); };

  const updComm = (id: string, patch: any) => {
    setFormComms(rows => rows.map(r => {
      if (r.id !== id) return r;
      const total = Number(formOcc?.valor_comissao ?? 0);
      const merged = { ...r, ...patch };
      if (total > 0) {
        if ("percentual" in patch && patch.percentual != null && patch.percentual !== "") {
          merged.valor = Number(((Number(patch.percentual) / 100) * total).toFixed(2));
        } else if ("valor" in patch && patch.valor != null && patch.valor !== "") {
          merged.percentual = Number(((Number(patch.valor) / total) * 100).toFixed(3));
        }
      }
      return merged;
    }));
    setDirtyComms(true);
  };
  const addCommission = () => {
    setFormComms(rows => [...rows, { id: `new-${crypto.randomUUID()}`, occurrence_id: occ?.id, papel: "corretor_vendedor", nome: null, percentual: null, valor: null, _new: true }]);
    setDirtyComms(true);
  };
  const delCommission = (id: string) => {
    setFormComms(rows => rows.filter(r => r.id !== id));
    setDirtyComms(true);
  };

  const updPartner = (id: string, patch: any) => {
    setFormPartners(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r));
    setDirtyPartners(true);
  };
  const addPartner = () => {
    setFormPartners(rows => [...rows, { id: `new-${crypto.randomUUID()}`, occurrence_id: occ?.id, nome: "", _new: true }]);
    setDirtyPartners(true);
  };
  const delPartner = (id: string) => {
    setFormPartners(rows => rows.filter(r => r.id !== id));
    setDirtyPartners(true);
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (!occ) return true;
    if (dirtyOcc) {
      const fields = ["codigo_imovel","tempo_venda","data_assinatura","midia","nota_fiscal_obrigatoria","valor_anunciado","valor_negociado","percentual_comissao","valor_comissao","financiamento","financiamento_valor","financiamento_banco","financiamento_correspondente","financiamento_previsao","prev_recebimento_valor","prev_recebimento_data","prev_recebimento_forma","observacoes"];
      const patch: any = {};
      for (const k of fields) if ((formOcc?.[k] ?? null) !== (occ?.[k] ?? null)) patch[k] = formOcc[k] === "" ? null : formOcc[k];
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("occurrences").update(patch).eq("id", occ.id);
        if (error) { toast.error(error.message); return false; }
      }
    }
    if (dirtyComms) {
      const currentIds = new Set(formComms.filter(r => !r._new).map(r => r.id));
      const removed = commissions.filter(r => !currentIds.has(r.id));
      for (const r of removed) await supabase.from("occurrence_commissions").delete().eq("id", r.id);
      for (const r of formComms) {
        const data = { papel: r.papel, nome: r.nome ?? null, percentual: r.percentual ?? null, valor: r.valor ?? null };
        const { error } = r._new
          ? await supabase.from("occurrence_commissions").insert({ occurrence_id: occ.id, ...data })
          : await supabase.from("occurrence_commissions").update(data).eq("id", r.id);
        if (error) { toast.error(error.message); return false; }
      }
    }
    if (dirtyPartners) {
      const currentIds = new Set(formPartners.filter(r => !r._new).map(r => r.id));
      const removed = partners.filter(r => !currentIds.has(r.id));
      for (const r of removed) await supabase.from("occurrence_partners").delete().eq("id", r.id);
      for (const r of formPartners) {
        const data = { nome: r.nome ?? null, cpf_cnpj: r.cpf_cnpj ?? null, percentual: r.percentual ?? null, valor: r.valor ?? null, banco: r.banco ?? null, agencia: r.agencia ?? null, conta: r.conta ?? null };
        const { error } = r._new
          ? await supabase.from("occurrence_partners").insert({ occurrence_id: occ.id, ...data })
          : await supabase.from("occurrence_partners").update(data).eq("id", r.id);
        if (error) { toast.error(error.message); return false; }
      }
    }
    toast.success("Ocorrência salva");
    await load();
    return true;
  }, [occ, dirtyOcc, dirtyComms, dirtyPartners, formOcc, formComms, formPartners, commissions, partners, load]);

  useEffect(() => { registerSaver(save); return () => registerSaver(null); }, [save, registerSaver]);

  const somaComissoes = formComms.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const total = Number(formOcc?.valor_comissao ?? 0);
  const excedido = total > 0 && somaComissoes > total + 0.01;

  const conclude = async () => {
    if (anyDirty) { const ok = await save(); if (!ok) return; }
    if (excedido) {
      if (!confirm(`Soma das comissões (R$ ${somaComissoes.toFixed(2)}) excede a comissão total (R$ ${total.toFixed(2)}). Continuar mesmo assim?`)) return;
    }
    const { error: e0 } = await supabase.from("occurrences").update({ status: "concluida" }).eq("id", occ.id);
    if (e0) { toast.error(e0.message); return; }
    const { error } = await supabase.from("sales").update({ status: "ocorrencia_concluida" }).eq("id", saleId);
    if (error) { toast.error(error.message); return; }
    await supabase.from("sale_status_history").insert({ sale_id: saleId, de: sale.status, para: "ocorrencia_concluida", autor_id: user!.id, motivo: "Ocorrência finalizada" });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "occurrence_concluded", payload: { valor_total: total } });
    toast.success("Ocorrência finalizada");
    onChange();
  };

  const reopen = async () => {
    const motivo = prompt("Justificativa para reabrir a ocorrência (obrigatório):");
    if (!motivo?.trim()) return;
    await supabase.from("occurrences").update({ status: "pendente" }).eq("id", occ.id);
    await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", saleId);
    await supabase.from("sale_status_history").insert({ sale_id: saleId, de: "ocorrencia_concluida", para: "ocorrencia_pendente", autor_id: user!.id, motivo: `Reaberta: ${motivo}` });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "occurrence_reopened", payload: { motivo } });
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
      {canWrite && anyDirty && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <span>Você tem alterações não salvas nesta etapa.</span>
          <Button size="sm" onClick={save}><Save className="mr-1 h-4 w-4" />Salvar</Button>
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Ocorrência de compra e venda</CardTitle>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${concluida ? "bg-emerald-100 text-emerald-900" : "bg-orange-100 text-orange-900"}`}>{concluida ? "Concluída" : "Pendente"}</span>
        </CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Código do imóvel"><Input value={formOcc.codigo_imovel ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ codigo_imovel: e.target.value })} /></Field>
            <Field label="Tempo de venda"><Input value={formOcc.tempo_venda ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ tempo_venda: e.target.value })} placeholder="Ex: 45 dias" /></Field>
            <Field label="Data de assinatura"><Input type="date" value={formOcc.data_assinatura ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ data_assinatura: e.target.value || null })} /></Field>
            <Field label="Mídia"><Input value={formOcc.midia ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ midia: e.target.value })} placeholder="Instagram, Portal, Placa..." /></Field>
            <Field label="Nota fiscal obrigatória"><div className="flex items-center gap-2"><Switch checked={!!formOcc.nota_fiscal_obrigatoria} onCheckedChange={(v) => updOcc({ nota_fiscal_obrigatoria: v })} disabled={!canWrite} /><span className="text-sm text-muted-foreground">{formOcc.nota_fiscal_obrigatoria ? "Sim" : "Não"}</span></div></Field>
            <Field label="Valor anunciado"><Input type="number" step="0.01" value={formOcc.valor_anunciado ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ valor_anunciado: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Valor negociado"><Input type="number" step="0.01" value={formOcc.valor_negociado ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ valor_negociado: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="% Comissão"><Input type="number" step="0.001" value={formOcc.percentual_comissao ?? ""} disabled={!canWrite} onChange={(e) => {
              const p = e.target.value ? Number(e.target.value) : null;
              const neg = Number(formOcc.valor_negociado ?? 0);
              const patch: any = { percentual_comissao: p };
              if (p != null && neg > 0) patch.valor_comissao = Number(((p / 100) * neg).toFixed(2));
              updOcc(patch);
            }} /></Field>
            <Field label="Valor da comissão (total)"><Input type="number" step="0.01" value={formOcc.valor_comissao ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ valor_comissao: e.target.value ? Number(e.target.value) : null })} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Financiamento</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Tem financiamento?"><div className="flex items-center gap-2"><Switch checked={!!formOcc.financiamento} onCheckedChange={(v) => updOcc({ financiamento: v })} disabled={!canWrite} /><span className="text-sm text-muted-foreground">{formOcc.financiamento ? "Sim" : "Não"}</span></div></Field>
            <Field label="Valor financiado"><Input type="number" step="0.01" value={formOcc.financiamento_valor ?? ""} disabled={!canWrite || !formOcc.financiamento} onChange={(e) => updOcc({ financiamento_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Banco"><Input value={formOcc.financiamento_banco ?? ""} disabled={!canWrite || !formOcc.financiamento} onChange={(e) => updOcc({ financiamento_banco: e.target.value })} /></Field>
            <Field label="Correspondente bancário"><Input value={formOcc.financiamento_correspondente ?? ""} disabled={!canWrite || !formOcc.financiamento} onChange={(e) => updOcc({ financiamento_correspondente: e.target.value })} /></Field>
            <Field label="Previsão de liberação"><Input type="date" value={formOcc.financiamento_previsao ?? ""} disabled={!canWrite || !formOcc.financiamento} onChange={(e) => updOcc({ financiamento_previsao: e.target.value || null })} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recebimento da 1ª parcela</CardTitle></CardHeader>
        <CardContent>
          <FieldGrid>
            <Field label="Valor da primeira parcela"><Input type="number" step="0.01" value={formOcc.prev_recebimento_valor ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Data prevista"><Input type="date" value={formOcc.prev_recebimento_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_data: e.target.value || null })} /></Field>
            <Field label="Forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
            <Field label="Observações" colSpan={2}><Textarea value={formOcc.observacoes ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ observacoes: e.target.value })} /></Field>
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
          {formComms.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma comissão adicionada.</p>}
          {formComms.map((c) => (
            <div key={c.id} className="grid grid-cols-1 items-end gap-2 rounded-md border p-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label className="mb-1 block text-xs text-muted-foreground">Papel</Label>
                <Select value={c.papel} onValueChange={(v) => updComm(c.id, { papel: v })} disabled={!canWrite}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMISSAO_PAPEIS.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <Label className="mb-1 block text-xs text-muted-foreground">Nome</Label>
                <Input value={c.nome ?? ""} onChange={(e) => updComm(c.id, { nome: e.target.value })} disabled={!canWrite} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">%</Label>
                <Input type="number" step="0.001" value={c.percentual ?? ""} onChange={(e) => updComm(c.id, { percentual: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} />
              </div>
              <div className="md:col-span-2">
                <Label className="mb-1 block text-xs text-muted-foreground">Valor (R$)</Label>
                <Input type="number" step="0.01" value={c.valor ?? ""} onChange={(e) => updComm(c.id, { valor: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} />
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
          {formPartners.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parceria adicionada.</p>}
          {formPartners.map(p => (
            <div key={p.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-4">
              <Field label="Corretor/Imobiliária"><Input value={p.nome ?? ""} onChange={(e) => updPartner(p.id, { nome: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="CPF/CNPJ"><Input value={p.cpf_cnpj ?? ""} onChange={(e) => updPartner(p.id, { cpf_cnpj: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="%"><Input type="number" step="0.001" value={p.percentual ?? ""} onChange={(e) => updPartner(p.id, { percentual: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} /></Field>
              <Field label="Valor"><Input type="number" step="0.01" value={p.valor ?? ""} onChange={(e) => updPartner(p.id, { valor: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} /></Field>
              <Field label="Banco"><Input value={p.banco ?? ""} onChange={(e) => updPartner(p.id, { banco: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="Agência"><Input value={p.agencia ?? ""} onChange={(e) => updPartner(p.id, { agencia: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="Conta"><Input value={p.conta ?? ""} onChange={(e) => updPartner(p.id, { conta: e.target.value })} disabled={!canWrite} /></Field>
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
