// E-mail de boas-vindas do MAX HUB — LAYOUT (HTML de e-mail + texto puro).
// Sem dependências: roda no Deno (Edge Function do Supabase) e no vitest.
// O texto fica em ./conteudo.ts; aqui só há estrutura e cores.
//
// Regras de e-mail seguidas: tabelas + CSS inline, largura fluida até 600px, sem JS,
// fonte do sistema (Arial), sem imagem de fundo, botão "bulletproof" (tabela + link),
// alt em todas as imagens e preheader oculto.

import { CONTEUDO, LINKS } from "./conteudo.ts";

export type DadosBoasVindas = {
  primeiroNome: string;
  imobiliaria: string;
  email: string;
};

export type OpcoesRender = {
  /** Mostra a capa (imagem). Padrão: true. Sem a capa, fica só a faixa azul com o hexágono. */
  incluirCapa?: boolean;
};

export type EmailRenderizado = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

const COR = {
  navy: "#0d1f3b",
  navyEscuro: "#071325",
  vermelho: "#dc1c2e",
  texto: "#1f2a3d",
  cinza: "#5b6880",
  cinzaClaro: "#8a94a6",
  fundo: "#eef1f6",
  caixa: "#f3f5f9",
  borda: "#e3e7ee",
};
const FONTE = "font-family:Arial,Helvetica,sans-serif;";

