import { describe, expect, it } from "vitest";
import {
  type Banco,
  type Config,
  type Dados,
  type ItemFila,
  type Mensagem,
  chaveServidorOk,
  mascararErro,
  montarMensagem,
  processarFila,
  testeFicticio,
  testeUsuario,
} from "../../supabase/functions/send-email-boas-vindas/core.ts";

// Banco em memória que imita as regras da migration 20261020180000 (unique user_id+tipo, status).
function bancoFake(cfg: Partial<Config> = {}, usuarios: Record<string, Dados> = {}) {
  const config: Config = { modo: "off", allowlist: ["dacmedia16@gmail.com"], ...cfg };
  const fila: Array<
    ItemFila & { status: string; erro?: string; mid?: string; tentativas: number }
  > = [];
  let seq = 0;
  const b: Banco & { fila: typeof fila; enfileirar(u: string): void } = {
    fila,
    enfileirar(u) {
      if (fila.some((f) => f.user_id === u && f.tipo === "boas_vindas")) return; // on conflict do nothing
      fila.push({ id: ++seq, user_id: u, tipo: "boas_vindas", status: "pendente", tentativas: 0 });
    },
    config: async () => config,
    pegar: async () =>
      fila
        .filter((f) => f.status === "pendente")
        .map((f) => {
          f.status = "processando";
          f.tentativas++;
          return { id: f.id, user_id: f.user_id, tipo: f.tipo };
        }),
    dados: async (u) => usuarios[u] ?? null,
    concluir: async (id, r, erro, mid) => {
      const f = fila.find((x) => x.id === id)!;
      f.status =
        r === "erro" ? (f.tipo === "teste" || f.tentativas >= 5 ? "falhou" : "pendente") : r;
      f.erro = erro;
      f.mid = mid;
      return f.status;
    },
    testeReservar: async (u) => {
      if (fila.some((f) => f.user_id === u && f.tipo === "boas_vindas")) return null;
      fila.push({
        id: ++seq,
        user_id: u,
        tipo: "boas_vindas",
        status: "processando",
        tentativas: 1,
      });
      return seq;
    },
    testeFicticioReservar: async () => {
      fila.push({ id: ++seq, user_id: null, tipo: "teste", status: "processando", tentativas: 1 });
      return seq;
    },
  };
  return b;
}

function smtpFake(falhar = false) {
  const enviados: Mensagem[] = [];
  const fn = async (m: Mensagem) => {
    if (falhar) {
      const e = new Error(
        "Invalid login: 535 Authentication Failed for no-reply@somosmaxhub.com.br pass=SEGREDO123",
      );
      (e as Error & { responseCode: number }).responseCode = 535;
      throw e;
    }
    enviados.push(m);
    return m.messageId;
  };
  return Object.assign(fn, { enviados });
}

const DENIS = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const usuarios: Record<string, Dados> = {
  [DENIS]: {
    email: "DacMedia16@gmail.com ",
    nome: "denis teste",
    imobiliaria: "REMAX - TESTE",
    apto: true,
  },
  [OUTRO]: { email: "corretor@exemplo.com", nome: "Ana", imobiliaria: "RE/MAX Única", apto: true },
};

