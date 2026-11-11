import { describe, expect, it } from "vitest";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  CAMPOS_DOCUMENTO,
  camposIniciais,
  dadosContrato,
  faltasMontagem,
  fimPrazo,
  gerarPdfContrato,
  reaisExtenso,
  textoContrato,
  type LocacaoBase,
  type Montagem,
} from "./locacao-montagem";

const base: LocacaoBase = {
  codigo: "TESTE-001",
  endereco: "Rua Inventada, 1 - Cidade Exemplo/XX",
  aluguel: 2400,
  taxaAdm: 10,
  tipo: "residencial",
  garantia: "fiador",
  ficha: {
    imovelId: "IM-EXEMPLO",
    locatarioEndereco: "Rua do Locatário (fictícia), 2",
    proprietario: { nome: "Locadora Exemplo" },
  },
};
const dados: Record<string, string> = {
  loc_nome: "Locatário Fictício",
  loc_cpf: "CPF fictício",
  loc_rg: "RG fictício",
  loc_nacionalidade: "brasileira",
  loc_estado_civil: "solteiro",
  loc_profissao: "analista",
  loc_endereco: "Rua do Locatário (fictícia), 2",
  prop_nome: "Locadora Exemplo",
  prop_cpf: "CPF fictício",
  prop_rg: "RG fictício",
  prop_nacionalidade: "brasileira",
  prop_estado_civil: "solteira",
  prop_profissao: "professora",
  prop_endereco: "Rua da Locadora (fictícia), 3",
  fia_nome: "Fiador Exemplo",
  fia_cpf: "CPF fictício",
  fia_rg: "RG fictício",
  fia_nacionalidade: "brasileira",
  fia_estado_civil: "solteiro",
  fia_profissao: "contador",
  fia_endereco: "Rua do Fiador (fictícia), 4",
  fia_matricula: "MATRÍCULA FICTÍCIA",
  fia_cartorio: "Cartório Exemplo",
  imv_vagas: "não possui",
  imv_inscricao: "INSCRIÇÃO FICTÍCIA",
  imv_energia: "CÓDIGO FICTÍCIO",
  imv_agua: "CÓDIGO FICTÍCIO",
  imv_gas: "cobrado no condomínio",
  inicio: "2027-01-01",
  prazo_meses: "30",
  dia_vencimento: "10",
  moradores: "Moradora Exemplo (fictícia)",
};
const montagem: Montagem = {
  campos: { fia_imovel_endereco: "Rua do Bem Fictício, 5" },
  contrato: dados,
  administradora: {
    nome: "Imobiliária Exemplo",
    cnpj: "CNPJ fictício",
    creci: "CRECI fictício",
    cidade: "Cidade Exemplo",
    uf: "XX",
  },
};

