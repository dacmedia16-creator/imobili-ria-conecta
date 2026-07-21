import { createFileRoute } from "@tanstack/react-router";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/StatusBadge";
import { SaleFlowStepper } from "@/components/SaleFlowStepper";
import { AgingBadge } from "@/components/AgingBadge";
import { STATUS_LABEL, DOC_TYPES, COMISSAO_PAPEIS, validarProntaParaRevisao, proximoResponsavel, docSatisfazObrigatorio, temDocDoTipo, chegouAoJuridico, parteLabel, parteBase, parteSortKey, CHECKS_NAO_DOCUMENTAIS, type SaleStatus, type DocParte } from "@/lib/status";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileCheck, FileX, CheckCircle2, XCircle, Send, Gavel, DollarSign, AlertTriangle, RotateCcw, Plus, Trash2, History, MessageSquare, Eye, Printer, Download, ZoomIn, ZoomOut, FileText, ChevronRight, ChevronLeft } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import { useRouter } from "@tanstack/react-router";
import { extractDocument, applySaleExtractions } from "@/lib/documents.functions";
import { Sparkles, Loader2 } from "lucide-react";
import { PDFDocument } from "pdf-lib";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  head: () => ({ meta: [{ title: "Detalhe da venda" }] }),
  component: SaleDetail,
});

type Saver = () => Promise<boolean>;

const AUTOSAVE_DELAY_MS = 1200;

// Salva sozinho X ms depois da última alteração, sem precisar de clique em "Salvar".
// O delay evita gravar valor pela metade enquanto a pessoa ainda está digitando, e o
// savingRef evita disparar um novo save por cima de um que ainda não terminou.
function useAutosave(dirty: boolean, deps: readonly unknown[], saveFn: () => Promise<boolean>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      try { await saveFn(); } finally { savingRef.current = false; }
    }, AUTOSAVE_DELAY_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, ...deps]);
}

