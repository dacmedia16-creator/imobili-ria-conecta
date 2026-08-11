import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Wizard } from "@/components/Wizard";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DOC_TYPES, docTypesPessoalPara, temDocDoTipo, chegouAoJuridico, parteLabel, parteBase, type SaleStatus, type DocParte } from "@/lib/status";
import { toast } from "sonner";
import { Upload, FileCheck, FileX, Plus, Trash2, Eye, Printer, Download, ZoomIn, ZoomOut, ChevronRight, ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import { extractDocument, applySaleExtractions } from "@/lib/documents.functions";
import { PDFDocument } from "pdf-lib";
import { DocStatusBadge } from "./shared";

// Tipos de documento que costumam ser o mesmo arquivo para o casal (certidão de casamento conjunta,
// comprovante de endereço compartilhado) — só esses ganham a opção "Mesmo do 1º" no 2º comprador/vendedor.
const REUSABLE_DOC_TYPES = new Set(["certidao", "comprovante_endereco"]);

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

function ExtractionBadge({ status, loading }: { status?: string; loading?: boolean }) {
  if (loading || status === "pending") return <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-900"><Loader2 className="h-3 w-3 animate-spin" />IA lendo</span>;
  if (status === "done") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900"><Sparkles className="h-3 w-3" />IA ok</span>;
  if (status === "failed") return <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">IA falhou</span>;
  return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Aguardando IA</span>;
}

export function DocumentsPanel({
  saleId, saleStatus, docs, parties, editable, canModerate, canUseAi, canManageContratos, canDownloadAll, onChange,
  activeParte: activeParteProp, onActiveParteChange, onReachedLastBloco,
}: {
  saleId: string; saleStatus: SaleStatus; docs: any[]; parties: Record<string, any>; editable: boolean; canModerate: boolean; canUseAi: boolean;
  canManageContratos: boolean; canDownloadAll: boolean; onChange: () => void;
  /** Opcional: deixa o pai comandar qual bloco (comprador_1, juridico, ...) está ativo — usado pelo
   * atalho "Subir certidões" no topo da página, que precisa pular direto pro bloco do jurídico. */
  activeParte?: DocParte;
  onActiveParteChange?: (parte: DocParte) => void;
  /** Avisa o pai quando o usuário chega no último bloco de documentos — usado pra só liberar o
   * "Próximo" do wizard da venda depois que corretor/gestor passaram por todos os blocos. */
  onReachedLastBloco?: () => void;
}) {
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
      // RPC em vez de insert direto: mesmo bug de RLS inconsistente do PostgREST já corrigido
      // pra archive_sale_document (ver comentário em removeDoc) também acontecia aqui.
      const { error: insErr } = await supabase.rpc("insert_sale_document", {
        _sale_id: saleId, _tipo: "certidao_juridico", _parte: "juridico", _storage_path: path, _file_name: file.name,
        _descricao: nome.trim() || undefined,
      });
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
      // Arquivamento lógico: o arquivo e a linha continuam no banco/storage para consulta futura
      // (auditoria), só saem da tela comum. Passa por uma RPC (archive_sale_document) em vez de
      // update direto — vários corretores relataram "new row violates row-level security policy"
      // mesmo com a permissão correta (confirmado em testes diretos no banco); a RPC reaplica a
      // mesma checagem uma única vez server-side e escreve com privilégio elevado, contornando
      // essa inconsistência da camada do PostgREST.
      const { error } = await supabase.rpc("archive_sale_document", { _document_id: doc.id });
      if (error) { toast.error(error.message); return; }
      await supabase.from("activity_logs").insert({ sale_id: saleId, autor_id: user!.id, acao: "document_archived", payload: { doc_id: doc.id, tipo: doc.tipo, parte: doc.parte, file_name: doc.file_name } });
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
    // RPC em vez de insert direto: mesmo bug de RLS inconsistente do PostgREST já corrigido
    // pra archive_sale_document (ver comentário em removeDoc) também acontecia aqui.
    const { data: inserted, error: insErr } = await supabase.rpc("insert_sale_document", {
      _sale_id: saleId, _tipo: tipo, _parte: parte, _storage_path: path, _file_name: file.name,
    });
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
    // RPC em vez de insert direto: mesmo bug de RLS inconsistente do PostgREST já corrigido
    // pra archive_sale_document (ver comentário em removeDoc) também acontecia aqui.
    const { error } = await supabase.rpc("insert_sale_document", {
      _sale_id: saleId, _tipo: tipo, _parte: parte, _storage_path: baseDoc.storage_path, _file_name: baseDoc.file_name,
      _status: baseDoc.status, _extraction_status: "done",
    });
    if (error) { toast.error(error.message); return; }

    // O documento reaproveitado já foi extraído pela IA pro 1º — como o arquivo é o mesmo, o dado
    // (endereço do comprovante, regime do casamento da certidão) vale igual pro 2º. Sem isso, o
    // campo ficava vazio pro 2º mesmo usando exatamente o mesmo documento. Só preenche se o 2º
    // ainda não tiver algo digitado (nunca sobrescreve dado já preenchido).
    const campo = tipo === "comprovante_endereco" ? "endereco" : tipo === "certidao" ? "regime_casamento" : null;
    if (campo) {
      const { data: baseParty } = await supabase.from("sale_parties").select("endereco, regime_casamento").eq("sale_id", saleId).eq("papel", baseParte).maybeSingle();
      const valor = (baseParty as any)?.[campo];
      if (valor) {
        const { data: existingParty } = await supabase.from("sale_parties").select("id, endereco, regime_casamento").eq("sale_id", saleId).eq("papel", parte).maybeSingle();
        if (existingParty) {
          if (!(existingParty as any)[campo]) {
            await supabase.from("sale_parties").update({ [campo]: valor } as any).eq("id", (existingParty as any).id);
          }
        } else {
          await supabase.from("sale_parties").insert({ sale_id: saleId, papel: parte, [campo]: valor } as any);
        }
      }
    }

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

  // Cada parte pede um checklist diferente conforme o tipo_pessoa marcado na aba Partes (física:
  // RG/CPF/Certidão; jurídica: Cartão CNPJ/Última Alteração Contratual) — ver docTypesPessoalPara.
  const tiposPessoalDaParte = (parte: string) => docTypesPessoalPara(parties[parte]?.tipo_pessoa === "juridica" ? "juridica" : "fisica");
  const blocos: { parte: DocParte; tipos: typeof DOC_TYPES }[] = [
    { parte: "comprador_1", tipos: tiposPessoalDaParte("comprador_1") },
    ...compradorExtras.map(n => ({ parte: `comprador_${n}` as DocParte, tipos: tiposPessoalDaParte(`comprador_${n}`) })),
    { parte: "vendedor_1", tipos: tiposPessoalDaParte("vendedor_1") },
    ...vendedorExtras.map(n => ({ parte: `vendedor_${n}` as DocParte, tipos: tiposPessoalDaParte(`vendedor_${n}`) })),
    { parte: "imovel", tipos: DOC_TYPES.filter(t => t.grupo === "imovel") },
    { parte: "outros", tipos: DOC_TYPES.filter(t => t.grupo === "outros") },
    // Bloco de certidões do jurídico só aparece depois que a venda chega nessa etapa —
    // antes disso não faz sentido pedir certidão pra ninguém ainda.
    ...(chegouAoJuridico(saleStatus) ? [{ parte: "juridico" as DocParte, tipos: [] as typeof DOC_TYPES }] : []),
  ];
  // Navegação entre os blocos em modo wizard (um de cada vez, com Voltar/Próximo) —
  // mesma linguagem visual do wizard principal da venda. Controlado de fora quando o pai passa
  // activeParte/onActiveParteChange (atalho "Subir certidões"), senão fica em estado próprio.
  const [activeParteState, setActiveParteState] = useState<DocParte>("comprador_1");
  const activeParte = activeParteProp ?? activeParteState;
  const setActiveParte = onActiveParteChange ?? setActiveParteState;
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

  const ultimoBlocoKey = enabledBlocos[enabledBlocos.length - 1]?.parte;
  useEffect(() => {
    if (ultimoBlocoKey && activeParte === ultimoBlocoKey) onReachedLastBloco?.();
  }, [activeParte, ultimoBlocoKey, onReachedLastBloco]);

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
              // CNH enviada para essa parte dispensa o RG e o CPF, já que ela contém as duas informações — e vale o
              // contrário também: RG + CPF já enviados dispensam a CNH. É uma exigência de "um dos dois", não das duas.
              const dispensadoPorCnh = (t.key === "rg" || t.key === "cpf") && temDocDoTipo(docs, "cnh", parte);
              const cnhDispensadaPorRgCpf = t.key === "cnh" && temDocDoTipo(docs, "rg", parte) && temDocDoTipo(docs, "cpf", parte);
              const obrigatorioEfetivo = t.key === "cnh" ? !cnhDispensadaPorRgCpf : (t.obrigatorio && !dispensadoPorCnh);
              // "Contrato" e "Contrato assinado" já têm fluxo dedicado (jurídico anexa, gestor sobe o assinado) —
              // o corretor não deve enviar esses dois tipos por aqui, pra não pular a conferência.
              const isContratoTipo = t.key === "contrato" || t.key === "contrato_assinado";
              const podeEnviarAqui = editable && (!isContratoTipo || canManageContratos);
              // Obrigatório vale para qualquer comprador/vendedor (não só o 1º) — o corretor pode
              // adicionar quantos precisar, e cada um precisa dos seus próprios documentos.
              const partePessoal = parte.startsWith("comprador_") || parte.startsWith("vendedor_");
              const mostraObrigatorio = partePessoal || parte === "imovel";
              return (
                <Card key={`${parte}-${t.key}`} className={parteAccent}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{t.label}{obrigatorioEfetivo && mostraObrigatorio ? <span className="ml-1 text-destructive">*</span> : null}</div>
                        {t.key === "outros" && (
                          <div className="text-xs text-muted-foreground">Ex.: procuração, declaração de união estável, comprovante de renda, distrato, laudêmio, autorização de venda</div>
                        )}
                        {obrigatorioEfetivo && mostraObrigatorio && <div className="text-xs text-muted-foreground">Obrigatório</div>}
                        {dispensadoPorCnh && <div className="text-xs text-emerald-700 dark:text-emerald-400">Dispensado — CNH enviada</div>}
                        {cnhDispensadaPorRgCpf && <div className="text-xs text-emerald-700 dark:text-emerald-400">Dispensado — RG e CPF enviados</div>}
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
                  <Button size="sm" variant="outline" onClick={() => addParte("vendedor")}>+ Adicionar vendedor/proprietário</Button>
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
              {pendingDelete?.file_name} sairá da lista. Depois disso você pode enviar um novo arquivo — a IA fará a leitura novamente.
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
