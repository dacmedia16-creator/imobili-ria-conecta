import { describe, expect, it } from "vitest";
import { SISTEMAS_REMAX } from "./sistemas-remax";

describe("SISTEMAS_REMAX (t_06bb81c4)", () => {
  it("tem os 5 sistemas, na ordem aprovada, com os links corretos", () => {
    expect(SISTEMAS_REMAX.map((s) => [s.nome, s.href])).toEqual([
      ["iList", "https://goiconnect.com/SignIn.aspx?ReturnUrl=%2f"],
      ["Banib", "https://gerenciador.banibconecta.com/manager/login"],
      ["REMARKT", "https://br.remarkt.net/auth/login"],
      ["Buffini", "https://www.buffini.com.br/"],
      ["C2S", "https://api.contact2sale.com/webapp/login"],
    ]);
  });

  it("só Buffini e C2S têm descrição", () => {
    expect(SISTEMAS_REMAX.filter((s) => s.descricao).map((s) => [s.nome, s.descricao])).toEqual([
      ["Buffini", "Treinamento"],
      ["C2S", "Gestão de leads"],
    ]);
  });

  it("todos os links são https externos", () => {
    for (const s of SISTEMAS_REMAX) expect(new URL(s.href).protocol).toBe("https:");
  });
});
