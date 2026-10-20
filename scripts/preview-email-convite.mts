// Gera a prévia LOCAL do e-mail de convite do dono de imobiliária (não envia nada).
// Uso: node --experimental-strip-types scripts/preview-email-convite.mts [pasta-saida]
// Saída: previa.html (e-mail puro), previa-375-600.html (lado a lado em 375px e 600px) e previa.txt.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderEmailConvite } from "../supabase/functions/_shared/email-convite/render.ts";

const out = process.argv[2] ?? "preview-email-convite";
mkdirSync(out, { recursive: true });

// Dados fictícios (o token abaixo não existe em nenhum banco).
const r = renderEmailConvite({
  link: "https://app.somosmaxhub.com.br/convite/EXEMPLO_token_ficticio_nao_vale_000000000000",
  expiraEm: new Date("2026-10-27T22:00:00Z"),
  email: "dono.exemplo@gmail.com",
});

writeFileSync(join(out, "previa.html"), r.html);
writeFileSync(
  join(out, "previa.txt"),
  `Assunto: ${r.subject}\nPré-visualização: ${r.preheader}\n\n${r.text}`,
);
const srcdoc = r.html.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
writeFileSync(
  join(out, "previa-375-600.html"),
  `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prévia — ${r.subject}</title></head>
<body style="margin:0;padding:16px;background:#cfd5df;font-family:Arial,sans-serif;">
<p><strong>Assunto:</strong> ${r.subject}<br><strong>Pré-visualização:</strong> ${r.preheader}</p>
<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">
<div><p>375px (celular)</p><iframe title="375px" width="375" height="1100" style="border:1px solid #999;background:#fff" srcdoc="${srcdoc}"></iframe></div>
<div><p>600px</p><iframe title="600px" width="600" height="1100" style="border:1px solid #999;background:#fff" srcdoc="${srcdoc}"></iframe></div>
</div></body></html>`,
);
console.log(`prévia gerada em ${out}/`);
