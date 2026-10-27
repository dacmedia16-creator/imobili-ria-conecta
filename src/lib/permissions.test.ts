import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { canCancelSale, canDeleteSale, rpcDeCancelamento } from "./permissions";
import type { AppRole } from "@/lib/auth";

// Decisão de Denis (28/09/2026): excluir venda SOMENTE em rascunho, por quem pode editá-la;
// nas demais etapas, só cancelar. O banco (policy delete_sales_por_papel, fase 2e) é a fonte da
// verdade; a tela só esconde o botão de quem seria recusado.
const DONO = "dono";
const OUTRO = "outro";
const as = (roles: AppRole[]) => (want: AppRole[]) => want.some((r) => roles.includes(r));
const venda = (status?: string) => ({ id: "v1", corretor_id: DONO, status });
const equipe = new Set([DONO]);

describe("canDeleteSale — só rascunho", () => {
  it("rascunho: criador, líder da equipe do criador, admin e super_admin veem Excluir", () => {
    expect(canDeleteSale(DONO, as(["corretor"]), venda("rascunho"), new Set())).toBe(true);
    expect(canDeleteSale(DONO, as(["lancamento"]), venda("rascunho"), new Set())).toBe(true);
    expect(canDeleteSale(OUTRO, as(["gestor"]), venda("rascunho"), equipe)).toBe(true);
    expect(canDeleteSale(OUTRO, as(["team_leader"]), venda("rascunho"), equipe)).toBe(true);
    for (const r of ["admin", "super_admin"] as AppRole[])
      expect(canDeleteSale(OUTRO, as([r]), venda("rascunho"), new Set())).toBe(true);
  });

  it("rascunho: participante que não criou, líder de outra equipe, financeiro, jurídico, lançamento e staff não veem Excluir", () => {
    expect(canDeleteSale(OUTRO, as(["corretor"]), venda("rascunho"), new Set())).toBe(false);
    expect(canDeleteSale(OUTRO, as(["gestor"]), venda("rascunho"), new Set())).toBe(false);
    expect(canDeleteSale(OUTRO, as(["team_leader"]), venda("rascunho"), new Set())).toBe(false);
    for (const r of ["financeiro", "juridico", "lancamento", "staff"] as AppRole[])
      expect(canDeleteSale(OUTRO, as([r]), venda("rascunho"), equipe)).toBe(false);
  });

  it.each(["devolvida_ajuste", "enviada_revisao", "aprovada_gestor", "ocorrencia_concluida"])(
    "%s: ninguém vê Excluir (só Cancelar)",
    (status) => {
      expect(canDeleteSale(DONO, as(["corretor"]), venda(status), new Set())).toBe(false);
      expect(canDeleteSale(OUTRO, as(["gestor"]), venda(status), equipe)).toBe(false);
      for (const r of ["financeiro", "admin", "super_admin"] as AppRole[])
        expect(canDeleteSale(OUTRO, as([r]), venda(status), new Set())).toBe(false);
    },
  );

  it("status desconhecido ou sem usuário: falha fechada", () => {
    expect(canDeleteSale(DONO, as(["admin"]), venda(undefined), new Set())).toBe(false);
    expect(canDeleteSale(null, as(["admin"]), venda("rascunho"), new Set())).toBe(false);
  });

  it("listas e detalhe da venda carregam o status usado pela regra", () => {
    const lista = readFileSync(
      new URL("../routes/_authenticated/vendas.index.tsx", import.meta.url),
      "utf8",
    );
    expect(lista).toMatch(/\|\s*"status"/);
  });
});

