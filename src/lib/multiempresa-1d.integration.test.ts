/**
 * Marco 1d (multiempresa) — rotinas com service_role contra o CLONE LOCAL descartável.
 *
 * Roda somente quando MT1D_REST_URL (http://127.0.0.1:...) e MT1D_REST_TOKEN_FILE estão definidos
 * (ver supabase/multiempresa/run-1d.sh). Recusa qualquer host que não seja 127.0.0.1: nunca fala
 * com o Supabase real. Fixture sintética A↔B em supabase/multiempresa/tests/fixture_1d_rest.sql.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertUserInOrg,
  listOrgUserIds,
  resolveActiveOrg,
  type OrgAdminClient,
} from "./org-scope";
import { runRoomReservationReminders } from "./room-reservation-reminders.server";
import { startAt, type RoomReservationRow } from "./room-reservation-reminders";
import {
  keepOrgMembers,
  leaderIdsForCorretor,
  profilesInOrg,
  roleRowsInOrg,
  roleUserIds,
  saleOrg,
} from "./sale-notifications.server";
import { listAvailableCorretores, listLeaderCandidates } from "./team.server";
import { handleJuridicoRequest } from "../../supabase/functions/max-juridico-contratos/core.ts";
import { bridgeOrgGate } from "../../supabase/functions/conta-max-bridge/core.ts";

const REST_URL = process.env.MT1D_REST_URL ?? "";
const TOKEN_FILE = process.env.MT1D_REST_TOKEN_FILE ?? "";
const ENABLED = /^http:\/\/127\.0\.0\.1:\d+$/.test(REST_URL) && TOKEN_FILE.length > 0;

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "3d000000-0000-4000-8000-0000000000b0";
const A_GESTOR = "3d000000-0000-4000-8000-00000000a001";
const A_CORRETOR = "3d000000-0000-4000-8000-00000000a002";
const A_FIN = "3d000000-0000-4000-8000-00000000a003";
const B_GESTOR = "3d000000-0000-4000-8000-00000000b001";
const B_CORRETOR = "3d000000-0000-4000-8000-00000000b002";
const B_FIN = "3d000000-0000-4000-8000-00000000b003";
const SALE_A = "3d050000-0000-4000-8000-00000000000a";
const SALE_B = "3d050000-0000-4000-8000-00000000000b";
const DOC_A = "3d0d0000-0000-4000-8000-00000000000a";
const DOC_B = "3d0d0000-0000-4000-8000-00000000000b";
const RES_A = "3d070000-0000-4000-8000-00000000000a";
const RES_B = "3d070000-0000-4000-8000-00000000000b";
const A_IDS = new Set([A_GESTOR, A_CORRETOR, A_FIN]);
const B_IDS = new Set([B_GESTOR, B_CORRETOR, B_FIN]);

let admin: OrgAdminClient;

describe.skipIf(!ENABLED)("multiempresa 1d — service_role com escopo de agência (clone local)", () => {
  beforeAll(() => {
    const token = readFileSync(TOKEN_FILE, "utf8").trim();
    // PostgREST local serve na raiz; o supabase-js usa /rest/v1.
    const localFetch: typeof fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input).replace("/rest/v1", "");
      if (!url.startsWith(REST_URL)) throw new Error(`Destino não local bloqueado: ${url}`);
      return fetch(url, init);
    };
    admin = createClient(REST_URL, token, {
      global: { fetch: localFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as OrgAdminClient;
  });

  it("resolve a agência ativa de cada usuário e falha fechada para desconhecido", async () => {
    expect(await resolveActiveOrg(admin, A_GESTOR)).toBe(ORG_A);
    expect(await resolveActiveOrg(admin, B_GESTOR)).toBe(ORG_B);
    await expect(
      resolveActiveOrg(admin, "3d000000-0000-4000-8000-00000000ffff"),
    ).rejects.toThrow();
  });

  it("admin-users: A não alcança usuário de B (reset/editar/impersonar) e vice-versa", async () => {
    await expect(assertUserInOrg(admin, ORG_A, B_CORRETOR)).rejects.toThrow("não encontrado");
    await expect(assertUserInOrg(admin, ORG_B, A_CORRETOR)).rejects.toThrow("não encontrado");
    await expect(assertUserInOrg(admin, ORG_A, A_CORRETOR)).resolves.toBeUndefined();
  });

  it("admin-users: último login só lista usuários da própria agência", async () => {
    const idsA = await listOrgUserIds(admin, ORG_A);
    const idsB = await listOrgUserIds(admin, ORG_B);
    for (const id of A_IDS) expect(idsA.has(id)).toBe(true);
    for (const id of B_IDS) expect(idsA.has(id)).toBe(false);
    expect([...idsB].sort()).toEqual([...B_IDS].sort());
  });

  it("equipes: listas de corretores e líderes não misturam agências", async () => {
    const lideresA = (await listLeaderCandidates(admin, ORG_A)).map((p) => p.id);
    const lideresB = (await listLeaderCandidates(admin, ORG_B)).map((p) => p.id);
    expect(lideresA).toContain(A_GESTOR);
    expect(lideresA).not.toContain(B_GESTOR);
    expect(lideresB).toEqual([B_GESTOR]);
    const corretoresB = (await listAvailableCorretores(admin, ORG_B)).map((p) => p.id);
    for (const id of corretoresB) expect(B_IDS.has(id)).toBe(true);
    const corretoresA = (await listAvailableCorretores(admin, ORG_A)).map((p) => p.id);
    for (const id of corretoresA) expect(B_IDS.has(id)).toBe(false);
  });

  it("notificações de venda: destinatários e dados só da agência da venda", async () => {
    expect(await saleOrg(admin, SALE_A)).toBe(ORG_A);
    expect(await saleOrg(admin, SALE_B)).toBe(ORG_B);
    expect(await leaderIdsForCorretor(admin, ORG_B, B_CORRETOR)).toEqual([B_GESTOR]);
    // Corretor de B consultado com o escopo de A: nenhum líder.
    expect(await leaderIdsForCorretor(admin, ORG_A, B_CORRETOR)).toEqual([]);
    const finA = await roleUserIds(admin, ORG_A, "financeiro");
    const jurB = await roleUserIds(admin, ORG_B, "juridico");
    expect(finA).toContain(A_FIN);
    expect(finA).not.toContain(B_FIN);
    expect(jurB).toEqual([B_FIN]);
    const kept = await keepOrgMembers(admin, ORG_B, [B_GESTOR, A_GESTOR, A_FIN, B_FIN]);
    expect([...kept].sort()).toEqual([B_FIN, B_GESTOR].sort());
    const perfis = await profilesInOrg<{ id: string; telefone: string | null }>(
      admin,
      ORG_B,
      [A_CORRETOR, B_CORRETOR],
      "id, telefone",
    );
    expect(perfis.map((p) => p.id)).toEqual([B_CORRETOR]);
    const roles = await roleRowsInOrg<{ user_id: string }>(admin, ORG_A, [B_FIN, A_FIN]);
    expect(roles.every((r) => r.user_id === A_FIN)).toBe(true);
  });

  it("notificações: service_role não grava aviso de B marcado como A", async () => {
    const { error } = await admin.from("notifications").insert({
      organization_id: ORG_A,
      user_id: B_CORRETOR,
      sale_id: SALE_B,
      tipo: "status_change",
      titulo: "cruzado",
    });
    expect(error).not.toBeNull();
    const ok = await admin
      .from("notifications")
      .insert({
        organization_id: ORG_B,
        user_id: B_CORRETOR,
        sale_id: SALE_B,
        tipo: "status_change",
        titulo: "mesma agência",
      })
      .select("organization_id")
      .single();
    expect(ok.error).toBeNull();
    expect(ok.data?.organization_id).toBe(ORG_B);
  });

  it("lembretes de sala: cada agência só avisa os próprios participantes", async () => {
    const { data: rows } = await admin
      .from("room_reservations")
      .select("*")
      .in("id", [RES_A, RES_B]);
    expect(rows).toHaveLength(2);
    const now = new Date(startAt(rows![0] as RoomReservationRow).getTime() - 10 * 60 * 1000);
    const calls: { reservation: string; phone: string }[] = [];
    const result = await runRoomReservationReminders(
      admin,
      async (row, phone) => {
        calls.push({ reservation: row.id, phone });
        return true;
      },
      now,
    );
    const phonesA = calls.filter((c) => c.reservation === RES_A).map((c) => c.phone);
    const phonesB = calls.filter((c) => c.reservation === RES_B).map((c) => c.phone);
    // Telefones sintéticos: A = 551599991xxx, B = 551599992xxx (fixture_1d_rest.sql).
    expect(phonesA.sort()).toEqual(["551599991001", "551599991002"]);
    expect(phonesB.sort()).toEqual(["551599992001", "551599992002"]);
    expect(result.byOrg[ORG_A]).toBeGreaterThanOrEqual(1);
    expect(result.byOrg[ORG_B]).toBe(1);

    const { data: deliveries } = await admin
      .from("room_reservation_reminder_deliveries")
      .select("reservation_id, recipient_id, organization_id")
      .in("reservation_id", [RES_A, RES_B]);
    for (const d of deliveries ?? []) {
      const expected = d.reservation_id === RES_A ? ORG_A : ORG_B;
      expect(d.organization_id).toBe(expected);
      expect((expected === ORG_A ? A_IDS : B_IDS).has(d.recipient_id)).toBe(true);
    }
    // Segunda execução não reenvia (marcado por agência).
    const again: string[] = [];
    await runRoomReservationReminders(admin, async (row) => (again.push(row.id), true), now);
    expect(again).toEqual([]);
  });

  it("Edge max-juridico-contratos: token da agência A nunca vê documento de B", async () => {
    const search = await handleJuridicoRequest(admin, ORG_A, { action: "search" }, "mt1d-a");
    const idsA = (search.body.documents as { id: string }[]).map((d) => d.id);
    expect(search.status).toBe(200);
    expect(idsA).toContain(DOC_A);
    expect(idsA).not.toContain(DOC_B);
    const getB = await handleJuridicoRequest(
      admin,
      ORG_A,
      { action: "get", document_id: DOC_B },
      "mt1d-a",
    );
    expect(getB.body.count).toBe(0);
    const bySaleB = await handleJuridicoRequest(
      admin,
      ORG_A,
      { action: "search", sale_id: SALE_B },
      "mt1d-a",
    );
    expect(bySaleB.body.count).toBe(0);
    const searchB = await handleJuridicoRequest(admin, ORG_B, { action: "search" }, "mt1d-b");
    expect((searchB.body.documents as { id: string }[]).map((d) => d.id)).toEqual([DOC_B]);
    const noOrg = await handleJuridicoRequest(
      admin,
      "3d000000-0000-4000-8000-00000000dead",
      { action: "search" },
      "mt1d-x",
    );
    expect(noOrg.status).toBe(503);
    const { data: audit } = await admin
      .from("juridico_agent_audit")
      .select("organization_id, request_id")
      .like("request_id", "mt1d-%");
    for (const row of audit ?? [])
      expect(row.organization_id).toBe(row.request_id === "mt1d-b" ? ORG_B : ORG_A);
    expect((audit ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("Edge conta-max-bridge: sessão só para agência ativa e coerente com o ticket", async () => {
    expect(await bridgeOrgGate(admin, B_CORRETOR)).toEqual({ ok: true, organizationId: ORG_B });
    expect(await bridgeOrgGate(admin, B_CORRETOR, ORG_A)).toEqual({
      ok: false,
      error: "organization_mismatch",
    });
    const suspend = await admin.from("organizations").update({ status: "suspensa" }).eq("id", ORG_B);
    expect(suspend.error).toBeNull();
    try {
      expect(await bridgeOrgGate(admin, B_CORRETOR)).toEqual({
        ok: false,
        error: "organization_inactive",
      });
      // Agência suspensa também não recebe lembrete nem resolve escopo.
      await expect(resolveActiveOrg(admin, B_GESTOR)).rejects.toThrow();
    } finally {
      await admin.from("organizations").update({ status: "ativa" }).eq("id", ORG_B);
    }
    expect(await bridgeOrgGate(admin, A_CORRETOR)).toEqual({ ok: true, organizationId: ORG_A });
  });
});