describe("montagem residencial com fiador", () => {
  it("prefill da ficha e documentos, com correção isolada na montagem", () => {
    const c = camposIniciais(base, montagem);
    expect(c.imovel_endereco).toBe(base.endereco);
    expect(c.aluguel).toBe("2400.00");
    expect(c.d_loc_nome).toBe("Locatário Fictício");
    expect(c.d_prop_nome).toBe("Locadora Exemplo");
    expect(c.repasse_taxa).toBe("10");
    expect(c.local).toBe("Cidade Exemplo/XX");
    expect(Object.keys(CAMPOS_DOCUMENTO)).toContain("fia_matricula");
    const editado = {
      ...c,
      d_fia_nome: "Fiador Corrigido (fictício)",
      aluguel: "2600.50",
      data: "2027-01-01",
    };
    expect(dadosContrato(montagem, editado).fia_nome).toBe("Fiador Corrigido (fictício)");
    expect(montagem.contrato.fia_nome).toBe("Fiador Exemplo");
    expect(textoContrato(base, montagem, editado).join("\n")).toContain(
      "dois mil e seiscentos reais e cinquenta centavos",
    );
  });
  it("gera variáveis e mantém cláusulas padrão sem expor dados de outras imobiliárias", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      locadores_adicionais: "Segunda Locadora (fictícia)",
      locatarios_adicionais: "Segundo Locatário (fictício)",
    };
    const texto = textoContrato(base, montagem, c).join("\n");
    for (const trecho of [
      base.codigo,
      base.endereco,
      dados.imv_inscricao,
      dados.fia_matricula,
      dados.fia_cartorio,
      dados.imv_gas,
      dados.moradores,
      "Segunda Locadora",
      "Segundo Locatário",
      "1% (um por cento)",
      "10% (dez por cento)",
      "IPCA",
      "R$ 250,00",
      "R$ 150,00",
      "200x",
      "30 (trinta) dias",
      montagem.administradora.nome,
    ]) {
      expect(texto).toContain(trecho);
    }
    expect(texto).not.toContain("{{fia_matricula}}");
    expect(texto).not.toContain("Imobiliária de outra empresa");
  });
  it("bloqueia PDF incompleto ou condições diferentes do texto legal", () => {
    const c = { ...camposIniciais(base, montagem), data: "2027-01-01" };
    expect(faltasMontagem(base, montagem, c)).toEqual([]);
    expect(faltasMontagem(base, montagem, { ...c, d_fia_matricula: "" })).toContain(
      "matrícula do fiador",
    );
    expect(() => textoContrato(base, montagem, { ...c, d_fia_matricula: "" })).toThrow(
      /incompleto/,
    );
    expect(() => textoContrato({ ...base, garantia: "caucao" }, montagem, c)).toThrow();
    expect(faltasMontagem(base, montagem, { ...c, reajuste: "IGP-M" })).toContain(
      "condições diferentes do modelo residencial (revisão jurídica necessária)",
    );
  });
  it("gera PDF legível com fonte Unicode e dados totalmente fictícios", async () => {
    const c = { ...camposIniciais(base, montagem), data: "2027-01-01" };
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const logo = await readFile(new URL("../../public/remax-logo-transparent.png", import.meta.url));
    const bytes = await gerarPdfContrato(textoContrato(base, montagem, c), fonte, {
      negrito,
      logo,
    });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(bytes.byteLength).toBeGreaterThan(10000);
    const texto = textoContrato(base, montagem, c).join("\n");
    expect(texto).not.toContain("RG RG");
    expect(texto).not.toContain("CPF CPF");
    expect(texto).not.toContain("CNPJ CNPJ");
    expect(texto).not.toContain("CRECI CRECI");
    if (process.env.EXEMPLO_PDF_PATH) await writeFile(process.env.EXEMPLO_PDF_PATH, bytes);
  });
  it("não repete CRECI quando o cadastro já traz o rótulo", () => {
    const c = { ...camposIniciais(base, montagem), data: "2027-01-01" };
    const comRotulo = textoContrato(base, montagem, c).join("\n");
    expect(comRotulo).toContain("CRECI fictício");
    expect(comRotulo).not.toContain("CRECI CRECI");
    const soNumero = {
      ...montagem,
      administradora: { ...montagem.administradora, creci: "29.886-J" },
    };
    const tNumero = textoContrato(base, soNumero, c).join("\n");
    expect(tNumero).toContain("CRECI 29.886-J");
    expect(tNumero).not.toContain("CRECI CRECI");
    const comDoisPontos = {
      ...montagem,
      administradora: { ...montagem.administradora, creci: "CRECI: 29.886-J" },
    };
    const tDois = textoContrato(base, comDoisPontos, c).join("\n");
    expect(tDois).toContain("CRECI: 29.886-J");
    expect(tDois).not.toContain("CRECI CRECI");
  });
  it("mantém Vagas e o valor na mesma página do PDF", async () => {
    const baseLongo: LocacaoBase = {
      ...base,
      endereco: "Rua Fictícia das Flores, 100 — Ap 11, Sorocaba/SP [exemplo-layout]",
    };
    const c = { ...camposIniciais(baseLongo, montagem), data: "2027-01-01" };
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const logo = await readFile(new URL("../../public/remax-logo-transparent.png", import.meta.url));
    const bytes = await gerarPdfContrato(textoContrato(baseLongo, montagem, c), fonte, {
      negrito,
      logo,
    });
    const tmp = join(tmpdir(), `locacao-vagas-${process.pid}.pdf`);
    await writeFile(tmp, bytes);
    let extraido = "";
    try {
      extraido = execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8" });
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    const normal = extraido.replace(/\u00a0/g, " ");
    expect(normal).toMatch(/Vagas:\s*não possui/);
    expect(normal).not.toMatch(/Vagas:[\s\S]*?1 de \d+[\s\S]*?possui/);
    expect(textoContrato(baseLongo, montagem, c).join("\n")).toContain("Vagas:\u00a0não\u00a0possui");
  });
  it("calcula fim e valor por extenso de forma civil", () => {
    expect(fimPrazo("2027-01-01", 30)).toBe("2029-06-30");
    expect(reaisExtenso(2400.5)).toBe("dois mil e quatrocentos reais e cinquenta centavos");
  });
});
