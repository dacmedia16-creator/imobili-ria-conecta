import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emailValido,
  partesQueExigemEmail,
  pendenciasEmail,
  totalChecksEmail,
  validarProntaParaRevisao,
} from "./status";
import { destinoDaPendencia } from "./pendencia-navegacao";
import { saleSendCheck, showClicksignSend, needsAutoCancel } from "./sale-clicksign";
import type { PartyRow, SaleRow } from "@/lib/database.types";

const ler = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const parte = (nome: string | null, email: string | null) =>
  ({ nome, email, cpf_cnpj: "000" }) as unknown as PartyRow;

describe("e-mail obrigatório (opção B): pendência ao enviar para revisão", () => {
  it("cobra o e-mail dos papéis-base e de quem tem nome; trata inválido como faltando", () => {
    const parties = {
      vendedor_1: parte("Ana Vendedora", null),
      comprador_1: parte("Beto Comprador", "beto@"),
      comprador_2: parte("Caio Comprador", "caio@example.com"),
      vendedor_2: parte(null, null), // vazia: não cobra
    };
    const pend = pendenciasEmail({} as SaleRow, parties);
    expect(pend.map((p) => p.campo)).toEqual(["email_comprador_1", "email_vendedor_1"]);
    expect(pend.find((p) => p.campo === "email_comprador_1")?.mensagem).toMatch(/inválido/);
    expect(
      validarProntaParaRevisao({} as SaleRow, parties, null, []).map((p) => p.campo),
    ).toContain("email_vendedor_1");
  });

  it("lançamento fica fora (fluxo próprio)", () => {
    const s = { modalidade: "lancamento", parceria_tipo: "externa" } as unknown as SaleRow;
    expect(partesQueExigemEmail(s, {})).toEqual([]);
    expect(pendenciasEmail(s, {})).toEqual([]);
  });

  it("parceria externa exige e-mail do parceiro", () => {
    const s = { parceria_tipo: "externa", parceria_email: "" } as unknown as SaleRow;
    expect(pendenciasEmail(s, {}).map((p) => p.campo)).toContain("parceria_email");
    const ok = { parceria_tipo: "externa", parceria_email: "p@example.com" } as unknown as SaleRow;
    expect(pendenciasEmail(ok, {}).map((p) => p.campo)).not.toContain("parceria_email");
    expect(totalChecksEmail(s, {})).toBe(3);
  });

  it("cada pendência de e-mail leva à aba Partes (ou ao bloco da parceria) e o id existe na tela", () => {
    expect(destinoDaPendencia("email_comprador_2")).toMatchObject({
      etapa: "partes",
      parte: "comprador_2",
      alvoId: "campo-parte-email-comprador_2",
    });
    expect(destinoDaPendencia("parceria_email")).toMatchObject({
      etapa: "resumo",
      bloco: "equipe",
    });
    expect(ler("../components/vendas/PartiesStep.tsx")).toContain("campo-parte-email-${p}");
    expect(ler("../routes/_authenticated/vendas.$id.tsx")).toContain(
      '"campo-venda-parceria_email"',
    );
  });

  it("venda antiga sem e-mail continua abrindo e salvando: nada no banco ficou obrigatório", () => {
    const mig = ler("../../supabase/migrations/20261018200000_clicksign_venda.sql");
    // Nenhuma restrição de e-mail (só consultas "IS NOT NULL" existem).
    expect(mig).not.toMatch(/email\s+text\s+NOT NULL/i);
    expect(mig).not.toMatch(/ALTER COLUMN\s+\w*email\w*\s+SET NOT NULL/i);
    expect(mig).not.toMatch(/CHECK\s*\([^)]*email/i);
    expect(mig).toMatch(/occurrence_partners ADD COLUMN IF NOT EXISTS email text;/);
    // O formulário não bloqueia o autosave por e-mail (só marca o campo).
    const form = ler("../components/vendas/PartiesStep.tsx");
    const saveAll = form.slice(
      form.indexOf("const saveAll"),
      form.indexOf("registerSaver(saveAll)"),
    );
    expect(saveAll).not.toMatch(/emailValido/);
    expect(emailValido("x@example.com")).toBe(true);
    expect(emailValido("x@example")).toBe(false);
  });

  it("criação de venda, IA e lançamento não exigem e-mail (sem trava nesses fluxos)", () => {
    for (const f of [
      "../routes/_authenticated/vendas.nova.tsx",
      "./documents.functions.ts",
      "../components/vendas/LancamentoDetail.tsx",
    ])
      expect(ler(f), f).not.toMatch(/emailValido|pendenciasEmail/);
  });
});

describe("Clicksign na venda: tela", () => {
  const cfg = (over: Record<string, unknown> = {}) =>
    ({
      enabled: true,
      test_mode: true,
      can_send: true,
      witnesses: 2,
      deadline_days: 30,
      libera_assinatura: true,
      contrato: { id: "c1", file_name: "contrato.pdf" },
      imobiliaria: [{ id: "i1", nome: "Imob Um" }],
      corretores: [{ nome: "Corretor Um", email_ok: true }],
      envelope: null,
      ...over,
    }) as never;
  const base = {
    parties: [
      { papel: "vendedor_1", nome: "Ana Vendedora", email: "ana@example.com" },
      { papel: "comprador_1", nome: "Beto Comprador", email: null },
    ],
    corretores: [{ nome: "Corretor Um", email_ok: true }],
    liberaAssinatura: true,
    imobiliariaIds: ["i1"],
    testemunhas: [
      { nome: "Teste Um", email: "t1@example.com" },
      { nome: "Teste Dois", email: "t2@example.com" },
    ],
    extras: [],
  };

  it("botão só para quem pode enviar, em contrato_ok_corretor e com a Clicksign ligada", () => {
    expect(showClicksignSend(cfg(), "contrato_ok_corretor")).toBe(true);
    expect(showClicksignSend(cfg({ can_send: false }), "contrato_ok_corretor")).toBe(false);
    expect(showClicksignSend(cfg(), "aguardando_assinatura")).toBe(false);
    expect(showClicksignSend({ enabled: false }, "contrato_ok_corretor")).toBe(false);
  });

  it("parte sem e-mail bloqueia com atalho para a parte certa", () => {
    const r = saleSendCheck(base);
    expect(r.missing).toEqual([
      { parte: "comprador_1", label: "Comprador 1", nome: "Beto Comprador" },
    ]);
  });

  it("bloqueio do jurídico, e-mail repetido e pessoa de fora com CPF inválido", () => {
    const r = saleSendCheck({
      ...base,
      liberaAssinatura: false,
      extras: [
        {
          origem: "externo",
          nome: "Dra Fulana Silva",
          email: "ana@example.com",
          cpf: "123",
          role: "lawyer",
        },
      ],
    });
    expect(r.errors.join("|")).toMatch(/jurídico bloqueou/);
    expect(r.errors.join("|")).toMatch(/duas vezes/);
    expect(r.errors.join("|")).toMatch(/CPF inválido/);
  });

  it("cancelamento automático só com pedido do banco e envelope rodando", () => {
    expect(
      needsAutoCancel(cfg({ envelope: { status: "running", cancel_requested_at: "2026-10-18" } })),
    ).toBe(true);
    expect(needsAutoCancel(cfg({ envelope: { status: "running" } }))).toBe(false);
    expect(
      needsAutoCancel(
        cfg({ can_send: false, envelope: { status: "running", cancel_requested_at: "x" } }),
      ),
    ).toBe(false);
  });
});
