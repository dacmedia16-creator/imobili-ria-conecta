// Minuta anexada/versionada + trava do envio + andamentos + pagamento 8/23 (t_f8f83f9f). O comportamento no banco é
// provado em supabase/tests/locacao-minuta.sql (homologação); aqui: leitura da tela, regras puras e o contrato da
// migration × rollback (cada função redefinida volta com o texto exato de antes).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO,
  dataPagamento,
  extensaoMinuta,
  lerConfig,
  lerDetalhe,
  temModeloMinuta,
} from "@/lib/locacao";

const raiz = join(__dirname, "..", "..");
const MIG = readFileSync(
  join(raiz, "supabase/migrations/20261130120000_locacao_minuta_anexada.sql"),
  "utf8",
);
const RB = readFileSync(
  join(raiz, "supabase/rollback/20261130120000_locacao_minuta_anexada.sql"),
  "utf8",
);
const corpo = (sql: string, fn: string) =>
  new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`).exec(sql)?.[0] ??
  "";

describe("minuta guardada no sistema", () => {
  it("lê as versões da mais nova para a mais antiga e ignora lixo", () => {
    const d = lerDetalhe({
      id: "x",
      minuta: { estado: "com_corretor", versao_enviada: 2 },
      minutas: [
        {
          id: "a",
          versao: 1,
          origem: "anexo",
          nome_arquivo: "v1.docx",
          enviado_em: "2026-11-16T10:00:00Z",
        },
        {
          id: "b",
          versao: 2,
          origem: "gerada",
          nome_arquivo: "v2.pdf",
          enviado_por_nome: "Larissa",
        },
        { id: "", versao: 3 },
        { id: "c", versao: 0 },
      ],
      andamentos: [
        { id: "n", texto: "Aguardando proprietário", aguardando: "proprietario" },
        { id: "m", aguardando: "hacker" },
      ],
    });
    expect(d.minutas.map((v) => v.versao)).toEqual([2, 1]);
    expect(d.minutas[0]).toMatchObject({ origem: "gerada", enviadoPorNome: "Larissa" });
    expect(d.minuta.versaoEnviada).toBe(2);
    expect(d.andamentos[0].aguardando).toBe("proprietario");
    expect(d.andamentos[1].aguardando).toBeNull();
  });
  it("sem campo novo (banco antigo): lista vazia, envio travado na tela", () => {
    const d = lerDetalhe({ id: "x", minuta: { estado: "elaborando" } });
    expect(d.minutas).toEqual([]);
    expect(d.andamentos).toEqual([]);
    expect(d.minuta.versaoEnviada).toBeNull();
  });
  it("só PDF ou Word", () => {
    expect(extensaoMinuta("Minuta.DOCX")).toBe("docx");
    expect(extensaoMinuta("m.pdf")).toBe("pdf");
    expect(extensaoMinuta("m.doc")).toBe("doc");
    expect(extensaoMinuta("m.jpg")).toBeNull();
    expect(extensaoMinuta("sem-extensao")).toBeNull();
  });
  it("há modelos para as garantias cobertas; outras só com caução de imóvel", () => {
    expect(temModeloMinuta({ tipo: "residencial", garantia: "fiador" })).toBe(true);
    expect(temModeloMinuta({ tipo: "residencial", garantia: "seguro_fianca" })).toBe(true);
    expect(temModeloMinuta({ tipo: "comercial", garantia: "fiador" })).toBe(true);
    expect(temModeloMinuta({ tipo: "residencial", garantia: "outras" })).toBe(false);
    expect(temModeloMinuta({ tipo: "comercial", garantia: "outras", contrato: { valores: { cau_tipo: "imovel" } } })).toBe(true);
  });
});

describe("pagamento da comissão 8/23", () => {
  it("padrão sem regra salva: 1–15 → dia 8; 16–31 → dia 23 do mês seguinte", () => {
    expect(lerConfig({})).toMatchObject({ diaPagamento1a15: 8, diaPagamento16a31: 23 });
    expect(dataPagamento("2026-11-15", CONFIG_PADRAO)).toBe("2026-12-08");
    expect(dataPagamento("2026-11-16", CONFIG_PADRAO)).toBe("2026-12-23");
    expect(dataPagamento("2026-12-31", CONFIG_PADRAO)).toBe("2027-01-23");
  });
  it("imobiliária com regra própria continua com a dela", () => {
    expect(lerConfig({ dia_pagamento_16a31: 6 }).diaPagamento16a31).toBe(6);
  });
  it("banco: padrão 23 sem gravar em locacao_config", () => {
    expect(MIG).toContain("ALTER COLUMN dia_pagamento_16a31 SET DEFAULT 23");
    expect(corpo(MIG, "locacao_cfg")).toContain("_c.dia_pagamento_16a31 := 23");
    expect(MIG).not.toMatch(/(INSERT INTO|UPDATE)\s+public\.locacao_config\b/i);
  });
});

describe("migration × rollback", () => {
  it("trava no banco: enviar e preparar assinatura exigem arquivo", () => {
    const c = corpo(MIG, "locacao_contratos_acao");
    expect(c).toContain("_mv := public.locacao_minuta_atual(_l.id);");
    expect(c).toContain("Envio travado: anexe a minuta");
    expect(c).toContain("Assinatura travada");
    expect(c).toContain("IF _acao IN ('enviar_minuta', 'preparar_assinatura') THEN");
  });
  it("rollback devolve as funções redefinidas e apaga as novas", () => {
    for (const fn of [
      "locacao_contratos_acao",
      "locacao_detalhe",
      "locacao_cfg",
      "locacao_corretor_minuta",
    ]) {
      expect(corpo(RB, fn)).not.toBe("");
      expect(corpo(RB, fn)).not.toBe(corpo(MIG, fn));
    }
    expect(corpo(RB, "locacao_contratos_acao")).not.toContain("locacao_minuta_atual");
    expect(corpo(RB, "locacao_cfg")).toContain("_c.dia_pagamento_16a31 := 6");
    for (const fn of [
      "locacao_minuta_preparar",
      "locacao_minuta_registrar",
      "locacao_minuta_ver",
      "locacao_andamento_registrar",
      "locacao_andamento_resolver",
      "locacao_minuta_atual",
    ]) {
      expect(MIG).toContain(`FUNCTION public.${fn}(`);
      expect(RB).toContain(`DROP FUNCTION IF EXISTS public.${fn}(`);
    }
  });
  it("nada é apagado: rollback só derruba tabela vazia e não mexe em arquivos", () => {
    expect(RB).toContain("IF NOT EXISTS (SELECT 1 FROM public.locacao_minutas) THEN DROP TABLE");
    expect(RB).not.toMatch(/DELETE\s+FROM\s+storage/i);
    expect(MIG).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(MIG).not.toMatch(/TO\s+anon/i);
  });
});
