import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Locação — Documentação com leitura por IA (t_127811ca). Documentos e pessoas 100% fictícios; nada vai à rede.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (i: unknown) => unknown = (i) => i;
    const b = {
      middleware: () => b,
      validator: (v: (i: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const st = vi.hoisted(() => ({
  gravados: [] as Array<Record<string, unknown>>,
  alertas: [] as Array<Record<string, unknown>>,
  download: true,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      if (nome !== "locacao_leitura_gravar") throw new Error(`rpc inesperada ${nome}`);
      st.gravados.push(args);
      return {
        data: { ok: true, preenchidos: Object.keys(args._sugestoes as object).length },
        error: null,
      };
    },
    storage: {
      from: () => ({
        download: async () =>
          st.download
            ? { data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }
            : { data: null, error: { message: "x" } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { organization_id: "org-1" } }) }),
      }),
    }),
  },
}));
vi.mock("@/lib/ai-indisponivel.server", () => ({
  reportAiUnavailableSafe: async (ev: Record<string, unknown>) => {
    st.alertas.push(ev);
  },
}));

import {
  CAMPOS_CONTRATO,
  CHAVES_CONTRATO,
  alteracoes,
  casado,
  exigeDadosContrato,
  faltasContrato,
  lerContrato,
  valorOk,
} from "@/lib/locacao-contrato";
import {
  cpfLimpo,
  dataLimpa,
  estadoCivilLimpo,
  itemLidoPorIa,
  promptDoDocumento,
  sugestoesDoDocumento,
  tipoDoItem,
} from "@/lib/locacao-ia";
import { lerDocumentoLocacao } from "@/lib/locacao-ia.functions";
import { lerDetalhe } from "@/lib/locacao";

const MIG = readFileSync(
  new URL("../../supabase/migrations/20261112120000_locacao_documentos_ia.sql", import.meta.url),
  "utf8",
);
const MODELO_PADRAO = readFileSync(
  new URL("../../supabase/migrations/20261110120000_locacao_fase1.sql", import.meta.url),
  "utf8",
);

const completo = (): Record<string, string> => {
  const v: Record<string, string> = {};
  for (const pre of ["loc", "prop", "fia"]) {
    v[`${pre}_nome`] = `Pessoa ${pre} Fictícia`;
    v[`${pre}_cpf`] = "529.982.247-25";
    v[`${pre}_rg`] = "12.345.678-9";
    v[`${pre}_nacionalidade`] = "brasileira";
    v[`${pre}_estado_civil`] = "solteiro(a)";
    v[`${pre}_profissao`] = "analista";
    v[`${pre}_endereco`] = "Rua Fictícia, 1 — Sorocaba/SP";
  }
  Object.assign(v, {
    fia_matricula: "12.345",
    fia_cartorio: "1º Oficial de Registro de Imóveis de Sorocaba/SP",
    imv_inscricao: "11.22.33.4444",
    imv_energia: "4000123456",
    imv_agua: "98765",
    prazo_meses: "30",
    inicio: "2026-12-01",
    dia_vencimento: "10",
  });
  return v;
};

