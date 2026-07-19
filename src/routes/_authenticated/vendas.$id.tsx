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
import { SaleFlowStepper } from "@/components/SaleFlowStepper";
import { AgingBadge } from "@/components/AgingBadge";
import { STATUS_LABEL, DOC_TYPES, DOC_PARTE_LABEL, COMISSAO_PAPEIS, validarProntaParaRevisao, proximoResponsavel, type SaleStatus, type DocParte } from "@/lib/status";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileCheck, FileX, CheckCircle2, XCircle, Send, Gavel, DollarSign, AlertTriangle, RotateCcw, Plus, Save, Trash2 } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import { useRouter } from "@tanstack/react-router";
import { extractDocument, applySaleExtractions } from "@/lib/documents.functions";
import { Sparkles, Loader2 } from "lucide-react";

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
  const [aceitaFin, setAceitaFin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState("");
  const [returnTarget, setReturnTarget] = useState<SaleStatus>("devolvida_ajuste");
  const [step, setStep] = useState<string>("documentos");

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

  const router = useRouter();
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [contratoDialogOpen, setContratoDialogOpen] = useState(false);
  const [contratoFile, setContratoFile] = useState<File | null>(null);
  const [contratoUploading, setContratoUploading] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("membro_id")
        .eq("lider_id", user.id);
      setTeamIds(new Set((data ?? []).map((r: any) => r.membro_id)));
    })();
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, p, pay, ba, d, c, h, oc] = await Promise.all([
      supabase.from("sales").select("*").eq("id", id).maybeSingle(),
      supabase.from("sale_parties").select("*").eq("sale_id", id),
      supabase.from("sale_payment").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_bank_accounts").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_documents").select("*").eq("sale_id", id).order("created_at"),
      supabase.from("sale_comments").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("sale_status_history").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("occurrences").select("aceita_financeiro").eq("sale_id", id),
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
    setAceitaFin(((oc.data ?? []) as any[]).some((o) => o.aceita_financeiro));
    setLoading(false);
    if (s.data && user && s.data.corretor_id !== user.id) {
      supabase.from("activity_logs").insert({ sale_id: id, autor_id: user.id, acao: "sale_viewed" }).then(() => {});
    }
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  if (loading || !sale) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  const status = sale.status as SaleStatus;
  const isOwner = sale.corretor_id === user?.id;
  const isFinanceiro = hasAny(["financeiro", "admin", "super_admin"]);
  const isAdminLike = hasAny(["admin", "super_admin"]);
  const isGestor = hasAny(["gestor"]);
  const isJuridico = hasRole("juridico");
  const locked = aceitaFin || status === "ocorrencia_concluida";
  const canDelete = canDeleteSale(user?.id, hasAny, sale, teamIds);

  const onConfirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteSaleCascade(sale.id);
      toast.success("Venda excluída");
      setDeleteOpen(false);
      router.navigate({ to: "/vendas" });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao excluir venda");
    } finally {
      setDeleting(false);
    }
  };

  // Quem pode editar campos (Resumo/Partes/Pagamento/Docs) segundo o estado atual
  const corretorEdits = isOwner && (status === "rascunho" || status === "devolvida_ajuste");
  const gestorEdits = isGestor && ["enviada_revisao","contrato_conferencia_gestor","contrato_ok_corretor","aguardando_assinatura","contrato_assinado","ocorrencia_pendente","ocorrencia_devolvida_gestor"].includes(status);
  const juridicoEdits = isJuridico && ["aprovada_gestor","em_elaboracao_contrato"].includes(status);
  const editable = (corretorEdits || gestorEdits || juridicoEdits || isFinanceiro || isAdminLike) && (!locked || isFinanceiro || isAdminLike);

  // history vem ordenado por created_at desc (ver load()); o primeiro item é a transição que colocou a venda no status atual
  const stageChangedAt = history[0]?.created_at ?? sale.created_at;

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
        await notifyRoles(["gestor"], `Contrato assinado — preencher ocorrência: ${sale.imovel_id ?? sale.codigo_interno ?? sale.id.slice(0, 8)}`);
      }
    }
    toast.success(`Status alterado para "${STATUS_LABEL[next]}"`);
    load();
  };

  const contratoDocs = docs.filter((d) => d.tipo === "contrato");
  const contratoAssinadoDocs = docs.filter((d) => d.tipo === "contrato_assinado");

  const marcarContratoAssinado = async () => {
    if (contratoAssinadoDocs.length === 0) {
      toast.error("Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.");
      return;
    }
    await changeStatus("contrato_assinado");
  };

  const uploadContratoAndSend = async () => {
    if (!contratoFile && contratoDocs.length === 0) {
      toast.error("Anexe o arquivo do contrato antes de enviar.");
      return;
    }
    setContratoUploading(true);
    try {
      if (contratoFile) {
        const ext = contratoFile.name.split(".").pop();
        const path = `${id}/outros/contrato/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("sale-documents").upload(path, contratoFile, { upsert: false });
        if (upErr) { toast.error(`Falha no upload: ${upErr.message}`); return; }
        const { error: insErr } = await supabase.from("sale_documents").insert({
          sale_id: id, tipo: "contrato", parte: "outros", storage_path: path,
          file_name: contratoFile.name, uploaded_by: user!.id, status: "enviado",
        } as any);
        if (insErr) { toast.error(insErr.message); return; }
        await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, acao: "document_uploaded", payload: { tipo: "contrato", parte: "outros" } });
      }
      setContratoDialogOpen(false);
      setContratoFile(null);
      await changeStatus("contrato_conferencia_gestor");
    } finally {
      setContratoUploading(false);
    }
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

  const canOccurrence = ["contrato_assinado","ocorrencia_pendente","ocorrencia_analise_financeiro","ocorrencia_devolvida_gestor","ocorrencia_concluida"].includes(status);
  const canEditOcorrencia = (isGestor && ["contrato_assinado","ocorrencia_pendente","ocorrencia_devolvida_gestor"].includes(status)) || isFinanceiro || isAdminLike;
  const steps: WizardStep[] = [
    {
      key: "documentos",
      label: "1. Documentos",
      content: (
        <DocumentsPanel
          saleId={id}
          docs={docs}
          editable={editable}
          canModerate={isGestor || isJuridico}
          onChange={load}
        />
      ),
    },
    {
      key: "resumo",
      label: "2. Resumo",
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
      label: "3. Partes",
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
      label: "4. Pagamento",
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
      key: "ocorrencia",
      label: "5. Ocorrência",
      disabled: !canOccurrence,
      content: (
        <OccurrencePanel
          saleId={id}
          sale={sale}
          payment={payment}
          parties={parties}
          canEdit={canEditOcorrencia}
          onChange={load}
          registerSaver={(fn) => registerSaver("ocorrencia", fn)}
          onDirtyChange={(d) => setStepDirty("ocorrencia", d)}
        />
      ),
    },
    {
      key: "historico",
      label: "6. Histórico",
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
      label: "7. Comentários",
      content: <CommentsPanel saleId={id} comments={comments} onAdd={load} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm"><Link to="/vendas"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{sale.imovel_id || sale.codigo_interno || `Venda #${sale.id.slice(0, 8)}`}</h1>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Criada em {new Date(sale.created_at).toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Corretor: envio inicial ou reenvio após devolução */}
          {isOwner && (status === "rascunho" || status === "devolvida_ajuste") && (
            <Button onClick={attemptSendForReview}><Send className="mr-2 h-4 w-4" />Enviar ao gestor</Button>
          )}

          {/* Gestor: revisão inicial */}
          {isGestor && status === "enviada_revisao" && (
            <>
              <Button onClick={() => changeStatus("aprovada_gestor")}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar p/ jurídico</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver ao corretor</Button>
            </>
          )}

          {/* Jurídico: aceitar e elaborar */}
          {isJuridico && status === "aprovada_gestor" && (
            <>
              <Button onClick={() => changeStatus("em_elaboracao_contrato")}><Gavel className="mr-2 h-4 w-4" />Iniciar contrato</Button>
              <Button variant="outline" onClick={() => openReturnDialog("enviada_revisao")}><XCircle className="mr-2 h-4 w-4" />Devolver ao gestor</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver ao corretor</Button>
            </>
          )}
          {isJuridico && status === "em_elaboracao_contrato" && (
            <>
              <Button onClick={() => { setContratoFile(null); setContratoDialogOpen(true); }}><Send className="mr-2 h-4 w-4" />Anexar contrato e enviar ao gestor</Button>
              <Button variant="outline" onClick={() => openReturnDialog("enviada_revisao")}><XCircle className="mr-2 h-4 w-4" />Devolver ao gestor</Button>
              <Button variant="outline" onClick={() => openReturnDialog("devolvida_ajuste")}><XCircle className="mr-2 h-4 w-4" />Devolver ao corretor</Button>
            </>
          )}

          {/* Gestor: conferência do contrato */}
          {isGestor && status === "contrato_conferencia_gestor" && (
            <>
              <Button onClick={() => changeStatus("contrato_conferencia_corretor")}><Send className="mr-2 h-4 w-4" />Enviar ao corretor conferir</Button>
              <Button onClick={() => changeStatus("aguardando_assinatura")}><Send className="mr-2 h-4 w-4" />Enviar direto para assinatura</Button>
              <Button variant="outline" onClick={() => openReturnDialog("em_elaboracao_contrato")}><XCircle className="mr-2 h-4 w-4" />Devolver ao jurídico</Button>
            </>
          )}

          {/* Corretor: conferência do contrato */}
          {isOwner && status === "contrato_conferencia_corretor" && (
            <>
              <Button onClick={() => changeStatus("contrato_ok_corretor")}><CheckCircle2 className="mr-2 h-4 w-4" />Dar OK no contrato</Button>
              <Button variant="outline" onClick={() => openReturnDialog("contrato_conferencia_gestor")}><XCircle className="mr-2 h-4 w-4" />Devolver ao gestor</Button>
            </>
          )}

          {/* Gestor: liberar para assinatura */}
          {isGestor && status === "contrato_ok_corretor" && (
            <>
              <Button onClick={() => changeStatus("aguardando_assinatura")}><Send className="mr-2 h-4 w-4" />Enviar para assinatura</Button>
              <Button variant="outline" onClick={() => openReturnDialog("contrato_conferencia_corretor")}><XCircle className="mr-2 h-4 w-4" />Devolver ao corretor</Button>
            </>
          )}

          {/* Gestor: subir contrato assinado (após assinatura) */}
          {isGestor && status === "aguardando_assinatura" && (
            <Button onClick={marcarContratoAssinado}>
              <FileCheck className="mr-2 h-4 w-4" />Marcar contrato assinado
            </Button>
          )}

          {/* Gestor: enviar ocorrência ao financeiro */}
          {isGestor && (status === "ocorrencia_pendente" || status === "ocorrencia_devolvida_gestor") && (
            <Button onClick={() => changeStatus("ocorrencia_analise_financeiro")}>
              <DollarSign className="mr-2 h-4 w-4" />Enviar ocorrência ao financeiro
            </Button>
          )}

          {/* Financeiro: devolver ocorrência (aceite é feito dentro do painel de Ocorrência) */}
          {isFinanceiro && status === "ocorrencia_analise_financeiro" && (
            <Button variant="outline" onClick={() => openReturnDialog("ocorrencia_devolvida_gestor")}>
              <XCircle className="mr-2 h-4 w-4" />Devolver ao gestor
            </Button>
          )}

          {canDelete && (
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />Excluir venda
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta venda?</AlertDialogTitle>
            <AlertDialogDescription>
              <b>{sale.imovel_id || sale.codigo_interno || `Venda #${sale.id.slice(0, 8)}`}</b>
              {" "}será excluída permanentemente. Todos os documentos, partes, pagamentos, comentários e ocorrências relacionados serão removidos. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={onConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Excluindo..." : "Excluir venda"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <Card className="print:hidden">
        <CardContent className="space-y-3 p-4">
          <SaleFlowStepper status={status} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 p-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Próxima etapa</div>
              <div className="font-medium">{proximoResponsavel(status).titulo}</div>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
              <span>Responsável: <span className="font-medium text-foreground">{proximoResponsavel(status).papel}</span></span>
              <AgingBadge since={stageChangedAt} />
            </div>
          </div>
          {locked && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              🔒 <b>Venda travada pelo Financeiro.</b> Corretor, gestor e jurídico ficam em modo leitura. Somente Financeiro, Admin ou Super Admin podem reabrir edições.
            </div>
          )}
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

      {status === "ocorrencia_concluida" ? (
        <SaleReport sale={sale} parties={parties} payment={payment} docs={docs} history={history} canReopen={isFinanceiro} onReopened={load} />
      ) : (
        <Wizard
          steps={steps}
          current={step}
          onChange={setStep}
          dirty={currentDirty}
          onBeforeLeave={onBeforeLeave}
        />
      )}

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

      <Dialog open={contratoDialogOpen} onOpenChange={(o) => { if (!contratoUploading) setContratoDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar contrato</DialogTitle>
            <DialogDescription>
              Envie o arquivo do contrato (PDF, DOC ou DOCX). Após anexar, a venda vai para conferência do gestor.
            </DialogDescription>
          </DialogHeader>

          {contratoDocs.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-1 font-medium">Contrato(s) já anexado(s):</div>
              <ul className="space-y-1 text-muted-foreground">
                {contratoDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="truncate">{d.file_name}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs">Você pode enviar uma nova versão abaixo ou apenas prosseguir com a atual.</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Arquivo do contrato {contratoDocs.length === 0 && <span className="text-destructive">*</span>}</Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setContratoFile(e.target.files?.[0] ?? null)}
              disabled={contratoUploading}
            />
            {contratoFile && (
              <div className="text-xs text-muted-foreground">Selecionado: {contratoFile.name}</div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setContratoDialogOpen(false)} disabled={contratoUploading}>Cancelar</Button>
            <Button
              onClick={uploadContratoAndSend}
              disabled={contratoUploading || (!contratoFile && contratoDocs.length === 0)}
            >
              {contratoUploading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>) : (<><Send className="mr-2 h-4 w-4" />Anexar e enviar ao gestor</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Cabeçalho impresso na "Ocorrência de compra e venda" — dados da imobiliária (letterhead).
const AGENCY_NAME = "IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA";
const AGENCY_CRECI = "CRECI: 29.886-J";

function FormTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border border-b-0 border-foreground/30 bg-muted/60 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">
      <span>{children}</span>
      {right && <span className="font-medium normal-case tracking-normal">{right}</span>}
    </div>
  );
}
function FormTable({ children }: { children: React.ReactNode }) {
  return (
    <table className="mb-4 w-full border-collapse border border-foreground/30 text-sm">
      <tbody>{children}</tbody>
    </table>
  );
}
function FormHeadRow({ cols }: { cols: string[] }) {
  return (
    <tr>
      {cols.map((c, i) => (
        <th key={i} className="border border-foreground/30 bg-muted/40 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {c}
        </th>
      ))}
    </tr>
  );
}
function FormValueRow({ cols }: { cols: React.ReactNode[] }) {
  return (
    <tr>
      {cols.map((c, i) => (
        <td key={i} className="border border-foreground/30 px-2 py-1.5 align-top">
          {c ?? <span className="text-muted-foreground">—</span>}
        </td>
      ))}
    </tr>
  );
}
function Checkbox({ checked, label }: { checked: boolean; label: string }) {
  return <span className="font-mono">({checked ? "X" : " "}) {label}</span>;
}

/** Relatório oficial "Ocorrência de compra e venda" — réplica digital do formulário em papel usado pela imobiliária, exibido em vez do wizard de etapas quando a venda está concluída. */
function SaleReport({ sale, parties, payment, docs, history, canReopen, onReopened }: {
  sale: any; parties: Record<string, any>; payment: any; docs: any[]; history: any[];
  canReopen: boolean; onReopened: () => void;
}) {
  const { user } = useAuth();
  const [occ, setOcc] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [reopening, setReopening] = useState(false);

  const reopen = async () => {
    if (!occ) return;
    const motivo = prompt("Justificativa para reabrir a ocorrência (obrigatório):");
    if (!motivo?.trim()) return;
    setReopening(true);
    try {
      await supabase.from("occurrences").update({
        status: "pendente",
        aceita_financeiro: false,
        aceita_financeiro_em: null,
        aceita_financeiro_por: null,
        reopen_reason: motivo,
        reopened_at: new Date().toISOString(),
        reopened_by: user!.id,
      }).eq("id", occ.id);
      await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", sale.id);
      await supabase.from("sale_status_history").insert({ sale_id: sale.id, de: "ocorrencia_concluida", para: "ocorrencia_pendente", autor_id: user!.id, motivo: `Reaberta: ${motivo}` });
      await supabase.from("activity_logs").insert({ sale_id: sale.id, autor_id: user!.id, acao: "occurrence_reopened", payload: { motivo } });
      if (sale.corretor_id) {
        await supabase.from("notifications").insert({
          user_id: sale.corretor_id, sale_id: sale.id,
          tipo: "occurrence_reopened",
          titulo: "Ocorrência reaberta",
          mensagem: motivo,
        });
      }
      toast.success("Ocorrência reaberta");
      onReopened();
    } finally {
      setReopening(false);
    }
  };

  useEffect(() => {
    (async () => {
      const { data: o } = await supabase.from("occurrences").select("*").eq("sale_id", sale.id).maybeSingle();
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
    })();
  }, [sale.id]);

  if (loading) return <p className="text-sm text-muted-foreground">Carregando relatório...</p>;

  const money = (v: any) => (v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null);
  const dateBR = (v: any) => (v ? new Date(v).toLocaleDateString("pt-BR") : null);
  const vendedores = Object.entries(parties).filter(([papel]) => papel.startsWith("vendedor")).map(([, p]) => p);
  const compradores = Object.entries(parties).filter(([papel]) => papel.startsWith("comprador")).map(([, p]) => p);
  const commByPapel = (papel: string) => commissions.find((c) => c.papel === papel);

  return (
    <div className="space-y-6">
      <div className="print:border print:border-foreground/30 print:p-4">
        <div className="mb-3 flex items-center justify-between border-b pb-2">
          <div>
            <div className="text-sm font-bold">{AGENCY_NAME}</div>
            <div className="text-xs text-muted-foreground">{AGENCY_CRECI}</div>
          </div>
          <div className="flex gap-2 print:hidden">
            {canReopen && occ && (
              <Button variant="outline" size="sm" onClick={reopen} disabled={reopening}>
                <RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
        </div>

        <div className="mb-3 border border-foreground/30 bg-foreground/5 py-2 text-center text-base font-bold uppercase tracking-wide">
          Ocorrência de compra e venda
        </div>

        <FormTable>
          <FormHeadRow cols={["Código do imóvel", "Tempo de venda", "Data de assinatura", "Nota fiscal obrigatória", "Mídia"]} />
          <FormValueRow cols={[
            sale.imovel_id || sale.codigo_interno,
            occ?.tempo_venda,
            dateBR(occ?.data_assinatura),
            <Checkbox checked={!!occ?.nota_fiscal_obrigatoria} label={occ?.nota_fiscal_obrigatoria ? "Sim" : "Não"} />,
            occ?.midia,
          ]} />
        </FormTable>

        {vendedores.map((v: any, i: number) => (
          <FormTable key={v.id ?? i}>
            <FormValueRow cols={[<span><b>Nome do vendedor:</b> {v.nome}</span>, <span><b>E-mail:</b> {v.email}</span>]} />
            <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {v.cpf_cnpj}</span>, <span><b>RG:</b> {v.rg}</span>, <span><b>Celular:</b> {v.telefone}</span>]} />
          </FormTable>
        ))}
        {compradores.map((c: any, i: number) => (
          <FormTable key={c.id ?? i}>
            <FormValueRow cols={[<span><b>Nome do comprador:</b> {c.nome}</span>, <span><b>E-mail:</b> {c.email}</span>]} />
            <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {c.cpf_cnpj}</span>, <span><b>RG:</b> {c.rg}</span>, <span><b>Celular:</b> {c.telefone}</span>]} />
          </FormTable>
        ))}

        <FormTitle>Resumo da transação</FormTitle>
        <FormTable>
          <FormHeadRow cols={["Valor anunciado", "Valor negociado", "Percentual", "Valor da comissão"]} />
          <FormValueRow cols={[money(occ?.valor_anunciado ?? sale.valor_anunciado), money(occ?.valor_negociado ?? sale.valor_negociado), occ?.percentual_comissao ?? sale.percentual_comissao ? `${occ?.percentual_comissao ?? sale.percentual_comissao}%` : null, money(occ?.valor_comissao ?? sale.valor_total_comissao)]} />
        </FormTable>

        <FormTable>
          <FormHeadRow cols={["Papel", "Nome", "Comissão %", "Comissão R$"]} />
          {COMISSAO_PAPEIS.map((p) => {
            const c = commByPapel(p.key);
            return <FormValueRow key={p.key} cols={[p.label, c?.nome ?? "Não possui", c?.percentual != null ? `${c.percentual}%` : "0%", money(c?.valor) ?? "R$ 0,00"]} />;
          })}
        </FormTable>

        <FormTitle right={<Checkbox checked={!!occ?.financiamento} label={occ?.financiamento ? "Sim" : "Não"} />}>
          Dados de financiamento — financiamento
        </FormTitle>
        <FormTable>
          <FormHeadRow cols={["Financiamento R$", "Banco", "Correspondente bancário", "Previsão da liberação do crédito"]} />
          <FormValueRow cols={[money(occ?.financiamento_valor), occ?.financiamento_banco, occ?.financiamento_correspondente, dateBR(occ?.financiamento_previsao)]} />
        </FormTable>

        <FormTitle>Previsão de recebimento da comissão</FormTitle>
        <FormTable>
          <FormHeadRow cols={["1ª parcela", "Data", "Forma de pagamento"]} />
          <FormValueRow cols={[money(occ?.prev_recebimento_valor), dateBR(occ?.prev_recebimento_data), occ?.prev_recebimento_forma]} />
          <FormHeadRow cols={["2ª parcela", "Data", "Forma de pagamento"]} />
          <FormValueRow cols={[money(occ?.prev_recebimento2_valor), dateBR(occ?.prev_recebimento2_data), occ?.prev_recebimento2_forma]} />
          <FormHeadRow cols={["3ª parcela", "Data", "Forma de pagamento"]} />
          <FormValueRow cols={[money(occ?.prev_recebimento3_valor), dateBR(occ?.prev_recebimento3_data), occ?.prev_recebimento3_forma]} />
        </FormTable>

        <FormTitle>Parceria</FormTitle>
        <FormTable>
          <FormHeadRow cols={["Corretor(a) / Imobiliária", "CPF/CNPJ", "Percentual", "Valor da comissão"]} />
          {partners.length === 0 && <FormValueRow cols={["Não possui", null, "0%", "R$ 0,00"]} />}
          {partners.map((p) => (
            <FormValueRow key={p.id} cols={[p.nome, p.cpf_cnpj, p.percentual != null ? `${p.percentual}%` : "0%", money(p.valor) ?? "R$ 0,00"]} />
          ))}
          <FormHeadRow cols={["Dados bancários", "Banco", "Agência", "Conta"]} />
          {partners.length === 0 && <FormValueRow cols={[null, null, null, null]} />}
          {partners.map((p) => (
            <FormValueRow key={`${p.id}-bank`} cols={[null, p.banco, p.agencia, p.conta]} />
          ))}
        </FormTable>

        {occ?.observacoes && (
          <FormTable>
            <FormHeadRow cols={["Observações"]} />
            <FormValueRow cols={[occ.observacoes]} />
          </FormTable>
        )}
      </div>

      <div className="space-y-4 print:hidden">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informações internas (não impressas)</h2>
        <SaleSection title="Documentos">
          <div className="space-y-1">
            {docs.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>}
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>{d.file_name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${d.status === "aprovado" ? "bg-emerald-100 text-emerald-900" : d.status === "recusado" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        </SaleSection>

        <SaleSection title="Histórico">
          <div className="space-y-2">
            {history.length === 0 && <p className="text-sm text-muted-foreground">Sem alterações registradas.</p>}
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span>{h.de ? STATUS_LABEL[h.de as SaleStatus] : "—"} → <span className="font-medium">{STATUS_LABEL[h.para as SaleStatus]}</span></span>
                <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")}</span>
              </div>
            ))}
          </div>
        </SaleSection>
      </div>
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
  const [applying, setApplying] = useState(false);
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const removeDoc = async (doc: any) => {
    setDeleting(true);
    try {
      const { error: stErr } = await supabase.storage.from("sale-documents").remove([doc.storage_path]);
      if (stErr) console.warn("storage remove", stErr.message);
      await supabase.from("document_extractions").delete().eq("document_id", doc.id);
      const { error } = await supabase.from("sale_documents").delete().eq("id", doc.id);
      if (error) { toast.error(error.message); return; }
      await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_deleted", payload: { doc_id: doc.id, tipo: doc.tipo, parte: doc.parte, file_name: doc.file_name } });
      toast.success("Documento excluído");
      setPendingDelete(null);
      onChange();
    } finally {
      setDeleting(false);
    }
  };

  const runExtraction = useCallback(async (documentId: string) => {
    setExtracting((m) => ({ ...m, [documentId]: true }));
    try {
      const res = await extractDocument({ data: { documentId } });
      if (!res.ok) toast.error(`Falha ao ler documento: ${res.error}`);
      else toast.success("Documento lido pela IA");
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao extrair dados");
    } finally {
      setExtracting((m) => ({ ...m, [documentId]: false }));
      onChange();
    }
  }, [onChange]);

  const upload = async (tipo: string, parte: DocParte, file: File) => {
    const ext = file.name.split(".").pop();
    const path = `${saleId}/${parte}/${tipo}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("sale-documents").upload(path, file, { upsert: false });
    if (error) { toast.error(error.message); return; }
    const { data: inserted, error: insErr } = await supabase.from("sale_documents").insert({
      sale_id: saleId, tipo, parte, storage_path: path, file_name: file.name,
      uploaded_by: user!.id, status: "enviado",
    } as any).select("id").single();
    if (insErr) { toast.error(insErr.message); return; }
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_uploaded", payload: { tipo, parte } });
    toast.success("Documento enviado");
    onChange();
    // IA só roda quando o usuário clicar em "Aplicar dados aos campos".
    void inserted;
  };

  const download = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 60);
    if (error || !data) { toast.error("Falha ao gerar link"); return; }
    window.open(data.signedUrl, "_blank");
  };
  const approve = async (doc: any) => {
    const { error } = await supabase.from("sale_documents").update({ status: "aprovado", motivo_recusa: null }).eq("id", doc.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_approved", payload: { doc_id: doc.id, tipo: doc.tipo } });
    onChange();
  };
  const reject = async (doc: any) => {
    const motivo = prompt("Motivo da recusa (obrigatório):");
    if (!motivo?.trim()) return;
    const { error } = await supabase.from("sale_documents").update({ status: "recusado", motivo_recusa: motivo }).eq("id", doc.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("sale_comments").insert({ sale_id: saleId, autor_id: user!.id, escopo: "revisao", texto: `Documento recusado: ${motivo}`, doc_id: doc.id });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_rejected", payload: { doc_id: doc.id, tipo: doc.tipo, motivo } });
    // Notificar o corretor da venda
    const { data: sale } = await supabase.from("sales").select("corretor_id, imovel_id, codigo_interno").eq("id", saleId).maybeSingle();
    if (sale?.corretor_id) {
      await supabase.from("notifications").insert({
        user_id: sale.corretor_id, sale_id: saleId,
        tipo: "document_rejected",
        titulo: `Documento recusado: ${doc.tipo}`,
        mensagem: motivo,
      });
    }
    onChange();
  };

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const applyAll = async () => {
    setApplying(true);
    setProgress(null);
    try {
      // 1) Lê todos os docs que ainda não foram extraídos com sucesso
      const pendentes = docs.filter((d) => d.extraction_status !== "done");
      let lidos = 0;
      let falhas = 0;
      if (pendentes.length > 0) {
        setProgress({ done: 0, total: pendentes.length });
        // marca todos como "IA lendo" no UI
        setExtracting((m) => {
          const next = { ...m };
          for (const d of pendentes) next[d.id] = true;
          return next;
        });
        const results = await Promise.allSettled(
          pendentes.map(async (d) => {
            try {
              const res = await extractDocument({ data: { documentId: d.id } });
              return res.ok;
            } finally {
              setExtracting((m) => ({ ...m, [d.id]: false }));
              setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
            }
          }),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) lidos++;
          else falhas++;
        }
        onChange();
      }

      // 2) Aplica os dados extraídos aos campos
      const res = await applySaleExtractions({ data: { saleId } });
      const partes = [];
      if (lidos) partes.push(`${lidos} doc(s) lido(s) pela IA`);
      if (falhas) partes.push(`${falhas} falha(s) na leitura`);
      if (res.filled.length) partes.push(`${res.filled.length} campo(s) preenchido(s)`);
      if (partes.length === 0) toast.info("Nenhum campo novo para preencher");
      else if (falhas) toast.warning(partes.join(" • "));
      else toast.success(partes.join(" • "));
      onChange();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao aplicar dados");
    } finally {
      setApplying(false);
      setProgress(null);
    }
  };

  const anyPending = Object.values(extracting).some(Boolean);

  // Blocos por parte da venda. Compradores/vendedores extras aparecem sob demanda
  // (a IA usa a parte declarada em cada upload para rotear os dados extraídos).
  const [showComprador2, setShowComprador2] = useState<boolean>(
    docs.some(d => d.parte === "comprador_2")
  );
  const [showVendedor2, setShowVendedor2] = useState<boolean>(
    docs.some(d => d.parte === "vendedor_2")
  );
  useEffect(() => {
    if (docs.some(d => d.parte === "comprador_2")) setShowComprador2(true);
    if (docs.some(d => d.parte === "vendedor_2")) setShowVendedor2(true);
  }, [docs]);

  const pessoalTipos = DOC_TYPES.filter(t => t.grupo === "pessoal");
  const blocos: { parte: DocParte; tipos: typeof DOC_TYPES }[] = [
    { parte: "comprador_1", tipos: pessoalTipos },
    ...(showComprador2 ? [{ parte: "comprador_2" as DocParte, tipos: pessoalTipos }] : []),
    { parte: "vendedor_1", tipos: pessoalTipos },
    ...(showVendedor2 ? [{ parte: "vendedor_2" as DocParte, tipos: pessoalTipos }] : []),
    { parte: "imovel", tipos: DOC_TYPES.filter(t => t.grupo === "imovel") },
    { parte: "outros", tipos: DOC_TYPES.filter(t => t.grupo === "outros") },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
            <div className="text-sm">
              <div className="font-medium">Leitura automática por IA</div>
              <p className="text-muted-foreground">
                Envie os documentos de cada pessoa no bloco correspondente. Até 2 compradores e 2 vendedores. A IA lê cada arquivo e roteia os dados para a pessoa certa nas próximas etapas.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={applyAll} disabled={docs.length === 0 || applying || !editable}>
            {applying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {progress ? `Lendo ${progress.done}/${progress.total}...` : "Aplicando..."}
              </>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" />Ler documentos e aplicar dados</>
            )}
          </Button>
        </CardContent>
        {anyPending && !applying && (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Lendo documento(s)...
          </CardContent>
        )}
      </Card>

      {blocos.map(({ parte, tipos }) => {
        if (tipos.length === 0) return null;
        const parteAccent =
          parte === "comprador_1" || parte === "comprador_2" ? "border-l-4 border-l-blue-500" :
          parte === "vendedor_1" || parte === "vendedor_2" ? "border-l-4 border-l-amber-500" :
          parte === "imovel" ? "border-l-4 border-l-emerald-500" : "";
        return (
          <section key={parte} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{DOC_PARTE_LABEL[parte]}</h3>
              {editable && parte === "comprador_2" && (
                <Button size="sm" variant="ghost" onClick={() => setShowComprador2(false)} disabled={docs.some(d => d.parte === "comprador_2")}>Remover 2º comprador</Button>
              )}
              {editable && parte === "vendedor_2" && (
                <Button size="sm" variant="ghost" onClick={() => setShowVendedor2(false)} disabled={docs.some(d => d.parte === "vendedor_2")}>Remover 2º vendedor</Button>
              )}
            </div>
            {tipos.map((t) => {
              const list = docs.filter(d => d.tipo === t.key && (d.parte ?? "outros") === parte);
              const latest = list[list.length - 1];
              return (
                <Card key={`${parte}-${t.key}`} className={parteAccent}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{t.label}{t.obrigatorio && parte === "comprador_1" || (t.obrigatorio && parte === "vendedor_1") ? <span className="ml-1 text-destructive">*</span> : null}</div>
                        {t.obrigatorio && (parte === "comprador_1" || parte === "vendedor_1") && <div className="text-xs text-muted-foreground">Obrigatório</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {latest && <DocStatusBadge status={latest.status} />}
                        {editable && (
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                            <Upload className="h-4 w-4" />
                            <span>{latest?.status === "recusado" ? "Reenviar" : "Enviar"}</span>
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(t.key, parte, e.target.files[0])} />
                          </label>
                        )}
                      </div>
                    </div>
                    {latest?.status === "recusado" && latest.motivo_recusa && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                        <b>Motivo da recusa:</b> {latest.motivo_recusa}
                      </div>
                    )}
                    {list.map((d) => (
                      <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-2 text-sm">
                        <button className="truncate text-left hover:underline" onClick={() => download(d)}>{d.file_name}</button>
                        <div className="flex items-center gap-2">
                          <ExtractionBadge status={d.extraction_status} loading={!!extracting[d.id]} />
                          {editable && d.extraction_status !== "pending" && !extracting[d.id] && (
                            <Button size="sm" variant="ghost" title="Ler novamente com IA" onClick={() => runExtraction(d.id)}>
                              <Sparkles className="h-4 w-4" />
                            </Button>
                          )}
                          <DocStatusBadge status={d.status} />
                          {canModerate && d.status !== "aprovado" && (
                            <Button size="sm" variant="ghost" onClick={() => approve(d)}><FileCheck className="h-4 w-4" /></Button>
                          )}
                          {canModerate && d.status !== "recusado" && (
                            <Button size="sm" variant="ghost" onClick={() => reject(d)}><FileX className="h-4 w-4" /></Button>
                          )}
                          {editable && (d.uploaded_by === user?.id || canModerate) && (
                            <Button size="sm" variant="ghost" title="Excluir documento" onClick={() => setPendingDelete(d)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
            {editable && parte === "comprador_1" && !showComprador2 && (
              <Button size="sm" variant="outline" onClick={() => setShowComprador2(true)}>+ Adicionar 2º comprador</Button>
            )}
            {editable && parte === "vendedor_1" && !showVendedor2 && (
              <Button size="sm" variant="outline" onClick={() => setShowVendedor2(true)}>+ Adicionar 2º vendedor</Button>
            )}
          </section>
        );
      })}

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.file_name} será removido permanentemente. Depois disso você pode enviar um novo arquivo — a IA fará a leitura novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(e) => { e.preventDefault(); if (pendingDelete) removeDoc(pendingDelete); }}>
              {deleting ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExtractionBadge({ status, loading }: { status?: string; loading?: boolean }) {
  if (loading || status === "pending") return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-900"><Loader2 className="h-3 w-3 animate-spin" />IA lendo</span>;
  if (status === "done") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900"><Sparkles className="h-3 w-3" />IA ok</span>;
  if (status === "failed") return <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">IA falhou</span>;
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Aguardando IA</span>;
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
      const fields = ["codigo_imovel","tempo_venda","data_assinatura","midia","nota_fiscal_obrigatoria","valor_anunciado","valor_negociado","percentual_comissao","valor_comissao","financiamento","financiamento_valor","financiamento_banco","financiamento_correspondente","financiamento_previsao","prev_recebimento_valor","prev_recebimento_data","prev_recebimento_forma","prev_recebimento2_valor","prev_recebimento2_data","prev_recebimento2_forma","prev_recebimento3_valor","prev_recebimento3_data","prev_recebimento3_forma","observacoes"];
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

  const canFinLock = hasAny(["financeiro", "admin", "super_admin"]);

  const toggleAceite = async () => {
    if (!canFinLock) { toast.error("Somente financeiro/admin/super admin"); return; }
    const novo = !occ.aceita_financeiro;
    const patch: any = novo
      ? { aceita_financeiro: true, aceita_financeiro_em: new Date().toISOString(), aceita_financeiro_por: user!.id }
      : { aceita_financeiro: false, aceita_financeiro_em: null, aceita_financeiro_por: null };
    const { error } = await supabase.from("occurrences").update(patch).eq("id", occ.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: novo ? "occurrence_locked" : "occurrence_unlocked" });
    toast.success(novo ? "Ocorrência travada para edição" : "Edição liberada");
    onChange();
  };

  const reopen = async () => {
    if (!canFinLock) { toast.error("Somente financeiro/admin/super admin podem reabrir"); return; }
    const motivo = prompt("Justificativa para reabrir a ocorrência (obrigatório):");
    if (!motivo?.trim()) return;
    await supabase.from("occurrences").update({
      status: "pendente",
      aceita_financeiro: false,
      aceita_financeiro_em: null,
      aceita_financeiro_por: null,
      reopen_reason: motivo,
      reopened_at: new Date().toISOString(),
      reopened_by: user!.id,
    }).eq("id", occ.id);
    await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", saleId);
    await supabase.from("sale_status_history").insert({ sale_id: saleId, de: "ocorrencia_concluida", para: "ocorrencia_pendente", autor_id: user!.id, motivo: `Reaberta: ${motivo}` });
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "occurrence_reopened", payload: { motivo } });
    const { data: s } = await supabase.from("sales").select("corretor_id").eq("id", saleId).maybeSingle();
    if (s?.corretor_id) {
      await supabase.from("notifications").insert({
        user_id: s.corretor_id, sale_id: saleId,
        tipo: "occurrence_reopened",
        titulo: "Ocorrência reaberta",
        mensagem: motivo,
      });
    }
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
        <CardHeader><CardTitle className="text-base">Previsão de recebimento da comissão</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <FieldGrid>
            <Field label="1ª parcela — valor"><Input type="number" step="0.01" value={formOcc.prev_recebimento_valor ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="1ª parcela — data"><Input type="date" value={formOcc.prev_recebimento_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_data: e.target.value || null })} /></Field>
            <Field label="1ª parcela — forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
          </FieldGrid>
          <FieldGrid>
            <Field label="2ª parcela — valor"><Input type="number" step="0.01" value={formOcc.prev_recebimento2_valor ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento2_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="2ª parcela — data"><Input type="date" value={formOcc.prev_recebimento2_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento2_data: e.target.value || null })} /></Field>
            <Field label="2ª parcela — forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento2_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento2_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
          </FieldGrid>
          <FieldGrid>
            <Field label="3ª parcela — valor"><Input type="number" step="0.01" value={formOcc.prev_recebimento3_valor ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento3_valor: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="3ª parcela — data"><Input type="date" value={formOcc.prev_recebimento3_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento3_data: e.target.value || null })} /></Field>
            <Field label="3ª parcela — forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento3_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento3_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
          </FieldGrid>
          <FieldGrid>
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
        {canFinLock && (
          <Button variant={occ.aceita_financeiro ? "outline" : "default"} onClick={toggleAceite}>
            {occ.aceita_financeiro ? "Liberar edições" : "Aceitar e travar (Financeiro)"}
          </Button>
        )}
        {canFinLock && concluida && (
          <Button variant="outline" onClick={reopen}><RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência</Button>
        )}
      </div>
    </div>
  );
}
