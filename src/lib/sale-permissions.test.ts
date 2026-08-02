import { describe, expect, it } from "vitest";
import type { AppRole } from "@/lib/auth";
import type { SaleStatus } from "@/lib/status";
import {
  comissaoValorExcedido,
  corretorPodeEditar,
  deveOcultarBlocoComissao,
  getSaleRoleFlags,
  gestorPodeEditar,
  isSaleLocked,
  juridicoPodeEditar,
  podeEditarComissao,
  podeEditarOcorrencia,
  podeEditarVenda,
  podeFinalizarOcorrencia,
  podeVerOcorrencia,
  podeVerResumoCompleto,
} from "./sale-permissions";

const CORRETOR_ID = "corretor-1";
const OUTRO_ID = "outro-usuario";

describe("getSaleRoleFlags", () => {
  it("identifica o dono da venda", () => {
    expect(getSaleRoleFlags([], CORRETOR_ID, CORRETOR_ID).isOwner).toBe(true);
    expect(getSaleRoleFlags([], CORRETOR_ID, OUTRO_ID).isOwner).toBe(false);
    expect(getSaleRoleFlags([], CORRETOR_ID, undefined).isOwner).toBe(false);
  });

  it("isFinanceiro é true pra financeiro, admin ou super_admin", () => {
    expect(getSaleRoleFlags(["financeiro"], CORRETOR_ID, OUTRO_ID).isFinanceiro).toBe(true);
    expect(getSaleRoleFlags(["admin"], CORRETOR_ID, OUTRO_ID).isFinanceiro).toBe(true);
    expect(getSaleRoleFlags(["super_admin"], CORRETOR_ID, OUTRO_ID).isFinanceiro).toBe(true);
    expect(getSaleRoleFlags(["corretor"], CORRETOR_ID, OUTRO_ID).isFinanceiro).toBe(false);
  });

  it("isAdminLike é true só pra admin ou super_admin", () => {
    expect(getSaleRoleFlags(["admin"], CORRETOR_ID, OUTRO_ID).isAdminLike).toBe(true);
    expect(getSaleRoleFlags(["super_admin"], CORRETOR_ID, OUTRO_ID).isAdminLike).toBe(true);
    expect(getSaleRoleFlags(["financeiro"], CORRETOR_ID, OUTRO_ID).isAdminLike).toBe(false);
  });

  it("isGestor e isJuridico batem com o papel exato", () => {
    const flags = getSaleRoleFlags(["gestor", "juridico"], CORRETOR_ID, OUTRO_ID);
    expect(flags.isGestor).toBe(true);
    expect(flags.isJuridico).toBe(true);
    expect(getSaleRoleFlags(["corretor"], CORRETOR_ID, OUTRO_ID).isGestor).toBe(false);
    expect(getSaleRoleFlags(["corretor"], CORRETOR_ID, OUTRO_ID).isJuridico).toBe(false);
  });

  it("um usuário pode acumular vários papéis ao mesmo tempo", () => {
    const roles: AppRole[] = ["gestor", "admin"];
    const flags = getSaleRoleFlags(roles, CORRETOR_ID, OUTRO_ID);
    expect(flags.isGestor).toBe(true);
    expect(flags.isAdminLike).toBe(true);
    expect(flags.isFinanceiro).toBe(true); // admin conta como financeiro também
  });
});

describe("isSaleLocked", () => {
  it("trava quando o financeiro aceitou a ocorrência", () => {
    expect(isSaleLocked("contrato_assinado", true)).toBe(true);
  });

  it("trava quando o status é ocorrencia_concluida, mesmo sem aceite explícito", () => {
    expect(isSaleLocked("ocorrencia_concluida", false)).toBe(true);
  });

  it("não trava em outros status sem aceite do financeiro", () => {
    expect(isSaleLocked("enviada_revisao", false)).toBe(false);
    expect(isSaleLocked("contrato_assinado", false)).toBe(false);
  });
});

