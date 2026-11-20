// t_778e6bef: água e gás "incluídos no condomínio" (pedido de Denis 20/11).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INCLUIDO_CONDOMINIO,
  ROTULO_INCLUIDO_CONDOMINIO,
  camposIncluidoCondominio,
  faltasContrato,
  incluidoCondominio,
} from "./locacao-contrato";
import { incluidaNoCondominio, lerLocacao, titularidadePendente, type Titularidade } from "./locacao";

const MIG = readFileSync("supabase/migrations/20261211150000_locacao_agua_gas_condominio.sql", "utf8");
const RB = readFileSync("supabase/rollback/20261211150000_locacao_agua_gas_condominio.sql", "utf8");

// Locação residencial com fiador e todos os dados do contrato preenchidos, menos o código de água.
const base: Record<string, string> = {};
for (const p of ["loc", "prop", "fia"])
  Object.assign(base, {
    [`${p}_nome`]: "Pessoa Fictícia",
    [`${p}_cpf`]: "529.982.247-25",
    [`${p}_rg`]: "1",
    [`${p}_nacionalidade`]: "brasileira",
    [`${p}_estado_civil`]: "solteiro(a)",
    [`${p}_profissao`]: "x",
    [`${p}_endereco`]: "Rua Fictícia, 1",
  });
Object.assign(base, {
  fia_matricula: "1",
  fia_cartorio: "1º",
  imv_inscricao: "1",
  imv_energia: "1",
  imv_vagas: "não possui",
  prazo_meses: "30",
  inicio: "2026-12-01",
  dia_vencimento: "10",
  moradores: "Pessoa Fictícia",
});

const tit: Titularidade = {
  cpfl: { aplica: true, protocolo: "CPFL-1" },
  saae: { aplica: true, protocolo: null },
  gas: { aplica: true, protocolo: null },
};

describe("água e gás incluídos no condomínio", () => {
  it("as opções só existem para imóvel de condomínio (casa de rua e comercial não mostram)", () => {
    expect(camposIncluidoCondominio("condominio")).toEqual(["imv_agua", "imv_gas"]);
    expect(camposIncluidoCondominio("casa")).toEqual([]);
    expect(camposIncluidoCondominio("comercial")).toEqual([]);
    expect(camposIncluidoCondominio(null)).toEqual([]);
    expect(ROTULO_INCLUIDO_CONDOMINIO).toEqual({
      imv_agua: "Água incluída no condomínio",
      imv_gas: "Gás incluído no condomínio",
    });
  });

  it("desmarcado: o código de água continua pedido como hoje", () => {
    expect(faltasContrato("residencial", "fiador", base)).toEqual(["código de água"]);
  });

  it("marcado: o código de água não falta mais (fica gravado o motivo)", () => {
    const v = { ...base, imv_agua: INCLUIDO_CONDOMINIO.imv_agua };
    expect(faltasContrato("residencial", "fiador", v)).toEqual([]);
    expect(incluidoCondominio(v.imv_agua)).toBe(true);
  });

  it("texto livre antigo \"cobrado no condomínio\" continua valendo", () => {
    expect(incluidoCondominio("cobrado no condomínio")).toBe(true);
    expect(incluidoCondominio("Incluso no CONDOMINIO")).toBe(true);
    expect(incluidoCondominio("123456")).toBe(false);
    expect(incluidoCondominio("não possui")).toBe(false);
    expect(incluidoCondominio("")).toBe(false);
  });

  it("titularidade: conta incluída não se aplica e não gera aviso de protocolo", () => {
    expect(titularidadePendente(tit)).toEqual(["SAAE", "GAS"]);
    expect(titularidadePendente(tit, { agua: false, gas: false })).toEqual(["SAAE", "GAS"]);
    expect(titularidadePendente(tit, { agua: true, gas: false })).toEqual(["GAS"]);
    expect(titularidadePendente(tit, { agua: true, gas: true })).toEqual([]);
    expect(incluidaNoCondominio("cpfl", { agua: true, gas: true })).toBe(false);
  });

  it("lê contas_condominio do banco de forma fechada (ausente = nada incluído)", () => {
    expect(lerLocacao({}).contasCondominio).toEqual({ agua: false, gas: false });
    expect(lerLocacao({ contas_condominio: { agua: true, gas: "sim" } }).contasCondominio).toEqual({
      agua: true,
      gas: false,
    });
  });

  it("migration fecha a função nova ao navegador e o rollback a apaga", () => {
    expect(MIG).toMatch(/CREATE FUNCTION public\.locacao_contas_condominio/);
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.locacao_contas_condominio\(public\.locacoes\) FROM PUBLIC, anon, authenticated/,
    );
    expect(MIG).toMatch(/'contas_condominio', public\.locacao_contas_condominio\(_l\)/);
    expect(RB).toMatch(/DROP FUNCTION public\.locacao_contas_condominio\(public\.locacoes\)/);
    expect(RB).not.toMatch(/contas_condominio'/);
  });
});
