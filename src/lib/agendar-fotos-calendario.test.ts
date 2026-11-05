import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), auth: { getSession: vi.fn() } },
}));

import { coresCalendarioFotos, PONTO_AZUL_DIA_COM_RESERVA } from "@/lib/vouchers-fotos";

// 10/11 só livre; 11/11 livre + reserva; 12/11 só reserva (lotado); 13/11 nada liberado.
const LIVRES = ["2026-11-10T12:00:00Z", "2026-11-10T14:00:00Z", "2026-11-11T17:00:00Z"];
const RESERVAS = ["2026-11-11T12:00:00Z", "2026-11-12T12:00:00Z"];

describe("Agendar fotos — cores do calendário (Denis 05/11, t_9b79f000)", () => {
  it("verde = ainda tem horário livre; azul = tem reserva e não sobra livre; resto neutro", () => {
    const c = coresCalendarioFotos(LIVRES, RESERVAS, true);
    expect(c.disponivel).toEqual(["2026-11-10", "2026-11-11"]);
    expect(c.reservado).toEqual(["2026-11-12"]);
    expect([...c.disponivel, ...c.reservado]).not.toContain("2026-11-13");
  });
  it("dia com reserva E horário livre fica verde, com o pontinho azul", () => {
    const c = coresCalendarioFotos(LIVRES, RESERVAS, true);
    expect(c.disponivel).toContain("2026-11-11");
    expect(c.reservado).not.toContain("2026-11-11");
    expect(c.comIndicadorReserva).toEqual(["2026-11-11"]);
  });
  it("o pontinho azul sai com uma chave só (padrão ligado)", () => {
    expect(PONTO_AZUL_DIA_COM_RESERVA).toBe(true);
    expect(coresCalendarioFotos(LIVRES, RESERVAS, false).comIndicadorReserva).toEqual([]);
  });
  it("usa a data de São Paulo (23h de SP não vira o dia seguinte)", () => {
    const c = coresCalendarioFotos(["2026-11-11T02:00:00Z"], []);
    expect(c.disponivel).toEqual(["2026-11-10"]);
  });
  it("sem nada liberado, nenhum dia colorido", () => {
    expect(coresCalendarioFotos([], [])).toEqual({
      disponivel: [],
      reservado: [],
      comIndicadorReserva: [],
    });
  });
});

describe("Agendar fotos — mesmo layout da Reserva de salas", () => {
  const card = readFileSync("src/components/agenda/EscolhaDataCard.tsx", "utf8");
  const agendar = readFileSync("src/components/fotos/AgendarSessao.tsx", "utf8");
  const salas = readFileSync("src/routes/_authenticated/reservas-salas.tsx", "utf8");
  const fotografo = readFileSync("src/routes/_authenticated/fotografo.tsx", "utf8");

  it("as três telas usam o mesmo cartão 'Escolha a data'", () => {
    expect(card).toContain("Escolha a data");
    expect(card).toContain("Veja a agenda do dia selecionado.");
    for (const f of [agendar, salas, fotografo]) expect(f).toContain("<EscolhaDataCard");
  });
  it("legenda curta abaixo do calendário", () => {
    expect(card).toContain("Verde = disponível");
    expect(card).toContain("Azul = reservado");
  });
  it("sem filtro de sala no Agendar fotos; mostra o nome do fotógrafo", () => {
    expect(agendar).not.toContain("Filtrar sala");
    expect(agendar).toContain('data-testid="bloco-fotografo"');
    expect(agendar).toContain("resumo.fotografo_nome");
  });
  it("não mudou regra: continua chamando as mesmas RPCs", () => {
    expect(agendar).toContain('rpc("photo_horarios_livres"');
    expect(agendar).toContain('rpc("photo_agendar"');
    expect(agendar).toContain("situacaoImovel(imovel)");
    expect(agendar).toContain("vouchersUsaveis(");
  });
});
