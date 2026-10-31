import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const equipe = ler("../routes/_authenticated/equipe.tsx");
const ficha = ler("../routes/_authenticated/ficha-colaboradores.tsx");
const perfil = ler("../routes/_authenticated/perfil.tsx");
const completar = ler("../components/CompletarPerfil.tsx");
const gate = ler("../components/ficha/FichaColaboradorGate.tsx");
const porteiro = ler("../components/porteiro/PorteiroEntrada.tsx");

describe("FASE 2 D5 — item 22 (Equipes e Ficha dos colaboradores)", () => {
  it("cada cartão de equipe tem 2 botões e um Mais com o resto das ações", () => {
    const bloco = equipe.slice(equipe.indexOf("function AcoesEquipe("));
    expect(bloco).toContain('data-testid="equipe-acao-membros"');
    expect(bloco).toContain('data-testid="equipe-acao-desempenho"');
    expect(bloco).toContain('data-testid="equipe-acao-mais"');
    for (const acao of ["Líder auxiliar", "Criar sub-equipe", "Editar", "Excluir"]) {
      expect(bloco).toContain(acao);
    }
    // Equipe-mãe e sub-equipe usam o mesmo bloco; sub-equipe não cria sub-equipe (como antes).
    expect(equipe.match(/<AcoesEquipe\b/g)?.length).toBe(2);
  });

  it("o Salvar da meta no modal Desempenho não fica apertado", () => {
    const meta = equipe.slice(equipe.indexOf("function MetaEditField("));
    expect(meta).toContain('data-testid="meta-salvar"');
    expect(meta).toContain("h-9 shrink-0 px-3");
    expect(meta).not.toContain("h-7 px-2 text-xs");
  });

  it("Ficha dos colaboradores: busca à vista e o resto em Mais filtros (n), como em Vendas", () => {
    expect(ficha).toContain('id="ff-busca"');
    expect(ficha).toContain("`Mais filtros (${maisAtivos})`");
    const mais = ficha.slice(ficha.indexOf('id="ficha-mais-filtros"'));
    for (const id of [
      "ff-mes-de",
      "ff-plano",
      "ff-religiao",
      "ff-hospital",
      "ff-papel",
      "ff-equipe",
    ]) {
      expect(mais).toContain(`id="${id}"`);
    }
    // Os filtros continuam passando pela mesma função de antes.
    expect(ficha).toContain("filtrarColaboradores(lista, f)");
  });
});

describe("FASE 2 D5 — item 23 (Meu acesso e telas de entrada)", () => {
  it("Meu acesso tem um Salvar por seção (sem os botões soltos antigos)", () => {
    for (const t of ["perfil-salvar-contato", "perfil-salvar-cadastro", "perfil-salvar-links"]) {
      expect(perfil).toContain(`"${t}"`);
    }
    for (const antigo of ["Salvar CPF e CRECI", "Salvar ID RE/MAX", "<MinhaDataNascimento"]) {
      expect(perfil).not.toContain(antigo);
    }
    expect(perfil).toContain("Alterações não salvas");
  });

  it("CRECI segue opcional e o ID RE/MAX mantém a mesma regra (630 + 6 números)", () => {
    expect(perfil).toContain("CRECI (opcional)");
    expect(perfil).toContain("/^630\\d{6}$/");
    expect(completar).toContain('label="CRECI (opcional)"');
    expect(completar).toContain('sufixoErro=""');
  });

  it("as duas telas de entrada usam a mesma moldura e o mesmo título, cada uma com seu porteiro", () => {
    expect(porteiro).toContain('TITULO_PORTEIRO = "Complete seu cadastro"');
    expect(completar).toContain("<PorteiroEntrada");
    expect(gate).toContain("<PorteiroEntrada");
    expect(completar).not.toContain("Complete seu perfil</h1>");
    expect(gate).not.toContain("Atualize seu cadastro</h1>");
    // Regras de quem vê cada tela não mudaram.
    expect(completar).toContain("modoCompletarPerfil({");
    expect(gate).toContain("setModo(modoFicha(s, lerAdiada(userId, sessao)))");
    expect(gate).toContain(".catch(() => vivo && setModo(null))");
  });
});
