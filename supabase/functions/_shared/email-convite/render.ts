// E-mail do convite para o dono de imobiliária se cadastrar no ADM MAX (t_6e4dab96).
// Sem dependências: roda no Deno (Edge Function) e no vitest. Mesmo visual do e-mail de boas-vindas
// (tabelas + CSS inline, botão "bulletproof", texto puro junto).
import { escapeHtml } from "../email-boas-vindas/render.ts";

export type DadosConvite = { link: string; expiraEm: Date; email: string };
export type EmailConvite = { subject: string; preheader: string; html: string; text: string };

const COR = {
  navy: "#0d1f3b",
  navyEscuro: "#071325",
  vermelho: "#dc1c2e",
  texto: "#1f2a3d",
  cinza: "#5b6880",
  fundo: "#eef1f6",
};
const FONTE = "font-family:Arial,Helvetica,sans-serif;";

export function dataValidade(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function renderEmailConvite(d: DadosConvite): EmailConvite {
  const validade = dataValidade(d.expiraEm);
  const subject = "Convite para cadastrar sua imobiliária no ADM MAX";
  const preheader = `Cadastre sua imobiliária no MAX HUB. O link vale até ${validade}.`;
  const e = escapeHtml;
  const linhas = [
    "Olá!",
    "",
    "Você recebeu um convite para cadastrar a sua imobiliária no ADM MAX, o sistema de gestão do MAX HUB.",
    "",
    `Cadastrar minha imobiliária: ${d.link}`,
    "",
    `Entre com a conta Google do e-mail ${d.email}. Com outra conta, o convite não funciona.`,
    `O link é pessoal, pode ser usado uma única vez e vale até ${validade} (7 dias).`,
    "",
    "Se você não esperava este convite, ignore este e-mail.",
    "",
    "Equipe MAX HUB",
    "",
    "--",
    "Este é um e-mail automático. Por favor, não responda.",
    "",
  ];
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
<style>@media only screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.px{padding-left:20px!important;padding-right:20px!important}.btn{display:block!important;padding:16px 12px!important}}</style>
</head>
<body style="margin:0;padding:0;width:100%;background:${COR.fundo};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR.fundo};">
  <tr><td align="center" style="padding:24px 8px;">
    <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:${COR.navyEscuro};padding:18px 28px;" class="px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td aria-hidden="true" style="${FONTE}font-size:26px;line-height:26px;color:${COR.vermelho};padding-right:10px;">&#11042;</td>
          <td style="${FONTE}font-size:20px;line-height:26px;font-weight:bold;letter-spacing:1px;color:#ffffff;">MAX&nbsp;<span style="color:${COR.vermelho};">HUB</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${COR.vermelho};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>
      <tr><td class="px" style="padding:32px 36px 8px 36px;">
        <h1 style="margin:0 0 16px 0;${FONTE}font-size:24px;line-height:32px;font-weight:bold;color:${COR.navy};">Cadastre sua imobiliária no ADM MAX</h1>
        <p style="margin:0 0 24px 0;${FONTE}font-size:16px;line-height:24px;color:${COR.texto};">Você recebeu um convite para cadastrar a sua imobiliária no ADM MAX, o sistema de gestão do MAX HUB. Leva poucos minutos.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
          <td align="center" bgcolor="${COR.vermelho}" style="border-radius:8px;background:${COR.vermelho};">
            <a class="btn" href="${e(d.link)}" target="_blank" rel="noopener" style="display:inline-block;padding:16px 36px;${FONTE}font-size:17px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px;background:${COR.vermelho};">Cadastrar minha imobiliária&nbsp;&rarr;</a>
          </td>
        </tr></table>
        <p style="margin:24px 0 8px 0;${FONTE}font-size:14px;line-height:21px;color:${COR.cinza};text-align:center;">Entre com a conta Google do e-mail<br><strong style="color:${COR.navy};word-break:break-all;">${e(d.email)}</strong><br>Com outra conta, o convite não funciona.</p>
        <p style="margin:0 0 24px 0;${FONTE}font-size:14px;line-height:21px;color:${COR.cinza};text-align:center;">O link é pessoal, pode ser usado uma única vez e vale até <strong>${e(validade)}</strong> (7 dias).</p>
        <p style="margin:0 0 24px 0;${FONTE}font-size:13px;line-height:20px;color:${COR.cinza};">Se você não esperava este convite, ignore este e-mail.</p>
        <p style="margin:0 0 28px 0;${FONTE}font-size:15px;line-height:22px;color:${COR.navy};font-weight:bold;">Equipe MAX HUB</p>
      </td></tr>
      <tr><td class="px" style="padding:16px 36px;background:${COR.fundo};${FONTE}font-size:12px;line-height:18px;color:${COR.cinza};">Este é um e-mail automático. Por favor, não responda.</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  return { subject, preheader, html, text: linhas.join("\n") };
}
