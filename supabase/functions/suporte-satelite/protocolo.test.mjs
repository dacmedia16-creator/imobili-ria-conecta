import test from "node:test";
import assert from "node:assert/strict";
import {
  assinarPedido,
  filaDe,
  montarPedidoSatelite,
  nomeOrigem,
  ondeVerResposta,
  receberPedido,
  tratarPedido,
} from "./protocolo.mjs";

const ESTUDO = "segredo-de-teste-estudo-com-32-chars";
const VISITA = "segredo-de-teste-visita-com-32-chars";
const ADM_USER = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const JTI = "33333333-3333-4333-8333-333333333333";
const AGORA = 1_700_000_000;

test("fila: Visita fica com o MAX Visita Prova; ADM e Estudo ficam com o MAX Tecnologia", () => {
  assert.equal(filaDe("visita"), "visita");
  assert.equal(filaDe("estudo"), "adm");
  assert.equal(filaDe("adm"), "adm");
  assert.equal(filaDe("outro"), null);
  assert.equal(nomeOrigem("estudo"), "Estudo de Mercado");
  assert.match(ondeVerResposta("visita"), /Visita MAX/);
  assert.doesNotMatch(ondeVerResposta("estudo"), /ADM MAX/);
});

test("o navegador não escolhe a conta ADM nem o sistema", async () => {
  let enviado = null;
  const r = await tratarPedido({
    method: "POST",
    authorization: "Bearer token",
    body: { acao: "meus", adm_user_id: OUTRO, sistema: "visita" },
    sistema: "estudo",
    agoraSeg: AGORA,
    novoJti: () => JTI,
    lerUsuario: async () => ({ id: "sat-1" }),
    buscarVinculo: async (id) => (id === "sat-1" ? ADM_USER : null),
    enviar: async (corpo, assinatura) => {
      enviado = { corpo, assinatura };
      return { status: 200, body: { ok: true } };
    },
    segredo: ESTUDO,
  });
  assert.equal(r.status, 200);
  const obj = JSON.parse(enviado.corpo);
  assert.equal(obj.adm_user_id, ADM_USER);
  assert.equal(obj.sistema, "estudo");
  assert.equal(obj.jti, JTI);
  const confere = await receberPedido({
    corpo: enviado.corpo,
    assinatura: enviado.assinatura,
    agoraSeg: AGORA,
    segredos: { estudo: ESTUDO, visita: VISITA },
  });
  assert.equal(confere.status, 200);
});

test("sem vínculo a ponte não assina nem envia", async () => {
  let chamou = false;
  const r = await tratarPedido({
    method: "POST",
    authorization: "Bearer token",
    body: { acao: "meus" },
    sistema: "visita",
    agoraSeg: AGORA,
    novoJti: () => JTI,
    lerUsuario: async () => ({ id: "sat-2" }),
    buscarVinculo: async () => null,
    enviar: async () => {
      chamou = true;
      return { status: 200, body: {} };
    },
    segredo: VISITA,
  });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /não está ligada ao ADM MAX/);
  assert.equal(chamou, false);
});

test("segredo de um sistema não abre o outro, e pedido velho ou repetido na forma é recusado", async () => {
  const { corpo, assinatura } = await assinarPedido(
    VISITA,
    { acao: "meus", sistema: "visita", adm_user_id: ADM_USER },
    AGORA,
    JTI,
  );
  const trocado = await receberPedido({
    corpo,
    assinatura,
    agoraSeg: AGORA,
    segredos: { estudo: ESTUDO, visita: ESTUDO },
  });
  assert.equal(trocado.status, 401);
  const velho = await receberPedido({
    corpo,
    assinatura,
    agoraSeg: AGORA + 61,
    segredos: { visita: VISITA },
  });
  assert.equal(velho.status, 401);
  assert.match(velho.body.error, /expirado/);
});

test("abrir recusa texto curto e print que não é imagem", () => {
  const curto = montarPedidoSatelite({
    sistema: "estudo",
    admUserId: ADM_USER,
    jti: JTI,
    body: { acao: "abrir", tipo: "erro", texto: "oi" },
  });
  assert.match(curto.erro, /5 caracteres/);
  const falso = montarPedidoSatelite({
    sistema: "estudo",
    admUserId: ADM_USER,
    jti: JTI,
    body: {
      acao: "abrir",
      tipo: "erro",
      texto: "a tela quebrou no filtro",
      print_base64: Buffer.from("nao-e-imagem").toString("base64"),
      print_tipo: "image/png",
    },
  });
  assert.match(falso.erro, /PNG, JPG ou WEBP/);
});
