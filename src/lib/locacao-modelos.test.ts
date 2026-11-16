import { describe, expect, it } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  CAMPOS_MODELO,
  CHAVES_MODELO,
  NOMES_BLOCOS_MODELO,
  camposDesconhecidos,
  modeloPadrao,
  travadosMudaram,
  validarModelo,
} from "./locacao-modelos";
import {
  camposIniciais,
  faltasMontagem,
  gerarPdfContrato,
  textoContrato,
  type LocacaoBase,
  type Montagem,
} from "./locacao-montagem";

// Apenas pessoas, documentos, datas, endereços e números FICTÍCIOS. Nenhum dado original chega a este teste.
const dados: Record<string, string> = {
  prop_nome: "Locadora Teste", prop_cpf: "CPF fictício", prop_rg: "RG fictício",
  prop_nacionalidade: "brasileira", prop_estado_civil: "solteira",
  prop_profissao: "professora", prop_endereco: "Rua Fictícia, 1",
  loc_nome: "Locatário Teste", loc_cpf: "CPF fictício", loc_rg: "RG fictício",
  loc_nacionalidade: "brasileira", loc_estado_civil: "solteiro",
  loc_profissao: "professor", loc_endereco: "Rua Fictícia, 2",
  fia_nome: "Fiador Teste", fia_cpf: "CPF fictício", fia_rg: "RG fictício",
  fia_nacionalidade: "brasileira", fia_estado_civil: "solteiro",
  fia_profissao: "professor", fia_endereco: "Rua Fictícia, 3",
  fia_matricula: "MATRÍCULA-FICTÍCIA", fia_cartorio: "Cartório Fictício",
  imv_vagas: "uma", imv_inscricao: "IM-FICTÍCIO", imv_energia: "EN-FICTÍCIO",
  imv_agua: "AG-FICTÍCIO", imv_gas: "cobrado no condomínio",
  prazo_meses: "30", inicio: "2027-01-01", dia_vencimento: "10",
  cau_tipo: "dinheiro", cau_valor: "3000.00", cau_meses: "1",
  cau_forma: "depósito identificado", cau_favorecido: "Imobiliária Teste",
  cauc_nome: "Caucionante Teste", cauc_cpf: "CPF fictício", cauc_rg: "RG fictício",
  cauc_nacionalidade: "brasileira", cauc_estado_civil: "solteira",
  cauc_profissao: "professora", cauc_endereco: "Rua Fictícia, 4",
  cauc_imovel_descricao: "Imóvel fictício na Rua Fictícia, 5",
  cauc_imovel_matricula: "MATRÍCULA-FICTÍCIA-2", cauc_imovel_cartorio: "Cartório Fictício",
  loft_numero: "REF-FICTÍCIA",
};
const org = {
  nome: "Imobiliária Teste", cnpj: "CNPJ fictício", creci: "CRECI fictício",
  cidade: "Cidade Fictícia", uf: "XX",
};
function caso(chave: string, tipo = "residencial", apolice = "") {
  const garantia = chave === "loft" ? "loft" : chave.startsWith("seguro_") ? "seguro_fianca"
    : chave === "fiador" ? "fiador" : "caucao";
  const base: LocacaoBase = {
    codigo: `TESTE-${chave}`, endereco: "Rua Fictícia, 99",
    aluguel: 3000, taxaAdm: 10, tipo, garantia,
    ficha: { imovelId: "IM-FICTÍCIO", proprietario: { nome: dados.prop_nome } },
  };
  const contrato = { ...dados,
    cau_tipo: chave === "caucao_imovel" ? "imovel" : "dinheiro",
    seg_seguradora: chave.startsWith("seguro_") ? chave.slice(7) : "",
    seg_apolice: apolice,
  };
  const m: Montagem = {
    campos: { prop_sexo: "feminino", loc_sexo: "masculino", fia_sexo: "masculino",
      fia_imovel_endereco: "Rua Fictícia, 3" },
    contrato, administradora: org,
    modelos: { [chave]: modeloPadrao(chave as (typeof CHAVES_MODELO)[number]) },
  };
  const c = { ...camposIniciais(base, m), data: "2027-01-01" };
  return { base, m, c };
}

