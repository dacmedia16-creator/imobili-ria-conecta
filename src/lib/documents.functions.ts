import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const ExtractInput = z.object({ documentId: z.string().uuid() });
const ApplyInput = z.object({ saleId: z.string().uuid() });

/**
 * Extrai dados estruturados de um documento anexado usando a API do Google Gemini.
 * Salva o resultado em `document_extractions` para uso posterior no preenchimento.
 */
export const extractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExtractInput.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");

    const supabase = context.supabase as any;

    const { data: doc, error: docErr } = await supabase
      .from("sale_documents")
      .select("id, sale_id, storage_path, file_name, tipo, parte")
      .eq("id", data.documentId)
      .maybeSingle();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Documento não encontrado");
    if (!doc.storage_path || !doc.file_name) throw new Error("Documento sem arquivo associado");

    await supabase.from("sale_documents").update({ extraction_status: "pending" }).eq("id", doc.id);
    await supabase
      .from("document_extractions")
      .upsert({ document_id: doc.id, sale_id: doc.sale_id, status: "pending", error: null }, { onConflict: "document_id" });

    // Baixa o arquivo do storage (bucket privado — cliente autenticado do usuário)
    const { data: blob, error: dlErr } = await supabase.storage.from("sale-documents").download(doc.storage_path);
    if (dlErr || !blob) {
      await markFailed(supabase, doc.id, dlErr?.message ?? "Falha ao baixar arquivo");
      return { ok: false as const, error: dlErr?.message ?? "Falha ao baixar arquivo" };
    }

    const buf = Buffer.from(await blob.arrayBuffer());
    const b64 = buf.toString("base64");
    const ext = (doc.file_name.split(".").pop() ?? "").toLowerCase();
    const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";

    const prompt = buildPromptForType(doc.tipo, doc.file_name, doc.parte);

    const callGemini = async (): Promise<any> => {
      const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: "Você extrai dados estruturados de documentos brasileiros (RG, CPF, comprovantes, matrícula de imóvel, IPTU, certidões). Responda APENAS com JSON válido, sem markdown, sem comentários." }],
          },
          contents: [{
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: b64 } },
            ],
          }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        const err: any = new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
        // 429 (cota) não adianta tentar de novo na hora; erro 5xx costuma ser transiente do servidor.
        err.retryable = res.status >= 500;
        throw err;
      }
      const json = await res.json();
      const finishReason = json.candidates?.[0]?.finishReason;
      const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = safeParseJson(text);
      if (!parsed) {
        const err: any = new Error(
          finishReason && finishReason !== "STOP"
            ? `Resposta incompleta da IA (${finishReason})`
            : "Resposta não é JSON válido",
        );
        err.retryable = true;
        throw err;
      }
      return parsed;
    };

    let raw: any = null;
    try {
      try {
        raw = await callGemini();
      } catch (err: any) {
        if (!err?.retryable) throw err;
        raw = await callGemini(); // uma segunda tentativa: falhas de parse/corte costumam ser passageiras
      }
    } catch (err: any) {
      await markFailed(supabase, doc.id, err?.message ?? "Falha na extração");
      return { ok: false as const, error: err?.message ?? "Falha na extração" };
    }

    await supabase
      .from("document_extractions")
      .upsert(
        { document_id: doc.id, sale_id: doc.sale_id, status: "done", raw_json: raw, error: null },
        { onConflict: "document_id" },
      );
    await supabase.from("sale_documents").update({ extraction_status: "done" }).eq("id", doc.id);

    return { ok: true as const, data: raw };
  });

/**
 * Aplica os dados extraídos aos campos da venda / partes / pagamento,
 * preenchendo APENAS campos ainda vazios (nunca sobrescreve dados do usuário).
 * Retorna a lista de campos preenchidos.
 */
