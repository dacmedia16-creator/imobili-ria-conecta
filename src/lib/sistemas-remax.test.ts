import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { SISTEMAS_REMAX } from "./sistemas-remax";

describe("SISTEMAS_REMAX (t_06bb81c4)", () => {
  it("tem os 8 sistemas, na ordem aprovada, com os links corretos", () => {
    expect(SISTEMAS_REMAX.map((s) => [s.nome, s.href])).toEqual([
      ["iList", "https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f"],
      ["Banib", "https://gerenciador.banibconecta.com/manager/login"],
      ["REMARKT", "https://br.remarkt.net/auth/login"],
      ["Buffini", "https://www.buffini.com.br/"],
      ["C2S", "https://api.contact2sale.com/webapp/login"],
      ["Universidade REMAX", "https://hub.minharemax.com/universidade"],
      ["eemovel", "https://brokers.eemovel.com.br/login"],
      [
        "Checkonn",
        "https://appbuscacheckonn.com/login.aspx?ReturnUrl=%2fconsultas%2fConsultaCPF.aspx",
      ],
    ]);
  });

  it("só Buffini, C2S, Universidade REMAX e Checkonn têm descrição", () => {
    expect(SISTEMAS_REMAX.filter((s) => s.descricao).map((s) => [s.nome, s.descricao])).toEqual([
      ["Buffini", "Treinamento"],
      ["C2S", "Gestão de leads"],
      ["Universidade REMAX", "EAD"],
      ["Checkonn", "Inteligência de dados"],
    ]);
  });

  it("todos os links são https externos", () => {
    for (const s of SISTEMAS_REMAX) expect(new URL(s.href).protocol).toBe("https:");
  });
});

describe("logos dos sistemas (t_48434b4a)", () => {
  it("os 8 têm logo local em /sistemas-remax/ (sem hotlink) e o arquivo existe em public/", () => {
    for (const s of SISTEMAS_REMAX) {
      expect(s.logo, s.nome).toMatch(/^\/sistemas-remax\/[a-z0-9-]+\.(svg|png)$/);
      expect(existsSync(path.join(process.cwd(), "public", s.logo!)), s.logo).toBe(true);
    }
  });
});