describe("campos do contrato (marcadores do modelo residencial com fiador)", () => {
  it("lista do front = lista do banco (mesma ordem)", () => {
    const sql =
      /locacao_contrato_chaves\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/.exec(MIG)?.[1] ?? "";
    const doBanco = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(doBanco).toEqual(CHAVES_CONTRATO);
    expect(new Set(CHAVES_CONTRATO).size).toBe(CHAVES_CONTRATO.length);
  });
  it("cobre o que o contrato-modelo pede", () => {
    for (const k of [
      "loc_nome",
      "loc_cpf",
      "prop_nome",
      "prop_conj_nome",
      "prop_conj_cpf",
      "fia_nome",
      "fia_cpf",
      "fia_conj_nome",
      "fia_matricula",
      "fia_cartorio",
      "moradores",
      "imv_inscricao",
      "imv_energia",
      "imv_agua",
      "imv_gas",
      "prazo_meses",
      "inicio",
      "dia_vencimento",
    ])
      expect(CHAVES_CONTRATO).toContain(k);
    expect(CAMPOS_CONTRATO.every((c) => c.label.length >= 2)).toBe(true);
  });
  it("trava só residencial com fiador (caução e seguro-fiança seguem como estão)", () => {
    expect(exigeDadosContrato("residencial", "fiador")).toBe(true);
    expect(exigeDadosContrato("residencial", "caucao")).toBe(false);
    expect(exigeDadosContrato("residencial", "seguro_fianca")).toBe(false);
    expect(exigeDadosContrato("comercial", "fiador")).toBe(false);
    expect(faltasContrato("residencial", "caucao", {})).toEqual([]);
  });
  it("completo = nada falta; vazio lista locatário, proprietário, fiador e imóvel", () => {
    expect(faltasContrato("residencial", "fiador", completo())).toEqual([]);
    const f = faltasContrato("residencial", "fiador", {});
    expect(f[0]).toBe("nome do locatário");
    expect(f).toContain("CPF do fiador");
    expect(f).toContain("matrícula do imóvel do fiador");
    expect(f.at(-1)).toBe("dia de vencimento");
    expect(f).toHaveLength(7 * 3 + 8);
  });
  it("casado pede cônjuge do proprietário e do fiador (não do locatário)", () => {
    const v = {
      ...completo(),
      prop_estado_civil: "casado(a)",
      fia_estado_civil: "união estável",
      loc_estado_civil: "casado(a)",
    };
    expect(faltasContrato("residencial", "fiador", v)).toEqual([
      "nome do cônjuge do proprietário",
      "CPF do cônjuge do proprietário",
      "nome do cônjuge do fiador",
      "CPF do cônjuge do fiador",
    ]);
    expect(casado("Casado(a)")).toBe(true);
    expect(casado("divorciado(a)")).toBe(false);
  });
  it("CPF precisa ter 11 dígitos", () => {
    expect(faltasContrato("residencial", "fiador", { ...completo(), loc_cpf: "123" })).toEqual([
      "CPF do locatário",
    ]);
  });
  it("validação igual à do banco: datas, prazo e vencimento", () => {
    expect(valorOk("inicio", "2026-02-30")).toBe(false);
    expect(valorOk("inicio", "2026-02-28")).toBe(true);
    expect(valorOk("loc_nascimento", "28/02/1990")).toBe(false);
    expect(valorOk("prazo_meses", "0")).toBe(false);
    expect(valorOk("prazo_meses", "30")).toBe(true);
    expect(valorOk("dia_vencimento", "29")).toBe(false);
    expect(valorOk("dia_vencimento", "28")).toBe(true);
    expect(valorOk("moradores", "x".repeat(2001))).toBe(false);
    expect(valorOk("loc_nome", "")).toBe(true);
  });
});

describe("origem de cada campo e alterações", () => {
  it("lido pela IA, digitado, da pré-análise e falta", () => {
    const { valores, origem } = lerContrato(
      { loc_nome: "Ana Fictícia", loc_rg: "1", fia_nome: "Beto", chave_estranha: "x", imv_agua: 5 },
      { loc_rg: { o: "ia", item: "RG/CNH do locatário" }, fia_nome: { o: "manual" } },
    );
    expect(valores).toEqual({ loc_nome: "Ana Fictícia", loc_rg: "1", fia_nome: "Beto" });
    expect(origem.loc_rg).toEqual({ o: "ia", item: "RG/CNH do locatário" });
    expect(origem.fia_nome).toEqual({ o: "manual" });
    expect(origem.loc_nome).toEqual({ o: "pre" });
    expect(origem.imv_agua).toEqual({ o: "vazio" });
  });
  it("só manda o que mudou; apagar vira null", () => {
    expect(
      alteracoes(
        { loc_nome: "Ana", loc_rg: "1" },
        { loc_nome: "Ana ", loc_rg: "", fia_nome: "Beto", x: "y" },
      ),
    ).toEqual({ loc_rg: null, fia_nome: "Beto" });
  });
  it("detalhe lê selo da leitura e contrato de forma fechada", () => {
    const d = lerDetalhe({
      documentos: [
        { id: "d1", item: "RG", leitura: "ok", preenchidos: 3 },
        { id: "d2", item: "x", leitura: "inventado" },
      ],
      contrato: { exige: true, faltando: ["nome do locatário", 3] },
    });
    expect(d.documentos[0]).toMatchObject({ leitura: "ok", preenchidos: 3 });
    expect(d.documentos[1].leitura).toBeNull();
    expect(d.contrato).toMatchObject({ exige: true, faltando: ["nome do locatário"] });
    expect(lerDetalhe({}).contrato.exige).toBe(false);
  });
});

