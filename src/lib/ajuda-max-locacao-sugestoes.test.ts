// Ajuda MAX na Locação — fatia 2/2 (t_365484dc): registro de ideia/erro/dúvida e tela "Sugestões e erros".
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  STATUS_GESTAO,
  TEXTO_MAX,
  confirmacaoEnvio,
  filtrarEnvios,
  lerEnvios,
  origemDaTela,
  origemDoEnvio,
  resumoEnvios,
  statusEnvioLabel,
  textoDoEnvio,
  tipoEnvioLabel,
} from "@/lib/ajuda-max-locacao-sugestoes";
import { TEXTO_NAO_SEI, telaDaRota } from "@/lib/ajuda-max-locacao";
import { responderPergunta, type DepsFluxo } from "@/lib/ajuda-max-locacao-fluxo";
import { assinaturaBate, nomeDaTela, nomeOrigem } from "@/lib/ajuda-sugestoes";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIG = ler("../../supabase/migrations/20261117120000_ajuda_max_locacao_sugestoes.sql");
const RB = ler("../../supabase/rollback/20261117120000_ajuda_max_locacao_sugestoes.sql");
const FN = ler("./ajuda-max-locacao-sugestoes.functions.ts");
const FN_IA = ler("./ajuda-max-locacao.functions.ts");
const BALAO = ler("../components/locacao/AjudaMaxLocacao.tsx");
const TELA = ler("../routes/_authenticated/locacoes.sugestoes.tsx");
const TOPO = ler("../components/AjudaSugestoes.tsx");

describe("mapa de nomes de telas (rotas /locacoes)", () => {
  it("nomeia lista, detalhe e Sugestões e erros", () => {
    expect(nomeDaTela("/locacoes")).toBe("Locação");
    expect(nomeDaTela("/locacoes/7c1d2e3f-0000-4000-8000-000000000001")).toBe(
      "Locação › Detalhe da locação",
    );
    expect(nomeDaTela("/locacoes/sugestoes")).toBe("Locação › Sugestões e erros");
    expect(nomeDaTela("/vendas")).toBe("Vendas");
  });
  it("a origem gravada nunca leva o id da locação", () => {
    const o = origemDoEnvio("/locacoes/7c1d2e3f-0000-4000-8000-000000000001");
    expect(o).toEqual({ telaNome: "Locação › Detalhe da locação", telaRota: "/locacoes/…" });
    expect(origemDaTela("detalhe").telaRota).toBe("/locacoes/…");
    expect(origemDaTela("lista")).toEqual({ telaNome: "Locação", telaRota: "/locacoes" });
  });
  it("o balão não aparece na tela Sugestões e erros", () => {
    expect(telaDaRota("/locacoes/sugestoes")).toBeNull();
    expect(telaDaRota("/locacoes/abc")).toBe("detalhe");
  });
  it("origem 'locacao' tem nome na central da equipe MAX", () => {
    expect(nomeOrigem("locacao")).toBe("Locação (Ajuda MAX)");
  });
});

