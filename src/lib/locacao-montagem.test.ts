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
  campos: {
    fia_imovel_endereco: "Rua do Bem Fictício, 5",
    prop_sexo: "feminino",
    loc_sexo: "masculino",
    fia_sexo: "masculino",
  },
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
      locadores_adicionais_sexo: "feminino",
      locatarios_adicionais_sexo: "masculino",
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
    expect(faltasMontagem(base, montagem, { ...c, prop_sexo: "" })).toContain("sexo do locador");
  });
  it("gera PDF legível com fonte Unicode e dados totalmente fictícios", async () => {
    const c = { ...camposIniciais(base, montagem), data: "2027-01-01" };
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const logo = await readFile(
      new URL("../../public/remax-logo-transparent.png", import.meta.url),
    );
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
    const logo = await readFile(
      new URL("../../public/remax-logo-transparent.png", import.meta.url),
    );
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
    expect(textoContrato(baseLongo, montagem, c).join("\n")).toContain(
      "Vagas:\u00a0não\u00a0possui",
    );
  });
  it("calcula fim e valor por extenso de forma civil", () => {
    expect(fimPrazo("2027-01-01", 30)).toBe("2029-06-30");
    expect(reaisExtenso(2400.5)).toBe("dois mil e quatrocentos reais e cinquenta centavos");
  });
  it("1 locador homem → LOCADOR e brasileiro/solteiro", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "masculino",
      d_prop_nacionalidade: "brasileiro(a)",
      d_prop_estado_civil: "solteiro(a)",
    };
    const t = textoContrato(base, montagem, c).join("\n");
    expect(t).toMatch(/^LOCADOR:/m);
    expect(t).toContain("brasileiro");
    expect(t).toContain("solteiro");
    expect(t).not.toContain("LOCADORA");
    expect(t).not.toContain("brasileiro(a)");
    expect(t).not.toContain("LOCADOR (A)");
  });
  it("1 locadora mulher → LOCADORA e brasileira/solteira", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "feminino",
      d_prop_nacionalidade: "brasileiro(a)",
      d_prop_estado_civil: "solteiro(a)",
    };
    const t = textoContrato(base, montagem, c).join("\n");
    expect(t).toMatch(/^LOCADORA:/m);
    expect(t).toContain("brasileira");
    expect(t).toContain("solteira");
    expect(t).not.toContain("LOCADORES");
    expect(t).not.toContain("LOCADOR (A)");
  });
  it("casal locador H+M → LOCADORES", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "masculino",
      prop_conj_sexo: "feminino",
      d_prop_conj_nome: "Cônjuge Locadora (fictícia)",
      d_prop_conj_cpf: "CPF fictício cônjuge",
      d_prop_estado_civil: "casado(a)",
    };
    const t = textoContrato(base, montagem, c).join("\n");
    expect(t).toMatch(/^LOCADORES:/m);
    expect(t).toContain("Cônjuge Locadora (fictícia)");
    expect(t).not.toContain("LOCADORAS");
  });
  it("duas locatárias → LOCATÁRIAS", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      loc_sexo: "feminino",
      locatarios_adicionais: "Segunda Locatária (fictícia)",
      locatarios_adicionais_sexo: "feminino",
      d_loc_nacionalidade: "brasileiro(a)",
      d_loc_estado_civil: "solteiro(a)",
    };
    const t = textoContrato(base, montagem, c).join("\n");
    expect(t).toMatch(/^LOCATÁRIAS:/m);
    expect(t).toContain("AS LOCATÁRIAS");
    expect(t).not.toContain("LOCATÁRIO (A)");
    expect(t).not.toContain("O(s) LOCATÁRIO");
  });
  it("fiador e fiadora → FIADORES", () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      fia_sexo: "masculino",
      fia_conj_sexo: "feminino",
      d_fia_conj_nome: "Fiadora Cônjuge (fictícia)",
      d_fia_conj_cpf: "CPF fictício fiadora",
      d_fia_estado_civil: "casado(a)",
    };
    const t = textoContrato(base, montagem, c).join("\n");
    expect(t).toMatch(/^FIADORES:/m);
    expect(t).toContain("GARANTIA LOCATÍCIA - FIADORES:");
    expect(t).toContain("OS FIADORES");
    expect(t).toContain("OS FIADORES assumem");
    expect(t).toContain("OS FIADORES declaram");
    expect(t).toContain("OS FIADORES responderão");
    expect(t).not.toMatch(/OS FIADORES assume\b/);
    expect(t).not.toMatch(/OS FIADORES declara\b/);
    expect(t).not.toMatch(/OS FIADORES responderá\b/);
  });
  it("locador PJ mantém LOCADOR sem flexão por sexo", () => {
    const pj: LocacaoBase = {
      ...base,
      ficha: { ...base.ficha, proprietarioPessoa: "pj" },
    };
    const c = { ...camposIniciais(pj, montagem), data: "2027-01-01", prop_sexo: "" };
    expect(faltasMontagem(pj, montagem, c)).toEqual([]);
    const t = textoContrato(pj, montagem, c).join("\n");
    expect(t).toMatch(/^LOCADOR:/m);
    expect(t).not.toContain("LOCADORA");
    expect(t).toContain("Contrato de Garantia: FIADOR");
  });
  it("PDF v3 locadora, locatário e casal de fiadores sem barra o/a", async () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "feminino",
      loc_sexo: "masculino",
      fia_sexo: "masculino",
      fia_conj_sexo: "feminino",
      d_prop_nacionalidade: "brasileiro(a)",
      d_prop_estado_civil: "solteiro(a)",
      d_loc_nacionalidade: "brasileiro(a)",
      d_loc_estado_civil: "solteiro(a)",
      d_fia_nacionalidade: "brasileiro(a)",
      d_fia_estado_civil: "casado(a)",
      d_fia_conj_nome: "Fiadora Cônjuge Exemplo",
      d_fia_conj_cpf: "CPF fictício 2",
    };
    const texto = textoContrato(base, montagem, c).join("\n");
    expect(texto).toMatch(/^LOCADORA:/m);
    expect(texto).toMatch(/^LOCATÁRIO:/m);
    expect(texto).toMatch(/^FIADORES:/m);
    expect(texto).not.toMatch(/LOCADOR\s*\(\s*A\s*\)/);
    expect(texto).not.toMatch(/LOCATÁRIO\s*\(\s*[AS]\s*\)/);
    expect(texto).not.toMatch(/o\/a/i);
    expect(texto).not.toMatch(/brasileiro\/brasileira/i);
    expect(texto).not.toMatch(/solteiro\/solteira/i);
    expect(texto).not.toContain("brasileiro(a)");
    expect(texto).not.toContain("solteiro(a)");
    expect(texto).not.toContain("casado(a)");
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const logo = await readFile(
      new URL("../../public/remax-logo-transparent.png", import.meta.url),
    );
    const bytes = await gerarPdfContrato(textoContrato(base, montagem, c), fonte, {
      negrito,
      logo,
    });
    const tmp = join(tmpdir(), `locacao-v3-${process.pid}.pdf`);
    await writeFile(tmp, bytes);
    let extraido = "";
    try {
      extraido = execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8" });
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    expect(extraido).toContain("LOCADORA");
    expect(extraido).toContain("LOCATÁRIO");
    expect(extraido).toContain("FIADORES");
    expect(extraido).not.toMatch(/o\/a/i);
    expect(extraido).not.toMatch(/LOCADOR\s*\(\s*A\s*\)/);
    expect(extraido).not.toMatch(/\(s\)/i);
    if (process.env.EXEMPLO_PDF_V3_PATH) await writeFile(process.env.EXEMPLO_PDF_V3_PATH, bytes);
  });
  const PAPEL_PL = "(?:LOCADORES|LOCADORAS|LOCATÁRIOS|LOCATÁRIAS|FIADORES|FIADORAS)";
  const VERBO_SG =
    "(?:assume|declara|responderá|deverá|poderá|será|obriga-se|compromete-se|considera-se)";
  const VERBO_SG_APOS_PLURAL = new RegExp(`\\b(?:OS|AS)\\s+${PAPEL_PL}\\s+${VERBO_SG}\\b`);
  const VERBO_SG_ANTES_PLURAL = new RegExp(`\\b${VERBO_SG}\\s+(?:os|as|OS|AS)\\s+${PAPEL_PL}\\b`);
  async function pdfTexto(paragrafos: string[]) {
    const fonte = await readFile(new URL("../assets/fonts/DejaVuSans.ttf", import.meta.url));
    const negrito = await readFile(new URL("../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url));
    const logo = await readFile(
      new URL("../../public/remax-logo-transparent.png", import.meta.url),
    );
    const bytes = await gerarPdfContrato(paragrafos, fonte, { negrito, logo });
    const tmp = join(
      tmpdir(),
      `locacao-v4-${process.pid}-${Math.random().toString(16).slice(2)}.pdf`,
    );
    await writeFile(tmp, bytes);
    try {
      return {
        bytes,
        extraido: execFileSync("pdftotext", ["-layout", tmp, "-"], { encoding: "utf8" }),
      };
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  }
  it("PDF v5 plural: casal de locadores, duas locatárias, casal de fiadores", async () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "masculino",
      prop_conj_sexo: "feminino",
      loc_sexo: "feminino",
      locatarios_adicionais: "Segunda Locatária Exemplo (fictícia)",
      locatarios_adicionais_sexo: "feminino",
      fia_sexo: "masculino",
      fia_conj_sexo: "feminino",
      d_prop_nacionalidade: "brasileiro(a)",
      d_prop_estado_civil: "casado(a)",
      d_prop_conj_nome: "Cônjuge Locadora Exemplo",
      d_prop_conj_cpf: "CPF fictício cônjuge locadora",
      d_loc_nacionalidade: "brasileiro(a)",
      d_loc_estado_civil: "solteiro(a)",
      d_fia_nacionalidade: "brasileiro(a)",
      d_fia_estado_civil: "casado(a)",
      d_fia_conj_nome: "Fiadora Cônjuge Exemplo",
      d_fia_conj_cpf: "CPF fictício fiadora",
    };
    const paragrafos = textoContrato(base, montagem, c);
    const texto = paragrafos.join("\n");
    expect(texto).toMatch(/^LOCADORES:/m);
    expect(texto).toMatch(/^LOCATÁRIAS:/m);
    expect(texto).toMatch(/^FIADORES:/m);
    expect(texto).toContain("OS LOCADORES declaram");
    expect(texto).toContain("AS LOCATÁRIAS assumem");
    expect(texto).toContain("OS FIADORES assumem");
    expect(texto).toContain("OS FIADORES declaram");
    expect(texto).toContain("OS FIADORES responderão");
    expect(texto).toContain("comprometem-se as LOCATÁRIAS");
    expect(texto).toContain("Obrigam-se as LOCATÁRIAS");
    expect(texto).not.toMatch(VERBO_SG_APOS_PLURAL);
    expect(texto).not.toMatch(VERBO_SG_ANTES_PLURAL);
    expect(texto).not.toMatch(/o\/a/i);
    const { bytes, extraido } = await pdfTexto(paragrafos);
    expect(extraido).not.toMatch(VERBO_SG_APOS_PLURAL);
    expect(extraido).not.toMatch(VERBO_SG_ANTES_PLURAL);
    expect(extraido).not.toMatch(/o\/a/i);
    expect(extraido).toContain("LOCADORES");
    expect(extraido).toContain("LOCATÁRIAS");
    expect(extraido).toContain("FIADORES");
    if (process.env.EXEMPLO_PDF_V5_PLURAL_PATH)
      await writeFile(process.env.EXEMPLO_PDF_V5_PLURAL_PATH, bytes);
  });
  it("PDF v5 singular: locadora, locatário, um fiador", async () => {
    const c = {
      ...camposIniciais(base, montagem),
      data: "2027-01-01",
      prop_sexo: "feminino",
      loc_sexo: "masculino",
      fia_sexo: "masculino",
      d_prop_nacionalidade: "brasileiro(a)",
      d_prop_estado_civil: "solteiro(a)",
      d_loc_nacionalidade: "brasileiro(a)",
      d_loc_estado_civil: "solteiro(a)",
      d_fia_nacionalidade: "brasileiro(a)",
      d_fia_estado_civil: "solteiro(a)",
    };
    const paragrafos = textoContrato(base, montagem, c);
    const texto = paragrafos.join("\n");
    expect(texto).toMatch(/^LOCADORA:/m);
    expect(texto).toMatch(/^LOCATÁRIO:/m);
    expect(texto).toMatch(/^FIADOR:/m);
    expect(texto).toContain("A LOCADORA declara ser a legítima proprietária");
    expect(texto).toContain("O LOCATÁRIO assume");
    expect(texto).toContain("O FIADOR assume");
    expect(texto).toContain("O FIADOR declara");
    expect(texto).toContain("O FIADOR responderá");
    expect(texto).toContain("compromete-se o LOCATÁRIO");
    expect(texto).toContain("Obriga-se o LOCATÁRIO");
    expect(texto).not.toContain("OS FIADORES");
    expect(texto).not.toContain("LOCATÁRIAS");
    expect(texto).not.toMatch(/o\/a/i);
    expect(texto).not.toMatch(VERBO_SG_APOS_PLURAL);
    expect(texto).not.toMatch(VERBO_SG_ANTES_PLURAL);
    const { bytes, extraido } = await pdfTexto(paragrafos);
    expect(extraido).toContain("LOCADORA");
    expect(extraido).toContain("LOCATÁRIO");
    expect(extraido).toMatch(/\bFIADOR\b/);
    expect(extraido).not.toMatch(VERBO_SG_APOS_PLURAL);
    expect(extraido).not.toMatch(VERBO_SG_ANTES_PLURAL);
    expect(extraido).not.toMatch(/o\/a/i);
    if (process.env.EXEMPLO_PDF_V5_SINGULAR_PATH)
      await writeFile(process.env.EXEMPLO_PDF_V5_SINGULAR_PATH, bytes);
  });
});
