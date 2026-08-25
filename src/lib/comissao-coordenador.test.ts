import { describe, expect, it } from "vitest";
import { agruparComissaoPorCoordenador, type CargoPorUsuario, type LinhaComissaoCoordenador } from "./comissao-coordenador";

/** As 23 linhas reais de agosto/2026 usadas pra validar a estrutura do relatório com o usuário
 * (várias rodadas de simulação em chat antes de virar código) — fixture congelada aqui pra não
 * depender do banco de produção continuar do jeito que estava quando essa conversa aconteceu. */
const LINHAS: LinhaComissaoCoordenador[] = [
  // Lançamento
  { occurrence_id: "occ-lanc-1", modalidade: "lancamento", papel: "corretor_vendedor", user_id: "wilson", nome: "Wilson Grecchi Junior", valor: 5613.12, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-1", modalidade: "lancamento", papel: "team_leader", user_id: "gustavo", nome: "Gustavo Fuentes", valor: 3118.40, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-2", modalidade: "lancamento", papel: "corretor_vendedor", user_id: "wilson", nome: "Wilson Grecchi Junior", valor: 9807.21, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-2", modalidade: "lancamento", papel: "team_leader", user_id: "gustavo", nome: "Gustavo Fuentes", valor: 5448.45, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-3", modalidade: "lancamento", papel: "corretor_vendedor", user_id: "gustavo", nome: "Gustavo Fuentes", valor: 6608.25, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-4", modalidade: "lancamento", papel: "coordenador_lancamento", user_id: "aline", nome: "Aline de Souza Rodrigues", valor: 617.47, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-4", modalidade: "lancamento", papel: "corretor_vendedor", user_id: "virginia", nome: "Virginia Aranha", valor: 5557.26, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-lanc-4", modalidade: "lancamento", papel: "team_leader", user_id: "gustavo", nome: "Gustavo Fuentes", valor: 2469.89, sem_cadastro_confirmado: false },
  // Padrão
  { occurrence_id: "occ-pad-1", modalidade: "padrao", papel: "corretor_captador", user_id: "carlos", nome: "Carlos Eduardo Carneiro", valor: 1080.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-1", modalidade: "padrao", papel: "corretor_vendedor", user_id: "carlos", nome: "Carlos Eduardo Carneiro", valor: 1080.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-1", modalidade: "padrao", papel: "lider_captador", user_id: "gabriel", nome: "Gabriel Geres", valor: 120.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-1", modalidade: "padrao", papel: "lider_vendedor", user_id: "gabriel", nome: "Gabriel Geres", valor: 120.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-2", modalidade: "padrao", papel: "corretor_captador", user_id: "wanderley", nome: "Wanderley Hiro Sato", valor: 4387.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-2", modalidade: "padrao", papel: "corretor_vendedor", user_id: "orlando", nome: "Orlando Menck da Silva", valor: 6825.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-2", modalidade: "padrao", papel: "lider_captador", user_id: "salvador", nome: "Salvador Ramalho", valor: 2437.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-3", modalidade: "padrao", papel: "corretor_captador", user_id: "ailton", nome: "Ailton Alexandria", valor: 4252.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-3", modalidade: "padrao", papel: "corretor_vendedor", user_id: "ailton", nome: "Ailton Alexandria", valor: 4252.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-3", modalidade: "padrao", papel: "lider_captador", user_id: "rodrigo", nome: "Rodrigo Becchelli", valor: 472.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-3", modalidade: "padrao", papel: "lider_vendedor", user_id: "rodrigo", nome: "Rodrigo Becchelli", valor: 472.50, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-4", modalidade: "padrao", papel: "corretor_captador", user_id: "wellington", nome: "Wellington de Oliveira", valor: 2700.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-4", modalidade: "padrao", papel: "corretor_vendedor", user_id: "wellington", nome: "Wellington de Oliveira", valor: 2700.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-4", modalidade: "padrao", papel: "lider_captador", user_id: "rodrigo", nome: "Rodrigo Becchelli", valor: 300.00, sem_cadastro_confirmado: false },
  { occurrence_id: "occ-pad-4", modalidade: "padrao", papel: "lider_vendedor", user_id: "rodrigo", nome: "Rodrigo Becchelli", valor: 300.00, sem_cadastro_confirmado: false },
];

const CARGOS: CargoPorUsuario = {
  gabriel: { gestor: true, teamLeader: false },
  rodrigo: { gestor: true, teamLeader: false },
  salvador: { gestor: true, teamLeader: false },
  aline: { gestor: true, teamLeader: false },
  virginia: { gestor: true, teamLeader: false },
  orlando: { gestor: true, teamLeader: true },
  gustavo: { gestor: false, teamLeader: true },
};

describe("agruparComissaoPorCoordenador — dados reais de agosto/2026 (fixture congelada)", () => {
  const r = agruparComissaoPorCoordenador(LINHAS, CARGOS);

  it("bate com os totais validados em chat com o usuário", () => {
    expect(r.totalComissao).toBeCloseTo(70740.05, 2);
    expect(r.totalVgv6pct).toBeCloseTo(1179000.83, 2);
  });

  it("não inclui parceiro externo confirmado no relatório nem nos totais", () => {
    const externo: LinhaComissaoCoordenador = {
      occurrence_id: "occ-externa", modalidade: "padrao", papel: "corretor_vendedor",
      user_id: null, nome: "Imobiliária parceira", valor: 10000,
      sem_cadastro_confirmado: true,
    };
    const comExterno = agruparComissaoPorCoordenador([...LINHAS, externo], CARGOS);
    expect(comExterno.totalComissao).toBeCloseTo(r.totalComissao, 2);
    expect(comExterno.secoes.some((s) => s.nome === "Imobiliária parceira")).toBe(false);
  });

  it("separa AGENTES x TEAM LEADERS nos totais certos", () => {
    const agentes = r.blocos.find((b) => b.bloco === "AGENTES")!;
    const teamLeaders = r.blocos.find((b) => b.bloco === "TEAM_LEADERS")!;
    expect(agentes.comissao).toBeCloseTo(30849.73, 2);
    expect(agentes.vgv6pct).toBeCloseTo(514162.17, 2);
    expect(teamLeaders.comissao).toBeCloseTo(39890.32, 2);
    expect(teamLeaders.vgv6pct).toBeCloseTo(664838.66, 2);
  });

  it("Virginia (gestora) tem seção própria pela venda que ela mesma fez, não aparece dentro do Gustavo", () => {
    const virginia = r.secoes.find((s) => s.chave === "virginia")!;
    expect(virginia).toBeDefined();
    expect(virginia.bloco).toBe("AGENTES");
    expect(virginia.subtotalComissao).toBeCloseTo(5557.26, 2);
    expect(virginia.itens).toHaveLength(1);
    expect(virginia.itens[0].vendeuElaMesma).toBe(true);

    const gustavo = r.secoes.find((s) => s.chave === "gustavo")!;
    expect(gustavo.itens.some((i) => i.nome === "Virginia Aranha")).toBe(false);
  });

  it("Gustavo acumula 3 linhas de coordenação + venda própria + Wilson (2 vendas)", () => {
    const gustavo = r.secoes.find((s) => s.chave === "gustavo")!;
    expect(gustavo.bloco).toBe("TEAM_LEADERS");
    const coordenacao = gustavo.itens.filter((i) => i.tipo === "coordenacao");
    expect(coordenacao).toHaveLength(3);
    expect(gustavo.subtotalComissao).toBeCloseTo(33065.32, 2);
  });

  it("Gabriel: capitador+vendedor da mesma pessoa na mesma ocorrência viram 1 linha só", () => {
    const gabriel = r.secoes.find((s) => s.chave === "gabriel")!;
    const membro = gabriel.itens.filter((i) => i.tipo === "membro");
    expect(membro).toHaveLength(1);
    expect(membro[0].valor).toBeCloseTo(2160.0, 2);
  });

  it("Orlando vendeu ele mesmo — não aparece em nenhuma outra seção", () => {
    const orlando = r.secoes.find((s) => s.chave === "orlando")!;
    expect(orlando.bloco).toBe("TEAM_LEADERS");
    expect(orlando.itens[0].vendeuElaMesma).toBe(true);
    expect(orlando.subtotalComissao).toBeCloseTo(6825.0, 2);
  });
});
