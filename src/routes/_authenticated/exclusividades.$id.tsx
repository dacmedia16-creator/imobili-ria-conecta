import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { guardExclusiveRoute } from "@/lib/exclusive-captures-guard";
import {
  downloadCaptureTemplate,
  downloadDocument,
  loadCapture,
  saveCapture,
  signedDocument,
  signedDocuments,
  transitionCapture,
  uploadCaptureDocument,
} from "@/lib/exclusive-captures-db";
import {
  applySuggestedFields,
  emptyOwner,
  fillExclusiveTemplate,
  missingRequirements,
  ownerDocumentsComplete,
  OWNER_FIELDS,
  PROPERTY_FIELDS,
  TERMS_FIELDS,
  TEMPLATES,
  type Capture,
  type CaptureDocument,
  type CaptureEvent,
  type CaptureForm,
  type DocumentKind,
  type OwnerField,
  type PropertyField,
  type TermsField,
} from "@/lib/exclusive-captures";
import { suggestFromLocalFile, validCpf, validCreci } from "@/lib/exclusive-captures-ocr";
import { clicksignManualInstructions } from "@/lib/exclusive-clicksign";
import {
  baixarDocumentosComoPdf,
  isImageFile,
  openDocumentPrintWindow,
  printDocumentUrls,
} from "@/lib/document-actions";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowRight, FileCheck2, Upload } from "lucide-react";

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
  { key: "revisao", label: "Revisão e envio" },
] as const;
type CaptureStep = (typeof captureSteps)[number]["key"];