export const applySaleExtractions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ApplyInput.parse(input))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as any;
    const filled: string[] = [];

    const { data: extractions } = await supabase
      .from("document_extractions")
      .select("raw_json, sale_documents(tipo, parte)")
      .eq("sale_id", data.saleId)
      .eq("status", "done");

    if (!extractions?.length) return { filled };

    // Merge: acumula sugestões por escopo
    const salePatch: Record<string, any> = {};
    const paymentPatch: Record<string, any> = {};
    const partiesPatch: Record<string, Record<string, any>> = {};

    for (const ext of extractions as any[]) {
      const r = ext.raw_json ?? {};
      const tipo: string = ext.sale_documents?.tipo ?? "outros";
      const parte: string = ext.sale_documents?.parte ?? "outros";

      // Campos do imóvel (matrícula, IPTU) — só se documento é do imóvel/outros
      if (parte === "imovel" || parte === "outros") {
        assign(salePatch, "matricula", r.matricula ?? r.numero_matricula);
        assign(salePatch, "imovel_id", r.codigo_imovel);
        assign(salePatch, "iptu", r.iptu ?? r.numero_iptu ?? r.inscricao_iptu);
        if (r.valor_venal) assign(salePatch, "valor_anunciado", num(r.valor_venal));
        if (r.valor_negociado) assign(salePatch, "valor_negociado", num(r.valor_negociado));
        if (r.observacoes_imovel) assign(salePatch, "imovel_observacoes", r.observacoes_imovel);

        // Pagamento (só de docs do imóvel/contrato/outros)
        if (r.entrada_valor) assign(paymentPatch, "entrada_valor", num(r.entrada_valor));
        if (r.financiamento_valor) {
          assign(paymentPatch, "financiamento", true);
          assign(paymentPatch, "financiamento_valor", num(r.financiamento_valor));
        }
        if (r.forma_pagamento) assign(salePatch, "forma_pagamento", r.forma_pagamento);
      }

      // Partes — a "parte" do documento decide o papel (comprador_1/2 ou vendedor_1/2).
      // Documentos do imóvel/outros não alimentam partes, exceto se tiverem nome_proprietario (vendedor_1).
      let papel: string | null = null;
      if (parte === "comprador_1" || parte === "comprador_2" || parte === "vendedor_1" || parte === "vendedor_2") {
        papel = parte;
      } else if (r.nome_proprietario) papel = "vendedor_1"; // matrícula com proprietário → vendedor


      if (papel) {
        const nome = r.nome ?? r.nome_completo ?? (papel === "vendedor_1" ? r.nome_proprietario : null);
        const rg = r.rg ?? r.numero_rg;
        const cpf = r.cpf ?? r.cpf_cnpj ?? r.cnpj ?? (papel === "vendedor_1" ? r.cpf_proprietario : null);
        const prof = r.profissao;
        const email = r.email;
        const tel = r.telefone ?? r.celular;
        if (nome || rg || cpf || prof || email || tel) {
          const p = (partiesPatch[papel] ??= {});
          assign(p, "nome", nome);
          assign(p, "rg", rg);
          assign(p, "cpf_cnpj", cpf);
          assign(p, "profissao", prof);
          assign(p, "email", email);
          assign(p, "telefone", tel);
        }
      }
    }


    // Aplica na venda (só campos vazios)
    if (Object.keys(salePatch).length) {
      const { data: cur } = await supabase.from("sales").select("*").eq("id", data.saleId).maybeSingle();
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(salePatch)) {
        if (v == null || v === "") continue;
        if (cur?.[k] == null || cur?.[k] === "") { patch[k] = v; filled.push(`sale.${k}`); }
      }
      if (Object.keys(patch).length) await supabase.from("sales").update(patch).eq("id", data.saleId);
    }

    // Pagamento (upsert)
    if (Object.keys(paymentPatch).length) {
      const { data: pay } = await supabase.from("sale_payment").select("*").eq("sale_id", data.saleId).maybeSingle();
      const patch: Record<string, any> = { sale_id: data.saleId };
      let any = false;
      for (const [k, v] of Object.entries(paymentPatch)) {
        if (v == null || v === "") continue;
        if (!pay || pay[k] == null || pay[k] === "") { patch[k] = v; filled.push(`payment.${k}`); any = true; }
      }
      if (any) {
        if (pay) await supabase.from("sale_payment").update(patch).eq("sale_id", data.saleId);
        else await supabase.from("sale_payment").insert(patch);
      }
    }

    // Partes
    for (const [papel, fields] of Object.entries(partiesPatch)) {
      const { data: cur } = await supabase.from("sale_parties").select("*").eq("sale_id", data.saleId).eq("papel", papel).maybeSingle();
      const patch: Record<string, any> = {};
      let any = false;
      for (const [k, v] of Object.entries(fields)) {
        if (v == null || v === "") continue;
        if (!cur || cur[k] == null || cur[k] === "") { patch[k] = v; filled.push(`${papel}.${k}`); any = true; }
      }
      if (any) {
        if (cur) await supabase.from("sale_parties").update(patch).eq("id", cur.id);
        else await supabase.from("sale_parties").insert({ sale_id: data.saleId, papel, ...patch });
      }
    }

    return { filled };
  });