export function escapeHtml(v: string): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Remove quebras de linha/controle (evita injeção em cabeçalho e lixo no texto). */
function limpar(v: string | null | undefined): string {
  // deno-lint-ignore no-control-regex
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function variaveis(d: DadosBoasVindas): Record<string, string> {
  const nome = limpar(d.primeiroNome).split(" ")[0] ?? "";
  return {
    primeiroNome: nome
      ? nome.charAt(0).toLocaleUpperCase("pt-BR") + nome.slice(1)
      : CONTEUDO.padroes.primeiroNome,
    imobiliaria: limpar(d.imobiliaria) || CONTEUDO.padroes.imobiliaria,
    email: limpar(d.email),
  };
}

function preencher(modelo: string, vars: Record<string, string>, html: boolean): string {
  const out = modelo.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
  return html ? escapeHtml(out) : out;
}

function montarTexto(v: Record<string, string>): string {
  const f = (t: string) => preencher(t, v, false);
  const c = CONTEUDO;
  return [
    f(c.saudacao),
    "",
    f(c.abertura),
    "",
    `${c.botao}: ${LINKS.app}`,
    "",
    `${c.loginGoogle} ${v.email}`,
    "",
    c.tituloRecursos,
    ...c.recursos.map((r) => `• ${r.nome}: ${r.descricao}`),
    "",
    c.emBreve,
    "",
    c.duvidas,
    "",
    c.assinatura,
    c.slogan,
    "",
    "--",
    c.rodape,
    "",
  ].join("\n");
}

function botao(rotulo: string, href: string): string {
  // Bulletproof: tabela com fundo na célula + link com padding. VML para Outlook desktop.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="${COR.vermelho}" style="border-radius:8px;background:${COR.vermelho};">
                    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="15%" stroke="f" fillcolor="${COR.vermelho}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;">${rotulo}</center></v:roundrect><![endif]-->
                    <!--[if !mso]><!-- --><a class="btn" href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 36px;${FONTE}font-size:17px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background:${COR.vermelho};">${rotulo}&nbsp;&rarr;</a><!--<![endif]-->
                  </td>
                </tr>
              </table>`;
}

function cabecalho(incluirCapa: boolean): string {
  // Faixa azul-marinho com o hexágono (caractere, não imagem: aparece mesmo com imagens bloqueadas).
  const marca = `<tr>
          <td style="background:${COR.navyEscuro};padding:18px 28px;" class="px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td aria-hidden="true" style="${FONTE}font-size:26px;line-height:26px;color:${COR.vermelho};padding-right:10px;">&#11042;</td>
                <td style="${FONTE}font-size:20px;line-height:26px;font-weight:bold;letter-spacing:1px;color:#ffffff;">Uni<span style="color:#8fb4e8;">Hub</span></td>
              </tr>
            </table>
          </td>
        </tr>`;
  const capa = incluirCapa
    ? `
        <tr>
          <td style="background:${COR.navyEscuro};padding:0;line-height:0;font-size:0;">
            <a href="${LINKS.app}" target="_blank" rel="noopener" style="text-decoration:none;"><img src="${LINKS.capa}" width="600" alt="${escapeHtml(CONTEUDO.altCapa)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;${FONTE}font-size:16px;line-height:22px;color:#ffffff;"></a>
          </td>
        </tr>`
    : "";
  return `${marca}${capa}
        <tr><td style="background:${COR.vermelho};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>`;
}

function montarHtml(v: Record<string, string>, incluirCapa: boolean): string {
  const f = (t: string) => preencher(t, v, true);
  const e = escapeHtml;
  const c = CONTEUDO;
  const recursos = c.recursos
    .map(
      (r) => `
                <tr>
                  <td width="22" valign="top" aria-hidden="true" style="padding:6px 0;${FONTE}font-size:13px;line-height:22px;color:${COR.vermelho};">&#11042;</td>
                  <td valign="top" style="padding:6px 0;${FONTE}font-size:15px;line-height:22px;color:${COR.texto};"><strong style="color:${COR.navy};">${e(r.nome)}:</strong> ${e(r.descricao)}</td>
                </tr>`,
    )
    .join("");
  // Preheader: texto + espaçadores para o cliente não "puxar" o corpo para a prévia.
  const espacador = "&#847;&zwnj;&nbsp;".repeat(40);

  return `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${f(c.assunto)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  @media only screen and (max-width:620px){
    .container{width:100%!important;border-radius:0!important}
    .px{padding-left:20px!important;padding-right:20px!important}
    .h1{font-size:22px!important;line-height:30px!important}
    .btn{display:block!important;padding:16px 12px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${COR.fundo};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COR.fundo};">${f(c.preheader)}${espacador}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR.fundo};">
  <tr>
    <td align="center" style="padding:24px 8px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
        ${cabecalho(incluirCapa)}
        <tr>
          <td class="px" style="padding:32px 36px 8px 36px;">
            <h1 class="h1" style="margin:0 0 16px 0;${FONTE}font-size:24px;line-height:32px;font-weight:bold;color:${COR.navy};">${f(c.saudacao)}</h1>
            <p style="margin:0 0 24px 0;${FONTE}font-size:16px;line-height:24px;color:${COR.texto};">${f(c.abertura)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="padding:4px 0 16px 0;">
              ${botao(e(c.botao), LINKS.app)}
                </td>
              </tr>
            </table>
            <p style="margin:0 0 28px 0;${FONTE}font-size:14px;line-height:21px;color:${COR.cinza};text-align:center;">${f(c.loginGoogle)}<br><strong style="color:${COR.navy};word-break:break-all;">${e(v.email)}</strong></p>
            <h2 style="margin:0 0 8px 0;${FONTE}font-size:18px;line-height:26px;font-weight:bold;color:${COR.navy};">${e(c.tituloRecursos)}</h2>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${recursos}
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;">
              <tr>
                <td style="padding:12px 16px;background:${COR.caixa};border-left:3px solid ${COR.vermelho};${FONTE}font-size:14px;line-height:21px;color:${COR.texto};">${e(c.emBreve)}</td>
              </tr>
            </table>
            <p style="margin:24px 0 0 0;${FONTE}font-size:15px;line-height:22px;color:${COR.texto};">${e(c.duvidas)}</p>
            <p style="margin:20px 0 0 0;${FONTE}font-size:15px;line-height:22px;color:${COR.navy};"><strong>${e(c.assinatura)}</strong><br><span style="color:${COR.cinza};font-size:14px;">${e(c.slogan)}</span></p>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:24px 36px 28px 36px;">
            <p style="margin:0;padding-top:16px;border-top:1px solid ${COR.borda};${FONTE}font-size:12px;line-height:18px;color:${COR.cinzaClaro};text-align:center;">${e(c.rodape)}</p>
          </td>
        </tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Monta o e-mail de boas-vindas: assunto, preheader, HTML e texto puro (multipart). */
export function renderEmailBoasVindas(
  dados: DadosBoasVindas,
  opcoes: OpcoesRender = {},
): EmailRenderizado {
  const v = variaveis(dados);
  return {
    subject: preencher(CONTEUDO.assunto, v, false),
    preheader: preencher(CONTEUDO.preheader, v, false),
    html: montarHtml(v, opcoes.incluirCapa ?? true),
    text: montarTexto(v),
  };
}