describe("corretorPodeEditar", () => {
  it("permite em rascunho e devolvida_ajuste, só pro dono", () => {
    expect(corretorPodeEditar(true, "rascunho")).toBe(true);
    expect(corretorPodeEditar(true, "devolvida_ajuste")).toBe(true);
  });

  it("nega fora desses status ou se não for o dono", () => {
    expect(corretorPodeEditar(true, "enviada_revisao")).toBe(false);
    expect(corretorPodeEditar(false, "rascunho")).toBe(false);
  });
});

describe("gestorPodeEditar", () => {
  const permitidos: SaleStatus[] = [
    "enviada_revisao",
    "contrato_conferencia_gestor",
    "contrato_ok_corretor",
    "aguardando_assinatura",
    "contrato_assinado",
    "ocorrencia_pendente",
    "ocorrencia_devolvida_gestor",
  ];

  it("permite em todos os status esperados, sendo gestor", () => {
    for (const status of permitidos) expect(gestorPodeEditar(true, status)).toBe(true);
  });

  it("nega fora desses status ou se não for gestor", () => {
    expect(gestorPodeEditar(true, "rascunho")).toBe(false);
    expect(gestorPodeEditar(false, "enviada_revisao")).toBe(false);
  });
});

describe("juridicoPodeEditar", () => {
  it("permite em aprovada_gestor e em_elaboracao_contrato, sendo jurídico", () => {
    expect(juridicoPodeEditar(true, "aprovada_gestor")).toBe(true);
    expect(juridicoPodeEditar(true, "em_elaboracao_contrato")).toBe(true);
  });

  it("nega fora desses status ou se não for jurídico", () => {
    expect(juridicoPodeEditar(true, "enviada_revisao")).toBe(false);
    expect(juridicoPodeEditar(false, "aprovada_gestor")).toBe(false);
  });
});

describe("podeEditarVenda", () => {
  const base = {
    corretorEdits: false,
    gestorEdits: false,
    juridicoEdits: false,
    isFinanceiro: false,
    isAdminLike: false,
    locked: false,
  };

  it("libera se qualquer papel tem edição no status atual", () => {
    expect(podeEditarVenda({ ...base, corretorEdits: true })).toBe(true);
    expect(podeEditarVenda({ ...base, gestorEdits: true })).toBe(true);
    expect(podeEditarVenda({ ...base, juridicoEdits: true })).toBe(true);
    expect(podeEditarVenda({ ...base, isFinanceiro: true })).toBe(true);
    expect(podeEditarVenda({ ...base, isAdminLike: true })).toBe(true);
  });

  it("nega se ninguém tem edição no status atual", () => {
    expect(podeEditarVenda(base)).toBe(false);
  });

  it("venda travada bloqueia corretor/gestor/jurídico mas não financeiro/admin", () => {
    expect(podeEditarVenda({ ...base, corretorEdits: true, locked: true })).toBe(false);
    expect(podeEditarVenda({ ...base, isFinanceiro: true, locked: true })).toBe(true);
    expect(podeEditarVenda({ ...base, isAdminLike: true, locked: true })).toBe(true);
  });
});

describe("podeEditarComissao", () => {
  it("financeiro e admin podem editar comissão mesmo sem gestorEdits", () => {
    expect(
      podeEditarComissao({
        gestorEdits: false,
        isFinanceiro: true,
        isAdminLike: false,
        locked: false,
      }),
    ).toBe(true);
    expect(
      podeEditarComissao({
        gestorEdits: false,
        isFinanceiro: false,
        isAdminLike: true,
        locked: false,
      }),
    ).toBe(true);
  });

  it("gestor edita comissão quando gestorEdits é true", () => {
    expect(
      podeEditarComissao({
        gestorEdits: true,
        isFinanceiro: false,
        isAdminLike: false,
        locked: false,
      }),
    ).toBe(true);
  });

  it("sem nenhum dos três, não edita", () => {
    expect(
      podeEditarComissao({
        gestorEdits: false,
        isFinanceiro: false,
        isAdminLike: false,
        locked: false,
      }),
    ).toBe(false);
  });

  it("venda travada bloqueia gestor mas não financeiro/admin", () => {
    expect(
      podeEditarComissao({
        gestorEdits: true,
        isFinanceiro: false,
        isAdminLike: false,
        locked: true,
      }),
    ).toBe(false);
    expect(
      podeEditarComissao({
        gestorEdits: false,
        isFinanceiro: true,
        isAdminLike: false,
        locked: true,
      }),
    ).toBe(true);
  });
});