// ---------------- helpers ----------------

async function markFailed(supabase: any, docId: string, err: string) {
  await supabase.from("sale_documents").update({ extraction_status: "failed" }).eq("id", docId);
  await supabase
    .from("document_extractions")
    .upsert({ document_id: docId, status: "failed", error: err }, { onConflict: "document_id" });
}

function assign(obj: Record<string, any>, key: string, val: any) {
  if (val == null || val === "") return;
  if (obj[key] == null || obj[key] === "") obj[key] = val;
}

function num(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function safeParseJson(text: string): any | null {
  const t = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function buildPromptForType(tipo: string, filename: string, parte: string): string {
  const pessoaLabel =
    parte === "comprador_1" ? "1º CLIENTE COMPRADOR" :
    parte === "comprador_2" ? "2º CLIENTE COMPRADOR" :
    parte === "vendedor_1" ? "1º CLIENTE VENDEDOR" :
    parte === "vendedor_2" ? "2º CLIENTE VENDEDOR" : null;
  const parteHint =
    pessoaLabel
      ? `\n\nATENÇÃO: Este documento pertence ao ${pessoaLabel} da venda. Os dados pessoais extraídos devem ser atribuídos a essa pessoa.`
      : parte === "imovel"
      ? "\n\nATENÇÃO: Este documento é do IMÓVEL (não é documento pessoal)."
      : "";
  const base = `Documento: ${filename} (tipo declarado: ${tipo}).${parteHint}\n\nExtraia os campos abaixo do documento. Se um campo não estiver presente, use null. Responda em JSON puro (sem markdown).`;
  const commonPessoal = `\n\nCampos pessoais possíveis:
{
  "nome": string|null,
  "cpf": string|null,
  "rg": string|null,
  "data_nascimento": string|null,
  "estado_civil": string|null,
  "profissao": string|null,
  "endereco": string|null,
  "email": string|null,
  "telefone": string|null
}`;
  const commonImovel = `\n\nCampos do imóvel possíveis:
{
  "matricula": string|null,
  "codigo_imovel": string|null,
  "iptu": string|null,
  "inscricao_iptu": string|null,
  "endereco_imovel": string|null,
  "area_total": string|null,
  "area_construida": string|null,
  "valor_venal": string|null,
  "nome_proprietario": string|null,
  "cpf_proprietario": string|null,
  "observacoes_imovel": string|null
}`;
  if (pessoaLabel) return base + commonPessoal;
  if (parte === "imovel") return base + commonImovel;
  if (tipo === "rg" || tipo === "cpf" || tipo === "certidao" || tipo === "comprovante_endereco") return base + commonPessoal;
  if (tipo === "matricula" || tipo === "iptu") return base + commonImovel;
  return base + commonPessoal + commonImovel;
}


