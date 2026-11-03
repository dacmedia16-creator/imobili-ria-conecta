// t_42a173e1 — card do nome (Ficha dos colaboradores) mostra a foto do perfil, com iniciais sem foto.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fotoValida, iniciaisNome } from "@/lib/ficha-colaborador";

const aqui = dirname(fileURLToPath(import.meta.url));
const ler = (p: string) => readFileSync(resolve(aqui, p), "utf8");
const tela = ler("../routes/_authenticated/ficha-colaboradores.tsx");
const card = ler("../components/ficha/FichaColaboradorCard.tsx");

describe("iniciaisNome", () => {
  it("usa primeiro e último nome, em maiúsculas", () => {
    expect(iniciaisNome("Ana Maria Souza")).toBe("AS");
    expect(iniciaisNome("  bruno  ")).toBe("B");
    expect(iniciaisNome("élio da silva")).toBe("ÉS");
  });
  it("sem nome devolve ?", () => {
    expect(iniciaisNome("")).toBe("?");
    expect(iniciaisNome(null)).toBe("?");
    expect(iniciaisNome(undefined)).toBe("?");
  });
});

describe("fotoValida", () => {
  it("aceita só http(s)", () => {
    const u = "https://x.supabase.co/storage/v1/object/public/avatars/a/b/avatar?t=1";
    expect(fotoValida(u)).toBe(u);
    expect(fotoValida(" http://x/a.png ")).toBe("http://x/a.png");
  });
  it("vazio, nulo ou outro esquema vira sem foto (iniciais)", () => {
    expect(fotoValida(null)).toBeUndefined();
    expect(fotoValida(undefined)).toBeUndefined();
    expect(fotoValida("  ")).toBeUndefined();
    expect(fotoValida("javascript:alert(1)")).toBeUndefined();
    expect(fotoValida("data:image/png;base64,AAAA")).toBeUndefined();
  });
});

describe("card e lista usam o Avatar do projeto", () => {
  it("card: foto em círculo com alt = nome e iniciais de reserva, sem consulta nova", () => {
    expect(card).toContain('from "@/components/ui/avatar"');
    expect(card).toContain("src={fotoValida(c.avatar_url)}");
    expect(card).toContain("alt={c.nome}");
    expect(card).toContain("{iniciaisNome(c.nome)}");
    expect(card).toContain('className="flex min-w-0 items-center gap-3"');
    expect(card).not.toMatch(/supabase|ficha-colaborador-db|\.rpc\(/);
  });
  it("lista: miniatura decorativa ao lado do nome, que continua sendo o botão do card", () => {
    expect(tela).toContain('data-testid="ficha-mini-avatar"');
    expect(tela).toContain('loading="lazy"');
    expect(tela).toContain("onClick={() => setAberto(c)}");
  });
});
