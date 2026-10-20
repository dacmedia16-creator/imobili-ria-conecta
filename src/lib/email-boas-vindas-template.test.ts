// Modelo do e-mail de boas-vindas do MAX HUB (t_9855b3d3) — só renderização, sem envio.
import { describe, expect, it } from "vitest";
import { CONTEUDO, LINKS } from "../../supabase/functions/_shared/email-boas-vindas/conteudo.ts";
import {
  escapeHtml,
  renderEmailBoasVindas,
} from "../../supabase/functions/_shared/email-boas-vindas/render.ts";

const d = { primeiroNome: "maria", imobiliaria: "RE/MAX Única", email: "maria@example.com" };

describe("renderEmailBoasVindas", () => {
  it("preenche assunto e preheader", () => {
    const r = renderEmailBoasVindas(d);
    expect(r.subject).toBe("Bem-vindo ao MAX HUB, Maria");
    expect(r.preheader).toBe("Seu acesso na RE/MAX Única já está liberado.");
    expect(r.html).toContain(r.preheader);
    expect(r.html).toMatch(/<div style="display:none;[^"]*">Seu acesso na/);
  });

  it("texto puro tem todo o conteúdo e nenhuma tag", () => {
    const { text } = renderEmailBoasVindas(d);
    for (const trecho of [
      "Olá, Maria!",
      "A RE/MAX Única liberou seu acesso ao MAX HUB. Com um único login, você entra em todos os sistemas MAX.",
      `Entrar no MAX HUB: ${LINKS.app}`,
      "Entre com a sua conta Google: maria@example.com",
      "O que você encontra lá:",
      ...CONTEUDO.recursos.map((r) => `• ${r.nome}: ${r.descricao}`),
      CONTEUDO.emBreve,
      CONTEUDO.duvidas,
      CONTEUDO.assinatura,
      CONTEUDO.slogan,
      CONTEUDO.rodape,
    ])
      expect(text).toContain(trecho);
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toContain("{{");
  });

  it("HTML segue as regras de e-mail", () => {
    const { html } = renderEmailBoasVindas(d);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/background-image|url\(/i);
    expect(html).toContain("max-width:600px");
    expect(html).toContain('name="viewport"');
    // botão bulletproof: link de texto dentro de célula com bgcolor
    expect(html).toMatch(
      /<td align="center" bgcolor="#dc1c2e"[\s\S]*?<a class="btn" href="https:\/\/app\.somosmaxhub\.com\.br\/"/,
    );
    // toda imagem tem alt não vazio
    const imgs = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgs.length).toBe(1);
    for (const i of imgs) expect(i).toMatch(/alt="[^"]+"/);
    expect(html).not.toContain("{{");
    for (const r of CONTEUDO.recursos) expect(html).toContain(escapeHtml(r.nome));
  });

  it("capa é opcional", () => {
    expect(renderEmailBoasVindas(d, { incluirCapa: false }).html).not.toContain("<img");
    expect(renderEmailBoasVindas(d).html).toContain(LINKS.capa);
  });

  it("escapa HTML dos valores e limpa quebras de linha", () => {
    const r = renderEmailBoasVindas({
      primeiroNome: "<b>Ana</b>\r\nBcc: x@y.com",
      imobiliaria: `"><script>alert(1)</script>`,
      email: "a&b@example.com",
    });
    expect(r.html).not.toContain("<script>alert");
    expect(r.html).not.toContain("<b>Ana");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("a&amp;b@example.com");
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.preheader).not.toMatch(/[\r\n]/);
  });

  it("usa padrões quando faltam dados", () => {
    const r = renderEmailBoasVindas({
      primeiroNome: "  ",
      imobiliaria: "",
      email: "x@example.com",
    });
    expect(r.subject).toBe("Bem-vindo ao MAX HUB, corretor(a)");
    expect(r.preheader).toBe("Seu acesso na sua imobiliária já está liberado.");
  });

  it("pega só o primeiro nome", () => {
    expect(renderEmailBoasVindas({ ...d, primeiroNome: " joão pedro " }).subject).toBe(
      "Bem-vindo ao MAX HUB, João",
    );
  });
});
