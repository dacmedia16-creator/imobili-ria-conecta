// t_58effd65 — Clicksign com vários proprietários (até 35+ no teste). Só mock: sem rede, sem token
// real, e-mails fictícios (example.com).
import { describe, expect, it, vi } from "vitest";
import {
  buildCaptureSigners,
  buildEnvelope,
  BULK_MIN_SIGNERS,
  BULK_REQUIREMENTS_CHUNK,
  captureOwnerList,
  ClicksignClient,
  deadlineIso,
  PACE_MAX_CALLS,
  PACE_WINDOW_MS,
  papelLabel,
  roleByPapel,
} from "../../supabase/functions/_shared/clicksign.ts";
import { EDITABLE_PAPEIS, labelOf } from "../../supabase/functions/clicksign-manage/core.ts";
import { sendDialogErrors, signedSignerLabels } from "./exclusive-clicksign";

const dono = (n: number) => ({
  nome_completo: `Pessoa Teste ${n}`,
  email: `dono${n}@example.com`,
  cpf: "529.982.247-25",
});
function formCom(n: number) {
  return {
    proprietario_1: dono(1),
    ...(n >= 2 ? { proprietario_2: dono(2) } : {}),
    ...(n >= 3
      ? { proprietarios_extras: Array.from({ length: n - 2 }, (_, i) => dono(i + 3)) }
      : {}),
  };
}
const base = {
  corretor: { nome: "Carlos Corretor", email: "corretor@example.com" },
  imobiliaria: [{ nome: "Vera Imobiliária", email: "vera@example.com" }],
  testemunhas: [
    { nome: "Tânia Testemunha", email: "t1@example.com" },
    { nome: "Otávio Testemunha", email: "t2@example.com" },
  ],
};

