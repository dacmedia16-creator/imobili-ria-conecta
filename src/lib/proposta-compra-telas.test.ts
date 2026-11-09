// @vitest-environment jsdom
/**
 * Proposta de compra 2/3 — telas (cartão t_da0dac53). Dados fictícios; nenhuma rede, nenhum WhatsApp.
 * - aba "Propostas" da captação: some com o módulo desligado; histórico com data, comprador, valor, corretor,
 *   situação e validade; "Nova proposta" cria o rascunho (captação + lead) pelo banco;
 * - Nova proposta: preenchimento automático (selos), PF/PJ, cônjuge pelo estado civil, validade padrão 5 dias;
 * - PDF: marca da imobiliária, texto oficial (t_b4e7c368) com a marca "Minuta" do advogado, página
 *   "Comprovação das assinaturas" com o código do documento só no PDF final;
 * - Assinaturas: situação de cada parte, Reenviar, todas as situações, recusa com motivo, contraproposta;
 * - Aceita: "Criar venda em rascunho" só no clique (e confirmação);
 * - Página pública: noindex, proposta inteira, código + "Li e concordo";
 * - "O que fazer hoje": proposta vencendo e parte sem assinar.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { rpc, fromSelect, toast, navigate, enviarProposta, lerPropostaLink, assinarPropostaLink } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    fromSelect: vi.fn(async () => ({ data: [], error: null })),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    navigate: vi.fn(),
    enviarProposta: vi.fn(),
    lerPropostaLink: vi.fn(),
    assinarPropostaLink: vi.fn(),
  }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => fromSelect() }) }),
      }),
    }),
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: {
      from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: "" } }) }),
    },
  },
}));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) =>
    createElement("a", { href: to }, children as never),
  createFileRoute: () => (o: unknown) => o,
  redirect: (o: unknown) => o,
  useNavigate: () => navigate,
}));
vi.mock("@/lib/proposta-compra.functions", () => ({
  enviarProposta: (...a: unknown[]) => enviarProposta(...a),
  lerPropostaLink: (...a: unknown[]) => lerPropostaLink(...a),
  assinarPropostaLink: (...a: unknown[]) => assinarPropostaLink(...a),
}));
vi.mock("@/lib/agency-brand", () => ({
  loadCurrentAgencyBrand: async () => ({ id: "o", nome: "RE/MAX Teste", pdfLogoUrl: null }),
  logoForPdf: async () => null,
}));

import { PropostasCaptacao } from "@/components/proposta-compra/PropostasCaptacao";
import { ItemPendenciaProposta } from "@/components/proposta-compra/PendenciasPropostas";
import { usePendenciasPropostas } from "@/components/proposta-compra/usePendenciasPropostas";
import { PropostaConteudo, Route as RotaInterna } from "@/routes/_authenticated/propostas.$id";
import { PropostaLink, Route as RotaPublica } from "@/routes/proposta.$token";
import {
  acoes,
  ajustarConjuges,
  aparelho,
  dadosParaSalvar,
  errosDoForm,
  formDoDetalhe,
  lerComprovacao,
  lerDetalhe,
  lerLista,
  lerPendencias,
  lerValor,
  mascararIp,
  mascararTelefone,
  situacaoParte,
  textoValidade,
  textoDoDetalhe,
} from "@/lib/proposta-compra-tela";
import { buildPropostaPdf, nomeArquivoProposta, textoDaProposta } from "@/lib/proposta-compra-pdf";
import { AVISO_TEXTO_ADVOGADO, SITUACOES, TEXTO_APROVADO_ADVOGADO } from "@/lib/proposta-compra";
import { MARCA_MINUTA, montarTextoProposta, textoPlano } from "@/lib/proposta-compra-texto";

const H = "a".repeat(64);
const TOKEN = "A".repeat(43);

function parte(papel: string, ordem: number, extra: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(ordem).padStart(4, "0")}${papel.length.toString().padStart(8, "0")}`,
    papel,
    ordem,
    tipo_pessoa: "fisica",
    nome: `${papel} ${ordem}`,
    cpf_cnpj: "11122233344",
    estado_civil: "solteiro",
    telefone: "15999990000",
    email: null,
    origem: "manual",
    assinado_em: null,
    codigo: null,
    ...extra,
  };
}

function detalheRaw(extra: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    documento: "PC-11111111",
    capture_id: "c0000000-0000-4000-8000-0000000000a1",
    lead_id: "1e000000-0000-4000-8000-0000000000a1",
    origem_id: null,
    versao: 1,
    situacao: "rascunho",
    imovel: {
      tipo: "Apartamento",
      endereco: "Rua das Acácias, 245",
      complemento: "apto 31",
      bairro: "Jardim Campolim",
      cidade: "Sorocaba",
      uf: "SP",
      matricula: "98.765",
      cartorio: "1º CRI",
      valor_anunciado: "R$ 500.000,00",
    },
    valor_oferta: 485000,
    forma_pagamento: "sinal_financiamento",
    sinal_valor: 48500,
    sinal_prazo_dias: 3,
    sinal_tipo: "confirmatorias",
    financiamento_banco: "Caixa",
    financiamento_valor: 388000,
    validade_dias: 5,
    validade_ate: null,
    prazo_contrato_dias: 15,
    certidoes: "vendedor_apresenta",
    observacoes: "Armários da cozinha ficam.",
    pdf_hash: null,
    conteudo_hash: H,
    enviada_em: null,
    aceita_em: null,
    recusada_em: null,
    recusa_motivo: null,
    venda_id: null,
    criado_em: "2026-11-08T12:00:00Z",
    corretor_id: "ebffaded-075c-493f-89e2-1d3d62901dc4",
    corretor_nome: "Ana Corretora",
    pode_operar: true,
    pendencias_envio: [],
    partes: [
      parte("comprador", 1, { origem: "lead", nome: "João Alves", estado_civil: "casado" }),
      parte("comprador_conjuge", 1, { nome: "Marina Alves", estado_civil: "casado" }),
      parte("vendedor", 1, { origem: "captacao", nome: "Carlos Pereira" }),
      parte("corretor", 1, { origem: "perfil", nome: "Ana Corretora", cpf_cnpj: null }),
    ],
    eventos: [
      {
        tipo: "criada",
        versao: 1,
        detalhe: "com lead do CRM",
        criado_em: "2026-11-08T12:00:00Z",
        autor: "Ana",
      },
    ],
    ...extra,
  };
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  enviarProposta.mockReset();
  lerPropostaLink.mockReset();
  assinarPropostaLink.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
});
afterEach(cleanup);

// ------------------------------------------------------------------------------------------------------------
describe("regras puras das telas", () => {
  it("detalhe do banco: lista fechada + formulário preenchido pela captação e pelo lead", () => {
    const d = lerDetalhe({
      ...detalheRaw(),
      cpf_extra: "não pode",
      partes: [...detalheRaw().partes, { papel: "x" }],
    });
    expect(d.partes).toHaveLength(4);
    expect((d as Record<string, unknown>).cpf_extra).toBeUndefined();
    const f = formDoDetalhe(d);
    expect(f.partes.map((p) => `${p.papel}:${p.origem}`)).toEqual([
      "comprador:lead",
      "comprador_conjuge:manual",
      "vendedor:captacao",
    ]);
    expect(f.valorOferta).toBe("485.000,00");
    expect(f.validadeDias).toBe("5");
  });

  it("validade padrão 5 dias corridos quando o campo vem vazio ou fora do limite", () => {
    const f = formDoDetalhe(lerDetalhe(detalheRaw({ validade_dias: null })));
    expect(f.validadeDias).toBe("5");
    expect(dadosParaSalvar({ ...f, validadeDias: "99" }).validade_dias).toBe(5);
    expect(dadosParaSalvar({ ...f, validadeDias: "7" }).validade_dias).toBe(7);
  });

  it("cônjuge segue o estado civil (casado/união estável) e some para solteiro ou empresa", () => {
    const f = formDoDetalhe(lerDetalhe(detalheRaw()));
    const vendCasado = f.partes.map((p) =>
      p.papel === "vendedor" ? { ...p, estadoCivil: "uniao_estavel" as const } : p,
    );
    expect(ajustarConjuges(vendCasado).map((p) => p.papel)).toEqual([
      "comprador",
      "comprador_conjuge",
      "vendedor",
      "vendedor_conjuge",
    ]);
    const compPJ = f.partes.map((p) =>
      p.papel === "comprador" ? { ...p, tipoPessoa: "juridica" as const } : p,
    );
    const salvo = dadosParaSalvar({ ...f, partes: compPJ }).partes as Record<string, unknown>[];
    expect(salvo.map((p) => p.papel)).toEqual(["comprador", "vendedor"]);
    expect(salvo[0].estado_civil).toBeNull();
    expect(salvo[0].tipo_pessoa).toBe("juridica");
  });

  it("salvar: sinal/financiamento só quando a forma pede; documentos e celular só com dígitos", () => {
    const f = formDoDetalhe(lerDetalhe(detalheRaw()));
    const avista = dadosParaSalvar({ ...f, formaPagamento: "a_vista" });
    expect(avista.sinal_valor).toBeNull();
    expect(avista.financiamento_banco).toBeNull();
    const fin = dadosParaSalvar({
      ...f,
      partes: f.partes.map((p) => ({
        ...p,
        cpfCnpj: "111.222.333-44",
        telefone: "(15) 99999-0000",
      })),
    });
    expect(fin.sinal_valor).toBe(48500);
    expect(fin.financiamento_valor).toBe(388000);
    expect((fin.partes as { cpf_cnpj: string; telefone: string }[])[0]).toMatchObject({
      cpf_cnpj: "11122233344",
      telefone: "15999990000",
    });
    expect(fin.sinal_tipo).toBe("confirmatorias");
    expect(dadosParaSalvar({ ...f, sinalTipo: "penitenciais" }).sinal_tipo).toBe("penitenciais");
  });

  it("valida antes de salvar", () => {
    const f = formDoDetalhe(lerDetalhe(detalheRaw()));
    expect(errosDoForm(f)).toEqual([]);
    expect(errosDoForm({ ...f, sinalValor: "600.000,00" })).toContain(
      "O sinal não pode ser maior que a oferta.",
    );
    expect(errosDoForm({ ...f, validadeDias: "0" })).toContain("Validade entre 1 e 30 dias.");
    expect(errosDoForm({ ...f, partes: [{ ...f.partes[0], cpfCnpj: "123" }] })[0]).toMatch(
      /11 ou 14/,
    );
    expect(lerValor("R$ 485.000,50")).toBe(485000.5);
    expect(lerValor("485.000")).toBe(485000);
    expect(lerValor("abc")).toBeNull();
  });

  it("ações por situação (todas as situações)", () => {
    const tab = Object.fromEntries(
      SITUACOES.map((s) => [
        s,
        Object.entries(acoes(lerDetalhe(detalheRaw({ situacao: s }))))
          .filter(([, v]) => v)
          .map(([k]) => k),
      ]),
    );
    expect(tab).toEqual({
      rascunho: ["editar", "gerarPdf", "enviar"],
      aguardando_assinaturas: ["editar", "reenviar", "recusar", "contraproposta"],
      aceita: ["criarVenda"],
      recusada: ["contraproposta"],
      contraproposta: [],
      vencida: ["contraproposta"],
    });
    expect(
      Object.values(acoes(lerDetalhe(detalheRaw({ situacao: "aceita", pode_operar: false })))).some(
        Boolean,
      ),
    ).toBe(false);
    expect(acoes(lerDetalhe(detalheRaw({ situacao: "aceita", venda_id: "x" }))).criarVenda).toBe(
      false,
    );
    expect(
      acoes(lerDetalhe(detalheRaw({ pendencias_envio: ["PDF da proposta (gere a prévia)"] })))
        .enviar,
    ).toBe(false);
  });

  it("situação de cada parte", () => {
    const base = lerDetalhe(detalheRaw()).partes[0];
    expect(situacaoParte({ ...base, assinadoEm: "2026-11-08T14:20:00Z" })).toBe("assinou");
    expect(situacaoParte({ ...base, telefone: null })).toBe("sem_celular");
    expect(situacaoParte(base)).toBe("nao_enviado");
    const cod = {
      criadoEm: null,
      enviadoEm: null,
      expiraEm: null,
      tentativas: 0,
      envioErro: null,
      ativo: true,
    };
    expect(situacaoParte({ ...base, codigo: cod })).toBe("aguardando");
    expect(situacaoParte({ ...base, codigo: { ...cod, ativo: false } })).toBe("codigo_vencido");
    expect(situacaoParte({ ...base, codigo: { ...cod, envioErro: "falha" } })).toBe("falha_envio");
  });

  it("validade em texto e lista da captação", () => {
    expect(textoValidade("2026-11-09", "2026-11-09")).toBe("Vence hoje");
    expect(textoValidade("2026-11-11", "2026-11-09")).toBe("Vence em 11/11 (2 dias)");
    expect(textoValidade("2026-11-08", "2026-11-09")).toBe("Venceu em 08/11");
    expect(lerLista([{ id: "x", situacao: "nao_existe" }, { sem: "id" }])).toEqual([
      expect.objectContaining({ id: "x", situacao: "rascunho" }),
    ]);
  });

  it("máscaras da comprovação: telefone, IP e aparelho", () => {
    expect(mascararTelefone("5515999990000")).toBe("(15) 9****-0000");
    expect(mascararTelefone("1533334444")).toBe("(15) ****-4444");
    expect(mascararIp("189.10.20.12")).toBe("189.xx.xx.12");
    expect(mascararIp("2804:14c:65:abcd::1")).toBe("2804:14c:…");
    expect(
      aparelho(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1",
      ),
    ).toBe("iPhone/Safari");
    expect(aparelho("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36")).toBe(
      "Android/Chrome",
    );
  });

  it("O que fazer hoje: lê só os 2 tipos e ordena pelo prazo", () => {
    const r = lerPendencias([
      {
        kind: "proposta_falta_assinar",
        proposta_id: "p1",
        capture_id: "c1",
        detalhe: "Falta assinar: Ana",
        dias: 2,
      },
      {
        kind: "proposta_vencendo",
        proposta_id: "p1",
        capture_id: "c1",
        detalhe: "Proposta vence hoje",
        dias: 0,
      },
      { kind: "outro", proposta_id: "p2", capture_id: "c2" },
    ]);
    expect(r.map((x) => x.kind)).toEqual(["proposta_vencendo", "proposta_falta_assinar"]);
  });
});

// ------------------------------------------------------------------------------------------------------------
describe("PDF da proposta (pdf-lib existente)", () => {
  const detalhe = () => lerDetalhe(detalheRaw({ situacao: "aceita", versao: 2 }));

  it("texto oficial: imóvel, partes, valores por extenso, arras confirmatórias (padrão) e marca do advogado", () => {
    const tx = textoDaProposta(detalhe(), "RE/MAX Teste", "2026-11-09");
    const t = textoPlano(tx);
    expect(t).toContain("PROPOSTA DE COMPRA DE IMÓVEL");
    expect(t).toContain("Rua das Acácias, 245");
    expect(t).toContain("111.222.333-44");
    expect(t).toContain("R$ 485.000,00 (quatrocentos e oitenta e cinco mil reais)");
    expect(t).toContain("arras confirmatórias (arts. 417 a 419 do Código Civil)");
    expect(t).not.toContain("arras penitenciais");
    expect(t).toContain("Financiamento bancário (Caixa)");
    expect(t).toContain("Armários da cozinha ficam.");
    expect(t).toContain("válida por 5 dias corridos, até 23h59 de 14/11/2026");
    expect(t).not.toMatch(/pendente de revisão/i);
    expect(TEXTO_APROVADO_ADVOGADO).toBe(true);
    expect(tx.marcaInterna).toBeNull();
    expect(MARCA_MINUTA).toMatch(/Minuta/);
    expect(AVISO_TEXTO_ADVOGADO).toMatch(/advogado/);
    const sig = tx.secoes.find((x) => x.titulo.endsWith("Signatários"))!.itens[0];
    expect(sig.tipo === "signatarios" && sig.linhas.map((l) => l[0])).toEqual([
      "João Alves",
      "Marina Alves",
      "Carlos Pereira",
      "Ana Corretora",
    ]);
  });

  it("prévia sem comprovação; PDF final ganha a página 'Comprovação das assinaturas' com o código", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const logo = new Uint8Array(readFileSync("public/remax-logo-transparent.png"));
    const emitidoEm = new Date("2026-11-09T12:00:00Z");
    const previa = await buildPropostaPdf({
      proposta: detalhe(),
      imobiliaria: "RE/MAX Teste",
      logo,
      emitidoEm,
    });
    const comp = lerComprovacao({
      documento: "PC-11111111",
      versao: 2,
      pdf_hash: H,
      conteudo_hash: H,
      aceita_em: "2026-11-08T15:00:00Z",
      assinaturas: [
        {
          papel: "comprador",
          ordem: 1,
          nome: "João",
          telefone: "15999990000",
          assinado_em: "2026-11-08T14:20:00Z",
          ip: "189.1.2.3",
          user_agent: "iPhone Safari/1",
          conteudo_hash: H,
          pdf_hash: H,
        },
        { papel: "x", ordem: 1 },
      ],
    });
    expect(comp.assinaturas).toHaveLength(1);
    const final = await buildPropostaPdf({
      proposta: detalhe(),
      imobiliaria: "RE/MAX Teste",
      logo,
      emitidoEm,
      comprovacao: comp,
    });
    const pPrev = (await PDFDocument.load(previa)).getPageCount();
    const pFinal = (await PDFDocument.load(final)).getPageCount();
    expect(pFinal).toBe(pPrev + 1);
    // Mesmo conteúdo + data fixa = mesmo arquivo (o hash registrado é reproduzível).
    const de_novo = await buildPropostaPdf({
      proposta: detalhe(),
      imobiliaria: "RE/MAX Teste",
      logo,
      emitidoEm,
    });
    expect(Buffer.from(de_novo).equals(Buffer.from(previa))).toBe(true);
    expect(nomeArquivoProposta("PC-11111111", 2, true)).toBe(
      "proposta-PC-11111111-v2-assinada.pdf",
    );
  });

  it("texto do PDF: marca da minuta do advogado, comprovação e código do documento", () => {
    const src = readFileSync("src/lib/proposta-compra-pdf.ts", "utf8");
    expect(src).toContain("tx.marcaInterna.toUpperCase()");
    expect(src).toContain('"Comprovação das assinaturas"');
    expect(src).toContain("Código do documento");
    expect(src).toContain('from "@/lib/owner-feedback-pdf"');
  });
});

// ------------------------------------------------------------------------------------------------------------
describe("aba Propostas da captação", () => {
  it("módulo desligado: não aparece", async () => {
    rpc.mockImplementation(async (n: string) => ({
      data: n === "proposta_compra_enabled" ? false : [],
      error: null,
    }));
    const { container } = render(
      createElement(PropostasCaptacao, { captureId: "c1", podeCriar: true }),
    );
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("proposta_compra_enabled", undefined));
    expect(container.innerHTML).toBe("");
    expect(rpc).not.toHaveBeenCalledWith("proposta_lista_captacao", expect.anything());
  });

  it("histórico: data, comprador, valor, corretor, situação e validade; Nova proposta cria pelo banco", async () => {
    rpc.mockImplementation(async (n: string) => {
      if (n === "proposta_compra_enabled") return { data: true, error: null };
      if (n === "proposta_lista_captacao")
        return {
          data: [
            {
              id: "p1",
              documento: "PC-1",
              criado_em: "2026-11-08T12:00:00Z",
              comprador: "João e Marina",
              valor_oferta: 485000,
              corretor: "Ana Souza",
              situacao: "aguardando_assinaturas",
              validade_ate: "2099-11-13",
            },
            {
              id: "p2",
              documento: "PC-2",
              criado_em: "2026-11-01T12:00:00Z",
              comprador: "Pedro",
              valor_oferta: 450000,
              corretor: "Bruno",
              situacao: "recusada",
              validade_ate: null,
            },
          ],
          error: null,
        };
      if (n === "proposta_criar") return { data: detalheRaw(), error: null };
      return { data: null, error: null };
    });
    render(createElement(PropostasCaptacao, { captureId: "c1", podeCriar: true }));
    const tabela = await screen.findByTestId("lista-propostas");
    const linhas = within(tabela).getAllByRole("row");
    expect(linhas[0].textContent).toBe("DataCompradorValorCorretorSituaçãoValidade");
    expect(linhas[1].textContent).toContain("08/11/2026");
    expect(linhas[1].textContent).toContain("João e Marina");
    expect(linhas[1].textContent).toContain("R$ 485.000,00");
    expect(linhas[1].textContent).toContain("Ana Souza");
    expect(linhas[1].textContent).toContain("Aguardando assinaturas");
    expect(linhas[1].textContent).toContain("Vence em 13/11");
    expect(linhas[2].textContent).toContain("Recusada");
    fireEvent.click(screen.getByTestId("nova-proposta"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("proposta_criar", { _capture_id: "c1", _lead_id: null }),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/propostas/$id",
      params: { id: detalheRaw().id },
    });
  });

  it("sem permissão de criar: só o histórico", async () => {
    rpc.mockImplementation(async (n: string) => ({
      data: n === "proposta_compra_enabled" ? true : [],
      error: null,
    }));
    render(createElement(PropostasCaptacao, { captureId: "c1", podeCriar: false }));
    await screen.findByTestId("sem-propostas");
    expect(screen.queryByTestId("nova-proposta")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------
describe("tela da proposta", () => {
  const comDetalhe = (raw: Record<string, unknown>, extra?: (n: string, a: unknown) => unknown) =>
    rpc.mockImplementation(async (n: string, a: unknown) => {
      const x = extra?.(n, a);
      if (x !== undefined) return { data: x, error: null };
      if (n === "proposta_detalhe") return { data: raw, error: null };
      return { data: null, error: null };
    });

  it("rota interna atrás da chave do módulo e a pública com noindex", async () => {
    const r = RotaInterna as unknown as { beforeLoad: () => Promise<void> };
    await expect(r.beforeLoad()).rejects.toEqual({ to: "/dashboard" });
    const head = RotaPublica as unknown as {
      head: () => { meta: { name?: string; content?: string }[] };
      ssr: boolean;
    };
    expect(head.ssr).toBe(false);
    expect(head.head().meta).toContainEqual({
      name: "robots",
      content: "noindex, nofollow, noarchive",
    });
  });

  it("rascunho: formulário preenchido (selos), salva rascunho pelo banco", async () => {
    comDetalhe(detalheRaw(), (n) =>
      n === "proposta_salvar" ? detalheRaw({ valor_oferta: 490000 }) : undefined,
    );
    render(createElement(PropostaConteudo, { id: detalheRaw().id }));
    const form = await screen.findByTestId("form-proposta");
    expect(within(form).getAllByText("preenchido pela captação").length).toBeGreaterThanOrEqual(2);
    expect(within(form).getByText("veio do CRM")).toBeTruthy();
    expect(within(form).getByTestId("sinal-tipo").textContent).toContain(
      "Confirmatório (padrão da lei)",
    );
    expect(
      (within(form).getByTestId("sinal-tipo-confirmatorias") as HTMLInputElement).checked,
    ).toBe(true);
    expect((within(form).getByTestId("sinal-tipo-penitenciais") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(within(form).queryByLabelText(/tipo do sinal/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Valor oferecido (R$)"), {
      target: { value: "490.000,00" },
    });
    fireEvent.click(screen.getByTestId("salvar-rascunho"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("proposta_salvar", expect.anything()));
    const args = rpc.mock.calls.find((c) => c[0] === "proposta_salvar")![1] as {
      _dados: Record<string, unknown>;
    };
    expect(args._dados.valor_oferta).toBe(490000);
    expect(toast.success).toHaveBeenCalledWith("Rascunho salvo.");
  });

  it("aguardando: situação de cada parte, Reenviar para quem falta (modo de teste), recusa exige motivo", async () => {
    const raw = detalheRaw({
      situacao: "aguardando_assinaturas",
      validade_ate: "2099-01-01",
      pdf_hash: H,
      partes: [
        parte("comprador", 1, { assinado_em: "2026-11-08T17:20:00Z" }),
        parte("vendedor", 1, { codigo: { ativo: true, tentativas: 2 } }),
        parte("corretor", 1, { codigo: { ativo: false, tentativas: 0 } }),
      ],
    });
    comDetalhe(raw, (n) =>
      n === "proposta_recusar"
        ? { ...raw, situacao: "recusada", recusa_motivo: "Vendedor quer mais" }
        : undefined,
    );
    enviarProposta.mockResolvedValue({
      modo: "simulacao",
      resultados: [{ status: "simulado" }],
      semTelefone: 0,
      aguarde: 0,
    });
    render(createElement(PropostaConteudo, { id: raw.id }));
    const lista = await screen.findByTestId("lista-assinaturas");
    const itens = within(lista).getAllByRole("listitem");
    expect(itens.map((i) => i.getAttribute("data-situacao-parte"))).toEqual([
      "assinou",
      "aguardando",
      "codigo_vencido",
    ]);
    expect(itens[0].textContent).toContain("Assinou em 08/11/2026 14:20");
    expect(itens[1].textContent).toContain("2 tentativa(s) errada(s)");
    fireEvent.click(screen.getByTestId("reenviar-faltam"));
    await waitFor(() =>
      expect(enviarProposta).toHaveBeenCalledWith({ data: { propostaId: raw.id, partes: null } }),
    );
    expect(toast.success.mock.calls[0][0]).toContain("nenhuma mensagem saiu pelo WhatsApp");
    fireEvent.click(screen.getByTestId("recusar"));
    const botao = screen.getByTestId("confirmar-recusa") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo da recusa"), {
      target: { value: "Vendedor quer mais" },
    });
    fireEvent.click(botao);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("proposta_recusar", {
        _id: raw.id,
        _motivo: "Vendedor quer mais",
      }),
    );
    expect((await screen.findByTestId("motivo-recusa")).textContent).toContain(
      "Vendedor quer mais",
    );
  });

  it("contraproposta abre a nova proposta já preenchida", async () => {
    const raw = detalheRaw({ situacao: "recusada", recusa_motivo: "Valor baixo" });
    comDetalhe(raw, (n) =>
      n === "proposta_contraproposta"
        ? detalheRaw({ id: "22222222-2222-4222-8222-222222222222", origem_id: raw.id })
        : undefined,
    );
    render(createElement(PropostaConteudo, { id: raw.id }));
    fireEvent.click(await screen.findByTestId("contraproposta"));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir contraproposta" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("proposta_contraproposta", { _id: raw.id }),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: "/propostas/$id",
      params: { id: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("aceita: 'Criar venda em rascunho' só cria depois do clique e da confirmação", async () => {
    const raw = detalheRaw({
      situacao: "aceita",
      pdf_hash: H,
      partes: [parte("comprador", 1, { assinado_em: "2026-11-08T17:20:00Z" })],
    });
    comDetalhe(raw, (n) => {
      if (n === "proposta_criar_venda")
        return { criada: false, venda_id: "99999999-9999-4999-8999-999999999999" };
      return undefined;
    });
    render(createElement(PropostaConteudo, { id: raw.id }));
    const bloco = await screen.findByTestId("bloco-aceita");
    expect(rpc).not.toHaveBeenCalledWith("proposta_criar_venda", expect.anything());
    fireEvent.click(within(bloco).getByTestId("criar-venda"));
    expect(rpc).not.toHaveBeenCalledWith("proposta_criar_venda", expect.anything());
    fireEvent.click(await screen.findByRole("button", { name: "Criar venda" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("proposta_criar_venda", { _id: raw.id }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/vendas/$id",
      params: { id: "99999999-9999-4999-8999-999999999999" },
    });
  });

  it("quem só vê (admin) não tem botões de ação", async () => {
    comDetalhe(detalheRaw({ situacao: "aceita", pode_operar: false }));
    render(createElement(PropostaConteudo, { id: detalheRaw().id }));
    await screen.findByTestId("bloco-aceita");
    expect(screen.queryByTestId("criar-venda")).toBeNull();
    expect(screen.getByText("Você pode ver esta proposta, mas não alterar.")).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------------------
describe("página pública do link", () => {
  const publica = (extra: Record<string, unknown> = {}) => ({
    ok: true,
    dados: {
      imobiliaria: "RE/MAX Teste",
      documento: "PC-11111111",
      versao: 2,
      situacao: "aguardando_assinaturas",
      validadeAte: "2099-11-13",
      conteudoHash: H,
      voce: {
        papel: "vendedor",
        ordem: 1,
        nome: "Carlos Pereira",
        documentoFinal: "44",
        assinadoEm: null,
      },
      imovel: {
        tipo: "Apartamento",
        endereco: "Rua das Acácias, 245",
        complemento: null,
        bairro: "Campolim",
        cidade: "Sorocaba",
        uf: "SP",
        matricula: "98.765",
        cartorio: null,
      },
      valores: {
        oferta: 485000,
        formaPagamento: "sinal_financiamento",
        sinal: 48500,
        sinalPrazoDias: 3,
        sinalTipo: "confirmatorias",
        financiamentoBanco: "Caixa",
        financiamentoValor: 388000,
      },
      condicoes: {
        validadeDias: 5,
        prazoContratoDias: 15,
        certidoes: "vendedor_apresenta",
        observacoes: null,
      },
      partes: [
        { papel: "comprador", ordem: 1, nome: "João Alves", assinou: true },
        { papel: "vendedor", ordem: 1, nome: "Carlos Pereira", assinou: false },
      ],
      corretor: { nome: "Ana", whatsapp: "https://wa.me/5515988887777" },
      ...extra,
    },
  });

  it("token inválido não chama o servidor", () => {
    render(createElement(PropostaLink, { token: "curto" }));
    expect(screen.getByTestId("link-indisponivel")).toBeTruthy();
    expect(lerPropostaLink).not.toHaveBeenCalled();
  });

  it("mostra a proposta inteira e só assina com 6 dígitos + 'Li e concordo'", async () => {
    lerPropostaLink.mockResolvedValue(publica());
    assinarPropostaLink
      .mockResolvedValueOnce({ ok: false, erro: "codigo_errado", restantes: 4 })
      .mockResolvedValueOnce({ ok: true, situacao: "aguardando_assinaturas", faltam: 1 });
    render(createElement(PropostaLink, { token: TOKEN }));
    const area = await screen.findByTestId("assinar");
    const texto = document.body.textContent ?? "";
    for (const t of [
      "Rua das Acácias, 245",
      "R$ 485.000,00",
      "arras confirmatórias",
      "Financiamento bancário (Caixa)",
      "em até 15 dias",
      "Se as certidões do imóvel",
      "PROPOSTA DE COMPRA DE IMÓVEL",
      "Leia a proposta inteira",
      "Sinal (arras)",
      "Validade e aceite",
      "Signatários",
      "João Alves",
      "termina em 44",
    ])
      expect(texto).toContain(t);
    expect(texto).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(texto).not.toContain(AVISO_TEXTO_ADVOGADO);
    expect(texto).not.toMatch(/Minuta/i);
    expect(screen.getByTestId("texto-oficial")).toBeTruthy();
    const botao = within(area).getByTestId("botao-assinar") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Código recebido no WhatsApp"), {
      target: { value: "12a3456" },
    });
    expect(botao.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("li-e-concordo"));
    expect(botao.disabled).toBe(false);
    fireEvent.click(botao);
    expect((await screen.findByTestId("erro-assinatura")).textContent).toBe(
      "Código incorreto. Você tem mais 4 tentativa(s).",
    );
    expect(assinarPropostaLink).toHaveBeenCalledWith({
      data: { token: TOKEN, codigo: "123456", conteudoHash: H, aceite: true },
    });
    fireEvent.click(botao);
    expect((await screen.findByTestId("assinado")).textContent).toContain("Assinatura registrada");
  });

  it("proposta vencida, aceita ou link de outra imobiliária desligada: mensagem neutra, sem campo de código", async () => {
    lerPropostaLink.mockResolvedValue({ ok: false, erro: "vencida" });
    render(createElement(PropostaLink, { token: TOKEN }));
    expect((await screen.findByTestId("link-indisponivel")).textContent).toContain("venceu");
    cleanup();
    lerPropostaLink.mockResolvedValue(publica({ situacao: "aceita" }));
    render(createElement(PropostaLink, { token: TOKEN }));
    await screen.findByTestId("partes-publicas");
    expect(screen.queryByTestId("assinar")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------
describe("O que fazer hoje do corretor", () => {
  function Quadro() {
    const itens = usePendenciasPropostas("u1");
    return createElement(
      "ul",
      { "data-testid": "quadro" },
      itens.map((p) => createElement(ItemPendenciaProposta, { key: p.kind + p.propostaId, p })),
    );
  }

  it("proposta vencendo em 2 dias e parte sem assinar, com link para a proposta", async () => {
    rpc.mockImplementation(async (n: string) =>
      n === "proposta_pendencias"
        ? {
            data: [
              {
                kind: "proposta_vencendo",
                proposta_id: "p1",
                capture_id: "c1",
                imovel: "Apartamento — Campolim",
                detalhe: "Proposta vence em 2 dia(s)",
                prazo: "2026-11-11",
                dias: 2,
              },
              {
                kind: "proposta_falta_assinar",
                proposta_id: "p1",
                capture_id: "c1",
                imovel: "Apartamento — Campolim",
                detalhe: "Falta assinar: Carlos Pereira",
                prazo: "2026-11-11",
                dias: 2,
              },
            ],
            error: null,
          }
        : { data: null, error: null },
    );
    render(createElement(Quadro));
    const q = await screen.findByTestId("quadro");
    await waitFor(() => expect(within(q).getAllByRole("listitem")).toHaveLength(2));
    expect(q.textContent).toContain("Proposta vencendo");
    expect(q.textContent).toContain("Falta assinar: Carlos Pereira");
    expect(within(q).getAllByRole("link")[0].getAttribute("href")).toBe("/propostas/$id");
  });

  it("falha ou módulo desligado: nada aparece (não quebra o quadro)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "desligado" } });
    render(createElement(Quadro));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("proposta_pendencias", undefined));
    expect(within(screen.getByTestId("quadro")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("encaixe mínimo: Minha carreira e captação só ganham o componente novo", () => {
    const mc = readFileSync("src/routes/_authenticated/minha-carreira.tsx", "utf8");
    expect(mc).toContain("usePendenciasPropostas(userId)");
    const cap = readFileSync("src/routes/_authenticated/exclusividades.$id.tsx", "utf8");
    expect(cap).toContain("<PropostasCaptacao");
    for (const f of [
      "src/components/gestao/MinhaGestao.tsx",
      "src/lib/inteligencia-gestao-tela.ts",
      "src/routes/acompanhar.$token.tsx",
    ])
      expect(readFileSync(f, "utf8")).not.toMatch(/proposta/i);
  });
});