function ExclusiveDetail() {
  const { id } = Route.useParams();
  const { user, hasAny } = useAuth();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [form, setForm] = useState<CaptureForm | null>(null);
  const [cpf, setCpf] = useState("");
  const [creci, setCreci] = useState("");
  const [docs, setDocs] = useState<CaptureDocument[]>([]);
  const [history, setHistory] = useState<CaptureEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState<CaptureStep>("documentos");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [reason, setReason] = useState("");
  const [suggestions, setSuggestions] = useState<
    {
      scope: "proprietario_1" | "proprietario_2" | "imovel";
      values: Record<string, string>;
    }[]
  >([]);
  const loadedId = useRef<string | null>(null);
  const manager = hasAny(["gestor", "team_leader", "admin", "super_admin"]);
  const editable = capture?.status === "rascunho" || capture?.status === "devolvida";
  const reload = useCallback(async () => {
    const result = await loadCapture(id);
    if (loadedId.current !== id) {
      setSuggestions([]);
      setPreview(null);
      setStep("documentos");
      loadedId.current = id;
    }
    setCapture(result.capture);
    setForm(result.capture.form_data);
    setCpf(result.capture.broker_cpf);
    setCreci(result.capture.broker_creci);
    setDocs(result.docs);
    setHistory(result.history);
    setDirty(false);
  }, [id]);
  useEffect(() => {
    reload()
      .catch((e) => toast.error(errorMessage(e, "Sem acesso a esta captação")))
      .finally(() => setLoading(false));
  }, [reload]);
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
      // A versão é sempre invalidada antes de gerar. A data vem do banco (fuso SP), nunca do relógio do browser.
      await saveCapture(id, form, cpf, creci);
      const bytes = await fillExclusiveTemplate(await downloadCaptureTemplate(capture.template), {
        ...capture,
        form_data: form,
        broker_cpf: cpf,
        broker_creci: creci,
      });
      const file = new File([bytes as BlobPart], `contrato-exclusividade-${id.slice(0, 8)}.pdf`, {
        type: "application/pdf",
      });
      await uploadCaptureDocument(id, "gerado", 0, file);
      toast.success("Contrato gerado. Confira no visualizador antes de enviá-lo.");
    });
  const upload = (kind: DocumentKind, owner: number, file: File) =>
    run(async () => {
      if (dirty && form) await saveCapture(id, form, cpf, creci);
      await uploadCaptureDocument(id, kind, owner, file);
      toast.success("Documento anexado");
      if (kind === "assinado" || kind === "gerado") return;
      const scope = owner === 1 ? "proprietario_1" : owner === 2 ? "proprietario_2" : "imovel";
      try {
        const values = await suggestFromLocalFile(file, owner ? "owner" : "property");
        if (Object.keys(values).length) {
          setSuggestions((current) => {
            const previous = current.find((item) => item.scope === scope);
            return [
              ...current.filter((item) => item.scope !== scope),
              { scope, values: { ...previous?.values, ...values } as Record<string, string> },
            ];
          });
          toast.info("Leitura local concluída. Confira as sugestões antes de aplicá-las.");
        } else toast.info("Sem campos legíveis identificados; preencha manualmente.");
      } catch {
        toast.info("Leitura local indisponível; o documento foi anexado. Preencha manualmente.");
      }
    });
  const action = (name: "enviar" | "assinatura" | "aprovar" | "devolver") =>
    run(async () => {
      if (name === "enviar" && !window.confirm("Você conferiu o PDF gerado e todos os documentos?"))
        return;
      await transitionCapture(id, name, name === "devolver" ? reason : undefined);
      setReason("");
      toast.success("Histórico atualizado");
    });
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
      const list = await signedDocuments(docs);
      if (print && printWindow) printDocumentUrls(list, printWindow);
      else await baixarDocumentosComoPdf(list, `captacao-${id.slice(0, 8)}-documentos.pdf`);
    } catch (e: unknown) {
      printWindow?.close();
      toast.error(errorMessage(e, "Falha ao reunir documentos"));
    }
  };
  if (loading) return <p>Carregando captação...</p>;
  if (!capture || !form)
    return (
      <p>
        Captação não encontrada ou acesso negado.{" "}
        <Link to="/exclusividades" className="underline">
          Voltar
        </Link>
      </p>
    );
  const missing = missingRequirements(
    form,
    dirty ? docs.filter((d) => d.kind !== "gerado") : docs,
    cpf,
    creci,
  );
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
        value={value ?? ""}
        maxLength={300}
        disabled={!editable || busy}
        onChange={(e) => change(e.target.value)}
      />
    </div>
  );
  const fileInput = (label: string, kind: DocumentKind, owner = 0) => {
    const attached = docs.filter((doc) => doc.kind === kind && doc.owner_index === owner).at(-1);
    const canUpload =
      !busy &&
      (kind === "assinado"
        ? manager && ["enviada", "em_assinatura"].includes(capture.status)
        : editable);
    return (
      <div key={`${kind}-${owner}`} className="rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {attached ? `Enviado: ${attached.file_name}` : "Ainda não enviado"}
            </p>
          </div>
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
    );
  };
  const ownerFields = (
    scope: "proprietario_1" | "proprietario_2",
    owner: NonNullable<CaptureForm[typeof scope]>,
  ) =>
    OWNER_FIELDS.map(({ key, label, required }) =>
      field(label, owner[key], (value) => edit(scope, key as OwnerField, value), required),
    );
  return (
    <div className="space-y-5 pb-10">
      <Link to="/exclusividades" className="text-sm text-primary underline">
        ← Captações
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">
          Captação exclusiva · {TEMPLATES[capture.template]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {statusLabels[capture.status]} · Criada em {capture.created_on_sp} (São Paulo). Captador:{" "}
          {capture.broker_name}
        </p>
      </div>
      <nav aria-label="Etapas da captação" className="grid gap-2 sm:grid-cols-3">
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
                      <div className="grid gap-3 sm:grid-cols-3">
                        {fileInput("RG", "rg", index + 1)}
                        {fileInput("CPF", "cpf", index + 1)}
                        {fileInput("CNH (substitui RG + CPF)", "cnh", index + 1)}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos complementares (opcionais)</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {fileInput("Comprovante de residência", "residencia")}
              {fileInput("IPTU", "iptu")}
              {fileInput("Matrícula", "matricula")}
            </CardContent>
          </Card>
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
                  field(
                    label,
                    form.imovel[key],
                    (v) => edit("imovel", key as PropertyField, v),
                    required,
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
      {step === "documentos" && (
        <Card>
          <CardHeader>
            <CardTitle>Documentos privados ({docs.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center gap-2 rounded border p-2 text-sm"
              >
                <span className="min-w-40 flex-1 truncate">
                  {documentLabels[doc.kind]}
                  {doc.owner_index ? ` · proprietário ${doc.owner_index}` : ""}: {doc.file_name}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => withDoc(doc, (url) => setPreview({ name: doc.file_name, url }))}
                >
                  Ver
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    downloadDocument(doc).catch((e) =>
                      toast.error(errorMessage(e, "Falha ao baixar")),
                    )
                  }
                >
                  Baixar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const printWindow = openDocumentPrintWindow();
                    if (!printWindow) return;
                    void signedDocument(doc)
                      .then((url) =>
                        printDocumentUrls([{ file_name: doc.file_name, url }], printWindow),
                      )
                      .catch((e: unknown) => {
                        printWindow.close();
                        toast.error(errorMessage(e, "Não foi possível imprimir o documento"));
                      });
                  }}
                >
                  Imprimir
                </Button>
              </div>
            ))}
            {docs.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                <Button variant="outline" onClick={() => allDocs(false)}>
                  Baixar todos em PDF
                </Button>
                <Button variant="outline" onClick={() => allDocs(true)}>
                  Imprimir todos
                </Button>
              </div>
            )}
            {preview && (
              <div
                role="dialog"
                aria-label="Visualização do documento"
                className="rounded border p-3"
              >
                <div className="flex items-center justify-between">
                  <b>{preview.name}</b>
                  <Button variant="ghost" onClick={() => setPreview(null)}>
                    Fechar
                  </Button>
                </div>
                {isImageFile(preview.name) ? (
                  <img src={preview.url} alt={preview.name} className="max-h-[70vh] max-w-full" />
                ) : (
                  <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full" />
                )}
              </div>
            )}
          </CardContent>
        </Card>
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
                {dirty && (
                  <p className="text-amber-800">
                    Alterações não salvas. Gere novamente o PDF para incluir os dados atuais.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={generate}>
                    Gerar PDF do modelo e salvar
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
              captureSteps[Math.min(2, captureSteps.findIndex((s) => s.key === step) + 1)].key,
            )
          }
        >
          Próximo <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