describe("tipo de documento a partir do checklist padrão", () => {
  it("itens padrão da Fase 1", () => {
    expect(MODELO_PADRAO).toContain("RG/CNH do locatário");
    expect(tipoDoItem("RG/CNH do locatário")).toBe("identidade");
    expect(tipoDoItem("CPF do locatário")).toBe("identidade");
    expect(tipoDoItem("Comprovante de renda do locatário")).toBe("renda");
    expect(tipoDoItem("Comprovante de residência do locatário")).toBe("endereco");
    expect(tipoDoItem("Matrícula do imóvel do fiador (quitado)")).toBe("matricula");
    expect(tipoDoItem("Certidão de casamento do fiador (se casado)")).toBe("certidao");
    expect(tipoDoItem("Matrícula atualizada do imóvel")).toBe("matricula");
    expect(tipoDoItem("Último IPTU / conta de consumo")).toBe("contas");
    expect(tipoDoItem("Formulário do proprietário (dados bancários p/ repasse)")).toBe("outro");
    expect(itemLidoPorIa("Comprovante do depósito da caução")).toBe(false);
  });
  it("prompt diz de quem é o documento e nunca leva dado pessoal", () => {
    const p = promptDoDocumento("identidade", "fiador", "RG/CNH do fiador");
    expect(p).toContain("FIADOR");
    expect(p).toContain('"cpf"');
  });
});

describe("sugestões da IA → campos do contrato", () => {
  it("identidade do fiador vai para fia_*, com CPF e data normalizados", () => {
    const s = sugestoesDoDocumento("identidade", "fiador", {
      nome: " Carlos  Exemplo ",
      cpf: "52998224725",
      rg: "12.345.678-9",
      data_nascimento: "17/05/1970",
      estado_civil: "CASADO",
      profissao: null,
      nacionalidade: "não consta",
    });
    expect(s).toEqual({
      fia_nome: "Carlos Exemplo",
      fia_cpf: "529.982.247-25",
      fia_rg: "12.345.678-9",
      fia_nascimento: "1970-05-17",
      fia_estado_civil: "casado(a)",
    });
  });
  it("certidão de casamento do proprietário separa titular e cônjuge pelo CPF", () => {
    const s = sugestoesDoDocumento(
      "certidao",
      "proprietario",
      {
        tipo_certidao: "casamento",
        regime_casamento: "Comunhão parcial de bens",
        pessoas_certidao: [
          { nome: "Dora Fictícia", cpf: "111.444.777-35", profissao: "professora" },
          {
            nome: "Eli Fictício",
            cpf: "529.982.247-25",
            profissao: "engenheiro",
            nacionalidade: "brasileiro",
          },
        ],
      },
      { prop_cpf: "529.982.247-25" },
    );
    expect(s).toMatchObject({
      prop_estado_civil: "casado(a)",
      prop_regime: "Comunhão parcial de bens",
      prop_profissao: "engenheiro",
      prop_conj_nome: "Dora Fictícia",
      prop_conj_cpf: "111.444.777-35",
      prop_conj_profissao: "professora",
    });
  });
  it("certidão sem saber quem é o titular não arrisca o cônjuge", () => {
    const s = sugestoesDoDocumento("certidao", "fiador", {
      tipo_certidao: "casamento",
      pessoas_certidao: [{ nome: "A B C D E" }, { nome: "F G H I J" }],
    });
    expect(s).toEqual({ fia_estado_civil: "casado(a)" });
  });
  it("certidão com divórcio averbado vira divorciado e não cria cônjuge", () => {
    const s = sugestoesDoDocumento(
      "certidao",
      "fiador",
      {
        tipo_certidao: "casamento",
        averbacao_divorcio: true,
        pessoas_certidao: [{ cpf: "529.982.247-25" }, { nome: "Outro Fulano" }],
      },
      { fia_cpf: "52998224725" },
    );
    expect(s.fia_estado_civil).toBe("divorciado(a)");
    expect(s.fia_conj_nome).toBeUndefined();
  });
  it("matrícula do fiador → número e cartório; do proprietário → inscrição e dono", () => {
    expect(
      sugestoesDoDocumento("matricula", "fiador", {
        numero_matricula: "12.345",
        cartorio: "2º Oficial de Registro de Imóveis de Sorocaba",
      }),
    ).toEqual({
      fia_matricula: "12.345",
      fia_cartorio: "2º Oficial de Registro de Imóveis de Sorocaba",
    });
    expect(
      sugestoesDoDocumento("matricula", "proprietario", {
        inscricao_municipal: "11.22",
        proprietarios: [{ nome: "Gil Fictício", cpf: "529.982.247-25" }],
      }),
    ).toEqual({ imv_inscricao: "11.22", prop_nome: "Gil Fictício", prop_cpf: "529.982.247-25" });
  });
  it("conta de consumo/IPTU → códigos do imóvel", () => {
    expect(
      sugestoesDoDocumento("contas", "proprietario", {
        inscricao_municipal: "11.22.33",
        codigo_energia: "4000123456",
        codigo_agua: "98765",
        codigo_gas: null,
      }),
    ).toEqual({ imv_inscricao: "11.22.33", imv_energia: "4000123456", imv_agua: "98765" });
  });
  it("renda e comprovante de endereço; lixo é descartado", () => {
    expect(sugestoesDoDocumento("renda", "locatario", { profissao: "Vendedor" })).toEqual({
      loc_profissao: "Vendedor",
    });
    expect(sugestoesDoDocumento("endereco", "locatario", { endereco: "Rua X, 1" })).toEqual({
      loc_endereco: "Rua X, 1",
    });
    expect(sugestoesDoDocumento("identidade", "caucao", { nome: "x" })).toEqual({});
    expect(cpfLimpo("123")).toBeNull();
    expect(dataLimpa("31/02/2000")).toBeNull();
    expect(estadoCivilLimpo("Convivente")).toBe("união estável");
  });
});