describe("texto e confirmação do envio", () => {
  it("dúvida sem resposta vai mascarada (igual foi à IA); ideia/erro como escrito", () => {
    expect(textoDoEnvio("duvida", "meu CPF 123.456.789-09 como faço?")).toBe(
      "meu CPF [dado removido] como faço?",
    );
    expect(textoDoEnvio("sugestao", "  filtro   das paradas  ")).toBe("filtro das paradas");
    expect(textoDoEnvio("erro", "x".repeat(TEXTO_MAX + 50))).toHaveLength(TEXTO_MAX);
  });
  it("mensagens de confirmação dizem onde ver e não prometem causa", () => {
    expect(
      confirmacaoEnvio("sugestao", { numero: 1001, telaNome: "Locação", comPrint: false }),
    ).toMatch(/Registrei sua ideia \(#1001\).*Sugestões e erros/);
    const erro = confirmacaoEnvio("erro", { numero: 7, telaNome: "Locação", comPrint: true });
    expect(erro).toMatch(/com o print/);
    expect(erro).toMatch(/Origem: Locação/);
    expect(erro).toMatch(/Não tentei adivinhar a causa/);
    expect(confirmacaoEnvio("duvida", { numero: null, telaNome: "", comPrint: false })).toMatch(
      /dúvida sem resposta/,
    );
  });
  it("rótulos da maquete: novo / em análise / resolvido", () => {
    expect(STATUS_GESTAO).toEqual(["recebido", "em_analise", "resolvido"]);
    expect(STATUS_GESTAO.map(statusEnvioLabel)).toEqual(["Novo", "Em análise", "Resolvido"]);
    expect(tipoEnvioLabel("sugestao")).toBe("Ideia");
    expect(tipoEnvioLabel("duvida")).toBe("Dúvida sem resposta");
  });
});

describe("lista da tela", () => {
  const raw = {
    gestao: true,
    itens: [
      {
        id: "a",
        numero: 1,
        tipo: "sugestao",
        status: "recebido",
        texto: "t",
        tela_nome: "Locação",
        autor_nome: "Ana",
        meu: true,
        tem_print: false,
        created_at: "2026-11-11T12:00:00Z",
      },
      {
        id: "b",
        numero: 2,
        tipo: "erro",
        status: "em_analise",
        texto: "t",
        tela_nome: "Locação",
        autor_nome: "Bia",
        meu: false,
        tem_print: true,
        created_at: "2026-11-11T13:00:00Z",
      },
      {
        id: "c",
        numero: 3,
        tipo: "duvida",
        status: "recebido",
        texto: "t",
        meu: false,
        created_at: "x",
      },
      { numero: 4 },
    ],
  };
  it("leitura fechada descarta item sem id e preenche padrões", () => {
    const l = lerEnvios(raw);
    expect(l.gestao).toBe(true);
    expect(l.itens.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(l.itens[2]).toMatchObject({
      telaNome: "Locação",
      autorNome: "Usuário",
      temPrint: false,
    });
    expect(lerEnvios(null)).toEqual({ gestao: false, itens: [] });
  });
  it("filtros e números dos cartões", () => {
    const { itens } = lerEnvios(raw);
    expect(filtrarEnvios(itens, "erro", false).map((i) => i.id)).toEqual(["b"]);
    expect(filtrarEnvios(itens, "todos", true).map((i) => i.id)).toEqual(["a"]);
    expect(resumoEnvios(itens)).toEqual({ total: 3, ideias: 1, erros: 1, novos: 2 });
  });
});

describe("dúvida sem resposta no fluxo da pergunta (IA simulada)", () => {
  const base = (over: Partial<DepsFluxo>): DepsFluxo => ({
    reservar: async () => ({ ok: true, usadas: 1, limite: 20, org: "org-a", dia: "2026-11-11" }),
    fechar: vi.fn(async () => {}),
    chamarIA: async () => ({
      ok: true,
      texto: '{"sabe":false,"resposta":""}',
      entrada: 10,
      saida: 2,
    }),
    ...over,
  });
  const ENTRADA = {
    pergunta: "Quanto está o aluguel da Mariana?",
    tela: "lista" as const,
    historico: [],
  };

  it("IA não soube: registra e avisa com o número", async () => {
    const registrarDuvida = vi.fn(async () => 1005);
    const r = await responderPergunta(ENTRADA, base({ registrarDuvida }));
    expect(registrarDuvida).toHaveBeenCalledWith(ENTRADA.pergunta);
    expect(r).toMatchObject({
      ok: true,
      sabe: false,
      resposta: TEXTO_NAO_SEI,
      duvida: { registrada: true, numero: 1005 },
    });
  });
  it("registro falhou: a resposta continua e a pessoa é avisada", async () => {
    const r = await responderPergunta(
      ENTRADA,
      base({
        registrarDuvida: async () => {
          throw new Error("x");
        },
      }),
    );
    expect(r).toMatchObject({ ok: true, sabe: false, duvida: { registrada: false } });
  });
  it("IA soube: não registra nada", async () => {
    const registrarDuvida = vi.fn(async () => 1);
    const r = await responderPergunta(
      ENTRADA,
      base({
        registrarDuvida,
        chamarIA: async () => ({
          ok: true,
          texto: '{"sabe":true,"resposta":"1. Clique em **Nova locação**."}',
          entrada: 1,
          saida: 1,
        }),
      }),
    );
    expect(registrarDuvida).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("duvida");
  });
  it("IA indisponível ou limite: não registra (não é 'não soube')", async () => {
    const registrarDuvida = vi.fn(async () => 1);
    await responderPergunta(ENTRADA, base({ registrarDuvida, chamarIA: null }));
    await responderPergunta(
      ENTRADA,
      base({ registrarDuvida, reservar: async () => ({ ok: false, usadas: 20, limite: 20 }) }),
    );
    expect(registrarDuvida).not.toHaveBeenCalled();
  });
  it("a função de servidor registra com o login de quem perguntou (não service_role)", () => {
    const trecho = FN_IA.slice(FN_IA.indexOf("registrarDuvida:"));
    expect(trecho).toMatch(/db\.rpc\("ajuda_max_locacao_registrar"/);
    expect(trecho).toMatch(/textoDoEnvio\("duvida", pergunta\)/);
  });
});

describe("anexo: reaproveita o chamado e não vai à IA", () => {
  it("assinatura do arquivo (compartilhada com o chamado do topo)", () => {
    expect(assinaturaBate(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png")).toBe(
      true,
    );
    expect(assinaturaBate(new Uint8Array([255, 216, 255, 0]), "image/jpeg")).toBe(true);
    expect(assinaturaBate(new Uint8Array([1, 2, 3]), "image/jpeg")).toBe(false);
  });
  it("mesmo bucket privado, mesmo caminho, mesmos tipos e 5 MB; link assinado de 5 min", () => {
    expect(FN).toMatch(/const BUCKET = "support-attachments"/);
    expect(FN).toMatch(/caminhoDoPrint\(orgId, userId, crypto\.randomUUID\(\), ext\)/);
    expect(FN).toMatch(/decodificarPrint\(data\.print\)/);
    expect(FN).toMatch(/assinaturaBate\(bytes, data\.print\.contentType\)/);
    expect(FN).toMatch(/createSignedUrl\(path, 300\)/);
    expect(FN).toMatch(/ajuda_max_locacao_sugestao_print/);
    expect(FN).toMatch(/remove\(\[printPath\]\)/); // envio falhou: apaga o print
    expect(FN).toMatch(/ajuda_max_locacao_enabled/); // chave conferida antes de subir arquivo
  });
  it("o print nunca chega à função da IA", () => {
    expect(FN).not.toMatch(/gemini|generativelanguage|chamarIA/i);
    expect(FN_IA).not.toMatch(/print|base64|support-attachments/);
    expect(BALAO).toMatch(/O\s+print não vai para a IA/);
  });
  it("tarja reaproveitada do chamado do topo", () => {
    expect(BALAO).toMatch(/import \{[^}]*EditorTarja[^}]*\} from "@\/components\/AjudaSugestoes"/);
    expect(TOPO).toMatch(/export function EditorTarja/);
    expect(TOPO).toMatch(/export function exportarPrint/);
  });
  it("sem aviso (sino, WhatsApp, Telegram) nesta fase", () => {
    const codigo = FN.replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/notifications|ZIONTALK|telegram|enviarAvisos/i);
    expect(MIG).not.toMatch(/INSERT INTO public\.notifications/);
  });
});

describe("migration 20261117120000", () => {
  it("só acrescenta a origem 'locacao'; rollback volta à lista anterior e apaga só esses chamados", () => {
    expect(MIG).toMatch(/CHECK \(origem IN \('adm', 'estudo', 'visita', 'locacao'\)\)/);
    expect(RB).toMatch(/CHECK \(origem IN \('adm', 'estudo', 'visita'\)\)/);
    const del = RB.indexOf("DELETE FROM public.support_tickets WHERE origem = 'locacao'");
    expect(del).toBeGreaterThan(0);
    expect(del).toBeLessThan(RB.indexOf("ADD CONSTRAINT support_tickets_origem_check"));
    for (const f of ["registrar", "sugestoes", "sugestao_status", "sugestao_print"])
      expect(RB).toMatch(new RegExp(`DROP FUNCTION IF EXISTS public\\.ajuda_max_locacao_${f}\\(`));
  });
  it("não muda as RPCs do chamado do topo nem a fila do bot", () => {
    expect(MIG).not.toMatch(/(CREATE|REPLACE|DROP) FUNCTION public\.support_ticket_/);
    expect(MIG.replace(/^--.*$/gm, "")).not.toMatch(/max_suporte\./);
    expect(MIG).toMatch(/public\.support_ticket_create\(_tipo, _texto/); // reaproveita a validação e o freio
  });
  it("tudo exige login + chave; isolamento pela imobiliária do JWT", () => {
    const blocos = MIG.split("CREATE OR REPLACE FUNCTION").slice(1);
    expect(blocos).toHaveLength(4);
    for (const b of blocos) {
      expect(b).toMatch(/SECURITY DEFINER SET search_path TO ''/);
      expect(b).toMatch(/ajuda_max_locacao_enabled\(\)/);
      expect(b).toMatch(/auth\.uid\(\)/);
    }
    expect(MIG).toMatch(
      /t\.organization_id = _org AND t\.origem = 'locacao' AND \(_gestao OR t\.author_id = _uid\)/,
    );
    expect(MIG).toMatch(
      /WHERE id = _ticket AND organization_id = _org AND origem = 'locacao' FOR UPDATE/,
    );
    expect(MIG).toMatch(/t\.organization_id = public\.current_org_id\(\)/);
    expect(MIG).toMatch(/_gestao := public\.locacao_eh_gerencia\(_uid\)/);
    expect(MIG).toMatch(/IF NOT public\.locacao_eh_gerencia\(_uid\) THEN/);
    for (const g of MIG.match(/GRANT EXECUTE ON FUNCTION [^;]+;/g) ?? [])
      expect(g).toMatch(/TO authenticated;$/);
    expect(MIG.match(/REVOKE ALL ON FUNCTION [^;]+FROM PUBLIC, anon;/g)).toHaveLength(4);
  });
  it("status da gestão: só novo / em análise / resolvido", () => {
    expect(MIG).toMatch(/_status NOT IN \('recebido', 'em_analise', 'resolvido'\)/);
  });
});

describe("tela e balão", () => {
  it("rota protegida pela Locação e pela chave", () => {
    expect(TELA).toMatch(/guardLocacaoRoute\(\)/);
    expect(TELA).toMatch(/ajudaMaxLocacaoEnabled\(\)/);
    expect(TELA).toMatch(/ajuda_max_locacao_sugestoes/);
    expect(TELA).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it("colunas da maquete", () => {
    for (const c of ["Tipo", "Quem enviou", "Tela de origem", "Data", "Anexo", "Status"])
      expect(TELA).toContain(`>${c}</th>`);
  });
  it("balão tem os três modos da maquete e o registro não usa a IA", () => {
    for (const m of ["Dúvida de uso", "Dar ideia", "Relatar erro"]) expect(BALAO).toContain(m);
    expect(BALAO).toMatch(/registrarEnvioLocacao/);
    expect(BALAO).not.toMatch(/useParams|locacaoId|dangerouslySetInnerHTML/);
  });
  it("o botão 'Ajuda e sugestões' do topo segue abrindo chamado comum (sem origem locacao)", () => {
    expect(TOPO).toMatch(/criarChamado/);
    expect(TOPO).not.toMatch(/locacao/);
  });
});