/** Relógio falso: sleep avança o tempo; sem espera real. */
function fakeClock() {
  let t = 1_800_000_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

/** Clicksign falsa: conta chamadas por janela de 10 s e pode devolver 429 em chamadas escolhidas. */
function fakeApi(clock: ReturnType<typeof fakeClock>, opts: { rateLimitAt?: number[] } = {}) {
  const calls: Array<{ t: number; key: string; body: any }> = [];
  let n = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.replace(/^https:\/\/[^/]+\/api\/v3/, "");
    const key = `${init.method ?? "GET"} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ t: clock.now(), key, body });
    if (opts.rateLimitAt?.includes(calls.length)) {
      const reset = String(Math.ceil((clock.now() + 2_000) / 1000));
      return new Response("{}", { status: 429, headers: { "X-Rate-Limit-Reset": reset } });
    }
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    n += 1;
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    if (key.endsWith("/bulk_requirements")) {
      const ops = body["atomic:operations"];
      return new Response(
        JSON.stringify({ "atomic:results": ops.map(() => ({ data: { id, type: "requirements" } })) }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ data: { id } }), { status: 201 });
  });
  return { fetch, calls };
}
/** Maior número de chamadas em qualquer janela de 10 s. */
function picoPorJanela(ts: number[]): number {
  let max = 0;
  for (let i = 0; i < ts.length; i++) {
    const c = ts.filter((x) => x >= ts[i] && x - ts[i] < PACE_WINDOW_MS).length;
    max = Math.max(max, c);
  }
  return max;
}

describe("signatários: todos os proprietários assinam", () => {
  it("lista de proprietários: 1, 2 (antiga), 4, 35; extras sem 2º são ignorados", () => {
    expect(captureOwnerList(formCom(1))).toHaveLength(1);
    expect(captureOwnerList(formCom(2))).toHaveLength(2);
    expect(captureOwnerList(formCom(4))).toHaveLength(4);
    expect(captureOwnerList(formCom(35))).toHaveLength(35);
    expect(
      captureOwnerList({ proprietario_1: dono(1), proprietarios_extras: [dono(3)] }),
    ).toHaveLength(1);
    expect(captureOwnerList({ proprietario_1: dono(1), proprietario_2: { nome_completo: "" } })).toHaveLength(1);
  });

  it("captação antiga (2 proprietários) gera os mesmos papéis de antes", () => {
    const { signers, errors } = buildCaptureSigners({ form: formCom(2), ...base });
    expect(errors).toEqual([]);
    expect(signers.map((s) => s.papel)).toEqual([
      "proprietario_1",
      "proprietario_2",
      "corretor",
      "imobiliaria",
      "testemunha",
      "testemunha",
    ]);
  });

  it("35 proprietários: todos viram signatário contratante (proprietario_1..35)", () => {
    const { signers, errors } = buildCaptureSigners({ form: formCom(35), ...base });
    expect(errors).toEqual([]);
    const donos = signers.filter((s) => s.papel.startsWith("proprietario_"));
    expect(donos).toHaveLength(35);
    expect(donos[34]).toMatchObject({ papel: "proprietario_35", nome: "Pessoa Teste 35" });
    expect(donos.every((s) => roleByPapel(s.papel) === "contractor")).toBe(true);
    expect(signers).toHaveLength(35 + 1 + 1 + 2);
  });

  it("4º proprietário sem e-mail ou e-mail repetido é recusado (servidor e tela)", () => {
    const f = formCom(4);
    f.proprietarios_extras![1] = { ...dono(4), email: "" };
    expect(buildCaptureSigners({ form: f, ...base }).errors).toContain(
      "Proprietário 4: e-mail ausente ou inválido",
    );
    const g = formCom(4);
    g.proprietarios_extras![0] = { ...dono(3), email: "dono1@example.com" };
    expect(buildCaptureSigners({ form: g, ...base }).errors.join(" ")).toMatch(
      /Proprietário 1 e Proprietário 3/,
    );
    const tela = sendDialogErrors({
      form: f,
      corretorEmailOk: true,
      imobiliariaIds: ["x"],
      testemunhas: base.testemunhas.map((t) => ({ nome: t.nome, email: t.email })) as never,
    });
    expect(tela).toContain("Proprietário 4: e-mail ausente ou inválido no cadastro");
  });

  it("rótulos e edição: Proprietário N em todas as telas", () => {
    expect(papelLabel("proprietario_35")).toBe("Proprietário 35");
    expect(papelLabel("corretor")).toBe("Corretor");
    expect(EDITABLE_PAPEIS.has("proprietario_35")).toBe(true);
    expect(EDITABLE_PAPEIS.has("corretor")).toBe(false);
    expect(labelOf([{ papel: "proprietario_12", nome: "X", email_sha256: "h" }], 0)).toBe(
      "Proprietário 12",
    );
    expect(
      signedSignerLabels([
        { papel: "proprietario_1", nome: "A" },
        { papel: "proprietario_3", nome: "C" },
      ] as never),
    ).toEqual(["Proprietário 1: A", "Proprietário 3: C"]);
  });
});

describe("envio em lote com 35 proprietários", () => {
  const plan = (n: number) => {
    const { signers } = buildCaptureSigners({ form: formCom(n), ...base });
    return {
      name: "TESTE",
      deadlineAt: deadlineIso(30),
      filename: "t.pdf",
      pdf: new Uint8Array([37, 80, 68, 70]),
      metadata: {},
      signers,
      bulkLargeEnvelope: true,
    };
  };

  it("captação antiga (2) e 4 proprietários: fluxo de antes, sem lote (3 chamadas por signatário)", async () => {
    for (const [n, total] of [
      [2, 6],
      [4, 8],
    ]) {
      const clock = fakeClock();
      const api = fakeApi(clock);
      const client = new ClicksignClient("tok-fake", api.fetch, undefined, clock);
      await buildEnvelope(client, plan(n), { activate: true });
      const keys = api.calls.map((c) => c.key);
      expect(total).toBeLessThan(BULK_MIN_SIGNERS);
      expect(keys.filter((k) => k.endsWith("/signers"))).toHaveLength(total);
      expect(keys.filter((k) => k.endsWith("/requirements"))).toHaveLength(total * 2);
      expect(keys.filter((k) => k.endsWith("/bulk_requirements"))).toHaveLength(0);
      const agree = api.calls.filter((c) => c.body?.data?.attributes?.action === "agree");
      expect(agree.map((c) => c.body.data.attributes.role).slice(0, n)).toEqual(
        Array(n).fill("contractor"),
      );
      expect(clock.sleeps).toEqual([]);
    }
  });

  it("35 proprietários: 39 signatários, 78 requisitos em lotes, nunca mais de 40 chamadas/10 s", async () => {
    const clock = fakeClock();
    const api = fakeApi(clock);
    const client = new ClicksignClient("tok-fake", api.fetch, undefined, clock);
    const r = await buildEnvelope(client, plan(35), { activate: true });
    expect(r.activated).toBe(true);
    const keys = api.calls.map((c) => c.key);
    expect(keys.filter((k) => k.endsWith("/signers"))).toHaveLength(39);
    const bulk = api.calls.filter((c) => c.key.endsWith("/bulk_requirements"));
    expect(bulk).toHaveLength(Math.ceil(78 / BULK_REQUIREMENTS_CHUNK));
    const ops = bulk.flatMap((c) => c.body["atomic:operations"]);
    expect(ops).toHaveLength(78);
    // cada signatário tem os 2 requisitos
    const porSigner = new Map<string, number>();
    ops.forEach((o: any) => {
      const id = o.data.relationships.signer.data.id;
      porSigner.set(id, (porSigner.get(id) ?? 0) + 1);
    });
    expect([...porSigner.values()].every((v) => v === 2)).toBe(true);
    expect(porSigner.size).toBe(39);
    // envelope + doc + 39 + 4 lotes + ativar = 46 chamadas (antes seriam 2 + 39×3 + 1 = 120)
    expect(api.calls).toHaveLength(46);
    expect(picoPorJanela(api.calls.map((c) => c.t))).toBeLessThanOrEqual(PACE_MAX_CALLS);
    expect(clock.sleeps.length).toBeGreaterThan(0); // o ritmo segurou a 41ª chamada
  });

  it("35 proprietários com 429 no meio: espera e conclui, sem duplicar signatário", async () => {
    const clock = fakeClock();
    const api = fakeApi(clock, { rateLimitAt: [10, 25, 43] });
    const client = new ClicksignClient("tok-fake", api.fetch, undefined, clock);
    const r = await buildEnvelope(client, plan(35), { activate: true });
    expect(r.activated).toBe(true);
    // 3 repetições de 429 a mais; nenhum DELETE (rascunho não foi desfeito)
    expect(api.calls).toHaveLength(46 + 3);
    expect(api.calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);
    const signerPosts = api.calls.filter((c) => c.key.endsWith("/signers"));
    const nomes = signerPosts.map((c) => c.body.data.attributes.name);
    // 39 distintos; os repetidos são só as tentativas recusadas por 429 (nada criado nelas)
    expect(new Set(nomes).size).toBe(39);
    expect(picoPorJanela(api.calls.map((c) => c.t))).toBeLessThanOrEqual(PACE_MAX_CALLS + 3);
  });

  it("429 sem fim: estoura o orçamento, desfaz o rascunho e não ativa", async () => {
    const clock = fakeClock();
    const api = fakeApi(clock, { rateLimitAt: Array.from({ length: 200 }, (_, i) => i + 5) });
    const client = new ClicksignClient("tok-fake", api.fetch, undefined, clock);
    await expect(buildEnvelope(client, plan(35), { activate: true })).rejects.toMatchObject({
      status: 429,
    });
    expect(api.calls.some((c) => c.key.startsWith("PATCH"))).toBe(false);
    expect(api.calls.at(-1)?.key).toMatch(/^DELETE \/envelopes\/:id$/);
  });
});
