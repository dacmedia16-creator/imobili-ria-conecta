import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/lib/exclusive-captures-db";
import {
  applySuggestedFields,
  captureValidity,
  emptyOwner,
  formatDateBR,
  VALIDITY_STYLE,
  validityText,
  fillExclusiveTemplate,
  missingRequirements,
  ownerDocumentsComplete,
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
  type PropertyField,
  type TermsField,
} from "@/lib/exclusive-captures";
import { suggestFromLocalFile, validCpf, validCreci } from "@/lib/exclusive-captures-ocr";
import { isAiReadableKind } from "@/lib/exclusive-captures-ai";
import { extractCaptureDocument } from "@/lib/exclusive-captures-ai.functions";
import { clicksignManualInstructions } from "@/lib/exclusive-clicksign";
import { CaptureDossieStep } from "@/components/CaptureDossieStep";
import {
  appendDossieToContract,
  buildDossiePdf,
  dossieCatalog,
  selectedDossie,
} from "@/lib/capture-dossie";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Printer,
  Trash2,
  Upload,
} from "lucide-react";

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
const captureSteps = [
  { key: "documentos", label: "Documentos" },
  { key: "dados", label: "Dados do contrato" },
  { key: "dossie", label: "Dossiê" },
  { key: "revisao", label: "Revisão e envio" },
] as const;
type CaptureStep = (typeof captureSteps)[number]["key"];

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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<CaptureStep>("documentos");
  const [dossieActions, setDossieActions] = useState<FeedbackAction[]>([]);
  const [dossieLoading, setDossieLoading] = useState(true);
  const [preview, setPreview] = useState<{ doc: CaptureDocument; url: string } | null>(null);
  const [reason, setReason] = useState("");
  const [signedOn, setSignedOn] = useState("");
  const [conflicts, setConflicts] = useState<AddressConflict[]>([]);
  const [suggestions, setSuggestions] = useState<
    {
      scope: "proprietario_1" | "proprietario_2" | "imovel";
      values: Record<string, string>;
    }[]
  >([]);
  const loadedId = useRef<string | null>(null);
  // Sempre o formulário mais recente (a leitura termina depois do clique).
  const formRef = useRef<CaptureForm | null>(null);
  formRef.current = form;
  const manager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
  const navigate = useNavigate();
  const archived = !!capture?.archived_at;
  const editable = !archived && (capture?.status === "rascunho" || capture?.status === "devolvida");
  const reload = useCallback(async () => {
    const [result, unitList] = await Promise.all([loadCapture(id), listUnits()]);
    setUnits(unitList);
    if (loadedId.current !== id) {
      setSuggestions([]);
      setPreview(null);
      setStep("documentos");
      loadedId.current = id;
    }
    setCapture(result.capture);
    // Foro ainda não gravado = cidade/estado da unidade; foro já salvo (ou editado) é mantido.
    setForm(normalizeForm(result.savedForm, captureUnit(result.capture, unitList)));
    setCpf(result.capture.broker_cpf);
    setCreci(result.capture.broker_creci);
    setDocs(result.docs);
    setHistory(result.history);
    setSignedOn(result.capture.signed_on ?? hojeSaoPaulo());
    // Aviso de endereço repetido: falha aqui nunca bloqueia a tela.
    addressConflicts(id)
      .then(setConflicts)
      .catch(() => setConflicts([]));
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
  useEffect(() => {
    // Catálogo do Feedback (plano de marketing). Falha/módulo desligado = sem Dossiê, sem travar.
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
  // Começa vazio: o corretor escolhe as ações. Obrigatório ter ao menos 1 quando há catálogo.
  const dossieIds = form?.dossie ?? [];
  const dossieRequired = dossieCatalog(dossieActions).length > 0;
  const dossieMissing = dossieRequired && selectedDossie(dossieActions, dossieIds).length === 0;
  const setDossie = (ids: string[]) => {
    setForm((current) => (current ? { ...current, dossie: ids } : current));
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
  const edit = <
    K extends
      | "proprietario_1"
      | "proprietario_2"
      | "imovel"
      | "condicoes"
      | "testemunha_1"
      | "testemunha_2",
  >(
    scope: K,
    key: keyof NonNullable<CaptureForm[K]>,
    value: string,
  ) => {
    setForm((f) => (f ? { ...f, [scope]: { ...f[scope], [key]: value } } : f));
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
      toast.success("Rascunho salvo. Gere novamente o PDF antes de enviar.");
    });
  const generate = () =>
    run(async () => {
      if (!capture || !form) return;
      if (dossieMissing) {
        setStep("dossie");
        throw new Error("Marque ao menos 1 ação no Dossiê antes de gerar o contrato.");
      }
      const catalogReady = dossieCatalog(dossieActions).length > 0;
      const saved: CaptureForm = catalogReady ? { ...form, dossie: dossieIds } : form;
      // A versão é sempre invalidada antes de gerar.
      await saveCapture(id, saved, cpf, creci);
      // Data impressa no contrato = dia em que ele é gerado (calendário de SP).
      // PDF decidido pela unidade agora (contrato-base com os dados dela ou PDF antigo).
      const source = contractSource(capture, units);
      let bytes = await fillExclusiveTemplate(
        await downloadCaptureTemplate(source.file),
        { ...capture, form_data: saved, broker_cpf: cpf, broker_creci: creci },
        true,
        hojeSaoPaulo(),
        source.unit,
      );
      // Dossiê vai anexado ao final do contrato (mesma assinatura).
      if (catalogReady && selectedDossie(dossieActions, dossieIds).length) {
        const [ano, mes, dia] = hojeSaoPaulo().split("-");
        const dossie = await buildDossiePdf({
          actions: dossieActions,
          selected: dossieIds,
          ownerNames: [
            saved.proprietario_1.nome_completo,
            saved.proprietario_2?.nome_completo ?? "",
          ],
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
      const file = new File([bytes as BlobPart], `contrato-exclusividade-${id.slice(0, 8)}.pdf`, {
        type: "application/pdf",
      });
      // Salvo na captação: contrato + Dossiê (é o que vai para assinatura).
      await uploadCaptureDocument(id, "gerado", 0, file);
      // Baixado: contrato, Dossiê e depois os documentos anexados (RG, CNH, IPTU, matrícula...).
      const anexos = docs.filter((d) => d.kind !== "gerado" && d.kind !== "assinado");
      await baixarDocumentosComoPdf(
        await signedDocuments(anexos),
        `contrato-exclusividade-${id.slice(0, 8)}-completo.pdf`,
        bytes,
      );
      toast.success("Contrato gerado e salvo. PDF baixado: contrato, Dossiê e documentos.");
    });
  const upload = (kind: DocumentKind, owner: number, file: File) =>
    run(async () => {
      if (dirty && form) await saveCapture(id, form, cpf, creci);
      const storagePath = await uploadCaptureDocument(id, kind, owner, file);
      toast.success("Documento anexado");
      if (kind === "assinado" || kind === "gerado") return;
      const scope = owner === 1 ? "proprietario_1" : owner === 2 ? "proprietario_2" : "imovel";
      try {
        toast.info("Lendo o documento…");
        // Leitura por IA (mesma das Vendas); se falhar, cai para a leitura local antiga.
        let values: Record<string, string> = {};
        if (isAiReadableKind(kind)) {
          const res = await extractCaptureDocument({
            data: { captureId: id, storagePath, kind, scope: owner ? "owner" : "property" },
          }).catch(() => null);
          if (res?.ok) values = res.values;
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
        if (!Object.keys(values).length || !current) {
          toast.info("Sem campos legíveis identificados; preencha manualmente.");
          return;
        }
        const before = ((current[scope] ?? {}) as Record<string, string>) || {};
        const next = applySuggestedFields(current, scope, values);
        const after = (next[scope] ?? {}) as Record<string, string>;
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
  const action = (name: "enviar" | "assinatura" | "aprovar" | "devolver") =>
    run(async () => {
      if (name === "enviar" && !window.confirm("Você conferiu o PDF gerado e todos os documentos?"))
        return;
      await transitionCapture(id, name, name === "devolver" ? reason : undefined);
      // Vigência conta da assinatura: grava a data informada pelo gestor (padrão hoje).
      if (name === "aprovar" && signedOn && signedOn !== hojeSaoPaulo())
        await setCaptureSignedOn(id, signedOn);
      setReason("");
      toast.success("Histórico atualizado");
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
  if (loading) return <p>Carregando captação…</p>;
  if (!capture || !form)
    return (
      <DetailNotFound
        message={DETAIL_NOT_FOUND_MESSAGE.captacao}
        backTo="/exclusividades"
        backLabel="Voltar para exclusividades"
      />
    );
  const missing = missingRequirements(
    form,
    dirty ? docs.filter((d) => d.kind !== "gerado") : docs,
    cpf,
    creci,
  );
  if (dossieMissing) missing.push("Dossiê: marque ao menos 1 ação");
  if (cpf.trim() && !validCpf(cpf.trim()))
    missing.push("CPF do captador inválido (dígitos verificadores)");
  if (creci.trim() && !validCreci(creci))
    missing.push(
      "CRECI inválido (4 a 50 caracteres, letras, números, espaço, ponto, barra ou hífen)",
    );
  const pendingSuggestions = suggestions.map((suggestion) => ({
    ...suggestion,
    fields: Object.entries(suggestion.values).filter(
      ([key]) => !((form[suggestion.scope] ?? {}) as Record<string, string>)[key]?.trim(),
    ),
  }));
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    required = false,
  ) => (
    <div key={label} className="space-y-1">
      <Label>
        {label}
        {required ? " *" : ""}
      </Label>
      <Input
        aria-label={label}
        value={value ?? ""}
        maxLength={300}
        disabled={!editable || busy}
        onChange={(e) => change(e.target.value)}
      />
    </div>
  );
  const hasDoc = (kind: DocumentKind, owner: number) =>
    docs.some((doc) => doc.kind === kind && doc.owner_index === owner);
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
  const docRow = (doc: CaptureDocument) => (
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
        ? manager && ["enviada", "em_assinatura"].includes(capture.status)
        : editable);
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
                    accept={kind === "assinado" ? ".pdf" : ".pdf,.jpg,.jpeg,.png,.webp"}
                    aria-label={`Enviar ${label}`}
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) upload(kind, owner, file);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
          {list.map(docRow)}
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
      required: !dispensa && !hasDoc(kind, owner),
      dispensa,
    });
  };
  const ownerFields = (
    scope: "proprietario_1" | "proprietario_2",
    owner: NonNullable<CaptureForm[typeof scope]>,
  ) =>
    OWNER_FIELDS.map(({ key, label, required }) =>
      field(label, owner[key], (value) => edit(scope, key as OwnerField, value), required),
    );
  // Mesma regra do banco (exclusive_archive): contrato gerado ou fora do rascunho → arquivar.
  const validity = captureValidity(capture, hojeSaoPaulo());
  const saveSignedOn = () =>
    run(async () => {
      await setCaptureSignedOn(id, signedOn);
      toast.success("Data de assinatura atualizada");
    });
  const hasContract =
    capture.status !== "rascunho" || docs.some((d) => d.kind === "gerado" || d.kind === "assinado");
  return (
    <div className="space-y-5 pb-10">
      <Link to="/exclusividades" className="text-sm text-primary underline">
        ← Captações
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          Captação exclusiva · {captureUnitLabel(capture, units)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {statusLabels[capture.status]} · Criada em {capture.created_on_sp} (São Paulo). Captador:{" "}
          {capture.broker_name}
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
                  disabled={busy || !signedOn || signedOn === capture.signed_on}
                  onClick={saveSignedOn}
                >
                  Corrigir data
                </Button>
              </span>
            )}
          </div>
        )}
        {archived && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Captação arquivada: fora da lista principal e sem edição. Desarquive para voltar a usar.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
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
              disabled={busy}
              onClick={() => lifecycle("arquivar")}
            >
              <Archive className="mr-1 h-4 w-4" /> Arquivar
            </Button>
          )}
        </div>
      </div>
      <nav aria-label="Etapas da captação" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
      {step === "documentos" && (
        <>
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="space-y-1 p-4 text-sm">
              <p className="font-medium">Comece pelos documentos</p>
              <p>
                Envie RG e CPF ou CNH de cada proprietário. A leitura é local e apresenta sugestões
                para sua revisão. Também é possível preencher tudo manualmente na próxima etapa.
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
          {(["proprietario_1", "proprietario_2"] as const).map((scope, index) => {
            const owner = form[scope];
            return (
              <Card key={scope}>
                <CardHeader>
                  <CardTitle className="text-base">
                    Proprietário {index + 1} {index === 1 && !owner ? "(opcional)" : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {index === 1 && editable && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setForm((f) =>
                          f
                            ? f.proprietario_2
                              ? (({ proprietario_2: _, ...rest }) => rest)(f)
                              : { ...f, proprietario_2: emptyOwner() }
                            : f,
                        );
                        setSuggestions((current) =>
                          current.filter((item) => item.scope !== "proprietario_2"),
                        );
                        setDirty(true);
                      }}
                    >
                      {owner ? "Remover segundo proprietário" : "Adicionar segundo proprietário"}
                    </Button>
                  )}
                  {owner && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {owner.nome_completo || "Nome a preencher"} ·{" "}
                        {ownerDocumentsComplete(docs, (index + 1) as 1 | 2)
                          ? "Identificação completa"
                          : "RG + CPF ou CNH pendentes"}
                      </p>
                      <div className="space-y-3">
                        {ownerDocInput("RG", "rg", index + 1)}
                        {ownerDocInput("CPF", "cpf", index + 1)}
                        {ownerDocInput("CNH (substitui RG + CPF)", "cnh", index + 1)}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Imóvel e complementares (opcionais)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {fileInput("Comprovante de residência", "residencia", 0, {
                accent: "border-l-4 border-l-emerald-500",
              })}
              {fileInput("IPTU", "iptu", 0, { accent: "border-l-4 border-l-emerald-500" })}
              {fileInput("Matrícula", "matricula", 0, {
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
                        : `proprietário ${suggestion.scope === "proprietario_1" ? 1 : 2}`}
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
          {(["proprietario_1", "proprietario_2"] as const).map((scope, index) => {
            const owner = form[scope];
            return (
              <Card key={scope}>
                <CardHeader>
                  <CardTitle>
                    Proprietário {index + 1} {index === 1 && !owner ? "(opcional)" : ""}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {owner && (
                    <div className="grid gap-3 sm:grid-cols-2">{ownerFields(scope, owner)}</div>
                  )}
                  {!owner && (
                    <p className="text-sm text-muted-foreground">
                      Adicione este proprietário na etapa Documentos se necessário.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
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
                        disabled={!editable || busy}
                        onChange={(e) => edit("imovel", "valor_imovel", typeReais(e.target.value))}
                      />
                    </div>
                  ) : (
                    field(
                      label,
                      form.imovel[key],
                      (v) => edit("imovel", key as PropertyField, v),
                      required,
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
                </div>
              ))}
            </CardContent>
          </Card>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !dirty} onClick={save}>
                Salvar alterações
              </Button>
            </div>
          )}
        </>
      )}
      {step === "dossie" && form && (
        <>
          <CaptureDossieStep
            actions={dossieActions}
            selected={dossieIds}
            editable={editable}
            loading={dossieLoading}
            onChange={setDossie}
          />
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !dirty} onClick={save}>
                Salvar alterações
              </Button>
            </div>
          )}
        </>
      )}
      {step === "revisao" && (
        <>
          {editable && (
            <Card>
              <CardHeader>
                <CardTitle>Contrato para conferência</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>
                  Salve os dados, gere o PDF do modelo e confira o arquivo em Documentos antes de
                  enviar.
                </p>
                {dossieCatalog(dossieActions).length > 0 && (
                  <p>
                    {selectedDossie(dossieActions, dossieIds).length
                      ? `O Dossiê com ${selectedDossie(dossieActions, dossieIds).length} ações sai anexado ao final do contrato.`
                      : "O Dossiê é obrigatório: marque ao menos 1 ação antes de gerar o contrato."}{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline"
                      onClick={() => setStep("dossie")}
                    >
                      Revisar Dossiê
                    </button>
                  </p>
                )}
                {dirty && (
                  <p className="text-amber-800">
                    Alterações não salvas. Gere novamente o PDF para incluir os dados atuais.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={generate}>
                    Gerar PDF, salvar e baixar
                  </Button>
                  <Button variant="outline" onClick={() => setStep("documentos")}>
                    Ver documentos e conferir PDF
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {editable && (
            <Card>
              <CardHeader>
                <CardTitle>Enviar ao gestor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {missing.length ? (
                  <p className="text-sm text-amber-800">Pendências: {missing.join(" · ")}</p>
                ) : (
                  <p className="text-sm">
                    Campos e documentos completos. Confira o contrato antes do envio.
                  </p>
                )}
                <Button
                  disabled={busy || dirty || missing.length > 0}
                  onClick={() => action("enviar")}
                >
                  Enviar ao gestor
                </Button>
              </CardContent>
            </Card>
          )}
          {manager && ["enviada", "em_assinatura"].includes(capture.status) && (
            <Card>
              <CardHeader>
                <CardTitle>Gestão e assinatura</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm">{clicksignManualInstructions}</p>
                {fileInput("Contrato assinado (PDF)", "assinado")}
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
                    O prazo da exclusividade conta a partir desta data.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {capture.status === "enviada" && (
                    <Button variant="outline" disabled={busy} onClick={() => action("assinatura")}>
                      Registrar envio para assinatura externa
                    </Button>
                  )}
                  <Button
                    disabled={busy || !docs.some((d) => d.kind === "assinado")}
                    onClick={() => action("aprovar")}
                  >
                    Aprovar captação
                  </Button>
                </div>
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
          <Card>
            <CardHeader>
              <CardTitle>Histórico auditado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {history.map((h) => (
                <div key={h.id} className="border-b py-1">
                  {new Date(h.created_at).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  · {h.action} · {h.actor_id === user?.id ? "você" : h.actor_id}
                  {h.detail ? ` · ${h.detail}` : ""}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <Button
          variant="outline"
          disabled={step === "documentos"}
          onClick={() =>
            setStep(
              captureSteps[Math.max(0, captureSteps.findIndex((s) => s.key === step) - 1)].key,
            )
          }
        >
          Voltar
        </Button>
        {dirty && <span className="text-xs text-amber-800">Alterações não salvas</span>}
        <Button
          disabled={step === "revisao"}
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
