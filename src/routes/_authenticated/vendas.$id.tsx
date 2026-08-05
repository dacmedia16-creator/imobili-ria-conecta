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
import { STATUS_LABEL, DOC_TYPES, COMISSAO_PAPEIS, PARCERIA_TIPOS, MIDIA_OPTIONS, validarProntaParaRevisao, validarDocsAprovadosParaJuridico, proximoResponsavel, docSatisfazObrigatorio, temDocDoTipo, partesComExigenciaPessoal, chegouAoJuridico, parteLabel, parteBase, parteSortKey, CHECKS_NAO_DOCUMENTAIS, type SaleStatus, type DocParte } from "@/lib/status";
import { toast } from "sonner";
import { ArrowLeft, Upload, FileCheck, FileX, CheckCircle2, XCircle, Send, Gavel, DollarSign, AlertTriangle, RotateCcw, Plus, Trash2, History, MessageSquare, Eye, Printer, Download, ZoomIn, ZoomOut, FileText, ChevronRight, ChevronLeft, Copy } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { canDeleteSale, deleteSaleCascade } from "@/lib/permissions";
import {
  getSaleRoleFlags, isSaleLocked, corretorPodeEditar, gestorPodeEditar, juridicoPodeEditar,
  podeEditarVenda, podeEditarComissao, deveOcultarBlocoComissao, comissaoValorExcedido,
  podeVerOcorrencia, podeVerResumoCompleto, podeEditarOcorrencia, podeFinalizarOcorrencia,
} from "@/lib/sale-permissions";
import { fetchLedMemberIds } from "@/lib/team";
import { useRouter } from "@tanstack/react-router";
import { Sparkles, Loader2 } from "lucide-react";
import { type Saver, useAutosave, AutosaveStatus, SaleSection, FieldGrid, Field, CurrencyInput, money, dateBR, DocStatusBadge } from "@/components/vendas/shared";
import { PartiesStep } from "@/components/vendas/PartiesStep";
import { PaymentStep } from "@/components/vendas/PaymentStep";
import { DocumentsPanel } from "@/components/vendas/DocumentsPanel";
import { OccurrenceReportBody } from "@/components/vendas/OccurrenceReportBody";
import { notifySaleStatusChange } from "@/lib/sale-notifications.functions";

export const Route = createFileRoute("/_authenticated/vendas/$id")({
  head: () => ({ meta: [{ title: "Detalhe da venda" }] }),
  component: SaleDetail,
});

