import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lerDataAssinaturaPdf, motivoSemData } from "@/lib/clicksign-data-assinatura";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { DETAIL_NOT_FOUND_MESSAGE, isDetailRouteId } from "@/lib/detail-route-state";
import { DetailNotFound } from "@/components/DetailNotFound";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  downloadCaptureTemplate,
  downloadDocument,
  listUnits,
  loadCapture,
  saveCapture,
  signedDocument,
  signedDocuments,
  transitionCapture,
  archiveCapture,
  setCaptureSignedOn,
  addressConflicts,
  type AddressConflict,
  uploadCaptureDocument,
  confirmarDataAssinatura,
  vendaDaCaptacao,
  corrigirCaptacaoAprovada,
  virarVenda,
  type VendaDaCaptacao,
} from "@/lib/exclusive-captures-db";
import {
  applySignedContract,
  applySuggestedFields,
  captureValidity,
  MANUAL_COLOR,
  manualPendencies,
  ownerNamesSummary,
  formatDateBR,
  VALIDITY_STYLE,
  validityText,
  fillExclusiveTemplate,
  missingRequirements,
  addOwner,
  canRemoveOwner,
  captureOwners,
  ownerDocKinds,
  ownerNumber,
  ownerScope,
  removeOwner,
  withOwners,
  OWNER_FIELDS,
  PROPERTY_FIELDS,
  TERMS_FIELDS,
  captureUnit,
  captureUnitLabel,
  contractSource,
  normalizeForm,
  normalizeReais,
  typeReais,
  type Capture,
  type CaptureDocument,
  type ExclusiveUnit,
  type CaptureEvent,
  type CaptureForm,
  type DocumentKind,
  type OwnerField,
  type OwnerScope,
  type PropertyField,
  type TermsField,
} from "@/lib/exclusive-captures";
import { suggestFromLocalFile, validCpf, validCreci } from "@/lib/exclusive-captures-ocr";
import { fieldsFromDocument, isAiReadableKind } from "@/lib/exclusive-captures-ai";
import { AI_TIMEOUT_MESSAGE } from "@/lib/ai-timeout";
import { AI_UNAVAILABLE_MESSAGE } from "@/lib/ai-indisponivel";
import {
  extractCaptureDocument,
  extractSignedContract,
} from "@/lib/exclusive-captures-ai.functions";
import {
  limparArquivoSubstituido,
  removerDocumentoCaptacao,
} from "@/lib/captacao-remover-documento.functions";
import {
  clicksignCaptureSigned,
  clicksignManualInstructions,
  currentSignedDoc,
  fixarTestemunhasPdf,
  hasSignedStep,
  testemunhasCaptacao,
  testemunhasParaPdf,
  usarTestemunhasAuto,
  type ClicksignSignedInfo,
  type TestemunhasCaptacao,
} from "@/lib/exclusive-clicksign";
import { TestemunhasAutomaticas } from "@/components/exclusividades/TestemunhasAutomaticas";
import { ClicksignEnvio } from "@/components/exclusividades/ClicksignEnvio";
import { OwnerBlocks } from "@/components/exclusividades/OwnerBlocks";
import { useCaptureAutosave } from "@/components/exclusividades/useCaptureAutosave";
import { AutosaveStatus } from "@/components/vendas/shared";
import { STATUS_AGUARDANDO_MANUAL } from "@/lib/assinatura-manual";
import { juntarDocumentosEmPdf } from "@/lib/document-actions";
import { caberNoLimite, compressPdfBytes, formatMB, GERACAO_CONTRATO } from "@/lib/pdf-compress";
import { browserImageCodec } from "@/lib/pdf-compress-browser";
import { DocumentoAssinadoResumo } from "@/components/exclusividades/DocumentoAssinadoResumo";
import { CaptureDossieStep } from "@/components/CaptureDossieStep";
import { AnuncioPortais } from "@/components/exclusividades/AnuncioPortais";
import { PlanoChecklist } from "@/components/exclusividades/PlanoChecklist";
import {
  appendDossieToContract,
  buildDossiePdf,
  dossieCatalog,
  dossieMissingFor,
  initialDossieSelection,
  selectedDossie,
  ajustarSemanas,
  totalSemanasPlano,
  type PlanoSemanas,
} from "@/lib/capture-dossie";
import {
  canBuildCompletePdf,
  completePdfDocs,
  completePdfName,
  signaturePdfName,
} from "@/lib/capture-pdfs";
import type { FeedbackAction } from "@/lib/owner-feedback-actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  baixarDocumentosComoPdf,
  isImageFile,
  openDocumentPrintWindow,
  printDocumentUrls,
} from "@/lib/document-actions";
import { errorMessage } from "@/lib/errors";
import { hojeSaoPaulo } from "@/lib/hoje-sao-paulo";
import { useRecarregarAoFocar } from "@/lib/use-recarregar-ao-focar";
import { diasEntre, haQuantosDias } from "@/lib/captacao-venda";
import {
  aprovarBloqueio,
  autorDoHistorico,
  AVISO_CLICKSIGN,
  avisarTransicao,
  podeDevolverAprovada,
  ultimaDevolucao,
} from "@/lib/captacao-auditoria";
import { notifyCaptureTransition } from "@/lib/captacao-notifications.functions";
import {
  AVISO_VENDA_CORRECAO,
  CORRECAO_TRAVADOS,
  lerCorrecao,
  montarCorrecao,
  podeCorrigirAprovada,
  textoMudanca,
} from "@/lib/captacao-correcao";
import {
  avisoSemAssinado,
  BLOQUEIO_SEM_ASSINADO,
  captacaoDoProprioGestor,
  DATA_ASSINATURA_MIN,
  podeCaptadorInformarData,
  textoAprovacao,
} from "@/lib/captacoes-painel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FICHA_CAPTACAO_CAMPOS,
  TIPOS_IMOVEL,
  campoVisivel,
  fichaCaptacaoVazia,
  isTipoImovel,
  tipoImovelDoTexto,
  type FichaCaptacao,
} from "@/lib/ficha-imovel";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  Download,
  Eye,
  FileCheck2,
  ArrowRightLeft,
  Handshake,
  Pencil,
  Printer,
  Trash2,
  Upload,
} from "lucide-react";
import { ListSkeleton } from "@/components/visual/base";
import { TransferirCaptacaoDialog } from "@/components/exclusividades/TransferirCaptacaoDialog";
import {
  avisoContratoOutroCorretor,
  contratoNaTransferencia,
  lerTransferencia,
  papelPodeTransferir,
  podeTransferir,
  textoTransferencia,
  TEXTO_CONTRATO,
} from "@/lib/captacao-transferencia";

export const Route = createFileRoute("/_authenticated/exclusividades/$id")({
  beforeLoad: guardExclusiveRoute,
  head: () => ({ meta: [{ title: "Captação exclusiva" }] }),
  component: ExclusiveDetail,
});

const documentLabels: Record<DocumentKind, string> = {
  rg: "RG",
  cpf: "CPF",
  cnh: "CNH",
  residencia: "Comprovante de residência",
  iptu: "IPTU",
  matricula: "Matrícula",
  gerado: "Contrato gerado",
  assinado: "Contrato assinado",
};
const statusLabels: Record<Capture["status"], string> = {
  rascunho: "Rascunho",
  devolvida: "Devolvida para ajuste",
  enviada: "Enviada ao gestor",
  em_assinatura: "Em assinatura (Clicksign externa)",
  aprovada: "Aprovada",
};
const normalSteps = [
  { key: "documentos", label: "Documentos" },
  { key: "dados", label: "Dados do contrato" },
  { key: "dossie", label: "Plano de Marketing" },
  { key: "revisao", label: "Revisão e envio" },
] as const;
// Passo 5 só existe depois que o contrato assinado chega (Clicksign ou upload manual).
const signedStepItem = { key: "assinado", label: "Documento assinado" } as const;
// Cadastro manual (contrato já assinado no papel): contrato → conferência → Plano de Marketing.
const manualSteps = [
  { key: "contrato", label: "Contrato assinado" },
  { key: "dados", label: "Conferência dos dados" },
  { key: "dossie", label: "Plano de Marketing" },
  { key: "revisao", label: "Envio ao gestor" },
] as const;
type CaptureStep =
  | (typeof normalSteps)[number]["key"]
  | (typeof manualSteps)[number]["key"]
  | typeof signedStepItem.key;