describe("canCancelSale — só o dono da plataforma, depois do rascunho (fase 2f)", () => {
  const etapas = [
    "enviada_revisao",
    "devolvida_ajuste",
    "aprovada_gestor",
    "em_elaboracao_contrato",
    "aguardando_assinatura",
    "contrato_assinado",
    "ocorrencia_pendente",
    "ocorrencia_analise_financeiro",
    "ocorrencia_concluida",
    "arquivada",
  ];
  it.each(etapas)("%s: dono da plataforma vê Cancelar; os demais não", (status) => {
    expect(canCancelSale(true, status)).toBe(true);
    expect(canCancelSale(false, status)).toBe(false);
    expect(canCancelSale(undefined, status)).toBe(false);
  });
  it("rascunho, já cancelada ou status desconhecido: ninguém vê Cancelar", () => {
    for (const s of ["rascunho", "cancelada", undefined, null, ""])
      expect(canCancelSale(true, s)).toBe(false);
  });
  it("a tela usa o banco (is_platform_super_admin) para escolher a RPC e mostra o botão ao admin da imobiliária", () => {
    const tela = readFileSync(
      new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
      "utf8",
    );
    expect(tela).toContain('supabase.rpc("is_platform_super_admin")');
    expect(tela).toContain("canCancelSale(isPlatformAdmin, status, isAdminLike)");
    expect(tela).toContain("cancelSale(id, archiveMotivo.trim(), isPlatformAdmin)");
    // O botão Cancelar não depende de canCloseSale (arquivar).
    expect(tela).toMatch(/\{canCancel && \(\s*<Button/);
    // Confirmação com motivo obrigatório continua (diálogo + botão desabilitado sem motivo).
    expect(tela).toMatch(
      /if \(!archiveMotivo\.trim\(\)\) \{\s*toast\.error\("Motivo é obrigatório"\)/,
    );
    expect(tela).toContain("disabled={!archiveMotivo.trim()}");
  });
});

describe("cancelar venda: Administrador e Administrador principal da imobiliária (t_3c10bab8)", () => {
  it("admin da imobiliária vê Cancelar depois do rascunho; os outros papéis não", () => {
    expect(canCancelSale(false, "enviada_revisao", true)).toBe(true);
    expect(canCancelSale(false, "contrato_assinado", true)).toBe(true);
    expect(canCancelSale(false, "enviada_revisao", false)).toBe(false);
    expect(canCancelSale(undefined, "enviada_revisao")).toBe(false);
    for (const s of ["rascunho", "cancelada", undefined, null, ""])
      expect(canCancelSale(false, s, true)).toBe(false);
  });
  it("cada um cancela pela própria RPC (plataforma x imobiliária)", () => {
    expect(rpcDeCancelamento(true)).toBe("platform_cancel_sale");
    expect(rpcDeCancelamento(false)).toBe("org_admin_cancel_sale");
    expect(rpcDeCancelamento(undefined)).toBe("org_admin_cancel_sale");
  });
});

describe("migration 20261027190000_admin_todos_botoes_venda (t_3c10bab8)", () => {
  const up = readFileSync(
    new URL(
      "../../supabase/migrations/20261027190000_admin_todos_botoes_venda.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const down = readFileSync(
    new URL("../../supabase/rollback/20261027190000_admin_todos_botoes_venda.sql", import.meta.url),
    "utf8",
  );
  it("libera admin nas capacidades de gestor e nas funções do jurídico", () => {
    expect(up).toContain("ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[]");
    expect(
      up.match(/ARRAY\['juridico','admin','super_admin'\]::public\.app_role\[\]/g),
    ).toHaveLength(2);
  });
  it("cancelar: RPC confere papel, imobiliária, motivo, rascunho e grava histórico com o autor", () => {
    expect(up).toContain(
      "CREATE OR REPLACE FUNCTION public.org_admin_cancel_sale(_sale_id uuid, _motivo text)",
    );
    expect(up).toContain("ARRAY['admin','super_admin']::public.app_role[]");
    expect(up).toContain("_org IS DISTINCT FROM public.current_org_id()");
    expect(up).toContain("Informe o motivo para cancelar a venda.");
    expect(up).toContain("Venda em rascunho não é cancelada");
    expect(up).toMatch(
      /INSERT INTO public\.sale_status_history \(sale_id, de, para, autor_id, motivo, organization_id\)\s*VALUES \(_sale_id, _prev::public\.sale_status, 'cancelada', _actor, _motivo_limpo, _org\)/,
    );
    expect(up).toContain(
      "REVOKE ALL ON FUNCTION public.org_admin_cancel_sale(uuid, text) FROM PUBLIC, anon;",
    );
    // O gatilho só aceita 'cancelada' com a marca local da RPC e na própria imobiliária.
    expect(up).toContain("current_setting('mt.org_cancel_sale', true) = old.id::text");
    expect(up).toContain("old.organization_id = public.current_org_id()");
  });
  it("registrar: policy de INSERT inclui admin/super_admin, sempre com corretor_id = quem cria", () => {
    expect(up).toMatch(
      /CREATE POLICY sales_insert_corretor[\s\S]*corretor_id = \( SELECT auth\.uid\(\) AS uid\)[\s\S]*'admin'::app_role, 'super_admin'::app_role/,
    );
  });
  it("rollback volta às definições anteriores e remove a RPC", () => {
    expect(down).toContain("DROP FUNCTION IF EXISTS public.org_admin_cancel_sale(uuid, text);");
    expect(down).toContain("ARRAY['gestor','team_leader','super_admin']::public.app_role[]");
    expect(down).not.toContain("mt.org_cancel_sale");
    expect(down).toContain("ARRAY['gestor'::app_role, 'team_leader'::app_role]) AS has_any_role)");
  });
});

describe("reserva de sala — gestor e team leader só a própria equipe (fase 2h, Denis 29/09)", () => {
  const tela = readFileSync(
    new URL("../routes/_authenticated/reservas-salas.tsx", import.meta.url),
    "utf8",
  );
  const semQuebra = tela.replace(/\s+/g, " ");
  it("texto da tela diz que gestor e team leader cancelam só a própria equipe", () => {
    expect(semQuebra).toContain("gestores e team leaders, as reservas da própria equipe");
    expect(semQuebra).toContain("gestores e team leaders, as da própria equipe");
    expect(semQuebra).not.toMatch(/gestores, team leaders, staff/);
  });
  it("botão Cancelar depende do banco (can_cancel_room_reservation), não do papel na tela", () => {
    expect(tela).toContain('supabase.rpc("can_cancel_room_reservation"');
    expect(tela).toMatch(/\{selectedReservation\?\.canCancel && \(/);
    expect(tela).toContain("reservation.canCancel && reservation.responsibleId !== user?.id");
    // Reserva que só aparece na grade de ocupação nunca mostra Cancelar.
    expect(tela).toMatch(/const mapOccupancy[\s\S]*?canCancel: false,/);
  });
  it("migration 2h restringe gestor/team_leader por is_lead_of nas duas funções, com .down", () => {
    const dir = new URL("../../supabase/multiempresa/migrations/", import.meta.url);
    const up = readFileSync(new URL("20260928120000_mt_fase2h_reservas_equipe.sql", dir), "utf8");
    const down = readFileSync(
      new URL("20260928120000_mt_fase2h_reservas_equipe.down.sql", dir),
      "utf8",
    );
    for (const fn of ["can_cancel_room_reservation", "can_view_room_reservation"]) {
      const body = up.split(`FUNCTION public.${fn}(`)[1].split("$function$;")[0];
      expect(body).toContain("ARRAY['admin', 'super_admin', 'staff']");
      expect(body).toMatch(
        /ARRAY\['gestor', 'team_leader'\][\s\S]*AND public\.is_lead_of\(_actor, _responsible_id\)/,
      );
      expect(body).toContain(
        "public.mt_in_ctx_org(_actor) AND public.mt_in_ctx_org(_responsible_id)",
      );
    }
    expect(down).toContain("FROM public.mt_2h_backup");
    expect(down).toContain("DROP TABLE public.mt_2h_backup");
  });
});