describe("leitura no servidor (mesma IA da venda, sem rede)", () => {
  const DOC = "11111111-1111-4111-8111-111111111111";
  const prep = (item: string, grupo = "fiador") => ({
    rpc: async (nome: string) => {
      expect(nome).toBe("locacao_leitura_preparar");
      return { data: { path: "org/loc/a.pdf", item, grupo, valores: {} }, error: null };
    },
  });
  type Fn = (a: { data: unknown; context: unknown }) => Promise<Record<string, unknown>>;
  const ler = (item: string, grupo?: string) =>
    (lerDocumentoLocacao as unknown as Fn)({
      data: { documentoId: DOC },
      context: { supabase: prep(item, grupo), userId: "user-1" },
    });
  const logs: string[] = [];
  beforeEach(() => {
    st.gravados.length = 0;
    st.alertas.length = 0;
    st.download = true;
    logs.length = 0;
    vi.stubEnv("GEMINI_API_KEY", "chave-ficticia");
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const resposta = (obj: unknown) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }),
          {
            status: 200,
          },
        ),
    );

  it("lê, limpa e grava só sugestões válidas; chave no cabeçalho, mesmo modelo da venda", async () => {
    const f = resposta({
      nome: "Carlos Exemplo",
      cpf: "52998224725",
      rg: "9",
      data_nascimento: "1970-13-40",
    });
    vi.stubGlobal("fetch", f);
    const r = await ler("RG/CNH do fiador");
    expect(r).toEqual({ ok: true, status: "ok", preenchidos: 3 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("gemini-flash-latest:generateContent");
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("chave-ficticia");
    expect(st.gravados[0]).toMatchObject({
      _doc: DOC,
      _uid: "user-1",
      _status: "ok",
      _sugestoes: { fia_nome: "Carlos Exemplo", fia_cpf: "529.982.247-25", fia_rg: "9" },
    });
  });
  it("item sem leitura automática não chama a IA", async () => {
    const f = resposta({});
    vi.stubGlobal("fetch", f);
    const r = await ler("Formulário do proprietário (dados bancários p/ repasse)", "proprietario");
    expect(r).toEqual({ ok: true, status: "sem_leitura" });
    expect(f).not.toHaveBeenCalled();
    expect(st.gravados[0]._status).toBe("sem_leitura");
  });
  it("402 (sem crédito): selo IA falhou, aviso à plataforma, sem nova tentativa e sem dado no log", async () => {
    const f = vi.fn(
      async () => new Response("detalhe do google com Carlos Exemplo", { status: 402 }),
    );
    vi.stubGlobal("fetch", f);
    const r = await ler("RG/CNH do fiador");
    expect(r).toEqual({ ok: false, status: "falhou", erro: "IA_SEM_CREDITO" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(st.alertas[0]).toMatchObject({
      origem: "locacao_documento",
      orgId: "org-1",
      code: "IA_SEM_CREDITO",
    });
    expect(st.gravados[0]).toMatchObject({ _status: "falhou", _erro: "IA_SEM_CREDITO" });
    expect(logs.join(" ")).not.toContain("Carlos");
  });
  it("5xx tenta uma segunda vez; JSON inválido duas vezes = falhou", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "não é json" }] } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", f);
    const r = await ler("RG/CNH do fiador");
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: false, status: "falhou", erro: "FALHA" });
  });
  it("sem chave configurada: falha clara e o corretor digita", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const r = await ler("RG/CNH do fiador");
    expect(r).toEqual({ ok: false, status: "falhou", erro: "NAO_CONFIGURADA" });
  });
  it("erro de permissão do banco sobe (o navegador mostra a mensagem)", async () => {
    await expect(
      (lerDocumentoLocacao as unknown as Fn)({
        data: { documentoId: DOC },
        context: {
          supabase: {
            rpc: async () => ({
              data: null,
              error: { message: "Só o corretor da locação faz esta ação." },
            }),
          },
          userId: "user-2",
        },
      }),
    ).rejects.toThrow("Só o corretor");
    expect(st.gravados).toHaveLength(0);
  });
});