function ExclusiveDetail() {
  const { id } = Route.useParams();
  const { user, hasAny } = useAuth();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [units, setUnits] = useState<ExclusiveUnit[]>([]);
  const [form, setForm] = useState<CaptureForm | null>(null);
  const [cpf, setCpf] = useState("");
  const [creci, setCreci] = useState("");
  const [docs, setDocs] = useState<CaptureDocument[]>([]);
  const [history, setHistory] = useState<CaptureEvent[]>([]);
  // Testemunhas automáticas da Clicksign (corretor + gestor da equipe, t_e8078685).
  const [testemunhas, setTestemunhas] = useState<TestemunhasCaptacao | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<CaptureStep>("documentos");
  const [dossieActions, setDossieActions] = useState<FeedbackAction[]>([]);
  const [dossieLoading, setDossieLoading] = useState(true);
  const [preview, setPreview] = useState<{ doc: CaptureDocument; url: string } | null>(null);
  const [reason, setReason] = useState("");
  const [signedOn, setSignedOn] = useState("");
  // Data lida do PDF assinado (t_834c16c9): sugestão que o corretor/gestor confere antes de salvar.
  const [dataPdf, setDataPdf] = useState<{ data: string | null; aviso: string | null } | null>(
    null,
  );
  const sugestaoPdf = useRef<string | null | undefined>(undefined);
  // "Corrigir dados" na captação aprovada (t_9f9f0c6a): libera só imóvel, ficha e proprietários.
  const [corrigindo, setCorrigindo] = useState(false);
  const [conflicts, setConflicts] = useState<AddressConflict[]>([]);
  // "Virou venda": permissão e venda ativa ligada à captação (o banco decide quem pode).
  const [vendaInfo, setVendaInfo] = useState<{
    pode_virar: boolean;
    venda: VendaDaCaptacao | null;
  }>({ pode_virar: false, venda: null });
  const [suggestions, setSuggestions] = useState<
    {
      scope: OwnerScope | "imovel";
      values: Record<string, string>;
    }[]
  >([]);
  const loadedId = useRef<string | null>(null);
  // Sempre o formulário mais recente (a leitura termina depois do clique).
  const formRef = useRef<CaptureForm | null>(null);
  formRef.current = form;
  const manager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
  // Captação do próprio gestor/TL (Denis 22/10/2026): o envio já gera o PDF para assinatura.
  const proprioGestor =
    !!capture && captacaoDoProprioGestor(capture, user?.id, hasAny(["gestor", "team_leader"]));
  // Cadastro manual: contrato de exclusividade já assinado no papel (sem PDF gerado pelo sistema).
  const manual = !!capture?.manual;
  // Passo 5 "Documento assinado": captação normal com contrato assinado anexado (Clicksign ou
  // upload). Captações antigas sem assinado e o cadastro manual seguem com 4 passos.
  // Mesma regra do banco: só conta o assinado anexado depois do gerado (ou aprovada antiga).
  const currentSigned = currentSignedDoc(manual, capture?.status, docs);
  const signedStep = hasSignedStep(manual, docs, capture?.status);
  const captureSteps: ReadonlyArray<{ key: CaptureStep; label: string }> = manual
    ? manualSteps
    : signedStep
      ? [...normalSteps, signedStepItem]
      : normalSteps;
  const [signedInfo, setSignedInfo] = useState<ClicksignSignedInfo | null | "unknown">(null);
  // Com a Clicksign ligada, a escolha "Como vai ser assinado?" (ClicksignEnvio) substitui o botão
  // "Registrar envio para assinatura externa"; sem Clicksign, o botão continua igual.
  const [clicksignModo, setClicksignModo] = useState({ disponivel: false, envelopeAtivo: false });
  const signedDocId = currentSigned?.id ?? null;
  useEffect(() => {
    if (!signedStep) {
      setSignedInfo(null);
      return;
    }
    let alive = true;
    void clicksignCaptureSigned(supabase as unknown as SupabaseClient, id, signedDocId).then(
      (r) => {
        if (alive) setSignedInfo(r);
      },
    );
    return () => {
      alive = false;
    };
  }, [id, signedStep, signedDocId]);
  // Assinado removido (ex.: devolvida e contrato trocado): volta para o passo 4.
  useEffect(() => {
    if (!signedStep && step === "assinado") setStep("revisao");
  }, [signedStep, step]);
  const [reading, setReading] = useState<{ ok: boolean; filled: string[] } | null>(null);
  const navigate = useNavigate();
  const archived = !!capture?.archived_at;
  const editable = !archived && (capture?.status === "rascunho" || capture?.status === "devolvida");
  // Mesma regra do banco (exclusive_corrigir_aprovada); o banco ainda confere liderança e organização.
  const podeCorrigir =
    !!capture &&
    podeCorrigirAprovada({
      status: capture.status,
      archived,
      userId: user?.id,
      captorId: capture.captor_id,
      manager,
    });
  const corrigindoAtivo = corrigindo && podeCorrigir;
  // Transferir para outro corretor (t_997545e5): só dono/gestor; o banco confere de novo.
  const [transferindo, setTransferindo] = useState(false);
  const [podeTransf, setPodeTransf] = useState(false);
  const papelTransfere = papelPodeTransferir(hasAny);
  useEffect(() => {
    if (!capture?.id || !user?.id || !papelTransfere) {
      setPodeTransf(false);
      return;
    }
    let vivo = true;
    void podeTransferir(capture.id, user.id).then((ok) => vivo && setPodeTransf(ok));
    return () => {
      vivo = false;
    };
  }, [capture?.id, capture?.captor_id, user?.id, papelTransfere]);
  const transfAvulsa = useMemo(() => {
    if (!capture) return undefined;
    const contrato = contratoNaTransferencia(capture, clicksignModo.envelopeAtivo);
    const i = capture.form_data?.imovel;
    const endereco = [i?.endereco, i?.complemento].filter((x) => x?.trim()).join(", ");
    const ultima = history.find((h) => h.action === "transferida");
    return {
      id: capture.id,
      captorId: capture.captor_id,
      // broker_name fica no nome antigo quando o contrato já foi assinado; o histórico tem o atual.
      captorNome: ultima ? lerTransferencia(ultima.detail).para_nome : capture.broker_name || "—",
      endereco,
      item: {
        id: capture.id,
        endereco: endereco || "—",
        bairro: i?.bairro ?? null,
        status: capture.status,
        manual: !!capture.manual,
        arquivada: !!capture.archived_at,
        bloqueio: contrato === "bloqueado" ? TEXTO_CONTRATO.bloqueado : null,
        contrato,
        leads_abertos: 0,
      },
    };
  }, [capture, history, clicksignModo.envelopeAtivo]);
  const avisoTransferida = capture ? avisoContratoOutroCorretor(capture, history) : null;
  // Na aprovada não há salvamento automático: avisa antes de fechar/recarregar com correção pendente.
  useEffect(() => {
    if (!corrigindoAtivo || !dirty) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [corrigindoAtivo, dirty]);
  // Campos do imóvel, da ficha e dos proprietários: editáveis no rascunho/devolvida ou na correção.
  const editaDados = editable || corrigindoAtivo;
  const reload = useCallback(async () => {
    const [result, unitList] = await Promise.all([loadCapture(id), listUnits()]);
    setUnits(unitList);
    if (loadedId.current !== id) {
      setSuggestions([]);
      setPreview(null);
      setReading(null);
      // Contrato já assinado aguardando aprovação: abre direto no passo 5.
      const aguardandoAprovacao =
        !result.capture.manual &&
        ["enviada", "em_assinatura"].includes(result.capture.status) &&
        hasSignedStep(!!result.capture.manual, result.docs, result.capture.status);
      setStep(result.capture.manual ? "contrato" : aguardandoAprovacao ? "assinado" : "documentos");
      loadedId.current = id;
    }
    setCapture(result.capture);
    // Foro ainda não gravado = cidade/estado da unidade; foro já salvo (ou editado) é mantido.
    setForm(normalizeForm(result.savedForm, captureUnit(result.capture, unitList)));
    setCpf(result.capture.broker_cpf);
    setCreci(result.capture.broker_creci);
    setDocs(result.docs);
    setHistory(result.history);
    // Manual: o gestor parte da data escrita no contrato (lida e conferida no cadastro).
    const contractDate = result.capture.manual
      ? normalizeForm(result.savedForm).data_assinatura
      : undefined;
    // PDF assinado recém-lido: a data lida (ou vazio, sem data confiável) vale até ser salva.
    const sug = sugestaoPdf.current;
    setSignedOn(
      sug !== undefined
        ? (sug ?? "")
        : (result.capture.signed_on ?? contractDate ?? hojeSaoPaulo()),
    );
    // Aviso de endereço repetido: falha aqui nunca bloqueia a tela.
    addressConflicts(id)
      .then(setConflicts)
      .catch(() => setConflicts([]));
    vendaDaCaptacao(id)
      .then(setVendaInfo)
      .catch(() => setVendaInfo({ pode_virar: false, venda: null }));
    // Falha aqui = null: a tela mostra o aviso e o envio pela Clicksign fica bloqueado.
    testemunhasCaptacao(supabase as unknown as SupabaseClient, id).then(setTestemunhas);
    setDirty(false);
  }, [id]);
  useEffect(() => {
    // ID malformado, inexistente ou de outra imobiliária caem no mesmo estado neutro abaixo, sem
    // toast com a mensagem crua do banco (que diferenciaria os casos).
    if (!isDetailRouteId(id)) {
      setCapture(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    reload()
      .catch(() => setCapture(null))
      .finally(() => setLoading(false));
  }, [id, reload]);
  // Salvamento automático (igual às Vendas) enquanto a captação é editável; nunca durante uma
  // ação em andamento (upload, leitura da IA, envio), que já grava o que estiver pendente.
  const persistCapture = useCallback(
    (f: CaptureForm, c: string, r: string) => saveCapture(id, f, c, r),
    [id],
  );
  const onAutosaved = useCallback(() => {
    setDirty(false);
    // O exclusive_save apaga o PDF gerado antigo (não pode ser submetido depois da edição).
    setDocs((list) => list.filter((d) => d.kind !== "gerado"));
  }, []);
  const autosave = useCaptureAutosave({
    enabled: editable && !busy,
    dirty,
    form,
    cpf,
    creci,
    savedCpf: capture?.broker_cpf ?? "",
    savedCreci: capture?.broker_creci ?? "",
    persist: persistCapture,
    onSaved: onAutosaved,
  });
  // Página aberta há tempo mostra estado antigo (ex.: já aprovada). Nunca recarrega por cima de
  // edição não salva ou de ação em andamento.
  useRecarregarAoFocar(() => {
    if (dirty || busy || autosave.saving || !isDetailRouteId(id)) return;
    return reload().catch(() => undefined);
  });
  useEffect(() => {
    // Catálogo do Feedback (plano de marketing). Falha/módulo desligado = sem Plano de Marketing, sem travar.
    let alive = true;
    (supabase as unknown as SupabaseClient)
      .from("owner_feedback_actions")
      .select("id,list,category,label,weight,sort")
      .eq("active", true)
      .eq("list", "marketing")
      .order("sort")
      .then(({ data, error }) => {
        if (!alive) return;
        setDossieActions(error ? [] : ((data ?? []) as FeedbackAction[]));
        setDossieLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  // Começa vazio: o corretor escolhe as ações. Obrigatório ter ao menos 1 quando há catálogo
  // (mesma regra na captação normal e no cadastro manual).
  const dossieIds = form?.dossie ?? [];
  // Semanas do Plano: Semana 1 = assinatura (manual: aprovação); até a última semana da exclusividade (sem prazo: 4).
  const planoSemanas = form?.plano_semanas;
  const aprovadaEm = useMemo(() => {
    const ev = history
      .filter((h) => h.action === "aprovar")
      .map((h) => h.created_at)
      .sort()
      .at(-1);
    const ap = ev ? hojeSaoPaulo(new Date(ev)) : (capture?.signed_on ?? null);
    // Fluxo normal: Semana 1 = data de assinatura (mesma regra de exclusive_inicio_plano).
    return !capture?.manual && capture?.signed_on ? capture.signed_on : ap;
  }, [history, capture?.signed_on, capture?.manual]);
  const semanasInfo = totalSemanasPlano({
    aprovadaEm: capture?.status === "aprovada" ? aprovadaEm : null,
    fimExclusividade: capture ? (captureValidity(capture, hojeSaoPaulo())?.end ?? null) : null,
    prazoDias: form?.condicoes?.prazo_dias_numero,
  });
  // Semana por ação é opcional (Denis, 15/10/2026): só a falta de ação marcada trava.
  const dossieMissing = dossieMissingFor(dossieActions, dossieIds);
  const planoFaltaTexto = "Plano de Marketing: marque ao menos 1 ação";
  const devolucao = ultimaDevolucao(history);
  // Cadastro manual: vitais já marcadas (defaultDossieSelection) para o corretor conferir; entra no
  // rascunho como alteração a salvar, para o gestor receber o que o corretor viu.
  const prefillDossie = manual && editable && !dossieLoading && form?.dossie === undefined;
  useEffect(() => {
    if (!prefillDossie || !dossieCatalog(dossieActions).length) return;
    const ids = initialDossieSelection(dossieActions, undefined, true);
    const sem = ajustarSemanas(dossieActions, ids, undefined, semanasInfo.total);
    setForm((current) =>
      current && current.dossie === undefined
        ? { ...current, dossie: ids, plano_semanas: sem }
        : current,
    );
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só no pré-preenchimento inicial
  }, [prefillDossie, dossieActions]);
  // Plano novo ou editado passa a gravar as semanas (planos antigos só mudam se forem editados).
  const setDossie = (ids: string[], semanas: PlanoSemanas) => {
    setForm((current) => (current ? { ...current, dossie: ids, plano_semanas: semanas } : current));
    setDirty(true);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await reload();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Ação não concluída"));
    } finally {
      setBusy(false);
    }
  };
  // Proprietário N (1, 2, 3…): grava na lista e devolve ao formato salvo.
  const editOwner = (n: number, key: OwnerField, value: string) => {
    setForm((f) => {
      if (!f) return f;
      const list = captureOwners(f);
      if (!list[n - 1]) return f;
      list[n - 1] = { ...list[n - 1], [key]: value };
      return withOwners(f, list);
    });
    setDirty(true);
  };
  const addOwnerToForm = () => {
    setForm((f) => (f ? addOwner(f) : f));
    setDirty(true);
  };
  const removeOwnerFromForm = (n: number) => {
    setForm((f) => (f ? removeOwner(f, n) : f));
    // Sugestões pendentes do removido e dos seguintes perdem a referência.
    setSuggestions((current) =>
      current.filter((item) => {
        const k = ownerNumber(item.scope);
        return k === null || k < n;
      }),
    );
    setDirty(true);
  };
  const edit = <K extends "imovel" | "condicoes" | "testemunha_1" | "testemunha_2">(
    scope: K,
    key: keyof NonNullable<CaptureForm[K]>,
    value: string,
  ) => {
    setForm((f) => (f ? { ...f, [scope]: { ...f[scope], [key]: value } } : f));
    setDirty(true);
  };
  const editFicha = (key: keyof FichaCaptacao, value: string) => {
    setForm((f) =>
      f ? { ...f, ficha: { ...(f.ficha ?? fichaCaptacaoVazia()), [key]: value } } : f,
    );
    setDirty(true);
  };
  const updateBroker = (key: "cpf" | "creci", value: string) => {
    if (key === "cpf") setCpf(value);
    else setCreci(value);
    setDirty(true);
  };
  const save = () =>
    run(async () => {
      if (!form) return;
      await saveCapture(id, form, cpf, creci);
      toast.success("Rascunho salvo.");
    });
  const generate = () => run(() => gerarPdfAssinatura(editable));
  // `salvar`: grava o formulário antes (só enquanto editável). Depois do envio não salva: o
  // exclusive_save só aceita rascunho/devolvida e apagaria o PDF gerado.
  const gerarPdfAssinatura = async (salvar: boolean) => {
    if (!capture || !form) return;
    if (dossieMissing) {
      setStep("dossie");
      throw new Error("Marque ao menos 1 ação no Plano de Marketing antes de gerar o contrato.");
    }
    const catalogReady = dossieCatalog(dossieActions).length > 0;
    const saved: CaptureForm = catalogReady ? { ...form, dossie: dossieIds } : form;
    // Contrato é gerado pelo gestor depois do envio; só salva se ainda for editável.
    if (salvar) await saveCapture(id, saved, cpf, creci);
    // Data impressa no contrato = dia em que ele é gerado (calendário de SP).
    // Testemunhas automáticas (t_e8078685), lidas agora: com Clicksign e cadastro completo, o PDF sai
    // com nome e CPF do corretor e do gestor (RG em branco). Senão, as digitadas, como antes.
    const tw = await testemunhasCaptacao(supabase as unknown as SupabaseClient, id);
    setTestemunhas(tw);
    const autoTw = usarTestemunhasAuto(tw);
    // PDF decidido pela unidade agora (contrato-base com os dados dela ou PDF antigo).
    const source = contractSource(capture, units);
    let bytes = await fillExclusiveTemplate(
      await downloadCaptureTemplate(source.file),
      {
        ...capture,
        form_data: testemunhasParaPdf(saved, tw),
        broker_cpf: cpf,
        broker_creci: creci,
      },
      true,
      hojeSaoPaulo(),
      source.unit,
    );
    // Plano de Marketing vai anexado ao final do contrato (mesma assinatura).
    if (catalogReady && selectedDossie(dossieActions, dossieIds).length) {
      const [ano, mes, dia] = hojeSaoPaulo().split("-");
      const dossie = await buildDossiePdf({
        actions: dossieActions,
        selected: dossieIds,
        semanas: saved.plano_semanas,
        totalSemanas: semanasInfo.total,
        // Até 2: "A e B" (igual a antes). 3+: "A, B e mais N" (a lista completa está no contrato).
        ownerNames: [ownerNamesSummary(saved)],
        brokerName: capture.broker_name,
        brokerCreci: creci,
        property: {
          tipo: saved.imovel.tipo_imovel,
          endereco: [saved.imovel.endereco, saved.imovel.complemento].filter(Boolean).join(" - "),
          bairro: saved.imovel.bairro,
          municipio: saved.imovel.municipio,
          valor: saved.imovel.valor_imovel,
        },
        company: source.unit?.nome_comercial || undefined,
        issuedOn: `${dia}/${mes}/${ano}`,
      });
      bytes = await appendDossieToContract(bytes, dossie);
    }
    // Imagens do modelo em JPEG ~150 dpi: o gerado fica bem abaixo dos 10 MB da Clicksign.
    bytes = (await compressPdfBytes(bytes, browserImageCodec, GERACAO_CONTRATO)).bytes;
    const file = new File([bytes as BlobPart], signaturePdfName(id), {
      type: "application/pdf",
    });
    // PDF para assinatura: SÓ contrato + Plano de Marketing (sem RG, matrícula etc.). É o mesmo
    // arquivo salvo na captação e o que o gestor envia ao Clicksign.
    const geradoPath = await uploadCaptureDocument(id, "gerado", 0, file);
    // Registra quem saiu impresso: o envio pela Clicksign só aceita o PDF com as testemunhas atuais.
    let avisoTw: string | null = null;
    if (autoTw && tw) {
      try {
        await fixarTestemunhasPdf(supabase as unknown as SupabaseClient, id, tw, geradoPath);
      } catch (e) {
        avisoTw = errorMessage(e, "Não foi possível registrar as testemunhas do PDF");
      }
    } else if (tw?.aplica) {
      avisoTw =
        "O PDF saiu com as testemunhas digitadas na captação. Para enviar pela Clicksign, complete as testemunhas automáticas e gere o PDF de novo.";
    }
    setTestemunhas(await testemunhasCaptacao(supabase as unknown as SupabaseClient, id));
    await baixarDocumentosComoPdf([], signaturePdfName(id), bytes);
    toast.success("PDF para assinatura gerado e salvo: contrato + Plano de Marketing.");
    if (avisoTw) toast.warning(avisoTw, { duration: 12000 });
  };
  // PDF completo (depois da aprovação): contrato ASSINADO + todos os documentos anexados.
  // O Plano de Marketing já está dentro do contrato assinado, então não é repetido.
  const downloadComplete = () =>
    run(async () => {
      // Teto de 9 MB: se passar, nova passada reduzindo a qualidade das imagens até caber.
      const juntado = await juntarDocumentosEmPdf(await signedDocuments(completePdfDocs(docs)));
      const fit = await caberNoLimite(juntado, browserImageCodec);
      await baixarDocumentosComoPdf([], completePdfName(id), fit.bytes);
      if (fit.cabe)
        toast.success(
          `PDF completo baixado (${formatMB(fit.bytes.length)}): contrato assinado + documentos.`,
        );
      else
        toast.warning(
          `PDF completo baixado com ${formatMB(fit.bytes.length)}: mesmo comprimido, ficou acima de 9 MB. Se precisar de arquivo menor, baixe os documentos separados.`,
        );
    });
  const upload = (kind: DocumentKind, owner: number, file: File) =>
    run(async () => {
      await autosave.flush();
      // Substituir: guarda o arquivo antigo para apagar do Storage depois que o novo for registrado
      // (só documentos da ficha; contrato gerado/assinado fica como está).
      const antigo =
        kind !== "assinado" && kind !== "gerado"
          ? docs.find((d) => d.kind === kind && d.owner_index === owner)?.storage_path
          : undefined;
      const storagePath = await uploadCaptureDocument(id, kind, owner, file);
      toast.success("Documento anexado");
      if (antigo && antigo !== storagePath)
        void limparArquivoSubstituido({ data: { captureId: id, path: antigo } }).catch(
          () => undefined,
        );
      // Upload manual do assinado (captação normal) leva ao passo 5, igual ao que chega da Clicksign.
      if (kind === "assinado" && !manual) {
        setStep("assinado");
        // Lê a data da última assinatura no log da Clicksign (leitura local, sem serviço externo).
        try {
          const l = await lerDataAssinaturaPdf(
            new Uint8Array(await file.arrayBuffer()),
            hojeSaoPaulo(),
          );
          sugestaoPdf.current = l.ok ? l.data : null;
          setDataPdf({ data: l.ok ? l.data : null, aviso: motivoSemData(l) });
          if (l.ok)
            toast.info(`Data de assinatura lida do PDF: ${formatDateBR(l.data)}. Confira e salve.`);
        } catch {
          sugestaoPdf.current = null;
          setDataPdf({ data: null, aviso: "Não foi possível ler a data do PDF. Informe a data." });
        }
      }
      if (kind === "assinado" || kind === "gerado") return;
      const scope: OwnerScope | "imovel" = owner > 0 ? ownerScope(owner) : "imovel";
      try {
        toast.info("Lendo o documento…");
        // Leitura por IA (mesma das Vendas); se falhar, cai para a leitura local antiga.
        let values: Record<string, string> = {};
        // IA sem crédito/cota: o plano B (leitura local) continua; o aviso só aparece se nada for lido.
        let iaIndisponivel = false;
        if (isAiReadableKind(kind)) {
          const res = await extractCaptureDocument({
            data: { captureId: id, storagePath, kind, scope: owner ? "owner" : "property" },
          }).catch(() => null);
          if (res?.ok) values = res.values;
          else if (res?.aiUnavailable) iaIndisponivel = true;
          else if (res?.timedOut) {
            // A IA passou do tempo-limite: o documento já está anexado; libera a tela.
            toast.info(AI_TIMEOUT_MESSAGE);
            return;
          }
        }
        if (!Object.keys(values).length)
          values = (await suggestFromLocalFile(file, owner ? "owner" : "property")) as Record<
            string,
            string
          >;
        // Igual às Vendas: preenche sozinho só os campos vazios (nunca sobrescreve) e salva.
        const current = formRef.current;
        // Valor do imóvel é sempre digitado pelo corretor; a leitura nunca preenche.
        delete (values as Record<string, unknown>).valor_imovel;
        values = fieldsFromDocument(kind, owner, values);
        if (!Object.keys(values).length || !current) {
          toast.info(
            iaIndisponivel
              ? AI_UNAVAILABLE_MESSAGE
              : "Sem campos legíveis identificados; preencha manualmente.",
          );
          return;
        }
        const pick = (f: CaptureForm) =>
          ((scope === "imovel" ? f.imovel : captureOwners(f)[owner - 1]) ?? {}) as Record<
            string,
            string
          >;
        const before = pick(current);
        const next = applySuggestedFields(current, scope, values);
        const after = pick(next);
        const filled = Object.keys(after).filter((k) => !before[k]?.trim() && after[k]?.trim());
        if (!filled.length) {
          toast.info("Documento lido. Os campos encontrados já estavam preenchidos.");
          return;
        }
        setForm(next);
        await saveCapture(id, next, cpf, creci);
        setDirty(false);
        toast.success(
          `Documento lido • ${filled.length} ${filled.length === 1 ? "campo preenchido" : "campos preenchidos"}. Confira em "Dados do contrato".`,
        );
      } catch {
        toast.info("Leitura indisponível; o documento foi anexado. Preencha manualmente.");
      }
    });
  // Cadastro manual: anexa o contrato já assinado (PDF ou foto) e lê tudo de uma vez com a mesma IA
  // das Vendas. Preenche só os campos vazios; se a leitura falhar, o preenchimento manual continua.
  const uploadSignedContract = (file: File) =>
    run(async () => {
      await autosave.flush();
      const storagePath = await uploadCaptureDocument(id, "assinado", 0, file, { manual: true });
      toast.success("Contrato assinado anexado");
      toast.info("Lendo o contrato…");
      const res = await extractSignedContract({ data: { captureId: id, storagePath } }).catch(
        () => null,
      );
      const current = formRef.current;
      if (!res?.ok || !current) {
        setReading({ ok: false, filled: [] });
        toast.info(
          res && !res.ok && res.timedOut
            ? AI_TIMEOUT_MESSAGE
            : res && !res.ok && res.aiUnavailable
              ? AI_UNAVAILABLE_MESSAGE
              : "Não foi possível ler o contrato. Preencha os dados na conferência.",
        );
        return;
      }
      const { form: next, filled } = applySignedContract(current, res.values);
      setReading({ ok: true, filled });
      if (filled.length) {
        setForm(next);
        await saveCapture(id, next, cpf, creci);
        setDirty(false);
      }
      toast.success(
        filled.length
          ? `Contrato lido • ${filled.length} ${filled.length === 1 ? "campo preenchido" : "campos preenchidos"}. Confira os dados.`
          : "Contrato lido. Os campos encontrados já estavam preenchidos.",
      );
    });
  const action = (name: "enviar" | "assinatura" | "aprovar" | "devolver") =>
    run(async () => {
      const ask = manual
        ? "Você conferiu os dados lidos do contrato assinado?"
        : proprioGestor
          ? "Você conferiu os dados e todos os documentos? O PDF para assinatura será gerado em seguida."
          : "Você conferiu o PDF gerado e todos os documentos?";
      // Plano de Marketing obrigatório (mesma regra e navegação da captação normal).
      if (manual && dossieMissing && (name === "enviar" || name === "aprovar")) {
        setStep("dossie");
        throw new Error("Marque ao menos 1 ação no Plano de Marketing antes de continuar.");
      }
      if (name === "enviar" && !window.confirm(ask)) return;
      // Alteração não salva (ex.: Plano de Marketing marcado) não pode travar o envio: salva antes.
      // Espera o salvamento automático em andamento e grava o que ainda estiver pendente.
      if (name === "enviar") await autosave.flush();
      const statusAntes = capture?.status;
      if (
        name === "devolver" &&
        statusAntes === "aprovada" &&
        !window.confirm(
          "Devolver esta captação aprovada ao corretor? Ela sai do mapa e do alerta de vencimento até ser aprovada de novo. O contrato assinado fica guardado no histórico.",
        )
      )
        return;
      // Vigência e Plano contam da assinatura: a data conferida é gravada antes; o 'aprovar' a mantém.
      if (name === "aprovar" && signedOn && signedOn !== capture?.signed_on) {
        await confirmarDataAssinatura(id, signedOn, dataPdf?.data ?? null);
        sugestaoPdf.current = undefined;
      }
      await transitionCapture(id, name, name === "devolver" ? reason : undefined);
      // Aviso (sino + WhatsApp) depois de gravar; falha do aviso nunca desfaz a ação.
      void avisarTransicao(name, id, notifyCaptureTransition);
      setReason("");
      toast.success("Histórico atualizado");
      // Captação do próprio gestor/TL: não espera ele mesmo revisar — já gera o PDF para
      // assinatura (o banco só aceita o PDF com a captação em 'enviada', por isso vem depois).
      // Se a geração falhar, a captação fica enviada e o cartão "Gerar PDF" continua disponível.
      if (name === "enviar" && proprioGestor) {
        try {
          await gerarPdfAssinatura(false);
          setStep("revisao");
        } catch (e: unknown) {
          toast.error(
            `Captação enviada, mas o PDF para assinatura não foi gerado: ${errorMessage(e, "erro desconhecido")}. Use "Gerar PDF para assinatura".`,
          );
        }
      }
      if (name === "devolver" && statusAntes === "em_assinatura")
        toast.warning(AVISO_CLICKSIGN, { duration: 10000 });
    });
  const lifecycle = async (name: "excluir" | "arquivar" | "desarquivar") => {
    const ask = {
      excluir: "Excluir este rascunho? Ele deixará de aparecer na lista.",
      arquivar:
        "Arquivar esta captação? Ela sai da lista principal e pode ser desarquivada depois.",
      desarquivar: "Desarquivar esta captação? Ela volta para a lista principal.",
    }[name];
    if (!window.confirm(ask)) return;
    const done = {
      excluir: "Rascunho excluído",
      arquivar: "Captação arquivada",
      desarquivar: "Captação desarquivada",
    }[name];
    if (name !== "excluir")
      return run(async () => {
        await archiveCapture(id, name);
        toast.success(done);
      });
    setBusy(true);
    try {
      await archiveCapture(id, name);
      toast.success(done);
      navigate({ to: "/exclusividades" });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Ação não concluída"));
      setBusy(false);
    }
  };
  const withDoc = async (doc: CaptureDocument, fn: (url: string) => void | Promise<void>) => {
    try {
      await fn(await signedDocument(doc));
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Não foi possível acessar o documento"));
    }
  };
  const allDocs = async (print: boolean) => {
    const printWindow = print ? openDocumentPrintWindow() : null;
    if (print && !printWindow) return;
    try {
      // Ordem: contrato (gerado/assinado), depois os documentos anexados.
      const rank = (d: CaptureDocument) =>
        d.kind === "assinado" ? 0 : d.kind === "gerado" ? 1 : 2;
      const list = await signedDocuments([...docs].sort((a, b) => rank(a) - rank(b)));
      if (print && printWindow) printDocumentUrls(list, printWindow);
      else await baixarDocumentosComoPdf(list, `captacao-${id.slice(0, 8)}-documentos.pdf`);
    } catch (e: unknown) {
      printWindow?.close();
      toast.error(errorMessage(e, "Falha ao reunir documentos"));
    }
  };
  if (loading) return <ListSkeleton rows={5} label="Carregando captação" />;
  if (!capture || !form)
    return (
      <DetailNotFound
        message={DETAIL_NOT_FOUND_MESSAGE.captacao}
        backTo="/exclusividades"
        backLabel="Voltar para exclusividades"
      />
    );
  // Manual: contrato assinado e Plano de Marketing são obrigatórios; o resto é pendência (o gestor vê).
  const manualCheck = manual ? manualPendencies(form, docs) : null;
  // Lista de proprietários e documentos por proprietário calculados uma vez por render (30+).
  const owners = captureOwners(form);
  const docKinds = ownerDocKinds(docs);
  // Mesma regra do banco (exclusive_transition 'aprovar'): contrato gerado, assinado e Plano.
  const bloqueioAprovar = aprovarBloqueio({ manual, docs, dossieMissing });
  // Plano de Marketing é obrigatório também no manual (mesma regra da captação normal).
  if (manualCheck && dossieMissing) manualCheck.required.push(planoFaltaTexto);
  const missing = manualCheck
    ? [...manualCheck.required]
    : missingRequirements(form, dirty ? docs.filter((d) => d.kind !== "gerado") : docs, cpf, creci);
  if (dossieMissing && !manual) missing.push(planoFaltaTexto);
  if (cpf.trim() && !validCpf(cpf.trim()))
    missing.push("CPF do captador inválido (dígitos verificadores)");
  if (creci.trim() && !validCreci(creci))
    missing.push(
      "CRECI inválido (4 a 50 caracteres, letras, números, espaço, ponto, barra ou hífen)",
    );
  const pendingSuggestions = suggestions.map((suggestion) => ({
    ...suggestion,
    fields: Object.entries(suggestion.values).filter(([key]) => {
      const n = ownerNumber(suggestion.scope);
      const target = (n ? owners[n - 1] : form.imovel) as Record<string, string> | undefined;
      return !target?.[key]?.trim();
    }),
  }));
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    required = false,
    /** Campo liberado também no "Corrigir dados" da aprovada (imóvel e proprietários). */
    corrigivel = false,
  ) => (
    <div key={label} className="space-y-1">
      <Label>
        {label}
        {required && !manual ? " *" : ""}
      </Label>
      <Input
        aria-label={label}
        value={value ?? ""}
        maxLength={300}
        disabled={!(corrigivel ? editaDados : editable) || busy}
        onChange={(e) => change(e.target.value)}
      />
    </div>
  );
  const hasDoc = (kind: DocumentKind, owner: number) =>
    owner > 0
      ? !!docKinds.get(owner)?.has(kind)
      : docs.some((doc) => doc.kind === kind && doc.owner_index === owner);
  const printOne = (doc: CaptureDocument) => {
    const printWindow = openDocumentPrintWindow();
    if (!printWindow) return;
    void signedDocument(doc)
      .then((url) => printDocumentUrls([{ file_name: doc.file_name, url }], printWindow))
      .catch((e: unknown) => {
        printWindow.close();
        toast.error(errorMessage(e, "Não foi possível imprimir o documento"));
      });
  };
  // Remover documento enviado por engano (t_5ab6dad4): o banco confere a permissão de novo.
  const removeDoc = (doc: CaptureDocument, label: string) => {
    if (
      !window.confirm(
        `Remover "${doc.file_name}" de ${label}? O arquivo será apagado e não poderá ser recuperado.`,
      )
    )
      return;
    void run(async () => {
      await removerDocumentoCaptacao({
        data: { captureId: id, kind: doc.kind, owner: doc.owner_index },
      });
      toast.success("Documento removido");
    });
  };
  const docRow = (doc: CaptureDocument, remove?: () => void) => (
    <div
      key={doc.id}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-2 text-sm"
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline"
        onClick={() => withDoc(doc, (url) => setPreview({ doc, url }))}
      >
        {doc.file_name}
      </button>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          title="Visualizar"
          aria-label={`Visualizar ${doc.file_name}`}
          onClick={() => withDoc(doc, (url) => setPreview({ doc, url }))}
        >
          <Eye className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Imprimir"
          aria-label={`Imprimir ${doc.file_name}`}
          onClick={() => printOne(doc)}
        >
          <Printer className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Baixar"
          aria-label={`Baixar ${doc.file_name}`}
          onClick={() =>
            downloadDocument(doc).catch((e) => toast.error(errorMessage(e, "Falha ao baixar")))
          }
        >
          <Download className="h-4 w-4" />
        </Button>
        {remove && (
          <Button
            size="sm"
            variant="ghost"
            title="Remover"
            aria-label={`Remover ${doc.file_name}`}
            className="text-destructive hover:text-destructive"
            onClick={remove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
  // Mesmo visual dos documentos da venda: um cartão por documento, faixa colorida por parte
  // (proprietário = âmbar, imóvel = verde), indicador de obrigatório/dispensado e os arquivos
  // enviados dentro do próprio cartão com Ver/Imprimir/Baixar.
  const fileInput = (
    label: string,
    kind: DocumentKind,
    owner = 0,
    opts: { accent?: string; required?: boolean; dispensa?: string } = {},
  ) => {
    const list = docs.filter((doc) => doc.kind === kind && doc.owner_index === owner);
    const attached = list.at(-1);
    const canUpload =
      !busy &&
      (kind === "assinado"
        ? manual
          ? editable || (manager && capture.status === "enviada")
          : manager && ["enviada", "em_assinatura"].includes(capture.status)
        : editable);
    // Remover: mesma regra do banco (exclusive_remove_document) — quem pode enviar, em rascunho ou
    // devolvida; nunca o contrato gerado nem o assinado da captação normal.
    const canRemove =
      canUpload && editable && kind !== "gerado" && !(kind === "assinado" && !manual);
    const acceptPdfOnly = kind === "gerado" || (kind === "assinado" && !manual);
    return (
      <Card key={`${kind}-${owner}`} className={opts.accent ?? ""}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {label}
                {opts.required ? <span className="ml-1 text-destructive">*</span> : null}
              </div>
              {opts.required && <div className="text-xs text-muted-foreground">Obrigatório</div>}
              {opts.dispensa && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400">
                  {opts.dispensa}
                </div>
              )}
              {!attached && !opts.required && !opts.dispensa && (
                <div className="text-xs text-muted-foreground">Ainda não enviado</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {attached && <FileCheck2 aria-label="Enviado" className="h-4 w-4 text-emerald-600" />}
              {canUpload && (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                  <Upload className="h-4 w-4" /> {attached ? "Substituir" : "Enviar"}
                  <input
                    type="file"
                    accept={acceptPdfOnly ? ".pdf" : ".pdf,.jpg,.jpeg,.png,.webp"}
                    aria-label={`Enviar ${label}`}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (manual && kind === "assinado") uploadSignedContract(file);
                      else upload(kind, owner, file);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {list.map((doc) => docRow(doc, canRemove ? () => removeDoc(doc, label) : undefined))}
        </CardContent>
      </Card>
    );
  };
  const ownerDocInput = (label: string, kind: "rg" | "cpf" | "cnh", owner: number) => {
    const temCnh = hasDoc("cnh", owner);
    const temRgCpf = hasDoc("rg", owner) && hasDoc("cpf", owner);
    const dispensa =
      kind !== "cnh" && temCnh
        ? "Dispensado — CNH enviada"
        : kind === "cnh" && temRgCpf
          ? "Dispensado — RG e CPF enviados"
          : undefined;
    return fileInput(label, kind, owner, {
      accent: "border-l-4 border-l-amber-500",
      // Manual: documentos do proprietário são opcionais (aparecem como pendência).
      required: !manual && !dispensa && !hasDoc(kind, owner),
      dispensa,
    });
  };
  // Comprovante de residência do proprietário: opcional, nunca trava o envio; a leitura preenche
  // só o endereço desse proprietário, se estiver vazio (t_8e496afb).
  const ownerResidenciaInput = (owner: number) =>
    fileInput("Comprovante de residência (opcional)", "residencia", owner, {
      accent: "border-l-4 border-l-amber-500",
    });
  // Só o bloco aberto chama estes dois (OwnerBlocks): com 30+ proprietários a tela não monta
  // centenas de campos e envios de documento de uma vez.
  const ownerFields = (n: number) => {
    const owner = owners[n - 1];
    if (!owner) return null;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {OWNER_FIELDS.map(({ key, label, required }) =>
          field(label, owner[key], (value) => editOwner(n, key, value), required, true),
        )}
      </div>
    );
  };
  const ownerDocs = (n: number) => (
    <div className="space-y-3">
      {ownerDocInput("RG", "rg", n)}
      {ownerDocInput("CPF", "cpf", n)}
      {ownerDocInput("CNH (substitui RG + CPF)", "cnh", n)}
      {ownerResidenciaInput(n)}
    </div>
  );
  const ownerBlocksCommon = {
    owners,
    docKinds,
    editable,
    busy,
    onAdd: addOwnerToForm,
    onRemove: removeOwnerFromForm,
    removeBlocked: (n: number) => {
      const r = canRemoveOwner(form, docs, n);
      return r.ok ? null : (r.reason ?? "Não é possível remover");
    },
  };
  // Mesma regra do banco (exclusive_archive): contrato gerado ou fora do rascunho → arquivar.
  const validity = captureValidity(capture, hojeSaoPaulo());
  // "Corrigir dados": manda ao banco só o que mudou em imóvel, ficha e proprietários.
  // Conferência e confirmação FORA do run(): cancelar não recarrega nem apaga o que foi digitado.
  const salvarCorrecao = () => {
    if (!form) return;
    const { payload, mudancas, erro } = montarCorrecao(capture.form_data, form);
    if (erro) {
      toast.error(erro);
      return;
    }
    if (!mudancas.length) {
      toast.info("Nenhuma alteração para salvar.");
      return;
    }
    const lista = mudancas.slice(0, 12).map((m) => `• ${textoMudanca(m)}`);
    if (mudancas.length > 12) lista.push(`• e mais ${mudancas.length - 12}`);
    if (!window.confirm(`Salvar a correção? A captação continua aprovada.\n\n${lista.join("\n")}`))
      return;
    return run(async () => {
      const r = await corrigirCaptacaoAprovada(id, payload, capture.updated_at ?? null);
      setCorrigindo(false);
      toast.success(
        `Correção salva (${r.alterados} ${r.alterados === 1 ? "campo" : "campos"}). A captação continua aprovada.`,
      );
      if (r.venda_ativa) toast.warning(AVISO_VENDA_CORRECAO, { duration: 12000 });
    });
  };
  const cancelarCorrecao = () => {
    if (dirty && !window.confirm("Descartar as alterações da correção?")) return;
    setCorrigindo(false);
    void run(async () => undefined); // recarrega os dados gravados
  };
  const saveSignedOn = () =>
    run(async () => {
      // Antes da aprovação: confirmação (corretor ou gestor). Aprovada: "Corrigir data" do gestor.
      if (capture?.status === "aprovada") await setCaptureSignedOn(id, signedOn);
      else await confirmarDataAssinatura(id, signedOn, dataPdf?.data ?? null);
      sugestaoPdf.current = undefined;
      toast.success("Data de assinatura atualizada");
    });
  // Contrato que chegou pela Clicksign (sem upload na tela): lê a data do PDF já anexado.
  const lerDataDoAssinado = () =>
    run(async () => {
      if (!currentSigned) return;
      const url = await signedDocument(currentSigned);
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      const l = await lerDataAssinaturaPdf(bytes, hojeSaoPaulo());
      sugestaoPdf.current = l.ok ? l.data : null;
      setDataPdf({ data: l.ok ? l.data : null, aviso: motivoSemData(l) });
    });
  // "Virou venda": o banco cria (ou devolve, se já existir) a venda em rascunho; dois cliques ou
  // duas abas caem na mesma venda.
  const virouVenda = async () => {
    if (
      !window.confirm(
        "Abrir uma nova venda com os dados desta captação? O captador entra automaticamente na venda.",
      )
    )
      return;
    setBusy(true);
    try {
      const { criada, venda } = await virarVenda(id);
      toast[criada ? "success" : "info"](
        criada
          ? `Venda #${venda.codigo} criada como rascunho. Complete comprador, valor, data, Mídia e parceria.`
          : `Esta captação já tem a venda #${venda.codigo}. Abrindo a venda existente.`,
      );
      navigate({ to: "/vendas/$id", params: { id: venda.id } });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Não foi possível abrir a venda"));
      setBusy(false);
    }
  };
  // Rascunho manual pode ser excluído mesmo com o contrato de papel anexado (mesma regra do banco).
  const hasContract =
    capture.status !== "rascunho" ||
    (!manual && docs.some((d) => d.kind === "gerado" || d.kind === "assinado"));
  // Assinado válido (anexado depois do gerado); o assinado antigo de uma devolvida fica só no histórico.
  const signedDoc = currentSigned ?? undefined;
  // Captador informa a data da assinatura antes da aprovação (mesma regra de exclusive_set_signed_on);
  // o gestor já tem o campo no cartão de aprovação.
  const podeInformarData = podeCaptadorInformarData(capture, user?.id, manager);
  const dicaDataPdf =
    !manual && currentSigned ? (
      <p className="text-xs" data-testid="data-lida-pdf">
        {dataPdf ? (
          dataPdf.data ? (
            <span className="text-emerald-700">
              Data lida do PDF assinado (última assinatura): {formatDateBR(dataPdf.data)}. Confira e
              salve.
            </span>
          ) : (
            <span className="text-amber-800">{dataPdf.aviso}</span>
          )
        ) : (
          <button
            type="button"
            className="font-medium text-primary underline"
            disabled={busy}
            onClick={lerDataDoAssinado}
          >
            Ler a data de assinatura do PDF
          </button>
        )}
      </p>
    ) : null;
  // Passo 4 = revisão, geração e envio. Com o assinado anexado, a aprovação (PDF assinado, data e
  // botão Aprovar) passa para o passo 5 "Documento assinado".
  const approvalStep: CaptureStep = signedStep ? "assinado" : "revisao";
  const lastStep = captureSteps[captureSteps.length - 1].key;
  return (
    <div className="space-y-5 pb-10">
      <Link to="/exclusividades" className="text-sm text-primary underline">
        ← Captações
      </Link>
      <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-4 shadow-sm sm:p-6">
        <h1 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
          Captação exclusiva · {captureUnitLabel(capture, units)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {manual && (
            <span
              className="mr-2 rounded-full px-2 py-0.5 text-xs font-medium text-white"
              style={{ background: MANUAL_COLOR }}
            >
              Cadastro manual
            </span>
          )}
          {manual && capture.status === "enviada"
            ? "Aguardando aprovação do gestor"
            : capture.status === "em_assinatura" &&
                clicksignModo.disponivel &&
                !clicksignModo.envelopeAtivo
              ? STATUS_AGUARDANDO_MANUAL
              : capture.status === "enviada" && proprioGestor
                ? "Pronta para assinatura"
                : statusLabels[capture.status]}{" "}
          · Criada em {capture.created_on_sp} (São Paulo). Captador: {capture.broker_name}
        </p>
        {conflicts.length > 0 && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          >
            <strong>Atenção: já existe captação ativa neste endereço.</strong>
            <ul className="mt-1 list-disc pl-5">
              {conflicts.map((c, i) => (
                <li key={i}>
                  {c.broker_name || "—"} · {statusLabels[c.status as Capture["status"]] ?? c.status}{" "}
                  · criada em {formatDateBR(c.created_on_sp)}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Confira com o gestor antes de seguir com esta captação.</p>
          </div>
        )}
        {capture.status === "aprovada" && (
          <p
            role="status"
            data-testid="captacao-aprovada-por"
            className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"
          >
            {textoAprovacao(history)}
          </p>
        )}
        {capture.status === "aprovada" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {validity ? (
              <>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${VALIDITY_STYLE[validity.level]}`}
                >
                  {validityText(validity)}
                </span>
                <span className="text-muted-foreground">
                  Exclusividade de {validity.days} dias: assinada em {formatDateBR(validity.start)},
                  válida até {formatDateBR(validity.end)}.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Data de assinatura não registrada.</span>
            )}
            {manager && !archived && (
              <span className="flex items-center gap-1">
                <Input
                  type="date"
                  aria-label="Data de assinatura"
                  className="h-8 w-40"
                  max={hojeSaoPaulo()}
                  value={signedOn}
                  onChange={(e) => setSignedOn(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || corrigindoAtivo || !signedOn || signedOn === capture.signed_on}
                  onClick={saveSignedOn}
                >
                  Corrigir data
                </Button>
              </span>
            )}
          </div>
        )}
        {vendaInfo.venda && <VendaDaCaptacaoAviso venda={vendaInfo.venda} />}
        {capture.status === "devolvida" && devolucao && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          >
            <strong>Devolvida para ajuste</strong> por {devolucao.quem} em {devolucao.quando}.
            <br />
            Motivo: {devolucao.motivo}
          </div>
        )}
        {archived && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Captação arquivada: fora da lista principal e sem edição. Desarquive para voltar a usar.
          </p>
        )}
        {avisoTransferida && (
          <p
            role="status"
            data-testid="aviso-transferida"
            className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            {avisoTransferida}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {podeTransf && !corrigindoAtivo && (
            <Button
              size="sm"
              variant="outline"
              data-testid="transferir-captacao"
              disabled={busy}
              onClick={() => setTransferindo(true)}
            >
              <ArrowRightLeft className="mr-1 h-4 w-4" /> Transferir
            </Button>
          )}
          {podeCorrigir && !corrigindoAtivo && (
            <Button
              size="sm"
              variant="outline"
              data-testid="corrigir-dados"
              disabled={busy}
              onClick={() => {
                setCorrigindo(true);
                setStep("dados");
              }}
            >
              <Pencil className="mr-1 h-4 w-4" /> Corrigir dados
            </Button>
          )}
          {vendaInfo.pode_virar &&
            !vendaInfo.venda &&
            !archived &&
            capture.status === "aprovada" && (
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={busy || corrigindoAtivo}
                onClick={virouVenda}
              >
                <Handshake className="mr-1 h-4 w-4" /> Virou venda
              </Button>
            )}
          {canBuildCompletePdf(capture, docs, !!currentSigned) && (
            <Button size="sm" disabled={busy} onClick={downloadComplete}>
              <Download className="mr-1 h-4 w-4" /> Baixar PDF completo (contrato assinado +
              documentos)
            </Button>
          )}
          {!hasContract ? (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={() => lifecycle("excluir")}
            >
              <Trash2 className="mr-1 h-4 w-4" /> Excluir rascunho
            </Button>
          ) : archived ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => lifecycle("desarquivar")}
            >
              <ArchiveRestore className="mr-1 h-4 w-4" /> Desarquivar
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || corrigindoAtivo}
              onClick={() => lifecycle("arquivar")}
            >
              <Archive className="mr-1 h-4 w-4" /> Arquivar
            </Button>
          )}
        </div>
      </div>
      {capture.status === "aprovada" && (
        <>
          <AnuncioPortais captureId={capture.id} />
          <PlanoChecklist captureId={capture.id} editable={!archived} />
        </>
      )}
      <nav
        aria-label="Etapas da captação"
        className={`grid grid-cols-2 gap-2 ${captureSteps.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}
      >
        {captureSteps.map((item, index) => (
          <Button
            key={item.key}
            variant={step === item.key ? "default" : "outline"}
            className="h-auto min-h-11 justify-start whitespace-normal text-left"
            aria-current={step === item.key ? "step" : undefined}
            onClick={() => setStep(item.key)}
          >
            <span className="mr-2 rounded-full border px-2 py-0.5 text-xs">{index + 1}</span>
            {item.label}
          </Button>
        ))}
      </nav>
      {step === "contrato" && manual && (
        <>
          <Card className="border-violet-300 bg-violet-50/60">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium">Envie o contrato de exclusividade já assinado</p>
              <p>
                PDF ou foto legível (JPG, PNG ou WEBP, até 16 MB). É o único item obrigatório. O
                sistema lê o contrato e preenche proprietário, imóvel, prazo, comissão e data de
                assinatura; você só confere e completa.
              </p>
            </CardContent>
          </Card>
          {fileInput("Contrato assinado (PDF ou foto)", "assinado", 0, {
            accent: "border-l-4 border-l-violet-600",
            required: !signedDoc,
          })}
          {reading && (
            <Card className={reading.ok ? "border-emerald-300" : "border-amber-300"}>
              <CardContent className="space-y-2 p-4 text-sm">
                {!reading.ok ? (
                  <p className="text-amber-900">
                    Não foi possível ler o contrato automaticamente. O contrato ficou anexado;
                    preencha os dados na próxima etapa.
                  </p>
                ) : reading.filled.length ? (
                  <>
                    <p className="font-medium text-emerald-800">
                      O sistema leu {reading.filled.length}{" "}
                      {reading.filled.length === 1 ? "campo" : "campos"} do contrato:
                    </p>
                    <p className="text-muted-foreground">{reading.filled.join(" · ")}</p>
                  </>
                ) : (
                  <p>Contrato lido. Os campos encontrados já estavam preenchidos.</p>
                )}
                <Button size="sm" onClick={() => setStep("dados")}>
                  Conferir os dados <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
      {step === "documentos" && (
        <>
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium">Comece pelos documentos</p>
              <p>
                Envie RG e CPF ou CNH de cada proprietário, a matrícula e o IPTU do imóvel: sem eles
                não dá para enviar ao gestor. O comprovante de residência é opcional. A leitura é
                local e apresenta sugestões para sua revisão. Também é possível preencher tudo
                manualmente na próxima etapa.
              </p>
              <p className="text-muted-foreground">
                PDF, JPG, PNG ou WEBP de até 16 MB. Os anexos são privados.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={docs.length === 0}
                  onClick={() => allDocs(true)}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir todos
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={docs.length === 0}
                  onClick={() => allDocs(false)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Baixar todos (PDF)
                </Button>
              </div>
            </CardContent>
          </Card>
          <OwnerBlocks {...ownerBlocksCommon} badges="docs" renderBody={ownerDocs} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos do imóvel</CardTitle>
              <p className="text-sm text-muted-foreground">
                Matrícula e IPTU são obrigatórios para enviar ao gestor. O comprovante de residência
                é opcional.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {fileInput("Matrícula", "matricula", 0, {
                accent: "border-l-4 border-l-emerald-500",
                required: !manual && !hasDoc("matricula", 0),
              })}
              {fileInput("IPTU", "iptu", 0, {
                accent: "border-l-4 border-l-emerald-500",
                required: !manual && !hasDoc("iptu", 0),
              })}
              {fileInput("Comprovante de residência (opcional)", "residencia", 0, {
                accent: "border-l-4 border-l-emerald-500",
              })}
            </CardContent>
          </Card>
          {docs.some((d) => d.kind === "gerado" || d.kind === "assinado") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Contrato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {docs.some((d) => d.kind === "gerado") &&
                  fileInput("Contrato gerado", "gerado", 0, {
                    accent: "border-l-4 border-l-indigo-500",
                  })}
                {docs.some((d) => d.kind === "assinado") &&
                  fileInput("Contrato assinado", "assinado", 0, {
                    accent: "border-l-4 border-l-indigo-500",
                  })}
              </CardContent>
            </Card>
          )}
          {editable &&
            pendingSuggestions
              .filter((s) => s.fields.length > 0)
              .map((suggestion) => (
                <Card key={suggestion.scope} className="border-primary/40">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Sugestões da leitura local —{" "}
                      {suggestion.scope === "imovel"
                        ? "imóvel"
                        : `proprietário ${ownerNumber(suggestion.scope) ?? ""}`}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p>
                      A leitura pode errar. Revise antes de aplicar; dados já preenchidos não serão
                      substituídos.
                    </p>
                    <ul className="list-inside list-disc">
                      {suggestion.fields.map(([key, value]) => (
                        <li key={key}>
                          {key.replaceAll("_", " ")}: {value}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setForm(
                            (current) =>
                              current &&
                              applySuggestedFields(current, suggestion.scope, suggestion.values),
                          );
                          setDirty(true);
                          setSuggestions((current) =>
                            current.filter((item) => item.scope !== suggestion.scope),
                          );
                          setStep("dados");
                        }}
                      >
                        Aplicar aos campos vazios e revisar
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setSuggestions((current) =>
                            current.filter((item) => item.scope !== suggestion.scope),
                          )
                        }
                      >
                        Descartar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
        </>
      )}
      {step === "dados" && (
        <>
          {corrigindoAtivo && (
            <Card className="border-amber-400 bg-amber-50/70" data-testid="faixa-correcao">
              <CardHeader>
                <CardTitle className="text-base">Corrigindo dados da captação aprovada</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  Pode corrigir os dados do imóvel, da ficha (área, quartos, suítes, vagas…) e o
                  cadastro dos proprietários. A captação continua aprovada, no mapa e no alerta de
                  vencimento. Cada correção fica no histórico com o valor anterior e o novo.
                </p>
                <p className="text-muted-foreground">
                  Não muda por aqui: {CORRECAO_TRAVADOS.join(", ")}. Para isso, use “Devolver ao
                  corretor”.
                </p>
                {vendaInfo.venda && (
                  <p
                    role="alert"
                    className="rounded-md border border-orange-300 bg-orange-50 p-2 text-orange-900"
                  >
                    {AVISO_VENDA_CORRECAO}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button disabled={busy || !dirty} onClick={salvarCorrecao}>
                    Salvar correção
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={cancelarCorrecao}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {manual && (
            <Card className="border-violet-300">
              <CardHeader>
                <CardTitle>Contrato já assinado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Confira o que foi lido do contrato e complete o que faltar. Nada aqui é
                  obrigatório; o que ficar vazio aparece como pendência para o gestor.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="manual-signed">Data de assinatura do contrato</Label>
                    <Input
                      id="manual-signed"
                      type="date"
                      className="w-44"
                      max={hojeSaoPaulo()}
                      value={form.data_assinatura ?? ""}
                      disabled={!editable || busy}
                      onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) => (f ? { ...f, data_assinatura: v || undefined } : f));
                        setDirty(true);
                      }}
                    />
                  </div>
                  <p className="pb-2 text-xs text-muted-foreground">
                    Informe a data em que o contrato foi assinado. O prazo da exclusividade e o
                    alerta de vencimento contam a partir desta data.
                  </p>
                </div>
                {signedDoc && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => withDoc(signedDoc, (url) => setPreview({ doc: signedDoc, url }))}
                  >
                    <Eye className="mr-1 h-4 w-4" /> Ver contrato assinado
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Captador</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {field("CPF do captador", cpf, (v) => updateBroker("cpf", v), true)}
              {field("CRECI do captador", creci, (v) => updateBroker("creci", v), true)}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Dados carregados de Meu acesso; preencha aqui se o perfil ainda não estiver
                completo.
              </p>
            </CardContent>
          </Card>
          <OwnerBlocks
            {...ownerBlocksCommon}
            badges="fields"
            title="Proprietários (CONTRATANTES)"
            renderBody={ownerFields}
          />
          <Card>
            <CardHeader>
              <CardTitle>Imóvel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {PROPERTY_FIELDS.map(({ key, label, required }) =>
                  key === "valor_imovel" ? (
                    <div key={label} className="space-y-1">
                      <Label>
                        {label}
                        {required ? " *" : ""}
                      </Label>
                      <Input
                        aria-label={label}
                        inputMode="numeric"
                        placeholder="R$ 0,00"
                        value={normalizeReais(form.imovel.valor_imovel)}
                        disabled={!editaDados || busy}
                        onChange={(e) => edit("imovel", "valor_imovel", typeReais(e.target.value))}
                      />
                    </div>
                  ) : key === "tipo_imovel" ? (
                    <div key={label} className="space-y-1">
                      <Label>
                        {label}
                        {required && !manual ? " *" : ""}
                      </Label>
                      <Select
                        value={
                          (isTipoImovel(form.imovel.tipo_imovel)
                            ? form.imovel.tipo_imovel
                            : tipoImovelDoTexto(form.imovel.tipo_imovel)) ?? ""
                        }
                        disabled={!editaDados || busy}
                        onValueChange={(v) => edit("imovel", "tipo_imovel", v)}
                      >
                        <SelectTrigger aria-label={label}>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_IMOVEL.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    field(
                      label,
                      form.imovel[key],
                      (v) => edit("imovel", key as PropertyField, v),
                      required,
                      true,
                    )
                  ),
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Documentos opcionais não dispensam o preenchimento manual dos dados necessários ao
                contrato.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ficha do imóvel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {FICHA_CAPTACAO_CAMPOS.filter(({ key }) =>
                  campoVisivel(key, tipoImovelDoTexto(form.imovel.tipo_imovel)),
                ).map(({ key, label, area }) => (
                  <div key={key} className="space-y-1">
                    <Label>{label}</Label>
                    <Input
                      aria-label={label}
                      inputMode={area ? "decimal" : "numeric"}
                      maxLength={20}
                      value={form.ficha?.[key] ?? ""}
                      disabled={!editaDados || busy}
                      onChange={(e) => editFicha(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Mesmos campos do Estudo de Mercado. Quando a captação virar venda, estes dados vão
                para a venda como sugestão; o corretor confirma a área útil lá.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Condições do contrato</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {TERMS_FIELDS.map(({ key, label }) =>
                field(
                  label,
                  form.condicoes[key],
                  (v) => edit("condicoes", key as TermsField, v),
                  true,
                ),
              )}
            </CardContent>
          </Card>
          {testemunhas?.aplica && !manual ? (
            <Card data-testid="card-testemunhas-auto">
              <CardHeader>
                <CardTitle>Testemunhas</CardTitle>
              </CardHeader>
              <CardContent>
                <TestemunhasAutomaticas
                  db={supabase as unknown as SupabaseClient}
                  captureId={capture.id}
                  testemunhas={testemunhas}
                  podeTrocar={
                    !archived && ["rascunho", "devolvida", "enviada"].includes(capture.status)
                  }
                  onChange={setTestemunhas}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Testemunhas (opcionais)</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {(["testemunha_1", "testemunha_2"] as const).map((scope, i) => (
                  <div key={scope} className="space-y-2 rounded border p-3">
                    <h3 className="font-medium">Testemunha {i + 1}</h3>
                    {(["nome", "rg", "cpf"] as const).map((key) =>
                      field(key.toUpperCase(), form[scope][key], (v) => edit(scope, key, v)),
                    )}
                    {field(
                      `E-mail da testemunha ${i + 1} (opcional)`,
                      form[scope].email ?? "",
                      (v) => edit(scope, "email", v),
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !dirty} onClick={save}>
                Salvar alterações
              </Button>
            </div>
          )}
          {corrigindoAtivo && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !dirty} onClick={salvarCorrecao}>
                Salvar correção
              </Button>
              <Button variant="outline" disabled={busy} onClick={cancelarCorrecao}>
                Cancelar
              </Button>
            </div>
          )}
        </>
      )}
      {step === "dossie" && form && (
        <>
          {manual ? (
            <CaptureDossieStep
              actions={dossieActions}
              selected={dossieIds}
              editable={editable}
              loading={dossieLoading}
              onChange={setDossie}
              semanas={planoSemanas}
              totalSemanas={semanasInfo.total}
              semanasPadrao={semanasInfo.padrao}
              title="Plano de Marketing"
              intro="Obrigatório: confira as ações de marketing combinadas com o proprietário (ao menos 1). As essenciais já vêm marcadas; ajuste o que for preciso. A semana de cada ação é opcional."
              manual
            />
          ) : (
            <CaptureDossieStep
              actions={dossieActions}
              selected={dossieIds}
              editable={editable}
              loading={dossieLoading}
              onChange={setDossie}
              semanas={planoSemanas}
              totalSemanas={semanasInfo.total}
              semanasPadrao={semanasInfo.padrao}
            />
          )}
          {manual && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documentos (opcionais)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Anexe o que tiver. O que faltar aparece como pendente, sem impedir o envio.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <OwnerBlocks
                  {...ownerBlocksCommon}
                  badges="docs"
                  docsOptional
                  renderBody={ownerDocs}
                />
                {fileInput("Comprovante de residência", "residencia", 0, {
                  accent: "border-l-4 border-l-emerald-500",
                })}
                {fileInput("IPTU", "iptu", 0, { accent: "border-l-4 border-l-emerald-500" })}
                {fileInput("Matrícula", "matricula", 0, {
                  accent: "border-l-4 border-l-emerald-500",
                })}
              </CardContent>
            </Card>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !dirty} onClick={save}>
                Salvar alterações
              </Button>
            </div>
          )}
        </>
      )}
      {step === "assinado" && signedStep && (
        <DocumentoAssinadoResumo
          info={signedInfo}
          fileName={signedDoc?.file_name}
          anexadoEm={signedDoc?.created_at}
          aprovada={capture.status === "aprovada"}
        />
      )}
      {step === "revisao" && signedStep && (
        <p
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
          Contrato assinado recebido.{" "}
          <button
            type="button"
            className="font-medium text-primary underline"
            onClick={() => setStep("assinado")}
          >
            Ver no passo 5 “Documento assinado”
          </button>
        </p>
      )}
      {(step === "revisao" || step === "assinado") && (
        <>
          {step === "revisao" &&
            manual &&
            manualCheck &&
            (capture.status !== "aprovada" || manager) && (
              <Card className="border-violet-300">
                <CardHeader>
                  <CardTitle>Pendências do cadastro manual</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {manualCheck.required.length > 0 && (
                    <p className="rounded-md border border-red-300 bg-red-50 p-2 text-red-900">
                      Obrigatório: {manualCheck.required.join(" · ")}
                    </p>
                  )}
                  {manualCheck.optional.length ? (
                    <ul className="list-inside list-disc text-amber-900">
                      {manualCheck.optional.map((p) => (
                        <li key={p}>Pendente: {p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-700">Nenhuma pendência.</p>
                  )}
                </CardContent>
              </Card>
            )}
          {step === "revisao" && !manual && manager && capture.status === "enviada" && (
            <Card>
              <CardHeader>
                <CardTitle>Gerar PDF para assinatura</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Confira os dados enviados pelo corretor e gere o PDF para assinatura: só o
                  contrato e o Plano de Marketing, sem os documentos anexados. Só gestor, team
                  leader ou ADM pode gerar.
                </p>
                {dossieCatalog(dossieActions).length > 0 && (
                  <p>
                    {selectedDossie(dossieActions, dossieIds).length
                      ? `O Plano de Marketing com ${selectedDossie(dossieActions, dossieIds).length} ações sai anexado ao final do contrato.`
                      : "O Plano de Marketing é obrigatório: marque ao menos 1 ação antes de gerar o contrato."}{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline"
                      onClick={() => setStep("dossie")}
                    >
                      Revisar Plano de Marketing
                    </button>
                  </p>
                )}
                {docs.some((d) => d.kind === "gerado") && (
                  <p className="text-emerald-700">
                    PDF para assinatura já gerado. Gerar de novo substitui o anterior.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={generate}>
                    Gerar PDF para assinatura
                  </Button>
                  <Button variant="outline" onClick={() => setStep("documentos")}>
                    Ver documentos e conferir PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {step === "revisao" && editable && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {proprioGestor ? "Enviar e gerar PDF para assinatura" : "Enviar ao gestor"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {missing.length ? (
                  <p className="text-sm text-amber-800">Pendências: {missing.join(" · ")}</p>
                ) : proprioGestor ? (
                  <p className="text-sm">
                    Campos e documentos completos. Como a captação é sua e você é gestor/team
                    leader, não precisa aprovar os próprios documentos: o envio já gera o PDF para
                    assinatura. Depois é só mandar para assinatura e aprovar com o contrato
                    assinado.
                  </p>
                ) : manual ? (
                  <p className="text-sm">
                    Contrato assinado anexado. O gestor confere e aprova; só depois a captação conta
                    como assinada, entra no mapa e no alerta de vencimento.
                  </p>
                ) : (
                  <p className="text-sm">
                    Campos e documentos completos. O gestor confere e gera o contrato.
                  </p>
                )}
                {dirty && !missing.length && (
                  <p className="text-sm text-amber-800" data-testid="enviar-salva-antes">
                    Há alterações não salvas. Elas serão salvas antes do envio.
                  </p>
                )}
                <Button disabled={busy || missing.length > 0} onClick={() => action("enviar")}>
                  {proprioGestor
                    ? dirty
                      ? "Salvar, enviar e gerar PDF para assinatura"
                      : "Enviar e gerar PDF para assinatura"
                    : dirty
                      ? "Salvar e enviar ao gestor"
                      : "Enviar ao gestor"}
                </Button>
              </CardContent>
            </Card>
          )}
          {step === approvalStep && podeInformarData && (
            <Card data-testid="captador-data-assinatura">
              <CardHeader>
                <CardTitle className="text-base">Data de assinatura do contrato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="captor-signed-on">
                      Informe a data em que o contrato foi assinado
                    </Label>
                    <Input
                      id="captor-signed-on"
                      type="date"
                      className="w-44"
                      min={DATA_ASSINATURA_MIN}
                      max={hojeSaoPaulo()}
                      value={signedOn}
                      onChange={(e) => setSignedOn(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    disabled={busy || !signedOn || signedOn === capture.signed_on}
                    onClick={saveSignedOn}
                  >
                    Salvar data
                  </Button>
                </div>
                {dicaDataPdf}
                <p className="text-xs text-muted-foreground">
                  O prazo da exclusividade e o Plano de Marketing contam a partir desta data. Depois
                  da aprovação, só o gestor corrige.
                </p>
              </CardContent>
            </Card>
          )}
          {/* Envio/acompanhamento pela Clicksign é do passo 4; assinado, o resumo fica no passo 5. */}
          {step === "revisao" &&
            !signedStep &&
            !manual &&
            !archived &&
            ["enviada", "em_assinatura"].includes(capture.status) && (
              <ClicksignEnvio
                captureId={capture.id}
                status={capture.status}
                form={form as unknown as Record<string, unknown> | null}
                hasGerado={docs.some((d) => d.kind === "gerado")}
                dirty={dirty}
                onSent={reload}
                podeManual={manager}
                temAssinado={!!currentSigned}
                onManual={() => action("assinatura")}
                onModo={setClicksignModo}
                testemunhas={testemunhas}
                onTestemunhas={setTestemunhas}
              />
            )}
          {step === approvalStep &&
            manager &&
            ["enviada", "em_assinatura"].includes(capture.status) && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {manual
                      ? "Aprovação do cadastro manual"
                      : signedStep
                        ? "Conferência e aprovação"
                        : "Gestão e assinatura"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm">
                    {manual
                      ? "Contrato assinado no papel, anexado pelo captador. Confira o contrato e os dados; ao aprovar, a captação passa a contar como assinada, entra no mapa e no alerta de vencimento."
                      : signedStep
                        ? "Confira o PDF assinado e a data de assinatura. Ao aprovar, a captação passa a contar como assinada, entra no mapa e no alerta de vencimento."
                        : clicksignManualInstructions}
                  </p>
                  {dossieMissing && (
                    <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
                      O Plano de Marketing é obrigatório e está sem ações marcadas. Devolva ao
                      corretor para marcar antes de aprovar.{" "}
                      <button
                        type="button"
                        className="font-medium text-primary underline"
                        onClick={() => setStep("dossie")}
                      >
                        Ver Plano de Marketing
                      </button>
                    </p>
                  )}
                  {fileInput(
                    manual ? "Contrato assinado (PDF ou foto)" : "Contrato assinado (PDF)",
                    "assinado",
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="space-y-1">
                      <Label htmlFor="signed-on">Data de assinatura do contrato</Label>
                      <Input
                        id="signed-on"
                        type="date"
                        className="w-44"
                        max={hojeSaoPaulo()}
                        value={signedOn}
                        onChange={(e) => setSignedOn(e.target.value)}
                      />
                    </div>
                    <p className="pb-2 text-xs text-muted-foreground">
                      O prazo da exclusividade e o Plano de Marketing contam a partir desta data.
                    </p>
                  </div>
                  {dicaDataPdf}
                  <div className="flex flex-wrap gap-2">
                    {!manual &&
                      !signedStep &&
                      capture.status === "enviada" &&
                      !clicksignModo.disponivel && (
                        <Button
                          variant="outline"
                          disabled={busy || !docs.some((d) => d.kind === "gerado")}
                          onClick={() => action("assinatura")}
                        >
                          Registrar envio para assinatura externa
                        </Button>
                      )}
                    <Button
                      disabled={busy || !!bloqueioAprovar}
                      title={bloqueioAprovar ?? undefined}
                      onClick={() => action("aprovar")}
                    >
                      Aprovar captação
                    </Button>
                  </div>
                  {avisoSemAssinado(docs) && (
                    <p
                      role="status"
                      data-testid="aviso-sem-assinado"
                      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      {avisoSemAssinado(docs)}
                    </p>
                  )}
                  {bloqueioAprovar && bloqueioAprovar !== BLOQUEIO_SEM_ASSINADO && (
                    <p className="text-xs text-muted-foreground">{bloqueioAprovar}</p>
                  )}
                  {capture.status === "em_assinatura" && (
                    <p className="text-xs text-amber-800">Ao devolver: {AVISO_CLICKSIGN}</p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      aria-label="Motivo da devolução"
                      placeholder="Motivo da devolução (obrigatório)"
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => action("devolver")}
                    >
                      Devolver
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          {step === approvalStep &&
            podeDevolverAprovada({
              manager,
              status: capture.status,
              archived,
              temVendaAtiva: !!vendaInfo.venda,
            }) && (
              <Card>
                <CardHeader>
                  <CardTitle>Devolver ao corretor</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Use quando a aprovação precisa ser refeita (dado errado, Plano de Marketing
                    incompleto). A captação sai do mapa e do alerta de vencimento até ser aprovada
                    de novo; o contrato assinado fica guardado no histórico. Não é possível com
                    venda ativa ligada.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Motivo da devolução da captação aprovada"
                      placeholder="Motivo da devolução (obrigatório)"
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Button
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => action("devolver")}
                    >
                      Devolver ao corretor
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          <Card>
            <CardHeader>
              <CardTitle>Histórico auditado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {history.map((h) => {
                const quando = new Date(h.created_at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                });
                if (h.action === "transferida") {
                  return (
                    <div key={h.id} className="border-b py-1" data-testid="historico-transferida">
                      Em {quando} · {textoTransferencia(lerTransferencia(h.detail))} ·{" "}
                      {autorDoHistorico(h, user?.id)}
                    </div>
                  );
                }
                if (h.action === "corrigida") {
                  const c = lerCorrecao(h.detail);
                  return (
                    <div key={h.id} className="border-b py-1" data-testid="historico-corrigida">
                      Em {quando} · dados corrigidos (continua aprovada) ·{" "}
                      {autorDoHistorico(h, user?.id)}
                      {c.por ? ` (${c.por})` : ""}
                      {c.mudancas.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-muted-foreground">
                          {c.mudancas.map((m, i) => (
                            <li key={i}>{textoMudanca(m)}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={h.id} className="border-b py-1">
                    Em {quando} · {h.action} · {autorDoHistorico(h, user?.id)}
                    {h.detail ? ` · ${h.detail}` : ""}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={step === captureSteps[0].key}
          onClick={() =>
            setStep(
              captureSteps[Math.max(0, captureSteps.findIndex((s) => s.key === step) - 1)].key,
            )
          }
        >
          Voltar
        </Button>
        {editable ? (
          <div className="flex flex-col items-center gap-1" data-testid="captacao-autosave">
            {autosave.error ? (
              <span role="alert" className="text-xs text-destructive">
                Não salvou: {autosave.error}
              </span>
            ) : autosave.bloqueio ? (
              <span role="alert" className="text-xs text-amber-800">
                {autosave.bloqueio}
              </span>
            ) : autosave.saving || dirty ? (
              <AutosaveStatus saving={autosave.saving} dirty={dirty} />
            ) : autosave.saved ? (
              <span className="text-xs text-emerald-700">Salvo</span>
            ) : null}
          </div>
        ) : (
          dirty && <span className="text-xs text-amber-800">Alterações não salvas</span>
        )}
        <Button
          disabled={step === lastStep}
          onClick={() =>
            setStep(
              captureSteps[
                Math.min(captureSteps.length - 1, captureSteps.findIndex((s) => s.key === step) + 1)
              ].key,
            )
          }
        >
          Próximo <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
      {podeTransf && (
        <TransferirCaptacaoDialog
          open={transferindo}
          onOpenChange={setTransferindo}
          avulsa={transfAvulsa}
          onDone={() => {
            void reload().catch(() => undefined);
          }}
        />
      )}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.doc.file_name}</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="max-h-[70vh] overflow-auto rounded-md border bg-muted/30">
              {isImageFile(preview.doc.file_name) ? (
                <img
                  src={preview.url}
                  alt={preview.doc.file_name}
                  className="mx-auto max-h-[70vh] max-w-full"
                />
              ) : (
                <iframe
                  src={preview.url}
                  title={preview.doc.file_name}
                  className="h-[70vh] w-full"
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => preview && printOne(preview.doc)}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                preview &&
                downloadDocument(preview.doc).catch((e) =>
                  toast.error(errorMessage(e, "Falha ao baixar")),
                )
              }
            >
              <Download className="mr-2 h-4 w-4" />
              Baixar
            </Button>
            <Button onClick={() => setPreview(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Situação da captação pela venda ligada a ela ("Virou venda"). Rascunho não muda a captação. */
function VendaDaCaptacaoAviso({ venda }: { venda: VendaDaCaptacao }) {
  const dias = diasEntre(venda.negociacao_desde, hojeSaoPaulo());
  const link = venda.pode_abrir ? (
    <Link to="/vendas/$id" params={{ id: venda.id }} className="font-semibold underline">
      venda #{venda.codigo}
    </Link>
  ) : (
    <strong>venda #{venda.codigo}</strong>
  );
  if (venda.situacao === "vendida")
    return (
      <p className="mt-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-sm text-violet-900">
        <strong>Vendida</strong> pela {link}. A captação saiu do mapa.
      </p>
    );
  if (venda.situacao === "em_negociacao")
    return (
      <p className="mt-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
        <strong>Em negociação</strong> pela {link}
        {venda.negociacao_desde && (
          <>
            {" "}
            (enviada ao gestor em {formatDateBR(venda.negociacao_desde)}, {haQuantosDias(dias)})
          </>
        )}
        . Continua no mapa com pino laranja até a venda ter contrato assinado.
      </p>
    );
  return (
    <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
      Esta captação já virou a {link} (rascunho
      {venda.aberta_por ? ` aberto por ${venda.aberta_por}` : ""}). Ela continua{" "}
      <strong>Ativa</strong> até a venda ser enviada ao gestor. Se a venda for arquivada ou
      cancelada, o botão "Virou venda" volta a funcionar.
    </p>
  );
}