function AutosaveStatus({ saving, dirty }: { saving: boolean; dirty: boolean }) {
  if (saving) return <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Salvando...</div>;
  if (dirty) return <div className="text-xs text-muted-foreground">Alterações pendentes — salvando em instantes...</div>;
  return null;
}

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
  const [approveJuridicoOpen, setApproveJuridicoOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnMotivo, setReturnMotivo] = useState("");
  const [returnTarget, setReturnTarget] = useState<SaleStatus>("devolvida_ajuste");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveMotivo, setArchiveMotivo] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<"arquivada" | "cancelada">("arquivada");
  const [step, setStep] = useState<string>("documentos");
  const [activeResumoBlock, setActiveResumoBlock] = useState("imovel");

  // Assim que a venda carrega, se ela já estiver na fase de ocorrência/financeiro, abre direto
  // na aba "Ocorrência" em vez de "Documentos" — nessa altura os outros passos já foram
  // preenchidos e não é o que quem está revisando (gestor/financeiro) precisa ver primeiro.
  const initialStepSetRef = useRef(false);
  useEffect(() => {
    if (initialStepSetRef.current || !sale) return;
    initialStepSetRef.current = true;
    const statusEsperandoOcorrencia = ["contrato_assinado", "ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_devolvida_gestor", "ocorrencia_concluida"];
    if (statusEsperandoOcorrencia.includes(sale.status)) setStep("ocorrencia");
  }, [sale]);

  // Buffered Resumo form
  const [formSale, setFormSale] = useState<any>({});
  const [dirtyResumo, setDirtyResumo] = useState(false);
  const [commissionExtras, setCommissionExtras] = useState<any[]>([]);
  const [formExtras, setFormExtras] = useState<any[]>([]);
  const [dirtyExtras, setDirtyExtras] = useState(false);

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
  const [contratoAssinadoDialogOpen, setContratoAssinadoDialogOpen] = useState(false);
  const [contratoAssinadoFile, setContratoAssinadoFile] = useState<File | null>(null);
  const [contratoAssinadoUploading, setContratoAssinadoUploading] = useState(false);

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

  const [lideres, setLideres] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    if (!sale?.corretor_id) return;
    (async () => {
      const { data: tm } = await supabase.from("team_members").select("lider_id").eq("membro_id", sale.corretor_id);
      const liderIds = Array.from(new Set((tm ?? []).map((r: any) => r.lider_id)));
      if (liderIds.length === 0) { setLideres([]); return; }
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", liderIds);
      setLideres((profs ?? []).map((p: any) => ({ id: p.id, nome: p.nome ?? p.id })));
    })();
  }, [sale?.corretor_id]);

  const hasLoadedOnceRef = useRef(false);
  const load = useCallback(async () => {
    // Só mostra a tela cheia de "Carregando..." na primeira vez — em recargas depois de uma ação
    // (enviar documento, salvar, etc.) isso desmontava a página inteira e resetava a aba/bloco
    // ativo de cada etapa (Documentos, Resumo, Partes, Pagamento) de volta pro padrão.
    if (!hasLoadedOnceRef.current) setLoading(true);
    const [s, p, pay, ba, d, c, h, oc, ce] = await Promise.all([
      supabase.from("sales").select("*").eq("id", id).maybeSingle(),
      supabase.from("sale_parties").select("*").eq("sale_id", id),
      supabase.from("sale_payment").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_bank_accounts").select("*").eq("sale_id", id).maybeSingle(),
      supabase.from("sale_documents").select("*").eq("sale_id", id).order("created_at"),
      supabase.from("sale_comments").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("sale_status_history").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("occurrences").select("aceita_financeiro").eq("sale_id", id),
      supabase.from("sale_commission_extras").select("*").eq("sale_id", id).order("created_at"),
    ]);
    setSale(s.data);
    setFormSale(s.data ?? {});
    setDirtyResumo(false);
    setCommissionExtras(ce.data ?? []);
    setFormExtras(ce.data ?? []);
    setDirtyExtras(false);
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
    hasLoadedOnceRef.current = true;
    if (s.data && user && s.data.corretor_id !== user.id) {
      supabase.from("activity_logs").insert({ sale_id: id, autor_id: user.id, acao: "sale_viewed" }).then(() => {});
    }
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  // Definida aqui (antes do "return" de carregamento abaixo) porque useAutosave chama hooks
  // (useEffect/useRef) — se ficasse depois do guard de loading, a ordem dos hooks mudaria entre
  // o primeiro render (carregando) e os seguintes, o que quebra as regras dos hooks do React.
  const saveResumo = async (): Promise<boolean> => {
    if (!sale) return false;
    setSaving(true);
    try {
    const fields = [
      "imovel_id","matricula","iptu","codigo_interno","imovel_observacoes",
      "corretor_captador","corretor_vendedor","indicador",
      "valor_anunciado","valor_negociado","percentual_comissao","valor_total_comissao",
      "valor_comissao_captador","valor_comissao_vendedor","valor_comissao_imobiliaria",
      "percentual_comissao_captador","percentual_comissao_vendedor",
      "valor_comissao_indicador","percentual_comissao_indicador","indicador_lado",
      "forma_pagamento","negociacao_observacoes","posse_data","posse_observacoes",
      "coordenador_id","team_leader_id",
    ];
    const patch: any = {};
    for (const k of fields) {
      const v = formSale?.[k];
      const orig = sale?.[k];
      if ((v ?? null) !== (orig ?? null)) patch[k] = v === "" ? null : v;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("sales").update(patch).eq("id", id);
      if (error) { toast.error(error.message); return false; }
    }
    // Extras resolvidos com id real do banco — usado pra sincronizar com a Ocorrência logo abaixo.
    // Sem isso, um extra recém-criado ainda estaria com o id temporário ("new-...") nesse ponto.
    let resolvedExtras = formExtras;
    if (dirtyExtras) {
      const currentIds = new Set(formExtras.filter(r => !r._new).map(r => r.id));
      const removed = commissionExtras.filter(r => !currentIds.has(r.id));
      for (const r of removed) {
        const { error } = await supabase.from("sale_commission_extras").delete().eq("id", r.id);
        if (error) { toast.error(error.message); return false; }
      }
      resolvedExtras = [...formExtras];
      for (let i = 0; i < resolvedExtras.length; i++) {
        const r = resolvedExtras[i];
        const data = { nome: r.nome || null, origem: r.origem, papel: r.papel || null, percentual: r.percentual ?? null, valor: r.valor ?? null };
        if (r._new) {
          const { data: inserted, error } = await supabase.from("sale_commission_extras").insert({ sale_id: id, ...data }).select("id").single();
          if (error) { toast.error(error.message); return false; }
          resolvedExtras[i] = { ...r, id: inserted.id, _new: false };
        } else {
          const { error } = await supabase.from("sale_commission_extras").update(data).eq("id", r.id);
          if (error) { toast.error(error.message); return false; }
        }
      }
    }
    if (Object.keys(patch).length === 0 && !dirtyExtras) { setDirtyResumo(false); return true; }
    try {
      await syncOccurrenceCommissions(id, { ...sale, ...formSale }, resolvedExtras);
    } catch (err: any) {
      console.warn("syncOccurrenceCommissions", err?.message);
    }
    setDirtyResumo(false);
    setDirtyExtras(false);
    await load();
    return true;
    } finally {
      setSaving(false);
    }
  };
  // Sem "editable &&" aqui de propósito: os campos só ficam dirty se o usuário conseguiu editá-los
  // (inputs desabilitados não disparam onChange), e "editable" só existe depois do guard abaixo.
  useAutosave(dirtyResumo || dirtyExtras, [formSale, formExtras], saveResumo);

  const anyDirtyAnywhere = dirtyResumo || dirtyExtras || Object.values(dirtyMap).some(Boolean);

  // Avisa o navegador (fechar aba, atualizar, digitar outra URL) se ainda tem algo pendente de
  // salvar — o autosave cobre a digitação em si, mas não cobre sair da página no meio do caminho.
  // Precisa ficar antes do guard de loading abaixo: é um hook (useEffect) e a ordem dos hooks não
  // pode mudar entre o primeiro render (carregando) e os seguintes.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (anyDirtyAnywhere) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirtyAnywhere]);

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
  const totalChecks = CHECKS_NAO_DOCUMENTAIS.length + DOC_TYPES.filter(t => t.obrigatorio).length;
  const progress = Math.round(((totalChecks - pendencias.length) / totalChecks) * 100);
  const requiredTypes = DOC_TYPES.map(d => d.key);
  const docsApproved = requiredTypes.filter(t => docs.some(d => d.tipo === t && d.status === "aprovado")).length;


  const logActivity = async (acao: string, payload?: any) => {
    await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, acao, payload: payload ?? null });
  };

  // ---- Resumo (buffered) save ----
  const updResumo = (patch: any) => { setFormSale((f: any) => ({ ...f, ...patch })); setDirtyResumo(true); };
  const COMISSAO_ROLES = ["captador", "vendedor"] as const;
  type ComissaoRole = (typeof COMISSAO_ROLES)[number];
  // Imobiliária = total menos captador e vendedor. O indicador NÃO desconta daqui — a comissão dele
  // sai de dentro da fatia do captador ou do vendedor (indicador_lado), não é uma 3ª fatia do total.
  const recalcImobiliaria = (patch: any) => {
    const total = Number(patch.valor_total_comissao ?? formSale.valor_total_comissao ?? 0);
    const soma = COMISSAO_ROLES.reduce((s, r) => s + Number(patch[`valor_comissao_${r}`] ?? formSale[`valor_comissao_${r}`] ?? 0), 0);
    return Number((total - soma).toFixed(2));
  };
  // Recalcula a comissão do indicador (em R$) a partir do % já definido, sempre que a fatia do
  // lado ao qual ele está vinculado (captador/vendedor) mudar de valor.
  const recalcIndicadorFromLado = (patch: any) => {
    const lado = patch.indicador_lado ?? formSale.indicador_lado;
    if (!lado) return { valor_comissao_indicador: null };
    const ladoValor = Number(patch[`valor_comissao_${lado}`] ?? formSale[`valor_comissao_${lado}`] ?? 0);
    const p = formSale.percentual_comissao_indicador ?? 25;
    return { valor_comissao_indicador: ladoValor > 0 ? Number(((p / 100) * ladoValor).toFixed(2)) : null };
  };
  // A soma das comissões de captador + vendedor nunca pode passar do valor total da comissão —
  // cada mudança é limitada (clamp) ao que ainda resta disponível para o outro lado.
  const applyComissaoPercentual = (role: ComissaoRole, raw: string) => {
    let p = raw ? Number(raw) : null;
    const total = Number(formSale.valor_total_comissao ?? 0);
    const outro = COMISSAO_ROLES.filter((r) => r !== role).reduce((s, r) => s + Number(formSale[`valor_comissao_${r}`] ?? 0), 0);
    let valor = p != null && total > 0 ? Number(((p / 100) * total).toFixed(2)) : (formSale[`valor_comissao_${role}`] ?? null);
    if (total > 0 && valor != null) {
      const max = Math.max(0, Number((total - outro).toFixed(2)));
      if (valor > max) { valor = max; p = Number(((max / total) * 100).toFixed(3)); }
    }
    const patch: any = { [`percentual_comissao_${role}`]: p, [`valor_comissao_${role}`]: valor };
    patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
    Object.assign(patch, recalcIndicadorFromLado(patch));
    updResumo(patch);
  };
  const applyComissaoValor = (role: ComissaoRole, v: number | null) => {
    const total = Number(formSale.valor_total_comissao ?? 0);
    const outro = COMISSAO_ROLES.filter((r) => r !== role).reduce((s, r) => s + Number(formSale[`valor_comissao_${r}`] ?? 0), 0);
    let valor = v;
    let p = formSale[`percentual_comissao_${role}`] ?? null;
    if (total > 0 && valor != null) {
      const max = Math.max(0, Number((total - outro).toFixed(2)));
      if (valor > max) valor = max;
      p = Number(((valor / total) * 100).toFixed(3));
    }
    const patch: any = { [`valor_comissao_${role}`]: valor, [`percentual_comissao_${role}`]: p };
    patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
    Object.assign(patch, recalcIndicadorFromLado(patch));
    updResumo(patch);
  };
  // Indicador: comissão calculada sobre a fatia do lado escolhido (captador/vendedor), não sobre o total.
  const indicadorLadoValor = () => {
    const lado = formSale.indicador_lado;
    if (lado === "captador" || lado === "vendedor") return Number(formSale[`valor_comissao_${lado}`] ?? 0);
    return 0;
  };
  const applyIndicadorLado = (lado: "captador" | "vendedor" | null) => {
    const ladoValor = lado === "captador" ? Number(formSale.valor_comissao_captador ?? 0) : lado === "vendedor" ? Number(formSale.valor_comissao_vendedor ?? 0) : 0;
    const p = formSale.percentual_comissao_indicador ?? 25;
    const valor = lado && ladoValor > 0 ? Number(((p / 100) * ladoValor).toFixed(2)) : null;
    updResumo({ indicador_lado: lado, percentual_comissao_indicador: lado ? p : null, valor_comissao_indicador: valor });
  };
  const applyIndicadorPercentual = (raw: string) => {
    let p = raw ? Number(raw) : null;
    const ladoValor = indicadorLadoValor();
    let valor = p != null && ladoValor > 0 ? Number(((p / 100) * ladoValor).toFixed(2)) : null;
    if (valor != null && ladoValor > 0) {
      valor = Math.min(valor, ladoValor);
      p = Number(((valor / ladoValor) * 100).toFixed(3));
    }
    updResumo({ percentual_comissao_indicador: p, valor_comissao_indicador: valor });
  };
  const applyIndicadorValor = (v: number | null) => {
    const ladoValor = indicadorLadoValor();
    let valor = v;
    if (valor != null) valor = Math.max(0, Math.min(valor, ladoValor));
    const p = valor != null && ladoValor > 0 ? Number(((valor / ladoValor) * 100).toFixed(3)) : formSale.percentual_comissao_indicador ?? null;
    updResumo({ valor_comissao_indicador: valor, percentual_comissao_indicador: p });
  };
  // Partes extras da divisão de comissão: cada uma escolhe de qual fatia (imobiliária/captador/vendedor)
  // o valor sai. O valor líquido de cada fatia (mostrado nos campos "Líquido...") já desconta a soma
  // das partes extras vinculadas a ela, pra bater com o que de fato sobra pra cada um.
  const somaExtrasPorOrigem = (origem: string) => formExtras.reduce((s, e) => s + (e.origem === origem ? Number(e.valor ?? 0) : 0), 0);
  const baseParaOrigem = (origem: string) => {
    if (origem === "captador") return Number(formSale.valor_comissao_captador ?? 0);
    if (origem === "vendedor") return Number(formSale.valor_comissao_vendedor ?? 0);
    return Number(formSale.valor_comissao_imobiliaria ?? 0);
  };
  const updExtra = (rowId: string, patch: any) => {
    setFormExtras(rows => rows.map(r => {
      if (r.id !== rowId) return r;
      const merged = { ...r, ...patch };
      const base = baseParaOrigem(merged.origem);
      if ("percentual" in patch) {
        let p = patch.percentual === "" || patch.percentual == null ? null : Number(patch.percentual);
        let valor = p != null && base > 0 ? Number(((p / 100) * base).toFixed(2)) : null;
        if (valor != null && base > 0) { valor = Math.min(valor, base); p = Number(((valor / base) * 100).toFixed(3)); }
        merged.percentual = p; merged.valor = valor;
      } else if ("valor" in patch) {
        let valor = patch.valor;
        if (valor != null && base > 0) valor = Math.max(0, Math.min(valor, base));
        const p = valor != null && base > 0 ? Number(((valor / base) * 100).toFixed(3)) : merged.percentual ?? null;
        merged.valor = valor; merged.percentual = p;
      } else if ("origem" in patch) {
        merged.valor = merged.percentual != null && base > 0 ? Number(((Number(merged.percentual) / 100) * base).toFixed(2)) : (base > 0 ? merged.valor : null);
      }
      return merged;
    }));
    setDirtyExtras(true);
  };
  const addExtra = () => {
    setFormExtras(rows => [...rows, { id: `new-${crypto.randomUUID()}`, sale_id: id, nome: "", papel: null, origem: "imobiliaria", percentual: null, valor: null, _new: true }]);
    setDirtyExtras(true);
  };
  const delExtra = (rowId: string) => {
    setFormExtras(rows => rows.filter(r => r.id !== rowId));
    setDirtyExtras(true);
  };
  const notifyRoles = async (rolesToNotify: string[], titulo: string, mensagem?: string) => {
    const { data: users } = await supabase.from("user_roles").select("user_id").in("role", rolesToNotify as any);
    const uniqIds = Array.from(new Set((users ?? []).map((u: any) => u.user_id)));
    if (uniqIds.length === 0) return;
    await supabase.from("notifications").insert(uniqIds.map(uid => ({
      user_id: uid, sale_id: id, tipo: "status_change", titulo, mensagem: mensagem ?? null,
    })));
  };

  // Garante que nada digitado em qualquer etapa fica pra trás antes de mudar o status (enviar
  // pra outro papel). Sem isso, um campo preenchido mas ainda não salvo — o autosave ainda não
  // tinha disparado, ou a pessoa clicou direto num botão do topo (ex.: "Enviar ao gestor") sem
  // passar pela troca de aba que aciona o save — sumia quando a venda passava adiante.
  const flushAllDirty = async (): Promise<boolean> => {
    if (dirtyResumo || dirtyExtras) {
      const ok = await saveResumo();
      if (!ok) return false;
    }
    for (const key of Object.keys(dirtyMap)) {
      if (!dirtyMap[key]) continue;
      const fn = saversRef.current[key];
      if (fn) {
        const ok = await fn();
        if (!ok) return false;
      }
    }
    return true;
  };

  const changeStatus = async (next: SaleStatus, motivo?: string) => {
    if (!(await flushAllDirty())) return;
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

  // Atalho pra abrir o contrato direto do topo da página — sem isso o contrato só existia
  // dentro de Documentos > Outros, e quem recebia a venda de volta (gestor/corretor) tinha
  // que caçar em qual aba/bloco ele tinha sido anexado.
  const abrirContratoRapido = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 300);
    if (error || !data) { toast.error("Falha ao gerar link do contrato"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const marcarContratoAssinado = async () => {
    if (contratoAssinadoDocs.length === 0) {
      toast.error("Suba o contrato assinado antes de marcar como assinado.");
      return;
    }
    await changeStatus("contrato_assinado");
  };

  // Anexar o contrato NÃO envia a venda ao gestor sozinho — o jurídico confere o arquivo
  // e só então clica em "Enviar ao gestor" (botão separado, fora deste dialog).
  const uploadContrato = async () => {
    if (!contratoFile) {
      toast.error("Selecione o arquivo do contrato.");
      return;
    }
    setContratoUploading(true);
    try {
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
      toast.success("Contrato anexado");
      setContratoDialogOpen(false);
      setContratoFile(null);
      load();
    } finally {
      setContratoUploading(false);
    }
  };
  const enviarContratoAoGestor = async () => {
    if (contratoDocs.length === 0) {
      toast.error("Anexe o contrato antes de enviar ao gestor.");
      return;
    }
    await changeStatus("contrato_conferencia_gestor");
  };

  // Subir o contrato assinado NÃO conclui a etapa sozinho — o gestor confere o arquivo
  // e só então clica em "Marcar contrato assinado" (botão separado, fora deste dialog).
  const uploadContratoAssinado = async () => {
    if (!contratoAssinadoFile) {
      toast.error("Selecione o arquivo do contrato assinado.");
      return;
    }
    setContratoAssinadoUploading(true);
    try {
      const ext = contratoAssinadoFile.name.split(".").pop();
      const path = `${id}/outros/contrato_assinado/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("sale-documents").upload(path, contratoAssinadoFile, { upsert: false });
      if (upErr) { toast.error(`Falha no upload: ${upErr.message}`); return; }
      const { error: insErr } = await supabase.from("sale_documents").insert({
        sale_id: id, tipo: "contrato_assinado", parte: "outros", storage_path: path,
        file_name: contratoAssinadoFile.name, uploaded_by: user!.id, status: "enviado",
      } as any);
      if (insErr) { toast.error(insErr.message); return; }
      await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, acao: "document_uploaded", payload: { tipo: "contrato_assinado", parte: "outros" } });
      toast.success("Contrato assinado anexado");
      setContratoAssinadoDialogOpen(false);
      setContratoAssinadoFile(null);
      load();
    } finally {
      setContratoAssinadoUploading(false);
    }
  };

  const openReturnDialog = (target: SaleStatus) => { setReturnTarget(target); setReturnMotivo(""); setReturnOpen(true); };
  const submitReturn = async () => {
    if (!returnMotivo.trim()) { toast.error("Motivo é obrigatório"); return; }
    await changeStatus(returnTarget, returnMotivo);
    await supabase.from("sale_comments").insert({ sale_id: id, autor_id: user!.id, escopo: "revisao", texto: returnMotivo });
    setReturnOpen(false);
  };

  const openArchiveDialog = (target: "arquivada" | "cancelada") => { setArchiveTarget(target); setArchiveMotivo(""); setArchiveOpen(true); };
  const submitArchive = async () => {
    if (!archiveMotivo.trim()) { toast.error("Motivo é obrigatório"); return; }
    await changeStatus(archiveTarget, archiveMotivo);
    setArchiveOpen(false);
  };
  const attemptSendForReview = () => setReviewOpen(true);
  const confirmSendForReview = async () => {
    if (pendencias.length > 0) { toast.error("Corrija as pendências antes de enviar"); return; }
    setReviewOpen(false);
    await changeStatus("enviada_revisao");
    await notifyRoles(["gestor", "coordenador"], `Nova venda para revisão: ${sale.imovel_id ?? sale.codigo_interno ?? sale.id.slice(0, 8)}`);
  };

  const attemptApproveJuridico = () => setApproveJuridicoOpen(true);
  const confirmApproveJuridico = async () => {
    setApproveJuridicoOpen(false);
    await changeStatus("aprovada_gestor");
  };

  // Wizard: on leaving a step, run its saver if dirty
  const onBeforeLeave = async (from: string): Promise<boolean> => {
    if (from === "resumo" && (dirtyResumo || dirtyExtras)) return await saveResumo();
    if (dirtyMap[from]) {
      const fn = saversRef.current[from];
      if (fn) return await fn();
    }
    return true;
  };

  const currentDirty = step === "resumo" ? (dirtyResumo || dirtyExtras) : !!dirtyMap[step];

  // "Voltar" também é uma saída da página — sem isso, dado digitado mas ainda não salvo
  // (autosave ainda não disparou) era perdido em silêncio ao clicar aqui.
  const handleVoltar = async () => {
    if (anyDirtyAnywhere) await flushAllDirty();
    router.navigate({ to: "/vendas" });
  };

  const canOccurrence = ["contrato_assinado","ocorrencia_pendente","ocorrencia_analise_financeiro","ocorrencia_devolvida_gestor","ocorrencia_concluida"].includes(status);
  const canOverview = !["rascunho", "devolvida_ajuste", "enviada_revisao"].includes(status);
  const canEditOcorrencia = (isGestor && ["contrato_assinado","ocorrencia_pendente","ocorrencia_devolvida_gestor"].includes(status)) || isFinanceiro || isAdminLike;
  // Só financeiro/admin/super admin finalizam a ocorrência — gestor pode editar a tabela de
  // comissão e mandar pro financeiro, mas não pode fechar a ocorrência sozinho, sem revisão.
  const canFinalizarOcorrencia = isFinanceiro || isAdminLike;
  const steps: WizardStep[] = [
    {
      key: "documentos",
      label: "1. Documentos",
      content: (
        <DocumentsPanel
          saleId={id}
          saleStatus={status}
          docs={docs}
          editable={editable}
          canModerate={isGestor || isJuridico}
          canUseAi={isOwner}
          canManageContratos={isGestor || isJuridico || isFinanceiro}
          canDownloadAll={isGestor || isJuridico || isFinanceiro || isAdminLike}
          onChange={load}
        />
      ),
    },
    {
      key: "resumo",
      label: "2. Resumo",
      content: (
        <div className="space-y-4">
          {editable && <AutosaveStatus saving={saving} dirty={dirtyResumo || dirtyExtras} />}
          <Wizard
            steps={[
              { key: "imovel", label: "Imóvel", content: (<>
          <SaleSection title="Imóvel">
            <FieldGrid>
              <Field label="ID do imóvel"><Input value={formSale.imovel_id ?? ""} disabled={!editable} onChange={(e) => updResumo({ imovel_id: e.target.value })} /></Field>
              <Field label="Matrícula"><Input value={formSale.matricula ?? ""} disabled={!editable} onChange={(e) => updResumo({ matricula: e.target.value })} /></Field>
              <Field label="IPTU"><Input value={formSale.iptu ?? ""} disabled={!editable} onChange={(e) => updResumo({ iptu: e.target.value })} /></Field>
              <Field label="Código interno"><Input value={formSale.codigo_interno ?? ""} disabled={!editable} onChange={(e) => updResumo({ codigo_interno: e.target.value })} /></Field>
              <Field label="Observações do imóvel" colSpan={2}><Textarea value={formSale.imovel_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ imovel_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("equipe")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "equipe", label: "Equipe", content: (<>
          <SaleSection title="Equipe">
            <FieldGrid>
              <Field label="Corretor captador"><Input value={formSale.corretor_captador ?? ""} disabled={!editable} onChange={(e) => updResumo({ corretor_captador: e.target.value })} /></Field>
              <Field label="Corretor vendedor"><Input value={formSale.corretor_vendedor ?? ""} disabled={!editable} onChange={(e) => updResumo({ corretor_vendedor: e.target.value })} /></Field>
              <Field label="Indicador"><Input value={formSale.indicador ?? ""} disabled={!editable} onChange={(e) => updResumo({ indicador: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("imovel")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("valores")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "valores", label: "Valores e negociação", content: (<>
          <SaleSection title="Valores e negociação">
            <FieldGrid>
              <Field label="Valor anunciado (R$)"><CurrencyInput value={formSale.valor_anunciado} disabled={!editable} onChange={(v) => updResumo({ valor_anunciado: v })} /></Field>
              <Field label="Valor negociado (R$)"><CurrencyInput value={formSale.valor_negociado} disabled={!editable} onChange={(v) => updResumo({ valor_negociado: v })} /></Field>
              <Field label="% Comissão"><Input type="number" step="0.001" value={formSale.percentual_comissao ?? ""} disabled={!editable} onChange={(e) => {
                const p = e.target.value ? Number(e.target.value) : null;
                const neg = Number(formSale.valor_negociado ?? 0);
                const patch: any = { percentual_comissao: p };
                if (p != null && neg > 0) patch.valor_total_comissao = Number(((p / 100) * neg).toFixed(2));
                patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
                updResumo(patch);
              }} /></Field>
              <Field label="Valor total da comissão (R$)"><CurrencyInput value={formSale.valor_total_comissao} disabled={!editable} onChange={(v) => {
                const neg = Number(formSale.valor_negociado ?? 0);
                const patch: any = { valor_total_comissao: v };
                if (v != null && neg > 0) patch.percentual_comissao = Number(((v / neg) * 100).toFixed(3));
                patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
                updResumo(patch);
              }} /></Field>
              <Field label="Forma de pagamento" colSpan={2}>
                <Input placeholder="Como o proprietário vai pagar a comissão" value={formSale.forma_pagamento ?? ""} disabled={!editable} onChange={(e) => updResumo({ forma_pagamento: e.target.value })} />
              </Field>
              <Field label="Observações" colSpan={2}><Textarea value={formSale.negociacao_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ negociacao_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("equipe")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("comissao")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "comissao", label: "Divisão da comissão", content: (<>
          <SaleSection title="Divisão da comissão (revisão do gestor)">
            {(() => {
              const total = Number(formSale.valor_total_comissao ?? 0);
              const soma = Number(formSale.valor_comissao_captador ?? 0) + Number(formSale.valor_comissao_vendedor ?? 0);
              const excedido = total > 0 && soma > total + 0.01;
              return excedido ? (
                <div className="mb-4 rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  A soma das comissões (R$ {soma.toFixed(2)}) ultrapassa o valor total da comissão (R$ {total.toFixed(2)}).
                </div>
              ) : null;
            })()}
            <FieldGrid>
              <Field label={`% Captador${formSale.corretor_captador ? ` — ${formSale.corretor_captador}` : ""}`}><Input type="number" step="0.001" value={formSale.percentual_comissao_captador ?? ""} disabled={!editable} onChange={(e) => applyComissaoPercentual("captador", e.target.value)} /></Field>
              <Field label={`Comissão corretor captador${formSale.corretor_captador ? ` — ${formSale.corretor_captador}` : ""} (R$)`}><CurrencyInput value={formSale.valor_comissao_captador} disabled={!editable} onChange={(v) => applyComissaoValor("captador", v)} /></Field>
              <Field label={`% Vendedor${formSale.corretor_vendedor ? ` — ${formSale.corretor_vendedor}` : ""}`}><Input type="number" step="0.001" value={formSale.percentual_comissao_vendedor ?? ""} disabled={!editable} onChange={(e) => applyComissaoPercentual("vendedor", e.target.value)} /></Field>
              <Field label={`Comissão corretor vendedor${formSale.corretor_vendedor ? ` — ${formSale.corretor_vendedor}` : ""} (R$)`}><CurrencyInput value={formSale.valor_comissao_vendedor} disabled={!editable} onChange={(v) => applyComissaoValor("vendedor", v)} /></Field>
              <Field label="Líquido do captador (R$)">
                <CurrencyInput value={Number((Number(formSale.valor_comissao_captador ?? 0) - (formSale.indicador_lado === "captador" ? Number(formSale.valor_comissao_indicador ?? 0) : 0) - somaExtrasPorOrigem("captador")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
              <Field label="Líquido do vendedor (R$)">
                <CurrencyInput value={Number((Number(formSale.valor_comissao_vendedor ?? 0) - (formSale.indicador_lado === "vendedor" ? Number(formSale.valor_comissao_indicador ?? 0) : 0) - somaExtrasPorOrigem("vendedor")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
              <Field label="Valor para a imobiliária (R$)" colSpan={2}>
                <CurrencyInput value={Number((Number(formSale.valor_comissao_imobiliaria ?? 0) - somaExtrasPorOrigem("imobiliaria")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
            </FieldGrid>
            <div className="mt-4 border-t pt-4">
              <p className="mb-3 text-xs text-muted-foreground">
                A comissão do indicador sai de dentro da fatia do captador ou do vendedor (não é descontada do total nem da imobiliária).
              </p>
              {formSale.indicador_lado && !formSale.indicador && (
                <div className="mb-3 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  Falta o nome do indicador — preencha abaixo.
                </div>
              )}
              <FieldGrid>
                <Field label="Nome do indicador"><Input value={formSale.indicador ?? ""} disabled={!editable} onChange={(e) => updResumo({ indicador: e.target.value })} /></Field>
                <Field label="Indicador de">
                  <Select
                    value={formSale.indicador_lado ?? "none"}
                    onValueChange={(v) => applyIndicadorLado(v === "none" ? null : (v as "captador" | "vendedor"))}
                    disabled={!editable}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem indicação</SelectItem>
                      <SelectItem value="captador">Captador{formSale.corretor_captador ? ` — ${formSale.corretor_captador}` : ""}</SelectItem>
                      <SelectItem value="vendedor">Vendedor{formSale.corretor_vendedor ? ` — ${formSale.corretor_vendedor}` : ""}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="% Indicador (sobre a comissão do lado)"><Input type="number" step="0.001" value={formSale.percentual_comissao_indicador ?? ""} disabled={!editable || !formSale.indicador_lado} onChange={(e) => applyIndicadorPercentual(e.target.value)} /></Field>
                <Field label="Comissão indicador (R$)"><CurrencyInput value={formSale.valor_comissao_indicador} disabled={!editable || !formSale.indicador_lado} onChange={applyIndicadorValor} /></Field>
              </FieldGrid>
              <p className="mt-2 text-xs text-muted-foreground">
                Veja o "Líquido do captador/vendedor" acima — já descontam indicador e partes extras dessa fatia.
              </p>
            </div>
            <div className="mt-4 border-t pt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Partes extras da divisão — classifique quem é a pessoa e de qual fatia (imobiliária, captador ou vendedor) o valor sai.
                </p>
                {editable && <Button size="sm" variant="outline" onClick={addExtra}><Plus className="mr-1 h-4 w-4" />Adicionar parte</Button>}
              </div>
              {formExtras.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parte extra adicionada.</p>}
              <div className="space-y-2">
                {formExtras.map((r) => {
                  const vinculavel = (r.papel === "gestor" || r.papel === "team_leader") && lideres.length > 0;
                  const liderAtualId = r.papel === "gestor" ? (formSale.coordenador_id ?? "") : r.papel === "team_leader" ? (formSale.team_leader_id ?? "") : "";
                  const onSelectLider = (liderId: string) => {
                    const lider = lideres.find((l) => l.id === liderId);
                    updExtra(r.id, { nome: lider ? lider.nome : r.nome });
                    if (r.papel === "gestor") updResumo({ coordenador_id: liderId || null });
                    if (r.papel === "team_leader") updResumo({ team_leader_id: liderId || null });
                  };
                  return (
                  <div key={r.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-6">
                    <Field label="Nome">
                      {vinculavel ? (
                        <Select value={liderAtualId || "manual"} onValueChange={(v) => onSelectLider(v === "manual" ? "" : v)} disabled={!editable}>
                          <SelectTrigger><SelectValue placeholder="Selecione o líder" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Digitar nome manualmente</SelectItem>
                            {lideres.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : null}
                      <Input
                        className={vinculavel ? "mt-2" : undefined}
                        value={r.nome ?? ""}
                        disabled={!editable || (vinculavel && !!liderAtualId)}
                        onChange={(e) => updExtra(r.id, { nome: e.target.value })}
                        placeholder={vinculavel ? "Nome (se não estiver na lista acima)" : undefined}
                      />
                    </Field>
                    <Field label="Papel">
                      <Select value={r.papel ?? "none"} onValueChange={(v) => updExtra(r.id, { papel: v === "none" ? null : v })} disabled={!editable}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="gestor">Gestor</SelectItem>
                          <SelectItem value="team_leader">Team Leader</SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Origem">
                      <Select value={r.origem} onValueChange={(v) => updExtra(r.id, { origem: v })} disabled={!editable}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                          <SelectItem value="captador">Captador</SelectItem>
                          <SelectItem value="vendedor">Vendedor</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="% (sobre a origem)"><Input type="number" step="0.001" value={r.percentual ?? ""} disabled={!editable} onChange={(e) => updExtra(r.id, { percentual: e.target.value })} /></Field>
                    <Field label="Valor (R$)"><CurrencyInput value={r.valor} disabled={!editable} onChange={(v) => updExtra(r.id, { valor: v })} /></Field>
                    {editable && (
                      <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => delExtra(r.id)}>Remover</Button></div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </SaleSection>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("valores")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("posse")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "posse", label: "Posse", content: (<>
          <SaleSection title="Posse">
            <FieldGrid>
              <Field label="Data de entrega da posse"><Input type="date" value={formSale.posse_data ?? ""} disabled={!editable} onChange={(e) => updResumo({ posse_data: e.target.value || null })} /></Field>
              <Field label="Observações" colSpan={2}><Textarea value={formSale.posse_observacoes ?? ""} disabled={!editable} onChange={(e) => updResumo({ posse_observacoes: e.target.value })} /></Field>
            </FieldGrid>
          </SaleSection>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("comissao")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
          </div>
              </>) },
            ]}
            current={activeResumoBlock}
            onChange={setActiveResumoBlock}
            hideNav
          />
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
          parties={parties}
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
          commissionExtras={commissionExtras}
          canEdit={canEditOcorrencia}
          onChange={load}
          registerSaver={(fn) => registerSaver("ocorrencia", fn)}
          onDirtyChange={(d) => setStepDirty("ocorrencia", d)}
        />
      ),
    },
    {
      key: "revisao",
      label: "6. Revisão",
      disabled: !canOccurrence,
      content: (
        <OccurrenceReviewPanel
          saleId={id}
          sale={sale}
          parties={parties}
          canEdit={canFinalizarOcorrencia}
          onChange={load}
        />
      ),
    },
  ];

  // Ação de avançar a venda para o próximo responsável — mesma ação do topo da página, só que
  // repetida no rodapé da última etapa do wizard, no lugar do "Próximo" (que ali não faz nada).
  // Statuses com mais de uma ação de avanço igualmente válida ficam de fora (o usuário escolhe lá em cima).
  const primaryAction: { label: string; icon: typeof Send; onClick: () => void } | null =
    isOwner && (status === "rascunho" || status === "devolvida_ajuste") ? { label: "Enviar ao gestor", icon: Send, onClick: attemptSendForReview } :
    isGestor && status === "enviada_revisao" ? { label: "Aprovar p/ jurídico", icon: CheckCircle2, onClick: attemptApproveJuridico } :
    isJuridico && status === "aprovada_gestor" ? { label: "Iniciar contrato", icon: Gavel, onClick: () => changeStatus("em_elaboracao_contrato") } :
    isJuridico && status === "em_elaboracao_contrato" && contratoDocs.length === 0 ? { label: "Anexar contrato", icon: Upload, onClick: () => { setContratoFile(null); setContratoDialogOpen(true); } } :
    isJuridico && status === "em_elaboracao_contrato" && contratoDocs.length > 0 ? { label: "Enviar ao gestor", icon: Send, onClick: enviarContratoAoGestor } :
    isOwner && status === "contrato_conferencia_corretor" ? { label: "Dar OK no contrato", icon: CheckCircle2, onClick: () => changeStatus("contrato_ok_corretor") } :
    isGestor && status === "contrato_ok_corretor" ? { label: "Enviar para assinatura", icon: Send, onClick: () => changeStatus("aguardando_assinatura") } :
    isGestor && status === "aguardando_assinatura" && contratoAssinadoDocs.length === 0 ? { label: "Subir contrato assinado", icon: Upload, onClick: () => { setContratoAssinadoFile(null); setContratoAssinadoDialogOpen(true); } } :
    isGestor && status === "aguardando_assinatura" && contratoAssinadoDocs.length > 0 ? { label: "Marcar contrato assinado", icon: FileCheck, onClick: marcarContratoAssinado } :
    isGestor && (status === "ocorrencia_pendente" || status === "ocorrencia_devolvida_gestor") ? { label: "Enviar ocorrência ao financeiro", icon: DollarSign, onClick: () => changeStatus("ocorrencia_analise_financeiro") } :
    null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={handleVoltar}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
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
              <Button onClick={attemptApproveJuridico}><CheckCircle2 className="mr-2 h-4 w-4" />Aprovar p/ jurídico</Button>
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
              <Button variant="outline" onClick={() => { setContratoFile(null); setContratoDialogOpen(true); }}>
                <Upload className="mr-2 h-4 w-4" />{contratoDocs.length > 0 ? "Substituir contrato" : "Anexar contrato"}
              </Button>
              <Button onClick={enviarContratoAoGestor} disabled={contratoDocs.length === 0}>
                <Send className="mr-2 h-4 w-4" />Enviar ao gestor
              </Button>
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
            <>
              <Button variant="outline" onClick={() => { setContratoAssinadoFile(null); setContratoAssinadoDialogOpen(true); }}>
                <Upload className="mr-2 h-4 w-4" />{contratoAssinadoDocs.length > 0 ? "Substituir contrato assinado" : "Subir contrato assinado"}
              </Button>
              <Button onClick={marcarContratoAssinado} disabled={contratoAssinadoDocs.length === 0}>
                <FileCheck className="mr-2 h-4 w-4" />Marcar contrato assinado
              </Button>
            </>
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

          {isAdminLike && status !== "arquivada" && status !== "cancelada" && (
            <>
              <Button variant="outline" onClick={() => openArchiveDialog("arquivada")}>Arquivar</Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => openArchiveDialog("cancelada")}>Cancelar venda</Button>
            </>
          )}

          {canDelete && (
            <Button variant="outline" className="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
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


      <div className="flex flex-wrap justify-end gap-2 print:hidden">
        {canOverview && (
          <Button variant="outline" size="sm" onClick={() => setOverviewOpen(true)}>
            <FileText className="mr-2 h-4 w-4" />Visão geral completa
          </Button>
        )}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm"><History className="mr-2 h-4 w-4" />Histórico</Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Histórico de status</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-2">
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
            </div>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm"><MessageSquare className="mr-2 h-4 w-4" />Comentários{comments.length > 0 ? ` (${comments.length})` : ""}</Button>
          </SheetTrigger>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>Comentários</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <CommentsPanel saleId={id} comments={comments} onAdd={load} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Visão geral da venda</DialogTitle>
            <DialogDescription>
              {sale.imovel_id || sale.codigo_interno || `Venda #${sale.id.slice(0, 8)}`} • {STATUS_LABEL[status]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <ReviewGroup title="Imóvel">
              <ReviewItem label="Imóvel" value={sale.imovel_id || sale.codigo_interno} />
              <ReviewItem label="Matrícula" value={sale.matricula} />
              <ReviewItem label="IPTU" value={sale.iptu} />
            </ReviewGroup>

            <ReviewGroup title="Equipe">
              <ReviewItem label="Corretor captador" value={sale.corretor_captador} />
              <ReviewItem label="Corretor vendedor" value={sale.corretor_vendedor} />
              <ReviewItem label="Indicador" value={sale.indicador} />
            </ReviewGroup>

            <ReviewGroup title="Valores e negociação">
              <ReviewItem label="Valor anunciado" value={money(sale.valor_anunciado)} />
              <ReviewItem label="Valor negociado" value={money(sale.valor_negociado)} />
              <ReviewItem label="% Comissão" value={sale.percentual_comissao != null ? `${sale.percentual_comissao}%` : null} />
              <ReviewItem label="Valor total da comissão" value={money(sale.valor_total_comissao)} />
              <ReviewItem label="Forma de pagamento" value={sale.forma_pagamento} />
            </ReviewGroup>

            <ReviewGroup title="Divisão de comissão">
              <ReviewItem label={`Captador${sale.corretor_captador ? ` — ${sale.corretor_captador}` : ""}`} value={money(sale.valor_comissao_captador)} />
              <ReviewItem label={`Vendedor${sale.corretor_vendedor ? ` — ${sale.corretor_vendedor}` : ""}`} value={money(sale.valor_comissao_vendedor)} />
              <ReviewItem label="Imobiliária" value={money(sale.valor_comissao_imobiliaria)} />
              {sale.indicador_lado && (
                <>
                  <ReviewItem
                    label={`Indicador${sale.indicador ? ` — ${sale.indicador}` : ""} (${sale.indicador_lado === "captador" ? "sai do captador" : "sai do vendedor"})`}
                    value={money(sale.valor_comissao_indicador)}
                  />
                  <ReviewItem
                    label={`Líquido do ${sale.indicador_lado === "captador" ? "captador" : "vendedor"} após indicador`}
                    value={money(Number(sale[`valor_comissao_${sale.indicador_lado}`] ?? 0) - Number(sale.valor_comissao_indicador ?? 0))}
                  />
                </>
              )}
            </ReviewGroup>

            <ReviewGroup title="Posse">
              <ReviewItem label="Data de entrega da posse" value={dateBR(sale.posse_data)} />
              <ReviewItem label="Observações" value={sale.posse_observacoes} />
            </ReviewGroup>

            <ReviewGroup title="Partes (qualificação para o contrato)">
              {partiesComNome(parties)
                .map((papel, i, arr) => {
                  const p = parties[papel];
                  return (
                    <div key={papel} className={i < arr.length - 1 ? "border-b pb-2 mb-2" : ""}>
                      <div className="mb-1 font-medium">{parteLabel(papel)} — {p.nome}</div>
                      <ReviewItem label="CPF/CNPJ" value={p.cpf_cnpj} />
                      <ReviewItem label="RG" value={p.rg} />
                      <ReviewItem label="Profissão" value={p.profissao} />
                      <ReviewItem label="E-mail" value={p.email} />
                      <ReviewItem label="Telefone" value={p.telefone} />
                      <ReviewItem label="Endereço" value={p.endereco} />
                    </div>
                  );
                })}
              {partiesComNome(parties).length === 0 && (
                <ReviewItem label="Nenhuma parte preenchida" value={null} />
              )}
            </ReviewGroup>

            <ReviewGroup title="Pagamento">
              <ReviewItem label="Entrada" value={money(payment?.entrada_valor)} />
              <ReviewItem label="Parcela 1" value={money(payment?.parcela1_valor)} />
              <ReviewItem label="Parcela 2" value={money(payment?.parcela2_valor)} />
              <ReviewItem label="Pagamento final" value={money(payment?.pagamento_final_valor)} />
              <ReviewItem label="FGTS" value={payment?.fgts ? money(payment?.fgts_valor) : "Não"} />
              <ReviewItem label="Financiamento" value={payment?.financiamento ? `${money(payment?.financiamento_valor)}${payment?.financiamento_banco ? ` — ${payment.financiamento_banco}` : ""}` : "Não"} />
            </ReviewGroup>

            <ReviewGroup title="Dados bancários do vendedor">
              <ReviewItem label="Titular" value={bank?.titular} />
              <ReviewItem label="Banco" value={bank?.banco} />
              <ReviewItem label="Agência" value={bank?.agencia} />
              <ReviewItem label="Conta" value={bank?.conta} />
              <ReviewItem label="PIX" value={bank?.pix} />
            </ReviewGroup>

            <ReviewGroup title="Documentos">
              {docs.length === 0 && <ReviewItem label="Nenhum documento enviado" value={null} />}
              {docs.map((d) => (
                <ReviewItem key={d.id} label={d.file_name} value={<DocStatusBadge status={d.status} />} />
              ))}
            </ReviewGroup>

            <ReviewGroup title="Histórico">
              {history.length === 0 && <ReviewItem label="Sem alterações registradas" value={null} />}
              {history.map((h) => (
                <ReviewItem
                  key={h.id}
                  label={`${h.de ? STATUS_LABEL[h.de as SaleStatus] : "—"} → ${STATUS_LABEL[h.para as SaleStatus]}`}
                  value={new Date(h.created_at).toLocaleString("pt-BR")}
                />
              ))}
            </ReviewGroup>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />Imprimir
            </Button>
            <Button onClick={() => setOverviewOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          {(contratoDocs.length > 0 || contratoAssinadoDocs.length > 0) && status !== "ocorrencia_concluida" && (
            <div className="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
              {contratoAssinadoDocs.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><FileCheck className="h-3.5 w-3.5 text-primary" /> Contrato assinado: <b className="text-foreground">{contratoAssinadoDocs[contratoAssinadoDocs.length - 1].file_name}</b></span>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => abrirContratoRapido(contratoAssinadoDocs[contratoAssinadoDocs.length - 1])}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver</Button>
                </div>
              )}
              {contratoDocs.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><FileCheck className="h-3.5 w-3.5 text-primary" /> Contrato (versão para revisão): <b className="text-foreground">{contratoDocs[contratoDocs.length - 1].file_name}</b></span>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => abrirContratoRapido(contratoDocs[contratoDocs.length - 1])}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver</Button>
                </div>
              )}
            </div>
          )}
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
          lastStepAction={primaryAction && (
            <Button onClick={primaryAction.onClick}>
              <primaryAction.icon className="mr-2 h-4 w-4" />{primaryAction.label}
            </Button>
          )}
        />
      )}

      {saving && <p className="fixed bottom-4 right-4 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow">Salvando...</p>}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conferência antes de enviar</DialogTitle>
            <DialogDescription>Revise o que foi preenchido antes de enviar para o gestor.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[28rem] space-y-4 overflow-y-auto text-sm">
            {pendencias.length === 0 ? (
              <div className="rounded-md bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />Venda pronta para revisão.
              </div>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mr-2 inline h-4 w-4" />{pendencias.length} pendência(s). Corrija antes de enviar.
                <ul className="mt-2 space-y-1 pl-2">
                  {pendencias.map(p => <li key={p.campo} className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{p.mensagem}</span></li>)}
                </ul>
              </div>
            )}

            <div className="space-y-3">
              <ReviewGroup title="Imóvel">
                <ReviewItem label="Imóvel" value={sale.imovel_id || sale.codigo_interno} />
                <ReviewItem label="Matrícula" value={sale.matricula} />
              </ReviewGroup>

              <ReviewGroup title="Valores e negociação">
                <ReviewItem label="Valor anunciado" value={money(sale.valor_anunciado)} />
                <ReviewItem label="Valor negociado" value={money(sale.valor_negociado)} />
                <ReviewItem label="% Comissão" value={sale.percentual_comissao != null ? `${sale.percentual_comissao}%` : null} />
                <ReviewItem label="Valor total da comissão" value={money(sale.valor_total_comissao)} />
              </ReviewGroup>

              <ReviewGroup title="Partes">
                {partiesComNome(parties).map((papel) => (
                  <ReviewItem key={papel} label={parteLabel(papel)} value={parties[papel]?.nome} />
                ))}
                {partiesComNome(parties).length === 0 && (
                  <ReviewItem label="Nenhuma parte preenchida" value={null} />
                )}
              </ReviewGroup>

              <ReviewGroup title="Pagamento">
                <ReviewItem label="Entrada" value={money(payment?.entrada_valor)} />
                <ReviewItem label="Financiamento" value={payment?.financiamento ? `${money(payment?.financiamento_valor)}${payment?.financiamento_banco ? ` — ${payment.financiamento_banco}` : ""}` : "Não"} />
              </ReviewGroup>

              <ReviewGroup title="Documentos">
                <ReviewItem label="Anexados" value={`${docs.length}`} />
              </ReviewGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>Cancelar</Button>
            <Button onClick={confirmSendForReview} disabled={pendencias.length > 0}>Confirmar envio</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveJuridicoOpen} onOpenChange={setApproveJuridicoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conferência antes de enviar ao jurídico</DialogTitle>
            <DialogDescription>Revise o que o corretor preencheu antes de aprovar e mandar pro jurídico.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[28rem] space-y-4 overflow-y-auto text-sm">
            <div className="space-y-3">
              <ReviewGroup title="Imóvel">
                <ReviewItem label="Imóvel" value={sale.imovel_id || sale.codigo_interno} />
                <ReviewItem label="Matrícula" value={sale.matricula} />
              </ReviewGroup>

              <ReviewGroup title="Valores e negociação">
                <ReviewItem label="Valor anunciado" value={money(sale.valor_anunciado)} />
                <ReviewItem label="Valor negociado" value={money(sale.valor_negociado)} />
                <ReviewItem label="% Comissão" value={sale.percentual_comissao != null ? `${sale.percentual_comissao}%` : null} />
                <ReviewItem label="Valor total da comissão" value={money(sale.valor_total_comissao)} />
              </ReviewGroup>

              <ReviewGroup title="Partes">
                {partiesComNome(parties).map((papel) => (
                  <ReviewItem key={papel} label={parteLabel(papel)} value={parties[papel]?.nome} />
                ))}
              </ReviewGroup>

              <ReviewGroup title="Pagamento">
                <ReviewItem label="Entrada" value={money(payment?.entrada_valor)} />
                <ReviewItem label="Financiamento" value={payment?.financiamento ? `${money(payment?.financiamento_valor)}${payment?.financiamento_banco ? ` — ${payment.financiamento_banco}` : ""}` : "Não"} />
              </ReviewGroup>

              <ReviewGroup title="Documentos">
                <ReviewItem label="Aprovados" value={`${docsApproved}/${requiredTypes.length}`} />
              </ReviewGroup>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveJuridicoOpen(false)}>Cancelar</Button>
            <Button onClick={confirmApproveJuridico}>Confirmar e enviar ao jurídico</Button>
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

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{archiveTarget === "arquivada" ? "Arquivar venda" : "Cancelar venda"}</DialogTitle>
            <DialogDescription>Descreva o motivo. Isso fica registrado no histórico da venda.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo (obrigatório)" value={archiveMotivo} onChange={(e) => setArchiveMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)}>Voltar</Button>
            <Button variant={archiveTarget === "cancelada" ? "destructive" : "default"} onClick={submitArchive} disabled={!archiveMotivo.trim()}>
              {archiveTarget === "arquivada" ? "Arquivar" : "Cancelar venda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contratoDialogOpen} onOpenChange={(o) => { if (!contratoUploading) setContratoDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anexar contrato</DialogTitle>
            <DialogDescription>
              Envie o arquivo do contrato (PDF, DOC ou DOCX). Depois de anexar, confira o arquivo e use o botão "Enviar ao gestor" quando estiver pronto.
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
              <div className="mt-2 text-xs">Selecionar um novo arquivo abaixo substitui a versão atual.</div>
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
              onClick={uploadContrato}
              disabled={contratoUploading || !contratoFile}
            >
              {contratoUploading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>) : (<><Upload className="mr-2 h-4 w-4" />Anexar contrato</>)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contratoAssinadoDialogOpen} onOpenChange={(o) => { if (!contratoAssinadoUploading) setContratoAssinadoDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir contrato assinado</DialogTitle>
            <DialogDescription>
              Envie o arquivo do contrato assinado (PDF, DOC ou DOCX). Depois de subir, confira o arquivo e use o botão "Marcar contrato assinado" quando estiver pronto.
            </DialogDescription>
          </DialogHeader>

          {contratoAssinadoDocs.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="mb-1 font-medium">Contrato(s) assinado(s) já anexado(s):</div>
              <ul className="space-y-1 text-muted-foreground">
                {contratoAssinadoDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="truncate">{d.file_name}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 text-xs">Selecionar um novo arquivo abaixo substitui a versão atual.</div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Arquivo do contrato assinado {contratoAssinadoDocs.length === 0 && <span className="text-destructive">*</span>}</Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setContratoAssinadoFile(e.target.files?.[0] ?? null)}
              disabled={contratoAssinadoUploading}
            />
            {contratoAssinadoFile && (
              <div className="text-xs text-muted-foreground">Selecionado: {contratoAssinadoFile.name}</div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setContratoAssinadoDialogOpen(false)} disabled={contratoAssinadoUploading}>Cancelar</Button>
            <Button
              onClick={uploadContratoAssinado}
              disabled={contratoAssinadoUploading || !contratoAssinadoFile}
            >
              {contratoAssinadoUploading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>) : (<><Upload className="mr-2 h-4 w-4" />Subir contrato assinado</>)}
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

const money = (v: any) => (v != null ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : null);
const dateBR = (v: any) => (v ? new Date(v).toLocaleDateString("pt-BR") : null);

/** Papéis de comprador_N/vendedor_N com nome preenchido, em ordem — usado nos resumos/diálogos de conferência. */
function partiesComNome(parties: Record<string, any>): string[] {
  return Object.keys(parties)
    .filter((p) => /^(vendedor|comprador)_\d+$/.test(p) && parties[p]?.nome)
    .sort((a, b) => {
      const ka = parteSortKey(a), kb = parteSortKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
}

const isImageFile = (name: string) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(name);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Converte qualquer imagem (jpg, png, etc.) pra PNG via canvas antes de embutir no PDF —
// mais simples e robusto do que tentar diferenciar jpg de png na hora de embutir, e cobre
// formatos que o pdf-lib não lê nativamente.
async function imageToPngBytes(blob: Blob): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(bitmap, 0, 0);
  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter imagem"))), "image/png");
  });
  return new Uint8Array(await pngBlob.arrayBuffer());
}

/** Baixa uma lista de documentos (imagens e/ou PDFs) já mesclados num único arquivo PDF. */
async function baixarDocumentosComoPdf(list: { file_name: string; url: string }[], nomeArquivo: string) {
  const merged = await PDFDocument.create();
  for (const doc of list) {
    const resp = await fetch(doc.url);
    if (!resp.ok) continue;
    const blob = await resp.blob();
    if (isImageFile(doc.file_name)) {
      const pngBytes = await imageToPngBytes(blob);
      const img = await merged.embedPng(pngBytes);
      const page = merged.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    }
  }
  const mergedBytes = await merged.save();
  const blobUrl = URL.createObjectURL(new Blob([mergedBytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}

/** Abre uma janela com um documento (ou vários) por página e dispara a impressão do navegador assim que tudo carrega. */
function printDocumentUrls(list: { file_name: string; url: string }[]) {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) { toast.error("Permita pop-ups para imprimir"); return; }
  const body = list.map((d) => `
    <section class="page">
      <h2>${escapeHtml(d.file_name)}</h2>
      ${isImageFile(d.file_name)
        ? `<img src="${d.url}" alt="${escapeHtml(d.file_name)}" />`
        : `<iframe src="${d.url}" title="${escapeHtml(d.file_name)}"></iframe>`}
    </section>
  `).join("");
  w.document.write(`<!doctype html><html><head><title>Imprimir documentos</title><style>
    body { margin: 0; font-family: sans-serif; }
    .page { page-break-after: always; padding: 16px; box-sizing: border-box; min-height: 100vh; }
    .page:last-child { page-break-after: auto; }
    .page h2 { font-size: 13px; margin: 0 0 8px; color: #333; }
    .page img { max-width: 100%; max-height: 92vh; display: block; margin: 0 auto; object-fit: contain; }
    .page iframe { width: 100%; height: 92vh; border: 0; }
  </style></head><body>${body}</body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); setTimeout(() => w.print(), 400); };
}

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

function ReviewGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1 rounded-md border p-2">{children}</div>
    </div>
  );
}
function ReviewItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

/** Tabelas do formulário "Ocorrência de compra e venda", compartilhadas entre a revisão (pré-finalização) e o relatório final. */
function OccurrenceReportBody({ sale, occ, commissions, partners, parties }: {
  sale: any; occ: any; commissions: any[]; partners: any[]; parties: Record<string, any>;
}) {
  const vendedores = Object.entries(parties).filter(([papel]) => papel.startsWith("vendedor")).map(([, p]) => p);
  const compradores = Object.entries(parties).filter(([papel]) => papel.startsWith("comprador")).map(([, p]) => p);
  const commByPapel = (papel: string) => commissions.find((c) => c.papel === papel);

  return (
    <>
      <div className="mb-3 border border-foreground/30 bg-foreground/5 py-2 text-center text-base font-bold uppercase tracking-wide">
        Ocorrência de compra e venda
      </div>

      <FormTable>
        <FormHeadRow cols={["Código do imóvel", "Tempo de venda", "Data de assinatura", "Nota fiscal obrigatória", "Mídia"]} />
        <FormValueRow cols={[
          sale.imovel_id || sale.codigo_interno,
          occ?.tempo_venda,
          <span className="font-semibold">{dateBR(occ?.data_assinatura)}</span>,
          <Checkbox checked={!!occ?.nota_fiscal_obrigatoria} label={occ?.nota_fiscal_obrigatoria ? "Sim" : "Não"} />,
          occ?.midia,
        ]} />
      </FormTable>

      {vendedores.map((v: any, i: number) => (
        <FormTable key={v.id ?? i}>
          <FormValueRow cols={[<span><b>Nome do vendedor:</b> {v.nome}</span>, <span><b>E-mail:</b> {v.email}</span>]} />
          <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {v.cpf_cnpj}</span>, <span><b>RG:</b> {v.rg}</span>, <span><b>Celular:</b> {v.telefone}</span>]} />
          <FormValueRow cols={[<span><b>Endereço:</b> {v.endereco}</span>]} />
        </FormTable>
      ))}
      {compradores.map((c: any, i: number) => (
        <FormTable key={c.id ?? i}>
          <FormValueRow cols={[<span><b>Nome do comprador:</b> {c.nome}</span>, <span><b>E-mail:</b> {c.email}</span>]} />
          <FormValueRow cols={[<span><b>CPF/CNPJ:</b> {c.cpf_cnpj}</span>, <span><b>RG:</b> {c.rg}</span>, <span><b>Celular:</b> {c.telefone}</span>]} />
          <FormValueRow cols={[<span><b>Endereço:</b> {c.endereco}</span>]} />
        </FormTable>
      ))}

      <FormTitle>Resumo da transação</FormTitle>
      <FormTable>
        <FormHeadRow cols={["Valor anunciado", "Valor negociado", "Percentual", "Valor da comissão"]} />
        <FormValueRow cols={[
          money(occ?.valor_anunciado ?? sale.valor_anunciado),
          money(occ?.valor_negociado ?? sale.valor_negociado),
          occ?.percentual_comissao ?? sale.percentual_comissao ? `${occ?.percentual_comissao ?? sale.percentual_comissao}%` : null,
          <span className="text-base font-bold text-primary">{money(occ?.valor_comissao ?? sale.valor_total_comissao)}</span>,
        ]} />
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
    </>
  );
}

/** Tela de revisão da ocorrência (pré-finalização) — mesmo layout de relatório do SaleReport, com ação para confirmar e finalizar. */
function OccurrenceReviewPanel({ saleId, sale, parties, canEdit, onChange }: {
  saleId: string; sale: any; parties: Record<string, any>; canEdit: boolean; onChange: () => void;
}) {
  const { user } = useAuth();
  const [occ, setOcc] = useState<any>(null);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmExcedidoOpen, setConfirmExcedidoOpen] = useState(false);
  const [excedidoMotivo, setExcedidoMotivo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
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

  const concluida = occ?.status === "concluida";
  const somaComissoes = commissions.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const total = Number(occ?.valor_comissao ?? 0);
  const excedido = total > 0 && somaComissoes > total + 0.01;

  const doFinalizar = async (motivoExcedido?: string) => {
    setFinalizing(true);
    try {
      const { error: e0 } = await supabase.from("occurrences").update({ status: "concluida" }).eq("id", occ.id);
      if (e0) { toast.error(e0.message); return; }
      const { error } = await supabase.from("sales").update({ status: "ocorrencia_concluida" }).eq("id", saleId);
      if (error) { toast.error(error.message); return; }
      const motivo = motivoExcedido ? `Ocorrência finalizada com comissão excedente — justificativa: ${motivoExcedido}` : "Ocorrência finalizada";
      await supabase.from("sale_status_history").insert({ sale_id: saleId, de: sale.status, para: "ocorrencia_concluida", autor_id: user!.id, motivo });
      await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "occurrence_concluded", payload: { valor_total: total, ...(motivoExcedido ? { comissao_excedida: true, justificativa: motivoExcedido, soma_comissoes: somaComissoes } : {}) } });
      toast.success("Ocorrência finalizada");
      onChange();
      await load();
    } finally {
      setFinalizing(false);
    }
  };
  const finalizar = async () => {
    if (!occ) return;
    if (excedido) { setExcedidoMotivo(""); setConfirmExcedidoOpen(true); return; }
    await doFinalizar();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Carregando revisão...</p>;
  if (!occ) return <p className="text-sm text-muted-foreground">Preencha e salve a etapa "Ocorrência" antes de revisar.</p>;

  return (
    <div className="space-y-4">
      <div className="print:border print:border-foreground/30 print:p-4">
        <div className="mb-3 flex items-center justify-between border-b pb-2">
          <div>
            <div className="text-sm font-bold">{AGENCY_NAME}</div>
            <div className="text-xs text-muted-foreground">{AGENCY_CRECI}</div>
          </div>
          <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>

        <OccurrenceReportBody sale={sale} occ={occ} commissions={commissions} partners={partners} parties={parties} />
      </div>

      {excedido && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200 print:hidden">
          Soma das comissões (R$ {somaComissoes.toFixed(2)}) excede a comissão total (R$ {total.toFixed(2)}).
        </div>
      )}

      <div className="flex justify-end print:hidden">
        {concluida ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Ocorrência finalizada.</p>
        ) : canEdit ? (
          <Button onClick={finalizar} disabled={finalizing}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmar e finalizar ocorrência</Button>
        ) : null}
      </div>

      <AlertDialog open={confirmExcedidoOpen} onOpenChange={setConfirmExcedidoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Comissões excedem o total?</AlertDialogTitle>
            <AlertDialogDescription>
              Soma das comissões (R$ {somaComissoes.toFixed(2)}) excede a comissão total (R$ {total.toFixed(2)}). Para finalizar mesmo assim, explique o motivo — isso fica registrado no histórico da venda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="excedido-motivo">Justificativa (obrigatória)</Label>
            <Textarea id="excedido-motivo" value={excedidoMotivo} onChange={(e) => setExcedidoMotivo(e.target.value)} placeholder="Ex.: bônus extra combinado com o gestor, ajuste retroativo, etc." />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={finalizing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={finalizing || !excedidoMotivo.trim()} onClick={(e) => { e.preventDefault(); setConfirmExcedidoOpen(false); doFinalizar(excedidoMotivo.trim()); }}>
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState("");

  const openReopenDialog = () => { setReopenMotivo(""); setReopenOpen(true); };
  const reopen = async () => {
    if (!occ) return;
    const motivo = reopenMotivo.trim();
    if (!motivo) { toast.error("Justificativa é obrigatória"); return; }
    setReopening(true);
    try {
      const { error: e0 } = await supabase.from("occurrences").update({
        status: "pendente",
        aceita_financeiro: false,
        aceita_financeiro_em: null,
        aceita_financeiro_por: null,
        reopen_reason: motivo,
        reopened_at: new Date().toISOString(),
        reopened_by: user!.id,
      }).eq("id", occ.id);
      if (e0) { toast.error(e0.message); return; }
      const { error: e1 } = await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", sale.id);
      if (e1) { toast.error(e1.message); return; }
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
      setReopenOpen(false);
      onReopened();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao reabrir ocorrência");
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
              <Button variant="outline" size="sm" onClick={openReopenDialog} disabled={reopening}>
                <RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
        </div>

        <OccurrenceReportBody sale={sale} occ={occ} commissions={commissions} partners={partners} parties={parties} />
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

      <Dialog open={reopenOpen} onOpenChange={(o) => { if (!reopening) setReopenOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir ocorrência</DialogTitle>
            <DialogDescription>Descreva a justificativa. O corretor será notificado.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Justificativa (obrigatória)" value={reopenMotivo} onChange={(e) => setReopenMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)} disabled={reopening}>Cancelar</Button>
            <Button onClick={reopen} disabled={reopening || !reopenMotivo.trim()}>Reabrir</Button>
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

const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Campo de valor em reais: digita-se em centavos (estilo maquininha) e formata como "R$ 1.234,56". */
function CurrencyInput({ value, onChange, disabled }: { value: number | null | undefined; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [display, setDisplay] = useState(() => (value != null ? brl(Math.round(value * 100)) : ""));

  useEffect(() => {
    setDisplay(value != null ? brl(Math.round(value * 100)) : "");
  }, [value]);

  return (
    <Input
      inputMode="decimal"
      placeholder="R$ 0,00"
      disabled={disabled}
      value={display}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        if (!digits) { setDisplay(""); onChange(null); return; }
        const cents = parseInt(digits, 10);
        setDisplay(brl(cents));
        onChange(cents / 100);
      }}
    />
  );
}

const partePapelSort = (a: string, b: string) => {
  const ka = parteSortKey(a), kb = parteSortKey(b);
  return ka[0] - kb[0] || ka[1] - kb[1];
};

// -------- Partes step (buffered) --------
// Compradores e vendedores são em número livre — o corretor adiciona quantos precisar, um bloco
// (nested Wizard) por pessoa, e só o "_1" de cada lado é obrigatório/fixo.
function PartiesStep({ saleId, parties, editable, onSaved, registerSaver, onDirtyChange }: {
  saleId: string; parties: Record<string, any>; editable: boolean; onSaved: () => void;
  registerSaver: (fn: Saver | null) => void; onDirtyChange: (d: boolean) => void;
}) {
  const [papeis, setPapeis] = useState<string[]>(() => {
    const fromDb = Object.keys(parties).filter((p) => /^(vendedor|comprador)_\d+$/.test(p));
    return Array.from(new Set(["vendedor_1", "comprador_1", ...fromDb])).sort(partePapelSort);
  });
  const [forms, setForms] = useState<Record<string, any>>(() => {
    const m: Record<string, any> = {};
    papeis.forEach(p => { m[p] = parties[p] ?? {}; });
    return m;
  });
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const anyDirty = useMemo(() => Object.values(dirty).some(Boolean), [dirty]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForms((prev) => {
      const m: Record<string, any> = {};
      for (const p of papeis) m[p] = parties[p] ?? prev[p] ?? {};
      return m;
    });
    setDirty({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties]);

  useEffect(() => { onDirtyChange(anyDirty); }, [anyDirty, onDirtyChange]);

  const update = (papel: string, k: string, v: string) => {
    setForms(f => ({ ...f, [papel]: { ...f[papel], [k]: v } }));
    setDirty(d => ({ ...d, [papel]: true }));
  };

  const [activePapel, setActivePapel] = useState(papeis[0]);

  const addPapel = (tipo: "vendedor" | "comprador") => {
    const nums = papeis.filter((p) => p.startsWith(`${tipo}_`)).map((p) => Number(p.split("_")[1]));
    const novoPapel = `${tipo}_${(nums.length ? Math.max(...nums) : 0) + 1}`;
    setPapeis((prev) => [...prev, novoPapel].sort(partePapelSort));
    setForms((f) => ({ ...f, [novoPapel]: {} }));
    setActivePapel(novoPapel);
  };

  const removePapel = async (papel: string) => {
    const existing = parties[papel];
    if (existing?.id) {
      const { error } = await supabase.from("sale_parties").delete().eq("id", existing.id);
      if (error) { toast.error(error.message); return; }
    }
    const idx = papeis.indexOf(papel);
    setPapeis((prev) => prev.filter((p) => p !== papel));
    setForms((f) => { const n = { ...f }; delete n[papel]; return n; });
    setDirty((d) => { const n = { ...d }; delete n[papel]; return n; });
    if (activePapel === papel) setActivePapel(papeis[idx - 1] ?? papeis[idx + 1] ?? papeis[0]);
    toast.success("Removido");
    onSaved();
  };

  const saveAll = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const papel of papeis) {
        if (!dirty[papel]) continue;
        const existing = parties[papel];
        const data = { nome: forms[papel].nome ?? null, rg: forms[papel].rg ?? null, cpf_cnpj: forms[papel].cpf_cnpj ?? null, profissao: forms[papel].profissao ?? null, email: forms[papel].email ?? null, telefone: forms[papel].telefone ?? null, endereco: forms[papel].endereco ?? null };
        const { error } = existing
          ? await supabase.from("sale_parties").update(data).eq("id", existing.id)
          : await supabase.from("sale_parties").insert({ sale_id: saleId, papel, ...data });
        if (error) { toast.error(error.message); return false; }
      }
      setDirty({});
      onSaved();
      return true;
    } finally {
      setSaving(false);
    }
  }, [dirty, forms, papeis, parties, saleId, onSaved]);

  useEffect(() => { registerSaver(saveAll); return () => registerSaver(null); }, [saveAll, registerSaver]);
  useAutosave(editable && anyDirty, [forms, dirty], saveAll);

  return (
    <div className="space-y-4">
      {editable && <AutosaveStatus saving={saving} dirty={anyDirty} />}
      <Wizard
        steps={papeis.map((p, i) => {
          const numero = Number(p.split("_")[1]);
          return {
          key: p,
          label: parteLabel(p),
          content: (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{parteLabel(p)}</CardTitle>
            {editable && numero > 1 && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => removePapel(p)}>Remover</Button>
            )}
          </CardHeader>
          <CardContent>
            <FieldGrid>
              <Field label="Nome"><Input value={forms[p].nome ?? ""} onChange={(e) => update(p, "nome", e.target.value)} disabled={!editable} /></Field>
              <Field label="RG"><Input value={forms[p].rg ?? ""} onChange={(e) => update(p, "rg", e.target.value)} disabled={!editable} /></Field>
              <Field label="CPF/CNPJ"><Input value={forms[p].cpf_cnpj ?? ""} onChange={(e) => update(p, "cpf_cnpj", e.target.value)} disabled={!editable} /></Field>
              <Field label="Profissão"><Input value={forms[p].profissao ?? ""} onChange={(e) => update(p, "profissao", e.target.value)} disabled={!editable} /></Field>
              <Field label="E-mail"><Input type="email" value={forms[p].email ?? ""} onChange={(e) => update(p, "email", e.target.value)} disabled={!editable} /></Field>
              <Field label="Telefone"><Input value={forms[p].telefone ?? ""} onChange={(e) => update(p, "telefone", e.target.value)} disabled={!editable} /></Field>
              <Field label="Endereço" colSpan={2}><Input value={forms[p].endereco ?? ""} onChange={(e) => update(p, "endereco", e.target.value)} disabled={!editable} /></Field>
            </FieldGrid>
          </CardContent>
          <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-0">
            <div className="flex gap-2">
              {editable && (
                <>
                  <Button size="sm" variant="outline" onClick={() => addPapel("comprador")}>+ Adicionar comprador</Button>
                  <Button size="sm" variant="outline" onClick={() => addPapel("vendedor")}>+ Adicionar vendedor</Button>
                </>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {i > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i - 1])}>
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                </Button>
              )}
              {i < papeis.length - 1 && (
                <Button size="sm" variant="ghost" onClick={() => setActivePapel(papeis[i + 1])}>
                  Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
          ),
        };})}
        current={activePapel}
        onChange={setActivePapel}
        hideNav
      />
    </div>
  );
}

// -------- Pagamento step (buffered) --------
function PaymentStep({ saleId, payment, bank, parties, editable, onSaved, registerSaver, onDirtyChange }: {
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
    if (!nome) { toast.error("Preencha o nome do vendedor na etapa Partes primeiro"); return; }
    updB("titular", nome);
    toast.success("Nome do vendedor aplicado ao titular");
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
            <Field label="Entrada — data"><Input type="date" value={p.entrada_data ?? ""} onChange={(e) => updP("entrada_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — valor"><CurrencyInput value={p.parcela1_valor} onChange={(v) => updP("parcela1_valor", v)} disabled={!editable} /></Field>
            <Field label="Parcela 1 — data"><Input type="date" value={p.parcela1_data ?? ""} onChange={(e) => updP("parcela1_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — valor"><CurrencyInput value={p.parcela2_valor} onChange={(v) => updP("parcela2_valor", v)} disabled={!editable} /></Field>
            <Field label="Parcela 2 — data"><Input type="date" value={p.parcela2_data ?? ""} onChange={(e) => updP("parcela2_data", e.target.value || null)} disabled={!editable} /></Field>
            <Field label="Pagamento final — valor"><CurrencyInput value={p.pagamento_final_valor} onChange={(v) => updP("pagamento_final_valor", v)} disabled={!editable} /></Field>
            <Field label="Pagamento final — data"><Input type="date" value={p.pagamento_final_data ?? ""} onChange={(e) => updP("pagamento_final_data", e.target.value || null)} disabled={!editable} /></Field>
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
                    updP("oba_credito", false);
                  }
                }}
                disabled={!editable}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vista">Vista</SelectItem>
                  <SelectItem value="financiamento">Financiamento</SelectItem>
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
            label: "Dados bancários do vendedor",
            content: (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dados bancários do vendedor</CardTitle>
          {editable && <Button size="sm" variant="outline" onClick={pullTitular}>Puxar nome do vendedor</Button>}
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

// Tipos de documento que costumam ser o mesmo arquivo para o casal (certidão de casamento conjunta,
// comprovante de endereço compartilhado) — só esses ganham a opção "Mesmo do 1º" no 2º comprador/vendedor.
const REUSABLE_DOC_TYPES = new Set(["certidao", "comprovante_endereco"]);

function DocumentsPanel({ saleId, saleStatus, docs, editable, canModerate, canUseAi, canManageContratos, canDownloadAll, onChange }: { saleId: string; saleStatus: SaleStatus; docs: any[]; editable: boolean; canModerate: boolean; canUseAi: boolean; canManageContratos: boolean; canDownloadAll: boolean; onChange: () => void }) {
  const { user } = useAuth();
  const [applying, setApplying] = useState(false);
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{ doc: any; url: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [printingAll, setPrintingAll] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [pendingReject, setPendingReject] = useState<any | null>(null);
  const [rejectMotivo, setRejectMotivo] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // Certidões pedidas pelo jurídico: linhas dinâmicas (nome + upload) — "+" adiciona mais uma.
  const [certidaoDrafts, setCertidaoDrafts] = useState<{ id: string; nome: string }[]>([{ id: crypto.randomUUID(), nome: "" }]);
  const [uploadingCertidao, setUploadingCertidao] = useState<Record<string, boolean>>({});
  const updCertidaoNome = (draftId: string, nome: string) => {
    setCertidaoDrafts((rows) => rows.map((r) => (r.id === draftId ? { ...r, nome } : r)));
  };
  const addCertidaoDraft = () => {
    setCertidaoDrafts((rows) => [...rows, { id: crypto.randomUUID(), nome: "" }]);
  };
  const uploadCertidao = async (draftId: string, nome: string, file: File) => {
    setUploadingCertidao((m) => ({ ...m, [draftId]: true }));
    try {
      const ext = file.name.split(".").pop();
      const path = `${saleId}/juridico/certidao_juridico/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("sale-documents").upload(path, file, { upsert: false });
      if (error) { toast.error(error.message); return; }
      const { error: insErr } = await supabase.from("sale_documents").insert({
        sale_id: saleId, tipo: "certidao_juridico", parte: "juridico", storage_path: path, file_name: file.name,
        descricao: nome.trim() || null, uploaded_by: user!.id, status: "enviado",
      } as any);
      if (insErr) { toast.error(insErr.message); return; }
      await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_uploaded", payload: { tipo: "certidao_juridico", descricao: nome } });
      toast.success("Certidão enviada");
      setCertidaoDrafts((rows) => {
        const next = rows.filter((r) => r.id !== draftId);
        return next.length > 0 ? next : [{ id: crypto.randomUUID(), nome: "" }];
      });
      onChange();
    } finally {
      setUploadingCertidao((m) => { const next = { ...m }; delete next[draftId]; return next; });
    }
  };

  const zoomIn = () => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)));

  const viewDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 300);
    if (error || !data) { toast.error("Falha ao gerar link"); return; }
    setZoom(1);
    setPreview({ doc, url: data.signedUrl });
  };

  const printDoc = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 300);
    if (error || !data) { toast.error("Falha ao gerar link"); return; }
    printDocumentUrls([{ file_name: doc.file_name, url: data.signedUrl }]);
  };

  const printAllDocs = async () => {
    if (docs.length === 0) return;
    setPrintingAll(true);
    try {
      const { data, error } = await supabase.storage.from("sale-documents").createSignedUrls(docs.map((d) => d.storage_path), 300);
      if (error || !data) { toast.error("Falha ao gerar links"); return; }
      const list = data
        .map((r, i) => (r.signedUrl ? { file_name: docs[i].file_name, url: r.signedUrl } : null))
        .filter((x): x is { file_name: string; url: string } => !!x);
      if (list.length === 0) { toast.error("Nenhum documento disponível para impressão"); return; }
      printDocumentUrls(list);
    } finally {
      setPrintingAll(false);
    }
  };

  const downloadAllAsPdf = async () => {
    if (docs.length === 0) return;
    setDownloadingAll(true);
    try {
      const { data, error } = await supabase.storage.from("sale-documents").createSignedUrls(docs.map((d) => d.storage_path), 300);
      if (error || !data) { toast.error("Falha ao gerar links"); return; }
      const list = data
        .map((r, i) => (r.signedUrl ? { file_name: docs[i].file_name, url: r.signedUrl } : null))
        .filter((x): x is { file_name: string; url: string } => !!x);
      if (list.length === 0) { toast.error("Nenhum documento disponível para baixar"); return; }
      await baixarDocumentosComoPdf(list, `documentos-${saleId.slice(0, 8)}.pdf`);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao gerar PDF");
    } finally {
      setDownloadingAll(false);
    }
  };

  const removeDoc = async (doc: any) => {
    setDeleting(true);
    try {
      // Documentos "Mesmo do 1º" apontam para o mesmo arquivo no storage — só apaga o arquivo
      // de fato se nenhum outro registro (o original ou outra cópia) ainda depender dele.
      const sharedWithOthers = docs.some(d => d.id !== doc.id && d.storage_path === doc.storage_path);
      if (!sharedWithOthers) {
        const { error: stErr } = await supabase.storage.from("sale-documents").remove([doc.storage_path]);
        if (stErr) console.warn("storage remove", stErr.message);
      }
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
      if (!res.ok) { toast.error(`Falha ao ler documento: ${res.error}`); return; }
      // Uma leitura bem-sucedida só vira dado visível se for aplicada aos campos —
      // sem isso o usuário vê "IA ok" no documento mas o formulário continua vazio.
      const applied = await applySaleExtractions({ data: { saleId } });
      toast.success(applied.filled.length ? `Documento lido pela IA • ${applied.filled.length} campo(s) preenchido(s)` : "Documento lido pela IA");
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao extrair dados");
    } finally {
      setExtracting((m) => ({ ...m, [documentId]: false }));
      onChange();
    }
  }, [onChange, saleId]);

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

  // Certidão de casamento e comprovante de endereço costumam ser o mesmo documento para o casal —
  // em vez de reenviar, o 2º comprador/vendedor reaproveita o arquivo já enviado pelo 1º.
  const copyFromBase = async (tipo: string, parte: DocParte) => {
    const baseParte = parteBase(parte);
    if (!baseParte) return;
    const baseDocs = docs.filter(d => d.tipo === tipo && (d.parte ?? "outros") === baseParte && d.status !== "recusado");
    const baseDoc = baseDocs[baseDocs.length - 1];
    if (!baseDoc) { toast.error(`Envie primeiro o documento de ${parteLabel(baseParte)}`); return; }
    const { error } = await supabase.from("sale_documents").insert({
      sale_id: saleId, tipo, parte, storage_path: baseDoc.storage_path, file_name: baseDoc.file_name,
      uploaded_by: user!.id, status: baseDoc.status, extraction_status: "done",
    } as any);
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_reused_from_other_party", payload: { tipo, parte, de: baseParte } });
    toast.success(`Documento reaproveitado de ${parteLabel(baseParte)}`);
    onChange();
  };

  const approve = async (doc: any) => {
    const { error } = await supabase.from("sale_documents").update({ status: "aprovado", motivo_recusa: null }).eq("id", doc.id);
    if (error) { toast.error(error.message); return; }
    await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_approved", payload: { doc_id: doc.id, tipo: doc.tipo } });
    onChange();
  };
  const openRejectDialog = (doc: any) => { setRejectMotivo(""); setPendingReject(doc); };
  const reject = async () => {
    const doc = pendingReject;
    const motivo = rejectMotivo.trim();
    if (!doc || !motivo) { toast.error("Motivo é obrigatório"); return; }
    setRejecting(true);
    try {
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
      setPendingReject(null);
      onChange();
    } finally {
      setRejecting(false);
    }
  };

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const applyAll = async () => {
    setApplying(true);
    setProgress(null);
    try {
      // 1) Lê todos os docs que ainda não foram extraídos com sucesso
      const pendentes = docs.filter((d) => d.extraction_status !== "done" && d.tipo !== "contrato" && d.tipo !== "contrato_assinado");
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

  // Blocos por parte da venda. Compradores/vendedores extras (3º, 4º, ...) aparecem sob demanda,
  // em número livre — a IA usa a parte declarada em cada upload para rotear os dados extraídos.
  const numerosExtras = (tipo: "comprador" | "vendedor") => {
    const re = new RegExp(`^${tipo}_(\\d+)$`);
    const nums = docs.map(d => d.parte?.match(re)?.[1]).filter(Boolean).map(Number);
    return Array.from(new Set(nums)).filter(n => n > 1).sort((a, b) => a - b);
  };
  const [compradorExtras, setCompradorExtras] = useState<number[]>(() => numerosExtras("comprador"));
  const [vendedorExtras, setVendedorExtras] = useState<number[]>(() => numerosExtras("vendedor"));
  useEffect(() => {
    setCompradorExtras(prev => Array.from(new Set([...prev, ...numerosExtras("comprador")])).sort((a, b) => a - b));
    setVendedorExtras(prev => Array.from(new Set([...prev, ...numerosExtras("vendedor")])).sort((a, b) => a - b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);
  const addParte = (tipo: "comprador" | "vendedor") => {
    const setFn = tipo === "comprador" ? setCompradorExtras : setVendedorExtras;
    setFn(prev => [...prev, (prev.length ? Math.max(...prev) : 1) + 1]);
  };

  const pessoalTipos = DOC_TYPES.filter(t => t.grupo === "pessoal");
  const blocos: { parte: DocParte; tipos: typeof DOC_TYPES }[] = [
    { parte: "comprador_1", tipos: pessoalTipos },
    ...compradorExtras.map(n => ({ parte: `comprador_${n}` as DocParte, tipos: pessoalTipos })),
    { parte: "vendedor_1", tipos: pessoalTipos },
    ...vendedorExtras.map(n => ({ parte: `vendedor_${n}` as DocParte, tipos: pessoalTipos })),
    { parte: "imovel", tipos: DOC_TYPES.filter(t => t.grupo === "imovel") },
    { parte: "outros", tipos: DOC_TYPES.filter(t => t.grupo === "outros") },
    // Bloco de certidões do jurídico só aparece depois que a venda chega nessa etapa —
    // antes disso não faz sentido pedir certidão pra ninguém ainda.
    ...(chegouAoJuridico(saleStatus) ? [{ parte: "juridico" as DocParte, tipos: [] as typeof DOC_TYPES }] : []),
  ];
  // Navegação entre os blocos em modo wizard (um de cada vez, com Voltar/Próximo) —
  // mesma linguagem visual do wizard principal da venda.
  const [activeParte, setActiveParte] = useState<DocParte>("comprador_1");
  const enabledBlocos = blocos.filter(b => b.tipos.length > 0 || b.parte === "juridico");
  const goToNextBlock = (parte: DocParte) => {
    const idx = enabledBlocos.findIndex(b => b.parte === parte);
    const next = enabledBlocos[idx + 1];
    if (next) setActiveParte(next.parte);
  };
  const goToPrevBlock = (parte: DocParte) => {
    const idx = enabledBlocos.findIndex(b => b.parte === parte);
    const prev = enabledBlocos[idx - 1];
    if (prev) setActiveParte(prev.parte);
  };

  // Leitura automática: cada documento enviado entra na fila de leitura sozinho, sem esperar o
  // bloco inteiro nem precisar clicar em "Ler documentos e aplicar dados". As leituras ficam
  // enfileiradas e espaçadas (~13s cada) para não estourar o limite de requisições por minuto
  // da API do Gemini quando vários uploads acontecem perto um do outro.
  const autoQueuedIdsRef = useRef<Set<string>>(new Set());
  const autoJobQueueRef = useRef<{ parte: DocParte; ids: string[] }[]>([]);
  const autoProcessingRef = useRef(false);
  const AUTO_EXTRACT_DELAY_MS = 13000;

  const processAutoQueue = useCallback(async () => {
    if (autoProcessingRef.current) return;
    autoProcessingRef.current = true;
    try {
      while (autoJobQueueRef.current.length > 0) {
        const job = autoJobQueueRef.current.shift()!;
        for (let i = 0; i < job.ids.length; i++) {
          // runExtraction já aplica os dados extraídos aos campos a cada documento lido.
          await runExtraction(job.ids[i]);
          const isLast = i === job.ids.length - 1 && autoJobQueueRef.current.length === 0;
          if (!isLast) await new Promise((r) => setTimeout(r, AUTO_EXTRACT_DELAY_MS));
        }
      }
    } finally {
      autoProcessingRef.current = false;
    }
  }, [runExtraction]);

  useEffect(() => {
    if (!editable) return;
    // Contrato/contrato assinado não têm dados de pessoa/imóvel pra extrair, e certidões do
    // jurídico não têm roteamento de campos definido — ficam de fora da leitura automática.
    // Só documentos NUNCA lidos (extraction_status "none", o valor padrão da coluna — não é
    // null) entram na fila — um que já falhou (quota do Gemini, etc.) não é retentado sozinho
    // a cada reload; fica "IA falhou" até o usuário mandar ler de novo manualmente.
    const pendentes = docs.filter(
      (d) => d.extraction_status === "none"
        && d.tipo !== "contrato" && d.tipo !== "contrato_assinado"
        && d.parte !== "juridico"
        && !autoQueuedIdsRef.current.has(d.id),
    );
    if (pendentes.length > 0) {
      for (const d of pendentes) autoQueuedIdsRef.current.add(d.id);
      autoJobQueueRef.current.push({ parte: pendentes[0].parte, ids: pendentes.map((d) => d.id) });
      void processAutoQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, editable]);

  return (
    <div className="space-y-6">
      <Card className={canUseAi ? "border-primary/40 bg-primary/5" : ""}>
        <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
          {canUseAi ? (
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 text-primary" />
              <div className="text-sm">
                <div className="font-medium">Leitura automática por IA</div>
                <p className="text-muted-foreground">
                  Assim que você envia um documento, a IA já lê sozinha (em alguns segundos) e roteia os dados para a pessoa certa nas próximas etapas — sem precisar clicar em nada.
                </p>
              </div>
            </div>
          ) : <div />}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={printAllDocs} disabled={docs.length === 0 || printingAll}>
              {printingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              Imprimir todos
            </Button>
            {canDownloadAll && (
              <Button size="sm" variant="outline" onClick={downloadAllAsPdf} disabled={docs.length === 0 || downloadingAll}>
                {downloadingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Baixar todos (PDF)
              </Button>
            )}
            {canUseAi && (
              <Button size="sm" onClick={applyAll} disabled={docs.length === 0 || applying || !editable}>
                {applying ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {progress ? `Lendo ${progress.done}/${progress.total}...` : "Aplicando..."}
                  </>
                ) : (
                  <><Sparkles className="mr-2 h-4 w-4" />Ler documentos e aplicar dados</>
                )}
              </Button>
            )}
          </div>
        </CardContent>
        {canUseAi && anyPending && !applying && (
          <CardContent className="pt-0 text-xs text-muted-foreground">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Lendo documento(s)...
          </CardContent>
        )}
      </Card>

      <Wizard
        steps={enabledBlocos.map(({ parte, tipos }) => {
        const parteNumero = Number(parte.split("_")[1]);
        const parteAccent =
          parte.startsWith("comprador_") ? "border-l-4 border-l-blue-500" :
          parte.startsWith("vendedor_") ? "border-l-4 border-l-amber-500" :
          parte === "imovel" ? "border-l-4 border-l-emerald-500" : "";
        return {
          key: parte,
          label: parteLabel(parte),
          content: (
          <section className="space-y-3">
            {editable && parteNumero > 1 && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => (parte.startsWith("comprador_")
                    ? setCompradorExtras(prev => prev.filter(n => n !== parteNumero))
                    : setVendedorExtras(prev => prev.filter(n => n !== parteNumero)))}
                  disabled={docs.some(d => d.parte === parte)}
                >
                  Remover {parteLabel(parte)}
                </Button>
              </div>
            )}
            {tipos.map((t) => {
              const list = docs.filter(d => d.tipo === t.key && (d.parte ?? "outros") === parte);
              const latest = list[list.length - 1];
              // CNH enviada para essa parte dispensa o RG e o CPF, já que ela contém as duas informações.
              const dispensadoPorCnh = (t.key === "rg" || t.key === "cpf") && temDocDoTipo(docs, "cnh", parte);
              const obrigatorioEfetivo = t.obrigatorio && !dispensadoPorCnh;
              // "Contrato" e "Contrato assinado" já têm fluxo dedicado (jurídico anexa, gestor sobe o assinado) —
              // o corretor não deve enviar esses dois tipos por aqui, pra não pular a conferência.
              const isContratoTipo = t.key === "contrato" || t.key === "contrato_assinado";
              const podeEnviarAqui = editable && (!isContratoTipo || canManageContratos);
              return (
                <Card key={`${parte}-${t.key}`} className={parteAccent}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{t.label}{obrigatorioEfetivo && (parte === "comprador_1" || parte === "vendedor_1") ? <span className="ml-1 text-destructive">*</span> : null}</div>
                        {obrigatorioEfetivo && (parte === "comprador_1" || parte === "vendedor_1") && <div className="text-xs text-muted-foreground">Obrigatório</div>}
                        {dispensadoPorCnh && <div className="text-xs text-emerald-700 dark:text-emerald-400">Dispensado — CNH enviada</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {latest && <DocStatusBadge status={latest.status} />}
                        {editable && list.length === 0 && parteBase(parte) && REUSABLE_DOC_TYPES.has(t.key) && (
                          <Button size="sm" variant="ghost" onClick={() => copyFromBase(t.key, parte)}>
                            Mesmo do {parteLabel(parteBase(parte)!)}
                          </Button>
                        )}
                        {podeEnviarAqui && (
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
                        <button className="truncate text-left hover:underline" onClick={() => viewDoc(d)}>{d.file_name}</button>
                        <div className="flex items-center gap-2">
                          {canUseAi && d.tipo !== "contrato" && d.tipo !== "contrato_assinado" && (
                            <ExtractionBadge status={d.extraction_status} loading={!!extracting[d.id]} />
                          )}
                          <Button size="sm" variant="ghost" title="Visualizar" onClick={() => viewDoc(d)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Imprimir" onClick={() => printDoc(d)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          {canUseAi && editable && d.tipo !== "contrato" && d.tipo !== "contrato_assinado" && d.extraction_status !== "pending" && !extracting[d.id] && (
                            <Button size="sm" variant="ghost" title="Ler novamente com IA" onClick={() => runExtraction(d.id)}>
                              <Sparkles className="h-4 w-4" />
                            </Button>
                          )}
                          <DocStatusBadge status={d.status} />
                          {canModerate && d.status !== "aprovado" && (
                            <Button size="sm" variant="ghost" onClick={() => approve(d)}><FileCheck className="h-4 w-4" /></Button>
                          )}
                          {canModerate && d.status !== "recusado" && (
                            <Button size="sm" variant="ghost" onClick={() => openRejectDialog(d)}><FileX className="h-4 w-4" /></Button>
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
            {parte === "juridico" && (
              <>
                {docs.filter((d) => d.tipo === "certidao_juridico").map((d) => (
                  <Card key={d.id} className="border-l-4 border-l-indigo-500">
                    <CardContent className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{d.descricao || d.file_name}</div>
                          {d.descricao && <div className="text-xs text-muted-foreground">{d.file_name}</div>}
                        </div>
                        <DocStatusBadge status={d.status} />
                      </div>
                      {d.status === "recusado" && d.motivo_recusa && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                          <b>Motivo da recusa:</b> {d.motivo_recusa}
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" title="Visualizar" onClick={() => viewDoc(d)}><Eye className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" title="Imprimir" onClick={() => printDoc(d)}><Printer className="h-4 w-4" /></Button>
                        {canModerate && d.status !== "aprovado" && (
                          <Button size="sm" variant="ghost" onClick={() => approve(d)}><FileCheck className="h-4 w-4" /></Button>
                        )}
                        {canModerate && d.status !== "recusado" && (
                          <Button size="sm" variant="ghost" onClick={() => openRejectDialog(d)}><FileX className="h-4 w-4" /></Button>
                        )}
                        {editable && (d.uploaded_by === user?.id || canModerate) && (
                          <Button size="sm" variant="ghost" title="Excluir" onClick={() => setPendingDelete(d)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {canManageContratos && certidaoDrafts.map((draft) => (
                  <Card key={draft.id}>
                    <CardContent className="flex flex-wrap items-center gap-2 p-4">
                      <Input
                        placeholder="Nome da certidão (ex: Certidão de ônus reais)"
                        value={draft.nome}
                        onChange={(e) => updCertidaoNome(draft.id, e.target.value)}
                        className="min-w-[14rem] flex-1"
                      />
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                        <Upload className="h-4 w-4" />
                        <span>{uploadingCertidao[draft.id] ? "Enviando..." : "Enviar"}</span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          className="hidden"
                          disabled={!!uploadingCertidao[draft.id]}
                          onChange={(e) => e.target.files?.[0] && uploadCertidao(draft.id, draft.nome, e.target.files[0])}
                        />
                      </label>
                    </CardContent>
                  </Card>
                ))}
                {canManageContratos && (
                  <Button size="sm" variant="outline" onClick={addCertidaoDraft}>
                    <Plus className="mr-1 h-4 w-4" />Adicionar certidão
                  </Button>
                )}
              </>
            )}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {editable && parte.startsWith("comprador_") && (
                  <Button size="sm" variant="outline" onClick={() => addParte("comprador")}>+ Adicionar comprador</Button>
                )}
                {editable && parte.startsWith("vendedor_") && (
                  <Button size="sm" variant="outline" onClick={() => addParte("vendedor")}>+ Adicionar vendedor</Button>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {enabledBlocos.findIndex(b => b.parte === parte) > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => goToPrevBlock(parte)}>
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar
                  </Button>
                )}
                {enabledBlocos.findIndex(b => b.parte === parte) < enabledBlocos.length - 1 && (
                  <Button size="sm" variant="ghost" onClick={() => goToNextBlock(parte)}>
                    Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </section>
          ),
        };
        })}
        current={activeParte}
        onChange={(k) => setActiveParte(k as DocParte)}
        hideNav
      />

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

      <Dialog open={!!pendingReject} onOpenChange={(o) => { if (!rejecting && !o) setPendingReject(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recusar documento</DialogTitle>
            <DialogDescription>Descreva o motivo da recusa. O corretor será notificado.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Motivo da recusa (obrigatório)" value={rejectMotivo} onChange={(e) => setRejectMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingReject(null)} disabled={rejecting}>Cancelar</Button>
            <Button onClick={reject} disabled={rejecting || !rejectMotivo.trim()}>Recusar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.doc.file_name}</DialogTitle>
          </DialogHeader>
          {preview && isImageFile(preview.doc.file_name) && (
            <div className="flex items-center justify-end gap-1">
              <Button size="sm" variant="outline" onClick={zoomOut} disabled={zoom <= 0.5}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="outline" onClick={zoomIn} disabled={zoom >= 3}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              {zoom !== 1 && (
                <Button size="sm" variant="outline" onClick={() => setZoom(1)}>Redefinir</Button>
              )}
            </div>
          )}
          {preview && (
            <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/30">
              {isImageFile(preview.doc.file_name) ? (
                <img
                  src={preview.url}
                  alt={preview.doc.file_name}
                  className="mx-auto cursor-zoom-in select-none"
                  style={zoom === 1 ? { maxHeight: "70vh", maxWidth: "100%", width: "auto" } : { width: `${zoom * 100}%`, maxWidth: "none", maxHeight: "none" }}
                  onDoubleClick={() => setZoom((z) => (z === 1 ? 2 : 1))}
                />
              ) : (
                <iframe src={preview.url} title={preview.doc.file_name} className="h-[70vh] w-full" />
              )}
            </div>
          )}
          <DialogFooter>
            {canModerate && preview?.doc.status !== "aprovado" && (
              <Button variant="outline" onClick={() => { approve(preview!.doc); setPreview(null); }}>
                <FileCheck className="mr-2 h-4 w-4" />Aprovar
              </Button>
            )}
            {canModerate && preview?.doc.status !== "recusado" && (
              <Button variant="outline" onClick={() => { openRejectDialog(preview!.doc); setPreview(null); }}>
                <FileX className="mr-2 h-4 w-4" />Recusar
              </Button>
            )}
            <Button variant="outline" onClick={() => preview && printDocumentUrls([{ file_name: preview.doc.file_name, url: preview.url }])}>
              <Printer className="mr-2 h-4 w-4" />Imprimir
            </Button>
            <Button variant="outline" onClick={() => preview && window.open(preview.url, "_blank")}>
              <Download className="mr-2 h-4 w-4" />Baixar
            </Button>
            <Button onClick={() => setPreview(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

// Partes extras da divisão (Resumo) viram comissões na ocorrência usando o "papel" que a pessoa
// recebeu lá (Gestor/Team Leader/Outro) — sem papel definido, cai em "outro".
const EXTRA_ORIGEM_PAPEIS = new Set(["gestor", "team_leader", "outro"]);
const papelDaExtra = (papel: string | null) => (papel && EXTRA_ORIGEM_PAPEIS.has(papel) ? papel : "outro");

/**
 * Sempre que a Resumo é salva (captador/vendedor/indicador/partes extras), joga esses valores
 * direto na ocorrência já criada — sem isso, o que foi preenchido lá só aparecia na Ocorrência
 * depois de alguém clicar manualmente em "Puxar da revisão do gestor". Se a ocorrência ainda não
 * existe, não faz nada (ela nasce com esses dados quando for criada).
 */
async function syncOccurrenceCommissions(saleId: string, sale: any, commissionExtras: any[]) {
  const { data: occ } = await supabase.from("occurrences").select("id, valor_comissao").eq("sale_id", saleId).maybeSingle();
  if (!occ) return;

  const { data: existing } = await supabase.from("occurrence_commissions").select("*").eq("occurrence_id", occ.id);
  const rows = existing ?? [];
  const total = Number(occ.valor_comissao ?? 0);
  const pctOfTotal = (v: any) => (v != null && total > 0 ? Number(((Number(v) / total) * 100).toFixed(3)) : null);

  const fixedUpdates: { papel: string; nome: any; valor: any }[] = [
    { papel: "corretor_captador", nome: sale.corretor_captador ?? null, valor: sale.valor_comissao_captador ?? null },
    { papel: "corretor_vendedor", nome: sale.corretor_vendedor ?? null, valor: sale.valor_comissao_vendedor ?? null },
  ];
  if (sale.indicador_lado === "captador") fixedUpdates.push({ papel: "indicador_captador", nome: sale.indicador ?? null, valor: sale.valor_comissao_indicador ?? null });
  if (sale.indicador_lado === "vendedor") fixedUpdates.push({ papel: "indicador_vendedor", nome: sale.indicador ?? null, valor: sale.valor_comissao_indicador ?? null });

  for (const upd of fixedUpdates) {
    if (upd.nome == null && upd.valor == null) continue;
    const row = rows.find((r) => r.papel === upd.papel);
    const percentual = pctOfTotal(upd.valor);
    if (row) {
      if (row.nome !== upd.nome || Number(row.valor ?? 0) !== Number(upd.valor ?? 0)) {
        await supabase.from("occurrence_commissions").update({ nome: upd.nome, valor: upd.valor, percentual }).eq("id", row.id);
      }
    } else {
      await supabase.from("occurrence_commissions").insert({ occurrence_id: occ.id, papel: upd.papel, nome: upd.nome, valor: upd.valor, percentual });
    }
  }

  for (const extra of commissionExtras) {
    const papel = papelDaExtra(extra.papel);
    // Casa pelo id estável da parte extra (sale_commission_extra_id) — casar só por nome quebra
    // quando o nome muda entre um save e outro (ex.: linha criada "sem nome" e preenchida depois),
    // já que aí vira um "nome" diferente e uma linha nova duplicada era criada em vez de atualizar.
    const row = rows.find((r) => r.sale_commission_extra_id === extra.id)
      ?? rows.find((r) => !r.sale_commission_extra_id && r.papel === papel && r.nome === extra.nome);
    const percentual = pctOfTotal(extra.valor);
    if (row) {
      if (row.nome !== extra.nome || Number(row.valor ?? 0) !== Number(extra.valor ?? 0) || row.sale_commission_extra_id !== extra.id) {
        await supabase.from("occurrence_commissions").update({ nome: extra.nome, valor: extra.valor, percentual, sale_commission_extra_id: extra.id }).eq("id", row.id);
      }
    } else {
      await supabase.from("occurrence_commissions").insert({ occurrence_id: occ.id, papel, nome: extra.nome, valor: extra.valor, percentual, sale_commission_extra_id: extra.id });
    }
  }
}

// -------- Occurrence step (buffered) --------
function OccurrencePanel({ saleId, sale, payment, parties, commissionExtras, canEdit, onChange, registerSaver, onDirtyChange }: {
  saleId: string; sale: any; payment: any; parties: Record<string, any>; commissionExtras: any[]; canEdit: boolean; onChange: () => void;
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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenMotivo, setReopenMotivo] = useState("");
  const [reopening, setReopening] = useState(false);
  const [saving, setSaving] = useState(false);

  const anyDirty = dirtyOcc || dirtyComms || dirtyPartners;
  const concluida = occ?.status === "concluida";
  const canWrite = canEdit && !concluida;
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

  // Sempre que a Resumo salva captador/vendedor/indicador/partes extras, o valor já é
  // sincronizado direto no banco (ver syncOccurrenceCommissions) — aqui só recarrega essa
  // tela pra refletir o que já foi salvo, sem precisar de F5 nem clicar em "Puxar".
  // Não recarrega se houver edição não salva na tabela, pra não apagar o que o usuário
  // estava digitando.
  useEffect(() => {
    if (dirtyComms) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale.corretor_captador, sale.corretor_vendedor, sale.valor_comissao_captador, sale.valor_comissao_vendedor, sale.valor_comissao_indicador, sale.indicador, sale.indicador_lado, commissionExtras]);

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
    // Pré-preenche captador/vendedor/indicador com o que já foi definido na revisão do gestor
    // (aba Resumo) — sem isso a tabela de comissões nasce zerada e duplica trabalho já feito.
    const totalComissao = Number(sale.valor_total_comissao ?? 0);
    const pctOfTotal = (v: any) => (v != null && totalComissao > 0 ? Number(((Number(v) / totalComissao) * 100).toFixed(3)) : null);
    const commRows = COMISSAO_PAPEIS.filter((p) => !EXTRA_ORIGEM_PAPEIS.has(p.key)).map((p) => {
      let nome: string | null = null;
      let valor: number | null = null;
      if (p.key === "corretor_captador") { nome = sale.corretor_captador ?? null; valor = sale.valor_comissao_captador ?? null; }
      else if (p.key === "corretor_vendedor") { nome = sale.corretor_vendedor ?? null; valor = sale.valor_comissao_vendedor ?? null; }
      else if (p.key === "indicador_captador" && sale.indicador_lado === "captador") { nome = sale.indicador ?? null; valor = sale.valor_comissao_indicador ?? null; }
      else if (p.key === "indicador_vendedor" && sale.indicador_lado === "vendedor") { nome = sale.indicador ?? null; valor = sale.valor_comissao_indicador ?? null; }
      return { occurrence_id: data.id, papel: p.key, nome, percentual: pctOfTotal(valor), valor };
    });
    // Partes extras já cadastradas no Resumo (Gestor/Team Leader/Outro) entram junto na criação.
    const extraRows = commissionExtras.map((e) => ({
      occurrence_id: data.id, papel: papelDaExtra(e.papel), nome: e.nome, percentual: pctOfTotal(e.valor), valor: e.valor,
      sale_commission_extra_id: e.id,
    }));
    await supabase.from("occurrence_commissions").insert([...commRows, ...extraRows]);
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
  // Traz captador/vendedor/indicador com os valores já definidos na revisão do gestor (aba Resumo),
  // útil para ocorrências criadas antes desse pré-preenchimento existir ou quando a revisão mudou depois.
  const pullFromSaleSplit = () => {
    const total = Number(formOcc?.valor_comissao ?? 0);
    const pctOfTotal = (v: any) => (v != null && total > 0 ? Number(((Number(v) / total) * 100).toFixed(3)) : null);
    setFormComms((rows) => {
      let next = rows.map((r) => {
        if (r.papel === "corretor_captador") return { ...r, nome: sale.corretor_captador ?? r.nome, valor: sale.valor_comissao_captador ?? r.valor, percentual: pctOfTotal(sale.valor_comissao_captador) ?? r.percentual };
        if (r.papel === "corretor_vendedor") return { ...r, nome: sale.corretor_vendedor ?? r.nome, valor: sale.valor_comissao_vendedor ?? r.valor, percentual: pctOfTotal(sale.valor_comissao_vendedor) ?? r.percentual };
        if (r.papel === "indicador_captador" && sale.indicador_lado === "captador") return { ...r, nome: sale.indicador ?? r.nome, valor: sale.valor_comissao_indicador ?? r.valor, percentual: pctOfTotal(sale.valor_comissao_indicador) ?? r.percentual };
        if (r.papel === "indicador_vendedor" && sale.indicador_lado === "vendedor") return { ...r, nome: sale.indicador ?? r.nome, valor: sale.valor_comissao_indicador ?? r.valor, percentual: pctOfTotal(sale.valor_comissao_indicador) ?? r.percentual };
        return r;
      });
      // Partes extras (Gestor/Team Leader/Outro) do Resumo: atualiza a linha já puxada antes
      // (casando pelo id estável da parte extra, não só nome — nome pode ter mudado desde a
      // última vez) ou adiciona uma nova, sem duplicar a cada clique.
      for (const extra of commissionExtras) {
        const papel = papelDaExtra(extra.papel);
        const idx = next.findIndex((r) => r.sale_commission_extra_id === extra.id);
        const idxLegado = idx >= 0 ? idx : next.findIndex((r) => !r.sale_commission_extra_id && r.papel === papel && r.nome === extra.nome);
        if (idxLegado >= 0) {
          next = next.map((r, i) => i === idxLegado ? { ...r, nome: extra.nome, valor: extra.valor, percentual: pctOfTotal(extra.valor), sale_commission_extra_id: extra.id } : r);
        } else {
          next = [...next, { id: `new-${crypto.randomUUID()}`, occurrence_id: occ?.id, papel, nome: extra.nome, percentual: pctOfTotal(extra.valor), valor: extra.valor, sale_commission_extra_id: extra.id, _new: true }];
        }
      }
      return next;
    });
    setDirtyComms(true);
    toast.success("Valores da revisão do gestor aplicados — confira e salve.");
  };
  const delCommission = (id: string) => {
    setFormComms(rows => rows.filter(r => r.id !== id));
    setDirtyComms(true);
  };

  // Traz financiamento/valor já preenchidos pelo corretor na etapa "Forma de pagamento",
  // útil quando esses dados mudaram depois da criação da ocorrência.
  const pullFinanciamento = () => {
    updOcc({
      financiamento: payment?.financiamento ?? false,
      financiamento_valor: payment?.financiamento_valor ?? null,
      financiamento_banco: payment?.financiamento_banco ?? null,
      financiamento_correspondente: payment?.financiamento_correspondente ?? null,
    });
    toast.success("Financiamento, valor, banco e correspondente puxados do pagamento — confira e salve.");
  };

  // Compara o que está salvo na ocorrência com os dados atuais da Resumo/Pagamento — se algo
  // mudou depois da última vez que alguém clicou em "Puxar", a ocorrência ficou desatualizada.
  const comissoesDesatualizadas = useMemo(() => {
    if (!occ) return false;
    const checks: { papel: string; valorAtual: any }[] = [
      { papel: "corretor_captador", valorAtual: sale.valor_comissao_captador },
      { papel: "corretor_vendedor", valorAtual: sale.valor_comissao_vendedor },
    ];
    if (sale.indicador_lado === "captador") checks.push({ papel: "indicador_captador", valorAtual: sale.valor_comissao_indicador });
    if (sale.indicador_lado === "vendedor") checks.push({ papel: "indicador_vendedor", valorAtual: sale.valor_comissao_indicador });
    const divergeValor = checks.some(({ papel, valorAtual }) => {
      if (valorAtual == null) return false;
      const row = commissions.find((r) => r.papel === papel);
      return !row || Math.abs(Number(row.valor ?? 0) - Number(valorAtual)) > 0.01;
    });
    const divergeExtra = commissionExtras.some((extra) => {
      const papel = papelDaExtra(extra.papel);
      const row = commissions.find((r) => r.papel === papel && r.nome === extra.nome);
      return !row || Math.abs(Number(row.valor ?? 0) - Number(extra.valor ?? 0)) > 0.01;
    });
    return divergeValor || divergeExtra;
  }, [occ, sale, commissions, commissionExtras]);

  const financiamentoDesatualizado = !!occ && (
    Boolean(occ.financiamento) !== Boolean(payment?.financiamento) ||
    Number(occ.financiamento_valor ?? 0) !== Number(payment?.financiamento_valor ?? 0) ||
    (occ.financiamento_banco ?? "") !== (payment?.financiamento_banco ?? "") ||
    (occ.financiamento_correspondente ?? "") !== (payment?.financiamento_correspondente ?? "")
  );

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
    setSaving(true);
    try {
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
      await load();
      return true;
    } finally {
      setSaving(false);
    }
  }, [occ, dirtyOcc, dirtyComms, dirtyPartners, formOcc, formComms, formPartners, commissions, partners, load]);

  useEffect(() => { registerSaver(save); return () => registerSaver(null); }, [save, registerSaver]);
  useAutosave(canWrite && anyDirty, [formOcc, formComms, formPartners], save);

  const somaComissoes = formComms.reduce((s, c) => s + Number(c.valor ?? 0), 0);
  const total = Number(formOcc?.valor_comissao ?? 0);
  const excedido = total > 0 && somaComissoes > total + 0.01;

  const canFinLock = hasAny(["financeiro", "admin", "super_admin"]);
  // Travar (aceitar) só faz sentido depois que a ocorrência de fato chegou ao financeiro —
  // travar antes disso congela o trabalho do gestor no meio sem ele nem saber. Destravar
  // continua liberado sempre, já que voltar atrás é a direção segura.
  const podeTravar = canFinLock && ["ocorrencia_analise_financeiro", "ocorrencia_concluida"].includes(sale.status);

  const toggleAceite = async () => {
    if (!canFinLock) { toast.error("Somente financeiro/admin/super admin"); return; }
    if (!occ.aceita_financeiro && !podeTravar) {
      toast.error("Só dá pra travar depois que a ocorrência estiver em análise do financeiro (ou já concluída).");
      return;
    }
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

  const openReopenDialog = () => {
    if (!canFinLock) { toast.error("Somente financeiro/admin/super admin podem reabrir"); return; }
    setReopenMotivo("");
    setReopenOpen(true);
  };
  const reopen = async () => {
    const motivo = reopenMotivo.trim();
    if (!motivo) { toast.error("Justificativa é obrigatória"); return; }
    setReopening(true);
    try {
      const { error: e0 } = await supabase.from("occurrences").update({
        status: "pendente",
        aceita_financeiro: false,
        aceita_financeiro_em: null,
        aceita_financeiro_por: null,
        reopen_reason: motivo,
        reopened_at: new Date().toISOString(),
        reopened_by: user!.id,
      }).eq("id", occ.id);
      if (e0) { toast.error(e0.message); return; }
      const { error: e1 } = await supabase.from("sales").update({ status: "ocorrencia_pendente" }).eq("id", saleId);
      if (e1) { toast.error(e1.message); return; }
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
      setReopenOpen(false);
      onChange();
      load();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao reabrir ocorrência");
    } finally {
      setReopening(false);
    }
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

  return (
    <div className="space-y-4">
      {canWrite && <AutosaveStatus saving={saving} dirty={anyDirty} />}
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
            <Field label="Valor anunciado"><CurrencyInput value={formOcc.valor_anunciado} disabled={!canWrite} onChange={(v) => updOcc({ valor_anunciado: v })} /></Field>
            <Field label="Valor negociado"><CurrencyInput value={formOcc.valor_negociado} disabled={!canWrite} onChange={(v) => updOcc({ valor_negociado: v })} /></Field>
            <Field label="% Comissão"><Input type="number" step="0.001" value={formOcc.percentual_comissao ?? ""} disabled={!canWrite} onChange={(e) => {
              const p = e.target.value ? Number(e.target.value) : null;
              const neg = Number(formOcc.valor_negociado ?? 0);
              const patch: any = { percentual_comissao: p };
              if (p != null && neg > 0) patch.valor_comissao = Number(((p / 100) * neg).toFixed(2));
              updOcc(patch);
            }} /></Field>
            <Field label="Valor da comissão (total)"><CurrencyInput value={formOcc.valor_comissao} disabled={!canWrite} onChange={(v) => {
              const neg = Number(formOcc.valor_negociado ?? 0);
              const patch: any = { valor_comissao: v };
              if (v != null && neg > 0) patch.percentual_comissao = Number(((v / neg) * 100).toFixed(3));
              updOcc(patch);
            }} /></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Financiamento</CardTitle>
          {canWrite && (
            <Button size="sm" variant="outline" onClick={pullFinanciamento}>Puxar do pagamento</Button>
          )}
        </CardHeader>
        <CardContent>
          {financiamentoDesatualizado && (
            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              O financiamento mudou na etapa Pagamento depois da última sincronização. Clique em "Puxar do pagamento" para atualizar.
            </div>
          )}
          <FieldGrid>
            <Field label="Tem financiamento?"><div className="flex items-center gap-2"><Switch checked={!!formOcc.financiamento} onCheckedChange={(v) => updOcc({ financiamento: v })} disabled={!canWrite} /><span className="text-sm text-muted-foreground">{formOcc.financiamento ? "Sim" : "Não"}</span></div></Field>
            <Field label="Valor financiado"><CurrencyInput value={formOcc.financiamento_valor} disabled={!canWrite || !formOcc.financiamento} onChange={(v) => updOcc({ financiamento_valor: v })} /></Field>
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
            <Field label="1ª parcela — valor"><CurrencyInput value={formOcc.prev_recebimento_valor} disabled={!canWrite} onChange={(v) => updOcc({ prev_recebimento_valor: v })} /></Field>
            <Field label="1ª parcela — data"><Input type="date" value={formOcc.prev_recebimento_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_data: e.target.value || null })} /></Field>
            <Field label="1ª parcela — forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
          </FieldGrid>
          <FieldGrid>
            <Field label="2ª parcela — valor"><CurrencyInput value={formOcc.prev_recebimento2_valor} disabled={!canWrite} onChange={(v) => updOcc({ prev_recebimento2_valor: v })} /></Field>
            <Field label="2ª parcela — data"><Input type="date" value={formOcc.prev_recebimento2_data ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento2_data: e.target.value || null })} /></Field>
            <Field label="2ª parcela — forma de pagamento" colSpan={2}><Input value={formOcc.prev_recebimento2_forma ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ prev_recebimento2_forma: e.target.value })} placeholder="PIX, TED, boleto..." /></Field>
          </FieldGrid>
          <FieldGrid>
            <Field label="3ª parcela — valor"><CurrencyInput value={formOcc.prev_recebimento3_valor} disabled={!canWrite} onChange={(v) => updOcc({ prev_recebimento3_valor: v })} /></Field>
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
          {canWrite && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={pullFromSaleSplit}>Puxar da revisão do gestor</Button>
              <Button size="sm" variant="outline" onClick={addCommission}><Plus className="mr-1 h-4 w-4" />Adicionar</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {comissoesDesatualizadas && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              A divisão de comissão mudou na Resumo depois da última sincronização. Clique em "Puxar da revisão do gestor" para atualizar.
            </div>
          )}
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
                <CurrencyInput value={c.valor} onChange={(v) => updComm(c.id, { valor: v })} disabled={!canWrite} />
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
              <Field label="Valor"><CurrencyInput value={p.valor} onChange={(v) => updPartner(p.id, { valor: v })} disabled={!canWrite} /></Field>
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
        {canFinLock && (
          <Button
            variant={occ.aceita_financeiro ? "outline" : "default"}
            onClick={toggleAceite}
            disabled={!occ.aceita_financeiro && !podeTravar}
            title={!occ.aceita_financeiro && !podeTravar ? "Só dá pra travar depois que a ocorrência estiver em análise do financeiro" : undefined}
          >
            {occ.aceita_financeiro ? "Liberar edições" : "Aceitar e travar (Financeiro)"}
          </Button>
        )}
        {canFinLock && concluida && (
          <Button variant="outline" onClick={openReopenDialog}><RotateCcw className="mr-2 h-4 w-4" />Reabrir ocorrência</Button>
        )}
      </div>

      <Dialog open={reopenOpen} onOpenChange={(o) => { if (!reopening) setReopenOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir ocorrência</DialogTitle>
            <DialogDescription>Descreva a justificativa. O corretor será notificado.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Justificativa (obrigatória)" value={reopenMotivo} onChange={(e) => setReopenMotivo(e.target.value)} rows={4} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)} disabled={reopening}>Cancelar</Button>
            <Button onClick={reopen} disabled={reopening || !reopenMotivo.trim()}>Reabrir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
