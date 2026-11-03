// t_9002e7be — "Ordenar por" na Ficha dos colaboradores (padrão: atualizados recentemente).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORDEM_FICHA_PADRAO, ordenarColaboradores, type Colaborador } from "./ficha-colaborador";

const aqui = dirname(fileURLToPath(import.meta.url));
const tela = readFileSync(
  resolve(aqui, "../routes/_authenticated/ficha-colaboradores.tsx"),
  "utf8",
);

const c = (user_id: string, nome: string, updated_at: string | null) =>
  ({ user_id, nome, updated_at }) as unknown as Colaborador;
const L = [
  c("a", "Bruno", "2026-10-01T12:00:00Z"),
  c("b", "álvaro", null),
  c("c", "Carla", "2026-11-03T12:00:00Z"),
  c("d", "Ana", "2026-10-20T12:00:00Z"),
];
const nomes = (l: Colaborador[]) => l.map((x) => x.nome);

describe("ordenarColaboradores", () => {
  it("padrão é 'desc' (atualizados recentemente), sem data no fim", () => {
    expect(ORDEM_FICHA_PADRAO).toBe("desc");
    expect(nomes(ordenarColaboradores(L, "desc"))).toEqual(["Carla", "Ana", "Bruno", "álvaro"]);
    expect(nomes(ordenarColaboradores(L, "asc"))).toEqual(["Bruno", "Ana", "Carla", "álvaro"]);
  });
  it("'nome' ordena A-Z em pt-BR, ignorando acento/maiúscula, sem alterar a original", () => {
    expect(nomes(ordenarColaboradores(L, "nome"))).toEqual(["álvaro", "Ana", "Bruno", "Carla"]);
    expect(L.map((x) => x.user_id).join("")).toBe("abcd");
  });
});

describe("Ficha dos colaboradores — tela", () => {
  it("seletor 'Ordenar por' com as duas opções e padrão ao abrir", () => {
    expect(tela).toContain("useState<OrdemFicha>(ORDEM_FICHA_PADRAO)");
    expect(tela).toContain('label="Ordenar por"');
    expect(tela).toContain('data-testid="ficha-ordenar-por"');
    expect(tela).toContain("Atualizados recentemente");
    expect(tela).toContain('<option value="nome">Nome (A-Z)</option>');
  });
  it("título 'Atualizada em' inverte a ordem; 'Limpar filtros' volta ao padrão", () => {
    expect(tela).toContain('onClick={() => setOrdem((o) => (o === "desc" ? "asc" : "desc"))}');
    expect(tela).toContain("setOrdem(ORDEM_FICHA_PADRAO);");
    expect(tela).toContain("ordem !== ORDEM_FICHA_PADRAO");
  });
  it("Excel e PDF usam a mesma lista ordenada da tela", () => {
    expect(tela).toContain("ordenarColaboradores(filtrarColaboradores(lista, f), ordem)");
    expect(tela).toContain("const alvo = uma ? [uma] : filtrada;");
  });
  it("coluna 'Atualizada em' vem logo depois do Nome (cabeçalho e célula)", () => {
    const thNome = tela.indexOf('<th className="px-3 py-2 font-medium">Nome</th>');
    const thAtual = tela.indexOf('data-testid="ficha-ordenar-atualizada"');
    const thPapel = tela.indexOf('"Papel / Equipe",');
    expect(thNome).toBeGreaterThan(-1);
    expect(thNome).toBeLessThan(thAtual);
    expect(thAtual).toBeLessThan(thPapel);
    const tdNome = tela.indexOf('data-testid="ficha-abrir-card"');
    const tdAtual = tela.indexOf('data-testid="atualizada-celula"');
    const tdPapel = tela.indexOf("rotuloPapeis(c.papeis, LABELS)");
    expect(tdNome).toBeLessThan(tdAtual);
    expect(tdAtual).toBeLessThan(tdPapel);
  });
});