describe("deveOcultarBlocoComissao", () => {
  it("esconde do corretor fora de devolvida_ajuste", () => {
    expect(deveOcultarBlocoComissao(true, "rascunho")).toBe(true);
    expect(deveOcultarBlocoComissao(true, "enviada_revisao")).toBe(true);
  });

  it("mostra pro corretor quando a venda foi devolvida pra ajuste", () => {
    expect(deveOcultarBlocoComissao(true, "devolvida_ajuste")).toBe(false);
  });

  it("nunca esconde de quem não é o corretor dono", () => {
    expect(deveOcultarBlocoComissao(false, "rascunho")).toBe(false);
  });
});

describe("comissaoValorExcedido", () => {
  it("excede quando captador + vendedor passa do total", () => {
    expect(comissaoValorExcedido(1000, 600, 500)).toBe(true);
  });

  it("não excede quando a soma bate exatamente com o total", () => {
    expect(comissaoValorExcedido(1000, 500, 500)).toBe(false);
  });

  it("não excede quando o total ainda não foi preenchido", () => {
    expect(comissaoValorExcedido(0, 500, 600)).toBe(false);
  });

  it("tolera diferença de arredondamento até 0.01", () => {
    expect(comissaoValorExcedido(1000, 500, 500.01)).toBe(false);
    expect(comissaoValorExcedido(1000, 500, 500.02)).toBe(true);
  });
});

describe("podeVerOcorrencia / podeVerResumoCompleto", () => {
  it("ocorrência só aparece a partir de contrato_assinado em diante", () => {
    expect(podeVerOcorrencia("contrato_assinado")).toBe(true);
    expect(podeVerOcorrencia("ocorrencia_concluida")).toBe(true);
    expect(podeVerOcorrencia("rascunho")).toBe(false);
    expect(podeVerOcorrencia("aprovada_gestor")).toBe(false);
  });

  it("resumo completo fica oculto só no início do fluxo", () => {
    expect(podeVerResumoCompleto("rascunho")).toBe(false);
    expect(podeVerResumoCompleto("devolvida_ajuste")).toBe(false);
    expect(podeVerResumoCompleto("enviada_revisao")).toBe(false);
    expect(podeVerResumoCompleto("aprovada_gestor")).toBe(true);
  });
});

describe("podeEditarOcorrencia", () => {
  it("gestor edita só nos status de ocorrência permitidos", () => {
    expect(
      podeEditarOcorrencia({
        isGestor: true,
        status: "contrato_assinado",
        isFinanceiro: false,
        isAdminLike: false,
      }),
    ).toBe(true);
    expect(
      podeEditarOcorrencia({
        isGestor: true,
        status: "ocorrencia_analise_financeiro",
        isFinanceiro: false,
        isAdminLike: false,
      }),
    ).toBe(false);
  });

  it("financeiro e admin sempre podem, independente do status", () => {
    expect(
      podeEditarOcorrencia({
        isGestor: false,
        status: "rascunho",
        isFinanceiro: true,
        isAdminLike: false,
      }),
    ).toBe(true);
    expect(
      podeEditarOcorrencia({
        isGestor: false,
        status: "rascunho",
        isFinanceiro: false,
        isAdminLike: true,
      }),
    ).toBe(true);
  });

  it("nega pra quem não é gestor/financeiro/admin", () => {
    expect(
      podeEditarOcorrencia({
        isGestor: false,
        status: "contrato_assinado",
        isFinanceiro: false,
        isAdminLike: false,
      }),
    ).toBe(false);
  });
});

describe("podeFinalizarOcorrencia", () => {
  it("só financeiro ou admin finalizam", () => {
    expect(podeFinalizarOcorrencia(true, false)).toBe(true);
    expect(podeFinalizarOcorrencia(false, true)).toBe(true);
    expect(podeFinalizarOcorrencia(false, false)).toBe(false);
  });
});