function SaleDetail() {
  const { id } = Route.useParams();
  const { user, hasAny, hasRole, roles } = useAuth();
  const [sale, setSale] = useState<any>(null);
  const [parties, setParties] = useState<Record<string, any>>({});
  const [payment, setPayment] = useState<any>(null);
  // Uma conta bancária por vendedor/proprietário (parte "vendedor_N"), não mais uma por venda.
  const [banks, setBanks] = useState<Record<string, any>>({});
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
  const [docParte, setDocParte] = useState<DocParte>("comprador_1");
  // Corretor e gestor só passam de "Documentos" depois de terem chegado no último bloco lá dentro
  // (comprador → vendedor → imóvel → outros → certidões) — evita pular pra Resumo sem revisar tudo.
  const [reachedLastDocBloco, setReachedLastDocBloco] = useState(false);
  const [activeResumoBlock, setActiveResumoBlock] = useState("imovel");
  // Mesma trava do Documentos, agora pros blocos do Resumo (Imóvel → Equipe → Valores → Divisão →
  // Parceria → Posse) — "posse" é sempre o último, mesmo quando "Divisão da comissão" fica oculto.
  const [reachedLastResumoBlock, setReachedLastResumoBlock] = useState(false);
  useEffect(() => {
    if (activeResumoBlock === "posse") setReachedLastResumoBlock(true);
  }, [activeResumoBlock]);

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
  const [dirtyResumo, setDirtyResumoState] = useState(false);
  const [commissionExtras, setCommissionExtras] = useState<any[]>([]);
  const [formExtras, setFormExtras] = useState<any[]>([]);
  const [dirtyExtras, setDirtyExtrasState] = useState(false);
  // Espelham dirtyResumo/dirtyExtras num ref, atualizado no mesmo instante do setState (não só no
  // próximo render) — load() precisa ler o valor atual de forma síncrona logo depois de setar false
  // dentro de saveResumo(), antes que o efeito de re-render tenha rodado.
  const dirtyResumoRef = useRef(false);
  const setDirtyResumo = (v: boolean) => { dirtyResumoRef.current = v; setDirtyResumoState(v); };
  const dirtyExtrasRef = useRef(false);
  const setDirtyExtras = (v: boolean) => { dirtyExtrasRef.current = v; setDirtyExtrasState(v); };

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
  // Jurídico sinaliza, ao anexar o contrato, se falta algum documento (com descrição livre) e se
  // isso impede o gestor de mandar pra assinatura — os dois são independentes: às vezes falta algo
  // mas não é bloqueante, às vezes é.
  const [contratoFaltaDoc, setContratoFaltaDoc] = useState(false);
  const [contratoFaltaDocDesc, setContratoFaltaDocDesc] = useState("");
  const [contratoLiberaAssinatura, setContratoLiberaAssinatura] = useState(true);
  const [contratoAssinadoDialogOpen, setContratoAssinadoDialogOpen] = useState(false);
  const [contratoAssinadoFile, setContratoAssinadoFile] = useState<File | null>(null);
  const [contratoAssinadoUploading, setContratoAssinadoUploading] = useState(false);
  // Previsão de recebimento da comissão: 2ª/3ª parcela ficam escondidas até o gestor clicar em
  // "Adicionar parcela" (ou já existir valor salvo — aí aparecem sozinhas ao carregar a venda).
  const [showParcela2Recebimento, setShowParcela2Recebimento] = useState(false);
  const [showParcela3Recebimento, setShowParcela3Recebimento] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetchLedMemberIds(user.id).then(setTeamIds);
  }, [user]);

  const [lideres, setLideres] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    if (!sale?.corretor_id) return;
    (async () => {
      const { data: tm } = await supabase.from("team_members").select("team_id").eq("membro_id", sale.corretor_id).maybeSingle();
      if (!tm) { setLideres([]); return; }
      const { data: team } = await supabase.from("teams").select("lider_id, parent_team_id").eq("id", tm.team_id).maybeSingle();
      if (!team) { setLideres([]); return; }
      const liderIds = [team.lider_id];
      const teamIdsForCoLideres = [tm.team_id];
      if (team.parent_team_id) {
        const { data: parent } = await supabase.from("teams").select("lider_id").eq("id", team.parent_team_id).maybeSingle();
        if (parent?.lider_id) liderIds.push(parent.lider_id);
        teamIdsForCoLideres.push(team.parent_team_id);
      }
      // Líder auxiliar ("braço direito") também entra como opção de Gestor/Team Leader da venda.
      const { data: coLideres } = await supabase.from("team_co_leaders").select("user_id").in("team_id", teamIdsForCoLideres);
      (coLideres ?? []).forEach((c: any) => liderIds.push(c.user_id));
      const uniqueIds = Array.from(new Set(liderIds));
      const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", uniqueIds);
      setLideres((profs ?? []).map((p: any) => ({ id: p.id, nome: p.nome ?? p.id })));
    })();
  }, [sale?.corretor_id]);

  // Fallback pra quando o corretor da venda não pertence a nenhum time (`lideres` fica vazio):
  // em vez de travar o campo, oferece todo mundo com papel gestor / todo líder de time cadastrado.
  const [gestoresGerais, setGestoresGerais] = useState<{ id: string; nome: string }[]>([]);
  const [teamLeadersGerais, setTeamLeadersGerais] = useState<{ id: string; nome: string }[]>([]);
  useEffect(() => {
    (async () => {
      const { data: gestorRoles } = await supabase.from("user_roles").select("user_id").eq("role", "gestor");
      const gestorIds = Array.from(new Set((gestorRoles ?? []).map((r: any) => r.user_id)));
      if (gestorIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", gestorIds);
        setGestoresGerais((profs ?? []).map((p: any) => ({ id: p.id, nome: p.nome ?? p.id })));
      }
      const { data: teamsData } = await supabase.from("teams").select("lider_id");
      const leaderIds = Array.from(new Set((teamsData ?? []).map((t: any) => t.lider_id).filter(Boolean)));
      if (leaderIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, nome").in("id", leaderIds);
        setTeamLeadersGerais((profs ?? []).map((p: any) => ({ id: p.id, nome: p.nome ?? p.id })));
      }
    })();
  }, []);
  const gestorOptions = lideres.length > 0 ? lideres : gestoresGerais;
  const teamLeaderOptions = lideres.length > 0 ? lideres : teamLeadersGerais;

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
      supabase.from("sale_bank_accounts").select("*").eq("sale_id", id),
      supabase.from("sale_documents").select("*").eq("sale_id", id).is("deleted_at", null).order("created_at"),
      supabase.from("sale_comments").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("sale_status_history").select("*").eq("sale_id", id).order("created_at", { ascending: false }),
      supabase.from("occurrences").select("aceita_financeiro").eq("sale_id", id),
      supabase.from("sale_commission_extras").select("*").eq("sale_id", id).order("created_at"),
    ]);
    // Antes, erro em qualquer uma dessas 9 queries era ignorado silenciosamente — a tela mostrava
    // "sem documentos"/"sem histórico" etc., indistinguível de "realmente não tem nada". Agora pelo
    // menos avisa que algo falhou, em vez de deixar a pessoa achar que os dados sumiram.
    const loadErrors = [s.error, p.error, pay.error, ba.error, d.error, c.error, h.error, oc.error, ce.error].filter(Boolean);
    if (loadErrors.length > 0) {
      console.error("Falha ao carregar dados da venda:", loadErrors);
      toast.error("Alguns dados da venda não puderam ser carregados. Tente atualizar a página.");
    }
    setSale(s.data);
    // Não sobrescreve o buffer da aba Resumo se ela tiver edição local ainda não salva — load() é
    // chamado por várias ações sem relação com essa aba (upload de contrato, troca de status em
    // outra etapa, etc.), e sobrescrever aqui apagava silenciosamente o que a pessoa estava
    // digitando (e cancelava o autosave, já que ele para assim que dirty vira false).
    if (!dirtyResumoRef.current) setFormSale(s.data ?? {});
    setCommissionExtras(ce.data ?? []);
    if (!dirtyExtrasRef.current) setFormExtras(ce.data ?? []);
    const partyMap: Record<string, any> = {};
    (p.data ?? []).forEach((row: any) => { partyMap[row.papel] = row; });
    setParties(partyMap);
    setPayment(pay.data ?? {});
    const bankMap: Record<string, any> = {};
    (ba.data ?? []).forEach((row: any) => { bankMap[row.parte] = row; });
    setBanks(bankMap);
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
      "imovel_id","matricula","iptu","imovel_endereco","codigo_interno","imovel_observacoes","tempo_venda_dias","midia",
      "corretor_captador","corretor_vendedor","indicador",
      "valor_anunciado","valor_negociado","percentual_comissao","valor_total_comissao",
      "valor_comissao_captador","valor_comissao_vendedor","valor_comissao_imobiliaria",
      "percentual_comissao_captador","percentual_comissao_vendedor",
      "valor_comissao_indicador","percentual_comissao_indicador","indicador_lado",
      "previsao_recebimento_valor","previsao_recebimento_data","previsao_recebimento_forma",
      "previsao_recebimento2_valor","previsao_recebimento2_data","previsao_recebimento2_forma",
      "previsao_recebimento3_valor","previsao_recebimento3_data","previsao_recebimento3_forma",
      "parceria_tipo","parceria_nome","parceria_cpf_cnpj","parceria_percentual","parceria_valor",
      "parceria_banco","parceria_agencia","parceria_conta","parceria_pix",
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
      await syncOccurrencePartnerFromSale(id, { ...sale, ...formSale });
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
  const { isOwner, isFinanceiro, isAdminLike, isGestor, isJuridico } = getSaleRoleFlags(roles, sale.corretor_id, user?.id);
  const locked = isSaleLocked(status, aceitaFin);
  const canDelete = canDeleteSale(user?.id, hasAny, sale, teamIds);

  const onConfirmDelete = async () => {
    setDeleting(true);
    try {
      const { orphanedFiles } = await deleteSaleCascade(sale.id);
      if (orphanedFiles.length > 0) {
        toast.warning(`Venda excluída, mas ${orphanedFiles.length} arquivo(s) não puderam ser removidos do armazenamento.`);
      } else {
        toast.success("Venda excluída");
      }
      setDeleteOpen(false);
      router.navigate({ to: "/vendas" });
    } catch (err: any) {
      toast.error(err.message ?? "Falha ao excluir venda");
    } finally {
      setDeleting(false);
    }
  };

  // Quem pode editar campos (Resumo/Partes/Pagamento/Docs) segundo o estado atual
  const corretorEdits = corretorPodeEditar(isOwner, status);
  const gestorEdits = gestorPodeEditar(isGestor, status);
  const juridicoEdits = juridicoPodeEditar(isJuridico, status);
  const editable = podeEditarVenda({ corretorEdits, gestorEdits, juridicoEdits, isFinanceiro, isAdminLike, locked });
  // Divisão da comissão é decisão do gestor — mesmo quando a venda volta pro corretor
  // (devolvida_ajuste) pra ajustar outra coisa, ele só pode VER essa parte, não editar.
  const editableComissao = podeEditarComissao({ gestorEdits, isFinanceiro, isAdminLike, locked });
  // Corretor só enxerga o bloco "Divisão da comissão" quando o gestor devolveu a venda pra ele
  // (devolvida_ajuste) — fora disso o bloco fica oculto (nada pra ver ainda, ou já não é mais a
  // vez dele mexer no Resumo). Gestor/financeiro/admin/jurídico sempre veem.
  const hideComissaoBlock = deveOcultarBlocoComissao(isOwner, status);
  // Única regra da divisão de comissão: captador + vendedor não pode ultrapassar o valor total da
  // comissão. Fora isso o preenchimento é livre — isso só vira bloqueio na hora de avançar pro
  // jurídico (confirmApproveJuridico), nunca trava a digitação em si.
  const comissaoExcedida = comissaoValorExcedido(formSale.valor_total_comissao, formSale.valor_comissao_captador, formSale.valor_comissao_vendedor);

  // history vem ordenado por created_at desc (ver load()); o primeiro item é a transição que colocou a venda no status atual
  const stageChangedAt = history[0]?.created_at ?? sale.created_at;

  const pendencias = validarProntaParaRevisao(sale, parties, payment, docs);
  // Docs "pessoal" (RG/CPF/Certidão/Comprovante) contam uma vez por comprador/vendedor ativo —
  // os "imovel"/"outros" continuam contando uma vez só, mantendo em sincronia com validarProntaParaRevisao.
  const pessoalObrigatoriosCount = DOC_TYPES.filter(t => t.obrigatorio && t.grupo === "pessoal").length;
  const outrosObrigatoriosCount = DOC_TYPES.filter(t => t.obrigatorio && t.grupo !== "pessoal").length;
  const totalChecks = CHECKS_NAO_DOCUMENTAIS.length + pessoalObrigatoriosCount * partesComExigenciaPessoal(parties, docs).length + outrosObrigatoriosCount;
  const progress = Math.round(((totalChecks - pendencias.length) / totalChecks) * 100);
  const requiredTypes = DOC_TYPES.map(d => d.key);
  const docsApproved = requiredTypes.filter(t => docs.some(d => d.tipo === t && d.status === "aprovado")).length;
  // Gestor só manda pro jurídico com todo documento obrigatório já aprovado (não só enviado) —
  // sem isso, ficava aberto aprovar a venda inteira sem ter revisado nenhum documento de fato.
  const docsPendentesAprovacao = validarDocsAprovadosParaJuridico(parties, docs);

  // ---- Resumo (buffered) save ----
  const updResumo = (patch: any) => { setFormSale((f: any) => ({ ...f, ...patch })); setDirtyResumo(true); };
  const COMISSAO_ROLES = ["captador", "vendedor"] as const;
  type ComissaoRole = (typeof COMISSAO_ROLES)[number];
  // Imobiliária = total menos captador, vendedor e a parceria externa (quando houver — o valor dela
  // sai da fatia da imobiliária, já que é quem paga o parceiro externo). O indicador NÃO desconta
  // daqui — a comissão dele sai de dentro da fatia do captador ou do vendedor (indicador_lado), não
  // é uma 3ª fatia do total.
  // "key in patch" em vez de "patch[key] ?? formSale[key]": quando o usuário limpa um campo (R$
  // vazio vira null), o patch traz null de propósito — "??" trataria esse null como "não veio
  // nada" e voltaria pro valor antigo do formSale, fazendo o recálculo ignorar a limpeza.
  const fromPatchOrSale = (patch: any, key: string) => (key in patch ? patch[key] : formSale[key]);
  const recalcImobiliaria = (patch: any) => {
    const total = Number(fromPatchOrSale(patch, "valor_total_comissao") ?? 0);
    const soma = COMISSAO_ROLES.reduce((s, r) => s + Number(fromPatchOrSale(patch, `valor_comissao_${r}`) ?? 0), 0);
    const parceria = Number(fromPatchOrSale(patch, "parceria_valor") ?? 0);
    return Number((total - soma - parceria).toFixed(2));
  };
  // Recalcula a comissão do indicador (em R$) a partir do % já definido, sempre que a fatia do
  // lado ao qual ele está vinculado (captador/vendedor) mudar de valor.
  const recalcIndicadorFromLado = (patch: any) => {
    const lado = fromPatchOrSale(patch, "indicador_lado");
    if (!lado) return { valor_comissao_indicador: null };
    const ladoValor = Number(fromPatchOrSale(patch, `valor_comissao_${lado}`) ?? 0);
    const p = formSale.percentual_comissao_indicador ?? 25;
    return { valor_comissao_indicador: ladoValor > 0 ? Number(((p / 100) * ladoValor).toFixed(2)) : null };
  };
  // Preenchimento livre: o gestor digita só o valor em R$ de cada lado, sem trava contra o outro
  // lado. A única regra ("não pode ultrapassar o total") vira aviso (soma > total) e bloqueia só o
  // avanço da venda pro jurídico (ver comissaoExcedida/confirmApproveJuridico), não a digitação em
  // si. O percentual continua calculado e salvo por baixo dos panos (usado nos relatórios), só não
  // tem mais campo próprio pra editar direto.
  const applyComissaoValor = (role: ComissaoRole, v: number | null) => {
    const total = Number(formSale.valor_total_comissao ?? 0);
    const valor = v;
    const p = total > 0 && valor != null ? Number(((valor / total) * 100).toFixed(3)) : (formSale[`percentual_comissao_${role}`] ?? null);
    const patch: any = { [`valor_comissao_${role}`]: valor, [`percentual_comissao_${role}`]: p };
    patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
    Object.assign(patch, recalcIndicadorFromLado(patch));
    updResumo(patch);
  };
  // Atalho: preenche captador e vendedor com 22,5% cada (45% somados) — só um ponto de partida
  // sugerido, o gestor pode ajustar cada lado livremente depois.
  const sugerirDivisao45 = () => {
    const total = Number(formSale.valor_total_comissao ?? 0);
    if (total <= 0) { toast.error("Defina o valor total da comissão antes de sugerir a divisão."); return; }
    const valor = Number(((22.5 / 100) * total).toFixed(2));
    const patch: any = {
      percentual_comissao_captador: 22.5,
      valor_comissao_captador: valor,
      percentual_comissao_vendedor: 22.5,
      valor_comissao_vendedor: valor,
    };
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
    const p = raw ? Number(raw) : null;
    const ladoValor = indicadorLadoValor();
    const valor = p != null && ladoValor > 0 ? Number(((p / 100) * ladoValor).toFixed(2)) : null;
    updResumo({ percentual_comissao_indicador: p, valor_comissao_indicador: valor });
  };
  const applyIndicadorValor = (v: number | null) => {
    const ladoValor = indicadorLadoValor();
    const valor = v;
    const p = valor != null && ladoValor > 0 ? Number(((valor / ladoValor) * 100).toFixed(3)) : formSale.percentual_comissao_indicador ?? null;
    updResumo({ valor_comissao_indicador: valor, percentual_comissao_indicador: p });
  };
  // Parceria externa (imobiliária de fora ou outra unidade RE/MAX): % sempre calculado sobre o
  // total da comissão, sinalizado aqui na Resumo pra a Ocorrência puxar sozinha depois. O valor sai
  // da fatia da imobiliária (recalcImobiliaria), por isso todo lugar que muda parceria_valor também
  // recalcula valor_comissao_imobiliaria.
  const applyParceriaPercentual = (raw: string) => {
    const p = raw ? Number(raw) : null;
    const total = Number(formSale.valor_total_comissao ?? 0);
    const valor = p != null && total > 0 ? Number(((p / 100) * total).toFixed(2)) : null;
    const patch: any = { parceria_percentual: p, parceria_valor: valor };
    patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
    updResumo(patch);
  };
  const applyParceriaValor = (v: number | null) => {
    const total = Number(formSale.valor_total_comissao ?? 0);
    const p = v != null && total > 0 ? Number(((v / total) * 100).toFixed(3)) : formSale.parceria_percentual ?? null;
    const patch: any = { parceria_valor: v, parceria_percentual: p };
    patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
    updResumo(patch);
  };
  const applyParceriaTipo = (v: string | null) => {
    if (!v) {
      const patch: any = { parceria_tipo: null, parceria_nome: null, parceria_cpf_cnpj: null, parceria_percentual: null, parceria_valor: null, parceria_banco: null, parceria_agencia: null, parceria_conta: null, parceria_pix: null };
      patch.valor_comissao_imobiliaria = recalcImobiliaria(patch);
      updResumo(patch);
      return;
    }
    updResumo({ parceria_tipo: v });
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
        const p = patch.percentual === "" || patch.percentual == null ? null : Number(patch.percentual);
        const valor = p != null && base > 0 ? Number(((p / 100) * base).toFixed(2)) : null;
        merged.percentual = p; merged.valor = valor;
      } else if ("valor" in patch) {
        const valor = patch.valor;
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
  // Atalho pra "mais um captador/vendedor": mesma linha de sale_commission_extras, só pré-preenchida
  // com o papel e a origem certos — assim entra no mesmo cálculo/sincronização das partes extras.
  const addCoCorretor = (role: "captador" | "vendedor") => {
    setFormExtras(rows => [...rows, {
      id: `new-${crypto.randomUUID()}`, sale_id: id, nome: "",
      papel: role === "captador" ? "corretor_captador" : "corretor_vendedor",
      origem: role, percentual: null, valor: null, _new: true,
    }]);
    setDirtyExtras(true);
  };
  // Mesmo atalho, mas pra gestor/team leader — já entra com o papel certo (o campo "Nome" vira
  // um seletor de líder automaticamente, ver `vinculavel` mais abaixo).
  const addLider = (role: "gestor" | "team_leader") => {
    setFormExtras(rows => [...rows, {
      id: `new-${crypto.randomUUID()}`, sale_id: id, nome: "",
      papel: role, origem: "imobiliaria", percentual: null, valor: null, _new: true,
    }]);
    setDirtyExtras(true);
  };
  // Partes extras com um desses papéis ganham campo fixo lá em cima (junto do resto da comissão)
  // em vez de aparecer na lista genérica de "Partes extras" mais abaixo.
  const PAPEIS_FIXOS_NO_TOPO = new Set(["corretor_captador", "corretor_vendedor", "gestor", "team_leader"]);
  const delExtra = (rowId: string) => {
    setFormExtras(rows => rows.filter(r => r.id !== rowId));
    setDirtyExtras(true);
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

  // sales.status + sale_status_history + activity_logs são gravados atomicamente dentro do RPC
  // change_sale_status (mesma transação, tudo ou nada) — antes eram 3 chamadas soltas do client, e
  // uma falha no meio (rede caiu) deixava o status mudado sem o registro de auditoria correspondente,
  // sem erro visível pra ninguém. Notificação in-app e WhatsApp continuam fora da transação de
  // propósito (são efeitos colaterais não-críticos, não faz sentido travar a troca de status por eles) —
  // as duas saem juntas de notifySaleStatusChange, que já calcula quem precisa saber (sua vez / toda
  // atualização) e cobre o corretor e o gestor da equipe sem precisar de nenhuma chamada extra aqui.
  const changeStatus = async (next: SaleStatus, motivo?: string) => {
    if (!(await flushAllDirty())) return;
    const { error } = await supabase.rpc("change_sale_status", { _sale_id: id, _new_status: next, _motivo: motivo });
    if (error) {
      toast.error(error.message);
      load(); // reconcilia a tela com o que realmente ficou salvo — a troca é atômica, então nada mudou
      return;
    }
    if (next === "contrato_assinado") {
      // contrato_assinado avança automaticamente pra ocorrencia_pendente, e as duas etapas têm o
      // mesmo responsável (gestor) — notifica só o status final, senão o gestor toma dois avisos
      // (sino + WhatsApp) pela mesma ação de marcar o contrato como assinado.
      const { error: e2 } = await supabase.rpc("change_sale_status", { _sale_id: id, _new_status: "ocorrencia_pendente", _motivo: "Automático: contrato assinado" });
      if (!e2) {
        notifySaleStatusChange({ data: { saleId: id, status: "ocorrencia_pendente" } }).catch(() => {});
      }
    } else {
      notifySaleStatusChange({ data: { saleId: id, status: next, motivo } }).catch(() => {});
    }
    toast.success(`Status alterado para "${STATUS_LABEL[next]}"`);
    load();
  };

  const contratoDocs = docs.filter((d) => d.tipo === "contrato");
  const contratoAssinadoDocs = docs.filter((d) => d.tipo === "contrato_assinado");
  const certidoesJuridicoDocs = docs.filter((d) => d.tipo === "certidao_juridico");

  // Atalho pra abrir o contrato direto do topo da página — sem isso o contrato só existia
  // dentro de Documentos > Outros, e quem recebia a venda de volta (gestor/corretor) tinha
  // que caçar em qual aba/bloco ele tinha sido anexado.
  const abrirContratoRapido = async (doc: any) => {
    const { data, error } = await supabase.storage.from("sale-documents").createSignedUrl(doc.storage_path, 300);
    if (error || !data) { toast.error("Falha ao gerar link do contrato"); return; }
    window.open(data.signedUrl, "_blank");
  };

  // Pula direto pro bloco "Certidões (Jurídico)" dentro de Documentos — sem isso o jurídico tinha
  // que ir em Documentos e descer até o último bloco pra achar onde subir as certidões.
  const irParaCertidoes = () => {
    setStep("documentos");
    setDocParte("juridico");
    requestAnimationFrame(() => {
      document.getElementById("venda-wizard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const marcarContratoAssinado = async () => {
    if (contratoAssinadoDocs.length === 0) {
      toast.error("Suba o contrato assinado antes de marcar como assinado.");
      return;
    }
    await changeStatus("contrato_assinado");
  };

  const openContratoDialog = () => {
    setContratoFile(null);
    setContratoFaltaDoc(!!sale.contrato_pendencia_descricao);
    setContratoFaltaDocDesc(sale.contrato_pendencia_descricao ?? "");
    setContratoLiberaAssinatura(sale.contrato_libera_assinatura ?? true);
    setContratoDialogOpen(true);
  };

  // Anexar o contrato NÃO envia a venda ao gestor sozinho — o jurídico confere o arquivo
  // e só então clica em "Enviar ao gestor" (botão separado, fora deste dialog). A sinalização de
  // pendência/liberação de assinatura pode ser salva mesmo sem trocar o arquivo (ex.: já tinha
  // contrato anexado e o jurídico só quer atualizar o aviso pro gestor).
  const uploadContrato = async () => {
    if (!contratoFile && contratoDocs.length === 0) {
      toast.error("Selecione o arquivo do contrato.");
      return;
    }
    if (contratoFaltaDoc && !contratoFaltaDocDesc.trim()) {
      toast.error("Descreva o que está faltando.");
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
      const pendenciaDesc = contratoFaltaDoc ? contratoFaltaDocDesc.trim() : null;
      // RPC em vez de update direto: gestor e jurídico precisam poder ajustar a pendência/liberação
      // de assinatura em qualquer etapa do contrato (não só em_elaboracao_contrato), e o jurídico
      // não tem permissão geral de editar a venda fora da janela dele — a função faz essa checagem
      // à parte, sem abrir edição geral da venda pra ele.
      const { error: updErr } = await supabase.rpc("update_contrato_pendencia", {
        _sale_id: id,
        _pendencia_descricao: pendenciaDesc,
        _libera_assinatura: contratoLiberaAssinatura,
      });
      if (updErr) { toast.error(updErr.message); return; }
      await supabase.from("activity_logs").insert({ sale_id: id, autor_id: user!.id, acao: "contrato_pendencia_atualizada", payload: { pendencia: pendenciaDesc, libera_assinatura: contratoLiberaAssinatura } });
      toast.success(contratoFile ? "Contrato anexado" : "Informações salvas");
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
    // Se o jurídico já sinalizou a pendência (documento faltando) ao anexar o contrato, isso vale
    // como o aviso — não precisa também travar o envio. A trava de certidão é só pra pegar quem
    // esqueceu de anexar sem avisar nada.
    if (certidoesJuridicoDocs.length === 0 && !sale.contrato_pendencia_descricao) {
      toast.error("Anexe ao menos uma certidão antes de enviar ao gestor (ou sinalize a pendência ao anexar o contrato).");
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
  };

  const attemptApproveJuridico = () => setApproveJuridicoOpen(true);
  const confirmApproveJuridico = async () => {
    if (docsPendentesAprovacao.length > 0) { toast.error("Aprove todos os documentos obrigatórios antes de enviar ao jurídico"); return; }
    if (comissaoExcedida) { toast.error("A soma da comissão do captador e vendedor não pode ultrapassar o valor total da comissão"); return; }
    setApproveJuridicoOpen(false);
    await changeStatus("aprovada_gestor");
  };

  // Wizard: on leaving a step, run its saver if dirty
  const onBeforeLeave = async (from: string): Promise<boolean> => {
    if (from === "documentos" && (isOwner || isGestor) && !reachedLastDocBloco) {
      toast.error('Revise todos os blocos de documentos (use "Próximo bloco") antes de continuar.');
      return false;
    }
    if (from === "resumo") {
      if ((isOwner || isGestor) && !reachedLastResumoBlock) {
        toast.error('Revise todos os blocos do resumo (use "Próximo bloco") antes de continuar.');
        return false;
      }
      if (dirtyResumo || dirtyExtras) return await saveResumo();
    }
    if (dirtyMap[from]) {
      const fn = saversRef.current[from];
      if (fn) return await fn();
    }
    return true;
  };

  const currentDirty = step === "resumo" ? (dirtyResumo || dirtyExtras) : !!dirtyMap[step];
  const nextDisabledFromDocumentos = step === "documentos" && (isOwner || isGestor) && !reachedLastDocBloco;
  const nextDisabledFromResumo = step === "resumo" && (isOwner || isGestor) && !reachedLastResumoBlock;

  // "Voltar" também é uma saída da página — sem isso, dado digitado mas ainda não salvo
  // (autosave ainda não disparou) era perdido em silêncio ao clicar aqui.
  const handleVoltar = async () => {
    if (anyDirtyAnywhere) await flushAllDirty();
    router.navigate({ to: "/vendas" });
  };

  const canOccurrence = podeVerOcorrencia(status);
  const canOverview = podeVerResumoCompleto(status);
  const canEditOcorrencia = podeEditarOcorrencia({ isGestor, status, isFinanceiro, isAdminLike });
  // Só financeiro/admin/super admin finalizam a ocorrência — gestor pode editar a tabela de
  // comissão e mandar pro financeiro, mas não pode fechar a ocorrência sozinho, sem revisão.
  const canFinalizarOcorrencia = podeFinalizarOcorrencia(isFinanceiro, isAdminLike);
  const steps: WizardStep[] = [
    {
      key: "documentos",
      label: "1. Documentos",
      content: (
        <DocumentsPanel
          saleId={id}
          saleStatus={status}
          docs={docs}
          parties={parties}
          editable={editable}
          canModerate={isGestor || isJuridico}
          canUseAi={isOwner}
          canManageContratos={isGestor || isJuridico || isFinanceiro}
          canDownloadAll={isGestor || isJuridico || isFinanceiro || isAdminLike}
          onChange={load}
          activeParte={docParte}
          onActiveParteChange={setDocParte}
          onReachedLastBloco={() => setReachedLastDocBloco(true)}
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
              <Field label="Endereço do imóvel" colSpan={2}><Input value={formSale.imovel_endereco ?? ""} disabled={!editable} onChange={(e) => updResumo({ imovel_endereco: e.target.value })} /></Field>
              <Field label="Código interno"><Input value={formSale.codigo_interno ?? ""} disabled={!editable} onChange={(e) => updResumo({ codigo_interno: e.target.value })} /></Field>
              <Field label="Tempo de venda (dias)"><Input type="number" min="0" step="1" value={formSale.tempo_venda_dias ?? ""} disabled={!editable} onChange={(e) => updResumo({ tempo_venda_dias: e.target.value ? Number(e.target.value) : null })} placeholder="Ex: 45" /></Field>
              <Field label="Mídia">
                <Select value={formSale.midia ?? "none"} onValueChange={(v) => updResumo({ midia: v === "none" ? null : v })} disabled={!editable}>
                  <SelectTrigger><SelectValue placeholder="Selecione o canal" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {MIDIA_OPTIONS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
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
              <Field label="Gestor">
                <Select value={formSale.coordenador_id ?? "none"} onValueChange={(v) => updResumo({ coordenador_id: v === "none" ? null : v })} disabled={!editable || gestorOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder="Selecione o gestor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {gestorOptions.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Team Leader">
                <Select value={formSale.team_leader_id ?? "none"} onValueChange={(v) => updResumo({ team_leader_id: v === "none" ? null : v })} disabled={!editable || teamLeaderOptions.length === 0}>
                  <SelectTrigger><SelectValue placeholder="Selecione o team leader" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {teamLeaderOptions.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
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
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock(hideComissaoBlock ? "parceria" : "comissao")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "comissao", label: "Divisão da comissão", disabled: hideComissaoBlock, content: (<>
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
            {editableComissao && (
              <div className="mb-4">
                <Button size="sm" variant="outline" onClick={sugerirDivisao45}>Sugerir 22,5% / 22,5% (45% somados)</Button>
              </div>
            )}
            <FieldGrid>
              <Field label={`Comissão corretor captador${formSale.corretor_captador ? ` — ${formSale.corretor_captador}` : ""} (R$)`}><CurrencyInput value={formSale.valor_comissao_captador} disabled={!editableComissao} onChange={(v) => applyComissaoValor("captador", v)} /></Field>
              <Field label={`Comissão corretor vendedor${formSale.corretor_vendedor ? ` — ${formSale.corretor_vendedor}` : ""} (R$)`}><CurrencyInput value={formSale.valor_comissao_vendedor} disabled={!editableComissao} onChange={(v) => applyComissaoValor("vendedor", v)} /></Field>
              <Field label="Líquido do captador (R$)">
                <CurrencyInput value={Number((Number(formSale.valor_comissao_captador ?? 0) - (formSale.indicador_lado === "captador" ? Number(formSale.valor_comissao_indicador ?? 0) : 0) - somaExtrasPorOrigem("captador")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
              <Field label="Líquido do vendedor (R$)">
                <CurrencyInput value={Number((Number(formSale.valor_comissao_vendedor ?? 0) - (formSale.indicador_lado === "vendedor" ? Number(formSale.valor_comissao_indicador ?? 0) : 0) - somaExtrasPorOrigem("vendedor")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
              <Field label="Valor para a imobiliária (R$)" colSpan={2}>
                <CurrencyInput value={Number((Number(formSale.valor_comissao_imobiliaria ?? 0) - somaExtrasPorOrigem("imobiliaria")).toFixed(2))} disabled onChange={() => {}} />
              </Field>
              {formExtras.filter((r) => r.papel === "corretor_captador" || r.papel === "corretor_vendedor").map((r) => {
                const rotulo = r.papel === "corretor_captador" ? "Outro corretor captador" : "Outro corretor vendedor";
                return (
                  <Field key={r.id} label={`${rotulo}${r.nome ? ` — ${r.nome}` : ""} (R$)`} colSpan={2}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="w-48"
                        placeholder="Nome"
                        value={r.nome ?? ""}
                        disabled={!editableComissao}
                        onChange={(e) => updExtra(r.id, { nome: e.target.value })}
                      />
                      <div className="w-32"><CurrencyInput value={r.valor} disabled={!editableComissao} onChange={(v) => updExtra(r.id, { valor: v })} /></div>
                      {editableComissao && <Button variant="ghost" size="sm" onClick={() => delExtra(r.id)}>Remover</Button>}
                    </div>
                  </Field>
                );
              })}
              {formExtras.filter((r) => r.papel === "gestor" || r.papel === "team_leader").map((r) => {
                const rotulo = r.papel === "gestor" ? "Gestor" : "Team Leader";
                const liderAtualId = r.papel === "gestor" ? (formSale.coordenador_id ?? "") : (formSale.team_leader_id ?? "");
                const opcoesLider = r.papel === "gestor" ? gestorOptions : teamLeaderOptions;
                const onSelectLider = (liderId: string) => {
                  const lider = opcoesLider.find((l) => l.id === liderId);
                  updExtra(r.id, { nome: lider ? lider.nome : r.nome });
                  if (r.papel === "gestor") updResumo({ coordenador_id: liderId || null });
                  if (r.papel === "team_leader") updResumo({ team_leader_id: liderId || null });
                };
                return (
                  <Field key={r.id} label={`Comissão ${rotulo}${r.nome ? ` — ${r.nome}` : ""} (R$)`} colSpan={2}>
                    <div className="flex flex-wrap items-center gap-2">
                      {opcoesLider.length > 0 ? (
                        <Select value={liderAtualId || "manual"} onValueChange={(v) => onSelectLider(v === "manual" ? "" : v)} disabled={!editableComissao}>
                          <SelectTrigger className="w-48"><SelectValue placeholder="Selecione o líder" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="manual">Digitar nome</SelectItem>
                            {opcoesLider.map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : null}
                      {(opcoesLider.length === 0 || !liderAtualId) && (
                        <Input
                          className="w-40"
                          placeholder="Nome"
                          value={r.nome ?? ""}
                          disabled={!editableComissao}
                          onChange={(e) => updExtra(r.id, { nome: e.target.value })}
                        />
                      )}
                      <Select value={r.origem} onValueChange={(v) => updExtra(r.id, { origem: v })} disabled={!editableComissao}>
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                          <SelectItem value="captador">Captador</SelectItem>
                          <SelectItem value="vendedor">Vendedor</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="w-32"><CurrencyInput value={r.valor} disabled={!editableComissao} onChange={(v) => updExtra(r.id, { valor: v })} /></div>
                      {editableComissao && <Button variant="ghost" size="sm" onClick={() => delExtra(r.id)}>Remover</Button>}
                    </div>
                  </Field>
                );
              })}
            </FieldGrid>
            {editableComissao && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => addCoCorretor("captador")}>
                  <Plus className="mr-1 h-4 w-4" />Outro captador
                </Button>
                <Button size="sm" variant="outline" onClick={() => addCoCorretor("vendedor")}>
                  <Plus className="mr-1 h-4 w-4" />Outro vendedor
                </Button>
                <Button size="sm" variant="outline" onClick={() => addLider("gestor")}>
                  <Plus className="mr-1 h-4 w-4" />Gestor
                </Button>
                <Button size="sm" variant="outline" onClick={() => addLider("team_leader")}>
                  <Plus className="mr-1 h-4 w-4" />Team Leader
                </Button>
              </div>
            )}
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
                <Field label="Nome do indicador"><Input value={formSale.indicador ?? ""} disabled={!editableComissao} onChange={(e) => updResumo({ indicador: e.target.value })} /></Field>
                <Field label="Indicador de">
                  <Select
                    value={formSale.indicador_lado ?? "none"}
                    onValueChange={(v) => applyIndicadorLado(v === "none" ? null : (v as "captador" | "vendedor"))}
                    disabled={!editableComissao}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem indicação</SelectItem>
                      <SelectItem value="captador">Captador{formSale.corretor_captador ? ` — ${formSale.corretor_captador}` : ""}</SelectItem>
                      <SelectItem value="vendedor">Vendedor{formSale.corretor_vendedor ? ` — ${formSale.corretor_vendedor}` : ""}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="% Indicador (sobre a comissão do lado)"><Input type="number" step="0.001" value={formSale.percentual_comissao_indicador ?? ""} disabled={!editableComissao || !formSale.indicador_lado} onChange={(e) => applyIndicadorPercentual(e.target.value)} /></Field>
                <Field label="Comissão indicador (R$)"><CurrencyInput value={formSale.valor_comissao_indicador} disabled={!editableComissao || !formSale.indicador_lado} onChange={applyIndicadorValor} /></Field>
              </FieldGrid>
              <p className="mt-2 text-xs text-muted-foreground">
                Veja o "Líquido do captador/vendedor" acima — já descontam indicador e partes extras dessa fatia.
              </p>
            </div>
            <div className="mt-4 border-t pt-4">
              <p className="mb-3 text-xs text-muted-foreground">
                Previsão de recebimento da comissão — se for parcelada, adicione quantas parcelas precisar. Vira a previsão de recebimento na Ocorrência quando ela for criada (financeiro pode ajustar lá).
                {formSale.parceria_valor != null && (
                  <> Digite o valor <b>total da parcela (bruto)</b>, incluindo a parte da parceria — "Comissões a Receber" já desconta automaticamente a fatia de {formSale.parceria_nome || "parceria"} (R$ {Number(formSale.parceria_valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) do total da comissão.</>
                )}
              </p>
              <FieldGrid>
                <Field label="1ª parcela — valor (R$)"><CurrencyInput value={formSale.previsao_recebimento_valor} disabled={!editableComissao} onChange={(v) => updResumo({ previsao_recebimento_valor: v })} /></Field>
                <Field label="1ª parcela — data"><Input type="date" value={formSale.previsao_recebimento_data ?? ""} disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento_data: e.target.value || null })} /></Field>
                <Field label="1ª parcela — forma de pagamento" colSpan={2}><Input value={formSale.previsao_recebimento_forma ?? ""} placeholder="PIX, TED, boleto..." disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento_forma: e.target.value })} /></Field>
              </FieldGrid>
              {(showParcela2Recebimento || formSale.previsao_recebimento2_valor != null || formSale.previsao_recebimento2_data || formSale.previsao_recebimento2_forma) && (
                <div className="mt-3">
                  <FieldGrid>
                    <Field label="2ª parcela — valor (R$)"><CurrencyInput value={formSale.previsao_recebimento2_valor} disabled={!editableComissao} onChange={(v) => updResumo({ previsao_recebimento2_valor: v })} /></Field>
                    <Field label="2ª parcela — data"><Input type="date" value={formSale.previsao_recebimento2_data ?? ""} disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento2_data: e.target.value || null })} /></Field>
                    <Field label="2ª parcela — forma de pagamento" colSpan={2}><Input value={formSale.previsao_recebimento2_forma ?? ""} placeholder="PIX, TED, boleto..." disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento2_forma: e.target.value })} /></Field>
                  </FieldGrid>
                </div>
              )}
              {(showParcela3Recebimento || formSale.previsao_recebimento3_valor != null || formSale.previsao_recebimento3_data || formSale.previsao_recebimento3_forma) && (
                <div className="mt-3">
                  <FieldGrid>
                    <Field label="3ª parcela — valor (R$)"><CurrencyInput value={formSale.previsao_recebimento3_valor} disabled={!editableComissao} onChange={(v) => updResumo({ previsao_recebimento3_valor: v })} /></Field>
                    <Field label="3ª parcela — data"><Input type="date" value={formSale.previsao_recebimento3_data ?? ""} disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento3_data: e.target.value || null })} /></Field>
                    <Field label="3ª parcela — forma de pagamento" colSpan={2}><Input value={formSale.previsao_recebimento3_forma ?? ""} placeholder="PIX, TED, boleto..." disabled={!editableComissao} onChange={(e) => updResumo({ previsao_recebimento3_forma: e.target.value })} /></Field>
                  </FieldGrid>
                </div>
              )}
              {editableComissao && !showParcela2Recebimento && formSale.previsao_recebimento2_valor == null && !formSale.previsao_recebimento2_data && !formSale.previsao_recebimento2_forma && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowParcela2Recebimento(true)}>
                  <Plus className="mr-1 h-4 w-4" />Adicionar parcela
                </Button>
              )}
              {editableComissao && (showParcela2Recebimento || formSale.previsao_recebimento2_valor != null || formSale.previsao_recebimento2_data || formSale.previsao_recebimento2_forma) && !showParcela3Recebimento && formSale.previsao_recebimento3_valor == null && !formSale.previsao_recebimento3_data && !formSale.previsao_recebimento3_forma && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowParcela3Recebimento(true)}>
                  <Plus className="mr-1 h-4 w-4" />Adicionar parcela
                </Button>
              )}
            </div>
            <div className="mt-4 border-t pt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Partes extras da divisão — classifique quem é a pessoa e de qual fatia (imobiliária, captador ou vendedor) o valor sai.
                </p>
                {editableComissao && <Button size="sm" variant="outline" onClick={addExtra}><Plus className="mr-1 h-4 w-4" />Adicionar parte</Button>}
              </div>
              {formExtras.filter((r) => !PAPEIS_FIXOS_NO_TOPO.has(r.papel)).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parte extra adicionada.</p>}
              <div className="space-y-2">
                {formExtras.filter((r) => !PAPEIS_FIXOS_NO_TOPO.has(r.papel)).map((r) => {
                  return (
                  <div key={r.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-6">
                    <Field label="Nome">
                      <Input
                        value={r.nome ?? ""}
                        disabled={!editableComissao}
                        onChange={(e) => updExtra(r.id, { nome: e.target.value })}
                      />
                    </Field>
                    <Field label="Papel">
                      <Select
                        value={r.papel ?? "none"}
                        onValueChange={(v) => {
                          const patch: any = { papel: v === "none" ? null : v };
                          if (v === "corretor_captador") patch.origem = "captador";
                          if (v === "corretor_vendedor") patch.origem = "vendedor";
                          updExtra(r.id, patch);
                        }}
                        disabled={!editableComissao}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="corretor_captador">Corretor captador</SelectItem>
                          <SelectItem value="corretor_vendedor">Corretor vendedor</SelectItem>
                          <SelectItem value="gestor">Gestor</SelectItem>
                          <SelectItem value="team_leader">Team Leader</SelectItem>
                          <SelectItem value="outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Origem">
                      <Select value={r.origem} onValueChange={(v) => updExtra(r.id, { origem: v })} disabled={!editableComissao}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="imobiliaria">Imobiliária</SelectItem>
                          <SelectItem value="captador">Captador</SelectItem>
                          <SelectItem value="vendedor">Vendedor</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="% (sobre a origem)"><Input type="number" step="0.001" value={r.percentual ?? ""} disabled={!editableComissao} onChange={(e) => updExtra(r.id, { percentual: e.target.value })} /></Field>
                    <Field label="Valor (R$)"><CurrencyInput value={r.valor} disabled={!editableComissao} onChange={(v) => updExtra(r.id, { valor: v })} /></Field>
                    {editableComissao && (
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
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("parceria")}>Próximo bloco <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
              </>) },
              { key: "parceria", label: "Parceria", content: (<>
          <SaleSection title="Parceria externa">
            <FieldGrid>
              <Field label="Tipo de parceria">
                <Select value={formSale.parceria_tipo ?? "none"} onValueChange={(v) => applyParceriaTipo(v === "none" ? null : v)} disabled={!editable}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem parceria externa</SelectItem>
                    {PARCERIA_TIPOS.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              {formSale.parceria_tipo && (<>
                <Field label="Corretor(a) / Imobiliária parceira"><Input value={formSale.parceria_nome ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_nome: e.target.value })} /></Field>
                <Field label="CPF/CNPJ"><Input value={formSale.parceria_cpf_cnpj ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_cpf_cnpj: e.target.value })} /></Field>
                <Field label="% Comissão"><Input type="number" step="0.001" value={formSale.parceria_percentual ?? ""} disabled={!editable} onChange={(e) => applyParceriaPercentual(e.target.value)} /></Field>
                <Field label="Valor da comissão (R$)"><CurrencyInput value={formSale.parceria_valor} disabled={!editable} onChange={applyParceriaValor} /></Field>
                <Field label="Banco"><Input value={formSale.parceria_banco ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_banco: e.target.value })} /></Field>
                <Field label="Agência"><Input value={formSale.parceria_agencia ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_agencia: e.target.value })} /></Field>
                <Field label="Conta"><Input value={formSale.parceria_conta ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_conta: e.target.value })} /></Field>
                <Field label="PIX"><Input value={formSale.parceria_pix ?? ""} disabled={!editable} onChange={(e) => updResumo({ parceria_pix: e.target.value })} /></Field>
              </>)}
            </FieldGrid>
          </SaleSection>
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock(hideComissaoBlock ? "valores" : "comissao")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
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
            <Button size="sm" variant="ghost" onClick={() => setActiveResumoBlock("parceria")}><ChevronLeft className="mr-1 h-3.5 w-3.5" /> Voltar</Button>
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
          banks={banks}
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
  const primaryAction: { label: string; icon: typeof Send; onClick: () => void; disabled?: boolean } | null =
    isOwner && (status === "rascunho" || status === "devolvida_ajuste") ? { label: "Enviar ao gestor", icon: Send, onClick: attemptSendForReview } :
    isGestor && status === "enviada_revisao" ? { label: "Aprovar p/ jurídico", icon: CheckCircle2, onClick: attemptApproveJuridico } :
    isJuridico && status === "aprovada_gestor" ? { label: "Iniciar contrato", icon: Gavel, onClick: () => changeStatus("em_elaboracao_contrato") } :
    isJuridico && status === "em_elaboracao_contrato" && contratoDocs.length === 0 ? { label: "Anexar contrato", icon: Upload, onClick: openContratoDialog } :
    isJuridico && status === "em_elaboracao_contrato" && contratoDocs.length > 0 ? { label: "Enviar ao gestor", icon: Send, onClick: enviarContratoAoGestor } :
    isOwner && status === "contrato_conferencia_corretor" ? { label: "Dar OK no contrato", icon: CheckCircle2, onClick: () => changeStatus("contrato_ok_corretor") } :
    isGestor && status === "contrato_ok_corretor" ? { label: "Enviar para assinatura", icon: Send, onClick: () => changeStatus("aguardando_assinatura"), disabled: sale.contrato_libera_assinatura === false } :
    isGestor && status === "aguardando_assinatura" && contratoAssinadoDocs.length === 0 ? { label: "Subir contrato assinado", icon: Upload, onClick: () => { setContratoAssinadoFile(null); setContratoAssinadoDialogOpen(true); } } :
    isGestor && status === "aguardando_assinatura" && contratoAssinadoDocs.length > 0 ? { label: "Marcar contrato assinado", icon: FileCheck, onClick: marcarContratoAssinado } :
    isGestor && (status === "ocorrencia_pendente" || status === "ocorrencia_devolvida_gestor") ? { label: "Enviar ocorrência ao financeiro", icon: DollarSign, onClick: () => changeStatus("ocorrencia_analise_financeiro") } :
    null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" onClick={handleVoltar}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Button>
      </div>

      {isJuridico && contratoDocs.length > 0 && ["contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura"].includes(status) && (
        <div className="flex justify-end print:hidden">
          <Button size="sm" variant="outline" onClick={openContratoDialog}>
            <AlertTriangle className="mr-2 h-4 w-4" />Pendência do contrato
          </Button>
        </div>
      )}

      {sale.contrato_libera_assinatura === false && ["contrato_conferencia_gestor", "contrato_conferencia_corretor", "contrato_ok_corretor", "aguardando_assinatura"].includes(status) && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 print:hidden dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          <b>Jurídico sinalizou pendência de documento — assinatura bloqueada:</b>{" "}
          {sale.contrato_pendencia_descricao || "sem descrição."}
        </div>
      )}

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
              <Button variant="outline" onClick={openContratoDialog}>
                <Upload className="mr-2 h-4 w-4" />{contratoDocs.length > 0 ? "Substituir contrato" : "Anexar contrato"}
              </Button>
              <Button variant="outline" onClick={irParaCertidoes}>
                <Gavel className="mr-2 h-4 w-4" />Subir certidões
              </Button>
              <Button onClick={enviarContratoAoGestor} disabled={contratoDocs.length === 0 || (certidoesJuridicoDocs.length === 0 && !sale.contrato_pendencia_descricao)}>
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
              <Button onClick={() => changeStatus("aguardando_assinatura")} disabled={sale.contrato_libera_assinatura === false} title={sale.contrato_libera_assinatura === false ? "Jurídico marcou que ainda não pode ir para assinatura" : undefined}><Send className="mr-2 h-4 w-4" />Enviar direto para assinatura</Button>
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
              <Button onClick={() => changeStatus("aguardando_assinatura")} disabled={sale.contrato_libera_assinatura === false} title={sale.contrato_libera_assinatura === false ? "Jurídico marcou que ainda não pode ir para assinatura" : undefined}><Send className="mr-2 h-4 w-4" />Enviar para assinatura</Button>
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
              <ReviewItem label="Código interno" value={sale.codigo_interno} />
              <ReviewItem label="Matrícula" value={sale.matricula} />
              <ReviewItem label="IPTU" value={sale.iptu} />
              <ReviewItem label="Endereço" value={sale.imovel_endereco} />
              <ReviewItem label="Tempo de venda" value={sale.tempo_venda_dias != null ? `${sale.tempo_venda_dias} dias` : null} />
              <ReviewItem label="Mídia" value={sale.midia} />
              <ReviewItem label="Observações do imóvel" value={sale.imovel_observacoes} />
            </ReviewGroup>

            <ReviewGroup title="Equipe">
              <ReviewItem label="Corretor captador" value={sale.corretor_captador} />
              <ReviewItem label="Corretor vendedor" value={sale.corretor_vendedor} />
              <ReviewItem label="Indicador" value={sale.indicador} />
              <ReviewItem label="Gestor" value={gestorOptions.find((l) => l.id === sale.coordenador_id)?.nome} />
              <ReviewItem label="Team Leader" value={teamLeaderOptions.find((l) => l.id === sale.team_leader_id)?.nome} />
            </ReviewGroup>

            <ReviewGroup title="Valores e negociação">
              <ReviewItem label="Valor anunciado" value={money(sale.valor_anunciado)} />
              <ReviewItem label="Valor negociado" value={money(sale.valor_negociado)} />
              <ReviewItem label="% Comissão" value={sale.percentual_comissao != null ? `${sale.percentual_comissao}%` : null} />
              <ReviewItem label="Valor total da comissão" value={money(sale.valor_total_comissao)} />
              <ReviewItem label="Forma de pagamento" value={sale.forma_pagamento} />
              <ReviewItem label="Observações" value={sale.negociacao_observacoes} />
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
              {commissionExtras.map((e) => (
                <ReviewItem
                  key={e.id}
                  label={`${COMISSAO_PAPEIS.find((p) => p.key === e.papel)?.label ?? "Outro"}${e.nome ? ` — ${e.nome}` : ""}`}
                  value={money(e.valor)}
                />
              ))}
              {([1, 2, 3] as const).map((n) => {
                const suf = n === 1 ? "" : n;
                const valor = sale[`previsao_recebimento${suf}_valor`];
                const data = sale[`previsao_recebimento${suf}_data`];
                const forma = sale[`previsao_recebimento${suf}_forma`];
                if (valor == null && !data && !forma) return null;
                return (
                  <ReviewItem
                    key={n}
                    label={`Previsão de recebimento — ${n}ª parcela`}
                    value={`${money(valor)}${data ? ` — ${dateBR(data)}` : ""}${forma ? ` — ${forma}` : ""}`}
                  />
                );
              })}
              {sale.previsao_recebimento_valor == null && sale.previsao_recebimento2_valor == null && sale.previsao_recebimento3_valor == null && (
                <ReviewItem label="Previsão de recebimento" value={null} />
              )}
            </ReviewGroup>

            <ReviewGroup title="Parceria externa">
              {sale.parceria_tipo ? (
                <>
                  <ReviewItem label="Tipo" value={PARCERIA_TIPOS.find((t) => t.key === sale.parceria_tipo)?.label ?? sale.parceria_tipo} />
                  <ReviewItem label="Corretor(a) / Imobiliária parceira" value={sale.parceria_nome} />
                  <ReviewItem label="CPF/CNPJ" value={sale.parceria_cpf_cnpj} />
                  <ReviewItem label="% Comissão" value={sale.parceria_percentual != null ? `${sale.parceria_percentual}%` : null} />
                  <ReviewItem label="Valor da comissão" value={money(sale.parceria_valor)} />
                  <ReviewItem label="Banco" value={sale.parceria_banco} />
                  <ReviewItem label="Agência" value={sale.parceria_agencia} />
                  <ReviewItem label="Conta" value={sale.parceria_conta} />
                  <ReviewItem label="PIX" value={sale.parceria_pix} />
                </>
              ) : (
                <ReviewItem label="Sem parceria externa" value={null} />
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
                      {p.tipo_pessoa === "juridica" && (
                        <>
                          <ReviewItem label="Razão social" value={p.razao_social} />
                          <ReviewItem label="CNPJ" value={p.cnpj} />
                        </>
                      )}
                      <ReviewItem label="CPF" value={p.cpf_cnpj} />
                      <ReviewItem label="RG" value={p.rg} />
                      <ReviewItem label="Profissão" value={p.profissao} />
                      <ReviewItem label="E-mail" value={p.email} />
                      <ReviewItem label="Telefone" value={p.telefone} />
                      <ReviewItem label="Endereço" value={p.endereco} />
                      <ReviewItem label="Regime de casamento" value={p.regime_casamento} />
                    </div>
                  );
                })}
              {partiesComNome(parties).length === 0 && (
                <ReviewItem label="Nenhuma parte preenchida" value={null} />
              )}
            </ReviewGroup>

            <ReviewGroup title="Pagamento">
              <ReviewItem label="Entrada" value={[money(payment?.entrada_valor), payment?.entrada_data].filter(Boolean).join(" — ") || null} />
              <ReviewItem label="Parcela 1" value={[money(payment?.parcela1_valor), payment?.parcela1_data].filter(Boolean).join(" — ") || null} />
              <ReviewItem label="Parcela 2" value={[money(payment?.parcela2_valor), payment?.parcela2_data].filter(Boolean).join(" — ") || null} />
              <ReviewItem label="Pagamento final" value={[money(payment?.pagamento_final_valor), payment?.pagamento_final_data].filter(Boolean).join(" — ") || null} />
              <ReviewItem label="FGTS" value={payment?.fgts ? money(payment?.fgts_valor) : "Não"} />
              <ReviewItem label="Tipo de pagamento" value={payment ? (payment.tipo_pagamento === "financiamento" ? "Financiamento" : payment.tipo_pagamento === "consorcio" ? "Consórcio" : "Vista") : null} />
              {payment?.tipo_pagamento === "financiamento" && (
                <>
                  <ReviewItem label="Financiamento" value={`${money(payment?.financiamento_valor)}${payment?.financiamento_banco ? ` — ${payment.financiamento_banco}` : ""}`} />
                  <ReviewItem label="Correspondente bancário" value={payment?.financiamento_correspondente} />
                  <ReviewItem label="Oba Crédito" value={payment?.oba_credito ? "Sim" : "Não"} />
                  <ReviewItem label="Previsão da liberação do crédito" value={dateBR(payment?.financiamento_previsao)} />
                </>
              )}
              {payment?.tipo_pagamento === "consorcio" && (
                <ReviewItem label="Consórcio" value={[payment?.consorcio_nome, payment?.consorcio_grupo && `Grupo ${payment.consorcio_grupo}`, payment?.consorcio_cota && `Cota ${payment.consorcio_cota}`].filter(Boolean).join(" — ") || null} />
              )}
              <ReviewItem label="Observações" value={payment?.observacoes} />
            </ReviewGroup>

            <ReviewGroup title="Dados bancários do vendedor/proprietário">
              {Object.keys(parties).filter((p) => p.startsWith("vendedor_")).sort((a, b) => parteSortKey(a)[1] - parteSortKey(b)[1]).map((papel, i, arr) => {
                const b = banks[papel];
                return (
                  <div key={papel} className={i < arr.length - 1 ? "border-b pb-2 mb-2" : ""}>
                    <div className="mb-1 font-medium">{parteLabel(papel)}</div>
                    <ReviewItem label="Titular" value={b?.titular} />
                    <ReviewItem label="Banco" value={b?.banco} />
                    <ReviewItem label="Agência" value={b?.agencia} />
                    <ReviewItem label="Conta" value={b?.conta} />
                    <ReviewItem label="PIX" value={b?.pix} />
                  </div>
                );
              })}
              {Object.keys(parties).filter((p) => p.startsWith("vendedor_")).length === 0 && (
                <ReviewItem label="Nenhum vendedor/proprietário preenchido" value={null} />
              )}
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
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5"><FileCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> <span className="shrink-0">Contrato assinado:</span> <b className="truncate text-foreground" title={contratoAssinadoDocs[contratoAssinadoDocs.length - 1].file_name}>{contratoAssinadoDocs[contratoAssinadoDocs.length - 1].file_name}</b></span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => abrirContratoRapido(contratoAssinadoDocs[contratoAssinadoDocs.length - 1])}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver / baixar</Button>
                </div>
              )}
              {contratoDocs.length > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5"><FileCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> <span className="shrink-0">Contrato (versão para revisão):</span> <b className="truncate text-foreground" title={contratoDocs[contratoDocs.length - 1].file_name}>{contratoDocs[contratoDocs.length - 1].file_name}</b></span>
                  <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => abrirContratoRapido(contratoDocs[contratoDocs.length - 1])}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver / baixar</Button>
                </div>
              )}
              {certidoesJuridicoDocs.length > 0 && (
                <div className="space-y-1 border-t border-primary/20 pt-1.5">
                  <div className="text-muted-foreground">Certidões (Jurídico):</div>
                  {certidoesJuridicoDocs.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 pl-1">
                      <span className="flex min-w-0 items-center gap-1.5"><FileCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> <b className="truncate text-foreground" title={d.descricao || d.file_name}>{d.descricao || d.file_name}</b></span>
                      <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => abrirContratoRapido(d)}><Eye className="mr-1.5 h-3.5 w-3.5" />Ver / baixar</Button>
                    </div>
                  ))}
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
        <div id="venda-wizard">
          <Wizard
            steps={steps}
            current={step}
            onChange={setStep}
            dirty={currentDirty}
            onBeforeLeave={onBeforeLeave}
            nextDisabled={nextDisabledFromDocumentos || nextDisabledFromResumo}
            lastStepAction={primaryAction && (
              <Button onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                <primaryAction.icon className="mr-2 h-4 w-4" />{primaryAction.label}
              </Button>
            )}
          />
        </div>
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

              <ReviewGroup title="Parceria externa">
                {sale.parceria_tipo ? (
                  <>
                    <ReviewItem label="Tipo" value={PARCERIA_TIPOS.find((t) => t.key === sale.parceria_tipo)?.label ?? sale.parceria_tipo} />
                    <ReviewItem label="Corretor(a) / Imobiliária parceira" value={sale.parceria_nome} />
                    <ReviewItem label="Valor da comissão" value={money(sale.parceria_valor)} />
                  </>
                ) : (
                  <ReviewItem label="Sem parceria externa" value={null} />
                )}
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
            {docsPendentesAprovacao.length === 0 ? (
              <div className="rounded-md bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="mr-2 inline h-4 w-4" />Todos os documentos obrigatórios estão aprovados.
              </div>
            ) : (
              <div className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mr-2 inline h-4 w-4" />{docsPendentesAprovacao.length} documento(s) ainda não aprovado(s). Aprove-os na etapa Documentos antes de enviar ao jurídico.
                <ul className="mt-2 space-y-1 pl-2">
                  {docsPendentesAprovacao.map(p => <li key={p.campo} className="flex items-start gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><span>{p.mensagem}</span></li>)}
                </ul>
              </div>
            )}

            {comissaoExcedida && (
              <div className="rounded-md bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                A soma da comissão do captador ({money(formSale.valor_comissao_captador)}) e do vendedor ({money(formSale.valor_comissao_vendedor)}) ultrapassa o valor total da comissão ({money(formSale.valor_total_comissao)}). Ajuste na Divisão da comissão antes de enviar ao jurídico.
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

              <ReviewGroup title="Parceria externa">
                {sale.parceria_tipo ? (
                  <>
                    <ReviewItem label="Tipo" value={PARCERIA_TIPOS.find((t) => t.key === sale.parceria_tipo)?.label ?? sale.parceria_tipo} />
                    <ReviewItem label="Corretor(a) / Imobiliária parceira" value={sale.parceria_nome} />
                    <ReviewItem label="Valor da comissão" value={money(sale.parceria_valor)} />
                  </>
                ) : (
                  <ReviewItem label="Sem parceria externa" value={null} />
                )}
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
            <Button onClick={confirmApproveJuridico} disabled={docsPendentesAprovacao.length > 0 || comissaoExcedida}>Confirmar e enviar ao jurídico</Button>
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

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Switch checked={contratoFaltaDoc} onCheckedChange={setContratoFaltaDoc} disabled={contratoUploading} />
              <Label className="cursor-pointer" onClick={() => !contratoUploading && setContratoFaltaDoc((v) => !v)}>Está faltando algum documento?</Label>
            </div>
            {contratoFaltaDoc && (
              <Textarea
                placeholder="Descreva o que está faltando"
                value={contratoFaltaDocDesc}
                onChange={(e) => setContratoFaltaDocDesc(e.target.value)}
                disabled={contratoUploading}
                rows={3}
              />
            )}
            <div className="flex items-center gap-2 border-t pt-3">
              <Switch checked={contratoLiberaAssinatura} onCheckedChange={setContratoLiberaAssinatura} disabled={contratoUploading} />
              <Label className="cursor-pointer" onClick={() => !contratoUploading && setContratoLiberaAssinatura((v) => !v)}>Libera o gestor a enviar para assinatura</Label>
            </div>
            {!contratoLiberaAssinatura && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Enquanto isso estiver desmarcado, o gestor não vai conseguir mandar o contrato para assinatura.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setContratoDialogOpen(false)} disabled={contratoUploading}>Cancelar</Button>
            <Button
              onClick={uploadContrato}
              disabled={contratoUploading || (!contratoFile && contratoDocs.length === 0)}
            >
              {contratoUploading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</>) : (<><Upload className="mr-2 h-4 w-4" />{contratoFile || contratoDocs.length === 0 ? "Anexar contrato" : "Salvar"}</>)}
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

/** Papéis de comprador_N/vendedor_N com nome preenchido, em ordem — usado nos resumos/diálogos de conferência. */
function partiesComNome(parties: Record<string, any>): string[] {
  return Object.keys(parties)
    .filter((p) => /^(vendedor|comprador)_\d+$/.test(p) && parties[p]?.nome)
    .sort((a, b) => {
      const ka = parteSortKey(a), kb = parteSortKey(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
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
  // Só string dá pra copiar (valores em badge/JSX, tipo status de documento, ficam de fora).
  const copiable = typeof value === "string" && value.trim().length > 0;
  const copy = async () => {
    if (!copiable) return;
    await navigator.clipboard.writeText(value as string);
    toast.success(`"${label}" copiado`);
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        role={copiable ? "button" : undefined}
        title={copiable ? "Clique para copiar" : undefined}
        onClick={copy}
        className={`text-right font-medium ${copiable ? "cursor-pointer inline-flex items-center gap-1 hover:text-primary" : ""}`}
      >
        {value ?? <span className="text-muted-foreground">—</span>}
        {copiable && <Copy className="h-3 w-3 shrink-0 opacity-50" />}
      </span>
    </div>
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
      // Não passa por notifySaleStatusChange de propósito: reabertura é uma ação corretiva rara
      // (só financeiro/admin fazem), não faz parte da esteira normal de "sua vez"/"toda atualização"
      // coberta por proximoResponsavelRoles, e decidimos não expandir o alcance do WhatsApp pra esse
      // caso agora. Só o corretor é avisado (sino), e não duplica se ele mesmo tiver reaberto.
      if (sale.corretor_id && sale.corretor_id !== user?.id) {
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
// recebeu lá (Gestor/Team Leader/Outro/mais um captador ou vendedor) — sem papel definido, cai em "outro".
const EXTRA_ORIGEM_PAPEIS = new Set(["gestor", "team_leader", "outro", "corretor_captador", "corretor_vendedor"]);
const papelDaExtra = (papel: string | null) => (papel && EXTRA_ORIGEM_PAPEIS.has(papel) ? papel : "outro");
// Papéis "fixos" da comissão (1 linha por venda cada, vindos direto de sales.corretor_captador/
// vendedor/indicador) — diferente de EXTRA_ORIGEM_PAPEIS acima, que é só sobre como rotular uma
// parte EXTRA. Não reaproveitar esse set ali: corretor_captador/vendedor está nos dois por razões
// diferentes, e um dia já causou um bug (createOcc parava de criar a linha fixa do captador/vendedor).
const FIXED_COMISSAO_PAPEIS = new Set(["corretor_captador", "indicador_captador", "corretor_vendedor", "indicador_vendedor"]);

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

/**
 * Mesma lógica do syncOccurrenceCommissions, mas para a parceria externa (imobiliária externa ou
 * outra unidade RE/MAX) sinalizada na Resumo — a linha em occurrence_partners marcada com
 * from_sale=true é a que fica em sincronia; banco/agência/conta preenchidos depois pelo financeiro
 * não são tocados aqui. Se a parceria for removida na Resumo, a linha sincronizada é apagada.
 */
async function syncOccurrencePartnerFromSale(saleId: string, sale: any) {
  const { data: occ } = await supabase.from("occurrences").select("id").eq("sale_id", saleId).maybeSingle();
  if (!occ) return;

  const { data: existing } = await supabase.from("occurrence_partners").select("*").eq("occurrence_id", occ.id).eq("from_sale", true);
  const row = (existing ?? [])[0];

  if (!sale.parceria_tipo) {
    if (row) await supabase.from("occurrence_partners").delete().eq("id", row.id);
    return;
  }

  const data = {
    tipo: sale.parceria_tipo,
    nome: sale.parceria_nome ?? null,
    cpf_cnpj: sale.parceria_cpf_cnpj ?? null,
    percentual: sale.parceria_percentual ?? null,
    valor: sale.parceria_valor ?? null,
  };
  if (row) {
    // Banco/agência/conta/pix NÃO entram aqui de propósito — uma vez que a ocorrência existe,
    // esses campos passam a ser do financeiro, e ressincronizar a cada save da Resumo sobrescreveria
    // o que ele já preencheu.
    if (row.tipo !== data.tipo || row.nome !== data.nome || row.cpf_cnpj !== data.cpf_cnpj || Number(row.percentual ?? 0) !== Number(data.percentual ?? 0) || Number(row.valor ?? 0) !== Number(data.valor ?? 0)) {
      await supabase.from("occurrence_partners").update(data).eq("id", row.id);
    }
  } else {
    await supabase.from("occurrence_partners").insert({
      occurrence_id: occ.id, from_sale: true, ...data,
      banco: sale.parceria_banco ?? null, agencia: sale.parceria_agencia ?? null, conta: sale.parceria_conta ?? null, pix: sale.parceria_pix ?? null,
    });
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

  // Espelham dirtyOcc/dirtyComms/dirtyPartners em refs — load() precisa ler o valor mais atual sem
  // depender do ciclo de re-render (usado pra não sobrescrever um buffer que ainda está dirty).
  const dirtyOccRef = useRef(false);
  useEffect(() => { dirtyOccRef.current = dirtyOcc; }, [dirtyOcc]);
  const dirtyCommsRef = useRef(false);
  useEffect(() => { dirtyCommsRef.current = dirtyComms; }, [dirtyComms]);
  const dirtyPartnersRef = useRef(false);
  useEffect(() => { dirtyPartnersRef.current = dirtyPartners; }, [dirtyPartners]);

  const load = useCallback(async () => {
    const { data: o } = await supabase.from("occurrences").select("*").eq("sale_id", saleId).maybeSingle();
    setOcc(o);
    // Não sobrescreve um buffer com edição local ainda não salva: load() roda tanto no mount quanto
    // depois de qualquer save (que já limpa o dirty antes de chamar load(), ver save() abaixo) quanto
    // pelo watcher de mudanças na Resumo logo adiante — sem essa trava, digitar aqui enquanto esse
    // watcher dispara (por causa de uma mudança em OUTRA aba) apagava o que a pessoa estava editando.
    if (!dirtyOccRef.current) setFormOcc(o ?? {});
    if (o) {
      const [c, p] = await Promise.all([
        supabase.from("occurrence_commissions").select("*").eq("occurrence_id", o.id).order("created_at"),
        supabase.from("occurrence_partners").select("*").eq("occurrence_id", o.id).order("created_at"),
      ]);
      setCommissions(c.data ?? []);
      if (!dirtyCommsRef.current) setFormComms(c.data ?? []);
      setPartners(p.data ?? []);
      if (!dirtyPartnersRef.current) setFormPartners(p.data ?? []);
    }
    setLoading(false);
  }, [saleId]);
  useEffect(() => { load(); }, [load]);

  // Sempre que a Resumo salva captador/vendedor/indicador/partes extras, o valor já é
  // sincronizado direto no banco (ver syncOccurrenceCommissions) — aqui só recarrega essa
  // tela pra refletir o que já foi salvo, sem precisar de F5 nem clicar em "Puxar".
  // Não recarrega se houver edição não salva em qualquer um dos três buffers, pra não apagar o
  // que o usuário estava digitando (load() em si também está protegido, mas nem chega a rodar).
  useEffect(() => {
    if (dirtyOcc || dirtyComms || dirtyPartners) return;
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
      tempo_venda_dias: sale.tempo_venda_dias,
      midia: sale.midia,
      valor_anunciado: sale.valor_anunciado,
      valor_negociado: sale.valor_negociado,
      percentual_comissao: sale.percentual_comissao,
      valor_comissao: sale.valor_total_comissao,
      financiamento: payment?.financiamento ?? false,
      financiamento_valor: payment?.financiamento_valor ?? null,
      financiamento_banco: payment?.financiamento_banco ?? null,
      financiamento_correspondente: payment?.financiamento_correspondente ?? null,
      financiamento_previsao: payment?.financiamento_previsao ?? null,
      oba_credito: payment?.oba_credito ?? false,
      prev_recebimento_valor: sale.previsao_recebimento_valor ?? null,
      prev_recebimento_data: sale.previsao_recebimento_data ?? null,
      prev_recebimento_forma: sale.previsao_recebimento_forma ?? null,
      prev_recebimento2_valor: sale.previsao_recebimento2_valor ?? null,
      prev_recebimento2_data: sale.previsao_recebimento2_data ?? null,
      prev_recebimento2_forma: sale.previsao_recebimento2_forma ?? null,
      prev_recebimento3_valor: sale.previsao_recebimento3_valor ?? null,
      prev_recebimento3_data: sale.previsao_recebimento3_data ?? null,
      prev_recebimento3_forma: sale.previsao_recebimento3_forma ?? null,
      observacoes: [vendedor?.nome && `Vendedor/Proprietário: ${vendedor.nome}`, comprador?.nome && `Comprador: ${comprador.nome}`].filter(Boolean).join(" | ") || null,
      status: "pendente",
    }).select("*").single();
    if (error) { toast.error(error.message); return; }
    // Pré-preenche captador/vendedor/indicador com o que já foi definido na revisão do gestor
    // (aba Resumo) — sem isso a tabela de comissões nasce zerada e duplica trabalho já feito.
    const totalComissao = Number(sale.valor_total_comissao ?? 0);
    const pctOfTotal = (v: any) => (v != null && totalComissao > 0 ? Number(((Number(v) / totalComissao) * 100).toFixed(3)) : null);
    const commRows = COMISSAO_PAPEIS.filter((p) => FIXED_COMISSAO_PAPEIS.has(p.key)).map((p) => {
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
    // Parceria externa (imobiliária externa ou outra unidade RE/MAX) já sinalizada na Resumo
    // entra junto na criação, sem precisar reentrar os dados na Ocorrência.
    if (sale.parceria_tipo) {
      await supabase.from("occurrence_partners").insert({
        occurrence_id: data.id, from_sale: true, tipo: sale.parceria_tipo,
        nome: sale.parceria_nome ?? null, cpf_cnpj: sale.parceria_cpf_cnpj ?? null,
        percentual: sale.parceria_percentual ?? null, valor: sale.parceria_valor ?? null,
        banco: sale.parceria_banco ?? null, agencia: sale.parceria_agencia ?? null, conta: sale.parceria_conta ?? null, pix: sale.parceria_pix ?? null,
      });
    }
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
      // Se a linha fixa (captador/vendedor/indicador) nunca existiu na ocorrência — ex.: ela foi
      // criada antes desses campos serem preenchidos na revisão do gestor — o map acima não tem o
      // que atualizar. Cria a linha que estiver faltando, em vez de silenciosamente não fazer nada.
      const fixedTargets: { papel: string; nome: any; valor: any }[] = [
        { papel: "corretor_captador", nome: sale.corretor_captador ?? null, valor: sale.valor_comissao_captador ?? null },
        { papel: "corretor_vendedor", nome: sale.corretor_vendedor ?? null, valor: sale.valor_comissao_vendedor ?? null },
      ];
      if (sale.indicador_lado === "captador") fixedTargets.push({ papel: "indicador_captador", nome: sale.indicador ?? null, valor: sale.valor_comissao_indicador ?? null });
      if (sale.indicador_lado === "vendedor") fixedTargets.push({ papel: "indicador_vendedor", nome: sale.indicador ?? null, valor: sale.valor_comissao_indicador ?? null });
      for (const t of fixedTargets) {
        if (t.nome == null && t.valor == null) continue;
        if (!next.some((r) => r.papel === t.papel)) {
          next = [...next, { id: `new-${crypto.randomUUID()}`, occurrence_id: occ?.id, papel: t.papel, nome: t.nome, percentual: pctOfTotal(t.valor), valor: t.valor, _new: true }];
        }
      }
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
      financiamento_previsao: payment?.financiamento_previsao ?? null,
      oba_credito: payment?.oba_credito ?? false,
    });
    toast.success("Financiamento, valor, banco, correspondente, previsão e Oba Crédito puxados do pagamento — confira e salve.");
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
    (occ.financiamento_correspondente ?? "") !== (payment?.financiamento_correspondente ?? "") ||
    (occ.financiamento_previsao ?? "") !== (payment?.financiamento_previsao ?? "") ||
    Boolean(occ.oba_credito) !== Boolean(payment?.oba_credito)
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
  // Traz a parceria externa (imobiliária externa ou outra unidade RE/MAX) já sinalizada na Resumo —
  // útil para ocorrências criadas antes desse pré-preenchimento existir ou quando a Resumo mudou depois.
  const pullPartnerFromSale = () => {
    if (!sale.parceria_tipo) { toast.error("Nenhuma parceria externa sinalizada na Resumo."); return; }
    const data = { tipo: sale.parceria_tipo, nome: sale.parceria_nome ?? null, cpf_cnpj: sale.parceria_cpf_cnpj ?? null, percentual: sale.parceria_percentual ?? null, valor: sale.parceria_valor ?? null, from_sale: true };
    setFormPartners((rows) => {
      const idx = rows.findIndex((r) => r.from_sale);
      // Banco/agência/conta/pix só entram quando a linha ainda nem existia (nada do financeiro
      // pra preservar) — num pull repetido numa linha já existente, ficam como estão.
      if (idx >= 0) return rows.map((r, i) => i === idx ? { ...r, ...data } : r);
      return [...rows, {
        id: `new-${crypto.randomUUID()}`, occurrence_id: occ?.id,
        banco: sale.parceria_banco ?? null, agencia: sale.parceria_agencia ?? null, conta: sale.parceria_conta ?? null, pix: sale.parceria_pix ?? null,
        ...data, _new: true,
      }];
    });
    setDirtyPartners(true);
    toast.success("Parceria da Resumo aplicada — confira e salve.");
  };
  const parceriaDesatualizada = useMemo(() => {
    if (!occ || !sale.parceria_tipo) return false;
    const row = partners.find((r) => r.from_sale);
    if (!row) return true;
    return row.tipo !== sale.parceria_tipo || (row.nome ?? "") !== (sale.parceria_nome ?? "") || (row.cpf_cnpj ?? "") !== (sale.parceria_cpf_cnpj ?? "")
      || Math.abs(Number(row.percentual ?? 0) - Number(sale.parceria_percentual ?? 0)) > 0.001
      || Math.abs(Number(row.valor ?? 0) - Number(sale.parceria_valor ?? 0)) > 0.01;
  }, [occ, sale, partners]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!occ) return true;
    setSaving(true);
    try {
      if (dirtyOcc) {
        const fields = ["codigo_imovel","tempo_venda_dias","data_assinatura","midia","nota_fiscal_obrigatoria","valor_anunciado","valor_negociado","percentual_comissao","valor_comissao","financiamento","financiamento_valor","financiamento_banco","financiamento_correspondente","financiamento_previsao","oba_credito","prev_recebimento_valor","prev_recebimento_data","prev_recebimento_forma","prev_recebimento2_valor","prev_recebimento2_data","prev_recebimento2_forma","prev_recebimento3_valor","prev_recebimento3_data","prev_recebimento3_forma","observacoes"];
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
          const data = { nome: r.nome ?? null, cpf_cnpj: r.cpf_cnpj ?? null, percentual: r.percentual ?? null, valor: r.valor ?? null, banco: r.banco ?? null, agencia: r.agencia ?? null, conta: r.conta ?? null, pix: r.pix ?? null };
          const { error } = r._new
            ? await supabase.from("occurrence_partners").insert({ occurrence_id: occ.id, ...data })
            : await supabase.from("occurrence_partners").update(data).eq("id", r.id);
          if (error) { toast.error(error.message); return false; }
        }
      }
      // Limpa os refs de dirty já aqui (síncrono), antes do load() logo abaixo — senão load() ainda
      // enxergaria os buffers como dirty (o useEffect que espelha dirty*->ref só roda no próximo
      // render) e pularia a sincronização com o que acabou de ser salvo.
      dirtyOccRef.current = false;
      dirtyCommsRef.current = false;
      dirtyPartnersRef.current = false;
      setDirtyOcc(false);
      setDirtyComms(false);
      setDirtyPartners(false);
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
  // Só informativo (não é uma linha de comissão paga a alguém) — o mesmo cálculo da Resumo:
  // valor_comissao_imobiliaria já descontando parceria externa, menos partes extras que saem dessa fatia.
  const imobiliariaExtras = commissionExtras.filter((e) => e.origem === "imobiliaria").reduce((s, e) => s + Number(e.valor ?? 0), 0);
  const valorImobiliaria = Number(sale.valor_comissao_imobiliaria ?? 0) - imobiliariaExtras;

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
      // Não passa por notifySaleStatusChange de propósito — ver mesmo comentário na outra ocorrência
      // desse bloco (reabertura é ação corretiva rara, fora da esteira normal de sua vez/toda atualização).
      const { data: s } = await supabase.from("sales").select("corretor_id").eq("id", saleId).maybeSingle();
      if (s?.corretor_id && s.corretor_id !== user?.id) {
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
            <Field label="Tempo de venda (dias)"><Input type="number" min="0" step="1" value={formOcc.tempo_venda_dias ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ tempo_venda_dias: e.target.value ? Number(e.target.value) : null })} placeholder="Ex: 45" /></Field>
            <Field label="Data de assinatura"><Input type="date" value={formOcc.data_assinatura ?? ""} disabled={!canWrite} onChange={(e) => updOcc({ data_assinatura: e.target.value || null })} /></Field>
            <Field label="Mídia">
              <Select value={formOcc.midia ?? "none"} onValueChange={(v) => updOcc({ midia: v === "none" ? null : v })} disabled={!canWrite}>
                <SelectTrigger><SelectValue placeholder="Selecione o canal" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {MIDIA_OPTIONS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
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
        <CardHeader><CardTitle className="text-base">Vendedor e Comprador</CardTitle></CardHeader>
        <CardContent>
          {partiesComNome(parties).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma parte preenchida.</p>
          ) : (
            <div className="space-y-3">
              {partiesComNome(parties).map((papel) => {
                const p = parties[papel];
                return (
                  <ReviewGroup key={papel} title={`${parteLabel(papel)} — ${p.nome}`}>
                    {p.tipo_pessoa === "juridica" && (
                      <>
                        <ReviewItem label="Razão social" value={p.razao_social} />
                        <ReviewItem label="CNPJ" value={p.cnpj} />
                      </>
                    )}
                    <ReviewItem label="CPF" value={p.cpf_cnpj} />
                    <ReviewItem label="RG" value={p.rg} />
                    <ReviewItem label="E-mail" value={p.email} />
                    <ReviewItem label="Telefone" value={p.telefone} />
                  </ReviewGroup>
                );
              })}
            </div>
          )}
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
            <Field label="Oba Crédito"><div className="flex items-center gap-2"><Switch checked={!!formOcc.oba_credito} onCheckedChange={(v) => updOcc({ oba_credito: v })} disabled={!canWrite || !formOcc.financiamento} /><span className="text-sm text-muted-foreground">{formOcc.oba_credito ? "Sim" : "Não"}</span></div></Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Previsão de recebimento da comissão</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {sale.parceria_valor != null && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Digite o valor <b>total da parcela (bruto)</b>, incluindo a parte da parceria — "Comissões a Receber" já desconta automaticamente a fatia de {sale.parceria_nome || "parceria"} (R$ {Number(sale.parceria_valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) do total da comissão.
            </p>
          )}
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
            <p className="mt-1 text-xs text-muted-foreground">Total: R$ {total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · Distribuído: R$ {somaComissoes.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} · Imobiliária: R$ {valorImobiliaria.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
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
          {canWrite && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={pullPartnerFromSale}>Puxar da Resumo</Button>
              <Button size="sm" variant="outline" onClick={addPartner}><Plus className="mr-1 h-4 w-4" />Adicionar parceria</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {parceriaDesatualizada && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              A parceria externa mudou na Resumo depois da última sincronização. Clique em "Puxar da Resumo" para atualizar.
            </div>
          )}
          {formPartners.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma parceria adicionada.</p>}
          {formPartners.map(p => (
            <div key={p.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-4">
              {p.tipo && (
                <p className="text-xs font-medium text-muted-foreground md:col-span-4">
                  {PARCERIA_TIPOS.find((t) => t.key === p.tipo)?.label ?? p.tipo}
                  {p.from_sale && " · sinalizado na Resumo"}
                </p>
              )}
              <Field label="Corretor/Imobiliária"><Input value={p.nome ?? ""} onChange={(e) => updPartner(p.id, { nome: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="CPF/CNPJ"><Input value={p.cpf_cnpj ?? ""} onChange={(e) => updPartner(p.id, { cpf_cnpj: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="%"><Input type="number" step="0.001" value={p.percentual ?? ""} onChange={(e) => updPartner(p.id, { percentual: e.target.value ? Number(e.target.value) : null })} disabled={!canWrite} /></Field>
              <Field label="Valor"><CurrencyInput value={p.valor} onChange={(v) => updPartner(p.id, { valor: v })} disabled={!canWrite} /></Field>
              <Field label="Banco"><Input value={p.banco ?? ""} onChange={(e) => updPartner(p.id, { banco: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="Agência"><Input value={p.agencia ?? ""} onChange={(e) => updPartner(p.id, { agencia: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="Conta"><Input value={p.conta ?? ""} onChange={(e) => updPartner(p.id, { conta: e.target.value })} disabled={!canWrite} /></Field>
              <Field label="PIX"><Input value={p.pix ?? ""} onChange={(e) => updPartner(p.id, { pix: e.target.value })} disabled={!canWrite} /></Field>
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