describe("envio do e-mail de boas-vindas", () => {
  it("mensagem multipart (texto + HTML) com o remetente UniHub e o modelo compartilhado", () => {
    const m = montarMensagem(
      "x@y.com",
      { nome: "maria silva", imobiliaria: "RE/MAX Única" },
      "<a@b>",
    );
    expect(m.from).toBe('"UniHub" <no-reply@somosmaxhub.com.br>');
    expect(m.subject).toBe("Bem-vindo ao UniHub, Maria");
    expect(m.text).toContain("RE/MAX Única");
    expect(m.html).toContain("<html");
    expect(m.text).not.toContain("<");
  });

  it("chave desligada (padrão): o robô não envia nada", async () => {
    const b = bancoFake({}, usuarios);
    b.enfileirar(OUTRO);
    const s = smtpFake();
    const r = await processarFila(b, s);
    expect(r.skipped).toBe("desligado");
    expect(s.enviados).toHaveLength(0);
    expect(b.fila[0].status).toBe("pendente");
  });

  it("idempotência: a 2ª chamada de teste para o mesmo usuário NÃO reenvia", async () => {
    const b = bancoFake({}, usuarios);
    const s = smtpFake();
    const r1 = await testeUsuario(b, s, DENIS);
    const r2 = await testeUsuario(b, s, DENIS);
    expect(r1).toMatchObject({ ok: true, status: "enviado" });
    expect(r2).toEqual({ ok: true, skipped: "ja_enviado" });
    expect(s.enviados).toHaveLength(1);
    expect(s.enviados[0].to).toBe("dacmedia16@gmail.com");
    expect(s.enviados[0].messageId).toBe(`<boas_vindas.${DENIS}@somosmaxhub.com.br>`);
  });

  it("idempotência no robô: perfil duplicado e 2ª rodada geram 1 envio só", async () => {
    const b = bancoFake({ modo: "live" }, usuarios);
    b.enfileirar(OUTRO);
    b.enfileirar(OUTRO); // perfil recriado pelo mt_2a
    const s = smtpFake();
    await processarFila(b, s);
    await processarFila(b, s);
    expect(s.enviados).toHaveLength(1);
    expect(b.fila).toHaveLength(1);
    expect(b.fila[0].status).toBe("enviado");
  });

  it("modo teste: com a chave off, só envia para a allowlist", async () => {
    const b = bancoFake({}, usuarios);
    const s = smtpFake();
    expect(await testeUsuario(b, s, OUTRO)).toEqual({ ok: false, error: "fora_da_allowlist" });
    expect(await testeFicticio(b, s, "corretor@exemplo.com", {})).toEqual({
      ok: false,
      error: "fora_da_allowlist",
    });
    const r = await testeFicticio(b, s, undefined, { nome: "Denis" });
    expect(r).toMatchObject({ ok: true, status: "enviado" });
    expect(s.enviados.map((m) => m.to)).toEqual(["dacmedia16@gmail.com"]);
  });

  it("falha de SMTP: não lança, registra erro mascarado e agenda nova tentativa", async () => {
    const b = bancoFake({ modo: "live" }, usuarios);
    b.enfileirar(OUTRO);
    const r = await processarFila(b, smtpFake(true), ["SEGREDO123"]);
    expect(r.ok).toBe(true);
    expect(b.fila[0].status).toBe("pendente");
    expect(b.fila[0].erro).toMatch(/^smtp_535/);
    expect(b.fila[0].erro).not.toContain("SEGREDO123");
    expect(b.fila[0].erro).not.toContain("somosmaxhub");
  });

  it("dry_run monta e marca 'simulado' sem enviar; inapto é cancelado", async () => {
    const b = bancoFake(
      { modo: "dry_run" },
      { ...usuarios, [DENIS]: { ...usuarios[DENIS], apto: false } },
    );
    b.enfileirar(OUTRO);
    b.enfileirar(DENIS);
    const s = smtpFake();
    await processarFila(b, s);
    expect(s.enviados).toHaveLength(0);
    expect(b.fila.map((f) => f.status)).toEqual(["simulado", "cancelado"]);
  });

  it("mascara credencial/e-mail e só aceita a chave do servidor", () => {
    expect(mascararErro(new Error("auth pass: abc123 x@y.com"), ["abc123"])).not.toMatch(
      /abc123|x@y\.com/,
    );
    const k = "k".repeat(40);
    const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
    expect(chaveServidorOk(h({ authorization: "Bearer " + k }), [k])).toBe(true);
    expect(chaveServidorOk(h({ authorization: "Bearer outra" }), [k])).toBe(false);
    expect(chaveServidorOk(h({}), [undefined])).toBe(false);
  });
});