describe("modelos do Pacote 4, dados sintéticos", () => {
  it("o editor aceita todos os padrões e rejeita campo inexistente", () => {
    for (const chave of CHAVES_MODELO) {
      const modelo = modeloPadrao(chave);
      expect(validarModelo(chave, modelo.paragrafos), chave).toEqual([]);
    }
    const m = modeloPadrao("fiador");
    expect(camposDesconhecidos("Texto [CAMPO_NAO_EXISTE]")).toEqual(["CAMPO_NAO_EXISTE"]);
    expect(validarModelo("fiador", [...m.paragrafos, { id: "x101", t: "[CAMPO_NAO_EXISTE]" }]))
      .toContain("Cláusula 101: campo que não existe [CAMPO_NAO_EXISTE].");
    expect(CAMPOS_MODELO.length).toBeGreaterThan(10);
    expect(NOMES_BLOCOS_MODELO).toContain("ASSINATURAS");
  });
  it("detecta a alteração de texto exigido por seguradora ou Loft", () => {
    for (const chave of ["seguro_porto", "seguro_pottencial", "seguro_tokio", "seguro_almada", "loft"] as const) {
      const ps = modeloPadrao(chave).paragrafos;
      expect(travadosMudaram(ps, ps)).toBe(false);
      const alterados = ps.map((p) => p.trava ? { ...p, t: p.t + " mudança" } : p);
      expect(travadosMudaram(ps, alterados)).toBe(true);
    }
  });
  it("gera os oito modelos residenciais e o caucionamento comercial; apólice opcional e texto travado intacto", async () => {
    const dir = process.env.PACOTE4_PDF_DIR;
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    if (dir) await mkdir(dir, { recursive: true });
    for (const chave of CHAVES_MODELO) {
      const tipo = chave === "caucao_imovel" ? "comercial" : "residencial";
      const { base, m, c } = caso(chave, tipo);
      expect(faltasMontagem(base, m, c), chave).toEqual([]);
      const ps = textoContrato(base, m, c);
      const texto = ps.join("\n");
      expect(texto, chave).toContain(base.endereco);
      expect(texto, chave).not.toMatch(/\[\[|\[(?:[A-Z_]{3,})\]/);
      for (const original of modeloPadrao(chave).paragrafos.filter((p) => p.trava))
        expect(ps, `${chave}: texto exigido mudou`).toContain(original.t);
      if (chave.startsWith("seguro_")) expect(texto).toContain("APÓLICE: a ser anexada");
      const bytes = await gerarPdfContrato(ps, fonte, { negrito });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount(), chave).toBeGreaterThan(1);
      if (dir) await writeFile(join(dir, `pacote4-${chave}-${tipo}-FICTICIO.pdf`), bytes);
    }
  }, 240000);
  it("comercial reaproveitado troca só o bloco de destinação, sem inventar seguro comercial original", () => {
    for (const chave of CHAVES_MODELO) {
      const { base, m, c } = caso(chave, "comercial");
      expect(faltasMontagem(base, m, c), chave).toEqual([]);
      const texto = textoContrato(base, m, c).join("\n");
      expect(texto).toContain("COMERCIAL");
      expect(texto).not.toContain("finalidade o uso para HABITAÇÃO");
      expect(texto).not.toMatch(/\[\[|\[(?:[A-Z_]{3,})\]/);
    }
  });
  it("exige campos específicos, mas não bloqueia montagem por apólice ainda não emitida", () => {
    const { base, m, c } = caso("seguro_porto");
    expect(faltasMontagem(base, m, c)).toEqual([]);
    expect(textoContrato(base, m, c).join("\n")).toContain("a ser anexada");
    expect(faltasMontagem(base, m, { ...c, d_seg_seguradora: "" })).toContain("seguradora");
    const com = caso("seguro_porto", "residencial", "APOLICE-FICTICIA");
    expect(textoContrato(com.base, com.m, com.c).join("\n")).toContain("nº APOLICE-FICTICIA, conforme anexo");
    const caucao = caso("caucao_imovel", "comercial");
    expect(faltasMontagem(caucao.base, caucao.m, { ...caucao.c, d_cauc_imovel_matricula: "" }))
      .toContain("matrícula do imóvel caucionado");
  });
});
