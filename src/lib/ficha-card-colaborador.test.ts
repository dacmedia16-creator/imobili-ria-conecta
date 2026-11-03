// t_02c8d570 — clicar no nome abre card somente leitura com a ficha da pessoa.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (p: string) => readFileSync(resolve(aqui, p), "utf8");
const tela = ler("../routes/_authenticated/ficha-colaboradores.tsx");
const card = ler("../components/ficha/FichaColaboradorCard.tsx");

describe("Ficha dos colaboradores — card da pessoa", () => {
  it("o nome é um botão acessível que abre o card com a linha já carregada", () => {
    expect(tela).toContain('data-testid="ficha-abrir-card"');
    expect(tela).toContain('type="button"');
    expect(tela).toContain("onClick={() => setAberto(c)}");
    expect(tela).toContain("<FichaColaboradorCard");
  });

  it("card usa o Dialog do projeto (X, Esc e clique fora) e não consulta nem grava nada", () => {
    expect(card).toContain('from "@/components/ui/dialog"');
    expect(card).toContain("onOpenChange={(aberto) => !aberto && onClose()}");
    expect(card).not.toMatch(/supabase|ficha-colaborador-db|\.rpc\(|<Input|<input|<textarea/);
  });

  it("mostra todos os campos pedidos, com — para vazio", () => {
    for (const r of [
      "Papel",
      "Equipe",
      "Nascimento",
      "Pendências do cadastro",
      "Filhos",
      "Plano de saúde",
      "Hospital de preferência",
      "Parentesco",
      "Telefone",
      "Religião",
      "Preenchida em",
      "Atualizada em",
    ])
      expect(card).toContain(`rotulo="${r}"`);
    expect(card).toContain('const VAZIO = "—"');
    expect(card).toContain("c.email");
  });

  it("PDF desta ficha reaproveita a exportação existente (mesmo registro), com 1 pessoa", () => {
    expect(card).toContain("PDF desta ficha");
    expect(tela).toContain('onPdf={(c) => exportar("pdf", c)}');
    expect(tela).toContain("const alvo = uma ? [uma] : filtrada;");
    expect(tela).toContain("await registrarExportacaoFichas(formato, alvo.length);");
    expect(tela).toContain("colaboradores: alvo,");
  });
});
