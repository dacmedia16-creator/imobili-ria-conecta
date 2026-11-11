import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calc, metaMensalDoPlano, metaOficialDoPlano, type Respostas } from "./regras";
import { ANO_PLANO } from "./telas";
import {
  AVISO_VIGENCIA,
  INICIO_VIGENCIA,
  TEXTO_FAROL_AGUARDANDO,
  TEXTO_MES_TRAVADO,
  anoCivil,
  metaMesDoPlanoAssinado,
  planoVigente,
} from "./vigencia";

const ANA: Respostas = {
  "d.comissao": "210000",
  "d.trans": "11",
  "d.conv": "22",
  "d.ticket": "700000",
  "d.dias": "118",
  "d.ativos": "14",
  "op.0": "3450",
  "op.1": "760",
  "op.2": "1080",
  "op.3": "1600",
  "op.4": "600",
  "op.5": "940",
  "op.6": "110",
  "op.7": "30",
  "on.0": "980",
  "on.1": "200",
  "on.2": "1350",
  "on.3": "59,99",
  "on.4": "570",
  "on.5": "200",
  "so.0.v": "40000",
  "so.1.v": "30000",
  "so.2.v": "5000",
  "es.aliq": "15",
  "m.faixa": "45",
  "m.ticket": "700000",
  "m.pct": "3",
  "m.conv": "22",
  "fu.v2cre": "50",
  "fu.v1v2": "60",
  "fu.folga": "25",
};

describe("vigência das metas do Meu Plano 2027", () => {
  it("só a partir de 01/01/2027 (data de São Paulo já em aaaa-mm-dd)", () => {
    expect(INICIO_VIGENCIA).toBe("2027-01-01");
    expect(planoVigente("2026-11-08")).toBe(false);
    expect(planoVigente("2026-12-31")).toBe(false);
    expect(planoVigente("2027-01-01")).toBe(true);
    expect(planoVigente("2027-06-15")).toBe(true);
  });
  it("ano civil não mistura 2026 com 2027", () => {
    expect(anoCivil("2026-11-08")).toBe(2026);
    expect(anoCivil("2027-01-01")).toBe(ANO_PLANO);
  });
});

describe("meta do mês em 2027 vem do plano assinado", () => {
  const anual = metaOficialDoPlano(calc(ANA))!;
  const mes = metaMensalDoPlano(calc(ANA))!;

  it("não duplica a conta: mês = anual ÷ 12; captações = captMes da calc()", () => {
    expect(anual).toEqual({ comissao: 588000, vgv: 19600000, vendas: 28, captacoes: 127 });
    expect(mes.comissao).toBe(49000);
    expect(mes.vgv).toBe(1633333.33);
    expect(mes.vendas).toBe(2);
    expect(mes.captacoes).toBe(11);
    expect(mes.captacoes).toBe(calc(ANA).captMes);
  });

  it("só trava em 2027, com módulo ligado e plano assinado", () => {
    const base = {
      moduloOn: true,
      assinadoEm: "2026-11-18T12:00:00Z",
      respostas: ANA,
    };
    expect(metaMesDoPlanoAssinado({ ...base, hoje: "2026-11-08" })).toBeNull();
    expect(metaMesDoPlanoAssinado({ ...base, hoje: "2027-03-01" })).toEqual(mes);
    expect(metaMesDoPlanoAssinado({ ...base, hoje: "2027-03-01", moduloOn: false })).toBeNull();
    expect(metaMesDoPlanoAssinado({ ...base, hoje: "2027-03-01", assinadoEm: null })).toBeNull();
    expect(metaMesDoPlanoAssinado({ ...base, hoje: "2027-03-01", respostas: {} })).toBeNull();
  });
});

describe("assinatura grava a meta anual de 2027 (substitui a manual)", () => {
  it("usePlano.assinar chama usar_meta com substituir=true no ano do plano", () => {
    const src = readFileSync("src/components/minha-carreira/meu-plano/usePlano.ts", "utf8");
    expect(src).toContain('rpc("carreira_plano_assinar"');
    expect(src).toContain('rpc("carreira_plano_usar_meta"');
    expect(src).toContain("usarMeta(m, true)");
    expect(src).toContain("_ano: ANO_PLANO");
    expect(src).not.toMatch(/2026-01-01/);
  });
  it("não grava minhas_metas de 2026", () => {
    const src = readFileSync("src/components/minha-carreira/meu-plano/usePlano.ts", "utf8");
    expect(src).not.toMatch(/make_date\(2026/);
    const mes = readFileSync("src/components/minha-carreira/MeuMes.tsx", "utf8");
    expect(mes).toContain("TEXTO_MES_TRAVADO");
    expect(mes).toContain("metaMesDoPlanoAssinado");
  });
});

describe("telas antes da vigência", () => {
  it("Sua semana e Equipe mostram aviso, sem comparar com meta", () => {
    const tela = readFileSync("src/components/minha-carreira/SuaSemana.tsx", "utf8");
    expect(tela).toContain("AVISO_VIGENCIA");
    expect(tela).toContain("aviso-vigencia");
    expect(tela).toContain("planoVigente");
    expect(AVISO_VIGENCIA).toMatch(/valem a partir de janeiro/);
  });
  it("Farol usa texto próprio, diferente de Sem plano", () => {
    expect(TEXTO_FAROL_AGUARDANDO).not.toMatch(/sem plano/i);
    expect(TEXTO_MES_TRAVADO).toMatch(/ajuste o plano/);
  });
  it("módulo desligado: Diario só mostra Sua semana com novo=true", () => {
    const d = readFileSync("src/components/minha-carreira/Diario.tsx", "utf8");
    expect(d).toMatch(/\{novo \? \(/);
    expect(d).toContain("planoVigente");
  });
});
