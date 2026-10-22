import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validarDocsAprovadosParaJuridico } from "./status";
import { captacaoDoProprioGestor } from "./captacoes-painel";
import type { DocumentRow } from "@/lib/database.types";

// Denis 22/10/2026 (t_83e2ee96): gestor/team leader não aprova os próprios documentos (venda e
// captação que ele mesmo criou) e segue direto para o próximo passo.

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const PARTE_RE = /^doc_(.+)_((?:comprador|vendedor)_\d+)$/;

/** Um documento para cada obrigatório de uma venda vazia, todos com o mesmo status. */
function docsCompletos(status: DocumentRow["status"]): DocumentRow[] {
  return validarDocsAprovadosParaJuridico({}, []).map((p, i) => {
    const m = PARTE_RE.exec(p.campo);
    return {
      id: `d${i}`,
      tipo: m ? m[1] : p.campo.replace(/^doc_/, ""),
      parte: m ? m[2] : "outros",
      status,
    } as DocumentRow;
  });
}

describe("venda — documentos do próprio gestor/TL", () => {
  it("venda de outro corretor: documento só enviado ainda barra (precisa aprovar)", () => {
    const pend = validarDocsAprovadosParaJuridico({}, docsCompletos("enviado"));
    expect(pend.length).toBeGreaterThan(0);
    expect(pend[0].mensagem).toMatch(/^Falta aprovar /);
  });

  it("venda de outro corretor: tudo aprovado passa", () => {
    expect(validarDocsAprovadosParaJuridico({}, docsCompletos("aprovado"))).toEqual([]);
  });

  it("venda do próprio gestor/TL: documentos enviados bastam", () => {
    expect(validarDocsAprovadosParaJuridico({}, docsCompletos("enviado"), true)).toEqual([]);
    expect(validarDocsAprovadosParaJuridico({}, docsCompletos("pendente"), true)).toEqual([]);
  });

  it("venda do próprio gestor/TL: documento recusado ou faltando continua barrando", () => {
    const recusados = validarDocsAprovadosParaJuridico({}, docsCompletos("recusado"), true);
    expect(recusados.length).toBe(docsCompletos("recusado").length);
    const faltando = validarDocsAprovadosParaJuridico({}, docsCompletos("enviado").slice(1), true);
    expect(faltando).toHaveLength(1);
    expect(faltando[0].mensagem).toMatch(/^Falta enviar /);
  });

  it("tela: só o dono/criador gestor usa a regra; envio continua indo direto ao jurídico", () => {
    const tela = ler("../routes/_authenticated/vendas.$id.tsx");
    expect(tela).toContain(
      "const docsDoProprioGestor = isGestor && (isOwner || isCriadorDaVenda);",
    );
    expect(tela).toMatch(
      /validarDocsAprovadosParaJuridico\(\s*parties,\s*docs,\s*docsDoProprioGestor,\s*\)/,
    );
    expect(tela).toContain("const envioDiretoJuridico = isOwnerGestor || gestorDaEquipeRascunho;");
    expect(tela).toContain('await changeStatus("aprovada_gestor");');
  });
});

describe("captação — envio do próprio gestor/TL", () => {
  const cap = { captor_id: "u1", manual: false };
  it("gestor/TL captador: sim", () => {
    expect(captacaoDoProprioGestor(cap, "u1", true)).toBe(true);
  });
  it("corretor captador (não gestor): não — continua 'Enviar ao gestor'", () => {
    expect(captacaoDoProprioGestor(cap, "u1", false)).toBe(false);
  });
  it("gestor olhando captação de outro corretor: não", () => {
    expect(captacaoDoProprioGestor(cap, "u2", true)).toBe(false);
    expect(captacaoDoProprioGestor(cap, undefined, true)).toBe(false);
  });
  it("cadastro manual (sem PDF gerado): não", () => {
    expect(captacaoDoProprioGestor({ ...cap, manual: true }, "u1", true)).toBe(false);
  });
  it("tela: botão diz o próximo passo e o envio gera o PDF logo depois", () => {
    const tela = ler("../routes/_authenticated/exclusividades.$id.tsx");
    expect(tela).toContain('"Enviar e gerar PDF para assinatura"');
    expect(tela).toMatch(
      /name === "enviar" && proprioGestor[\s\S]{0,80}gerarPdfAssinatura\(false\)/,
    );
  });
});
