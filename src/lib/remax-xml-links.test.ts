import { describe, expect, it } from "vitest";
import { ordenarLinks, precisaRevisar, resumoLinks, type BrokerLink } from "./remax-xml-links";

const mk = (over: Partial<BrokerLink>): BrokerLink => ({
  agent_id: "630699001",
  corretor_xml: "Corretor Teste",
  via: "id",
  candidatos: 1,
  broker_id: "00000000-0000-4000-8000-000000000001",
  anuncios: 1,
  ...over,
});

describe("vínculos do XML", () => {
  const rows = [
    mk({ agent_id: "1", via: "id", anuncios: 10 }),
    mk({ agent_id: "2", via: "email", anuncios: 3 }),
    mk({ agent_id: "3", via: "conflito", candidatos: 2, broker_id: null, anuncios: 4 }),
    mk({ agent_id: "4", via: "sem_cadastro", candidatos: 0, broker_id: null, anuncios: 7 }),
    mk({ agent_id: "5", via: "telefone", anuncios: 1 }),
    mk({ agent_id: "6", via: "sem_cadastro", candidatos: 0, broker_id: null, anuncios: 9 }),
  ];
  it("resume corretores e anúncios por tipo de vínculo", () => {
    const r = resumoLinks(rows);
    expect(r.id).toEqual({ corretores: 1, anuncios: 10 });
    expect(r.sem_cadastro).toEqual({ corretores: 2, anuncios: 16 });
    expect(r.conflito).toEqual({ corretores: 1, anuncios: 4 });
  });
  it("pendências primeiro, maior número de anúncios antes", () => {
    expect(ordenarLinks(rows).map((l) => l.agent_id)).toEqual(["3", "6", "4", "5", "2", "1"]);
  });
  it("só o vínculo por ID dispensa revisão", () => {
    expect(rows.filter(precisaRevisar).map((l) => l.agent_id)).toEqual(["2", "3", "4", "5", "6"]);
  });
});
