import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { saleManagementCapabilities } from "./sale-management-capabilities";
import { montarAcoesVenda, type EstadoAcoesVenda } from "./venda-acoes";
import { AcoesDaVenda } from "@/components/vendas/AcoesDaVenda";

const ESTADO_BASE: EstadoAcoesVenda = {
  status: "rascunho",
  isGestor: false,
  isJuridico: false,
  isFinanceiro: false,
  isOwner: false,
  isAdminLike: false,
  podeEnviarRevisao: false,
  gestorDaEquipeRascunho: false,
  envioDiretoJuridico: false,
  canUploadCertidoes: false,
  contratoDocs: 0,
  certidoesJuridicoDocs: 0,
  contratoPendenciaDescricao: null,
  assinaturaBloqueadaJuridico: false,
  clicksignAtalhoGestor: false,
  envioManualSimples: false,
  assinaturaManual: false,
  contratoAssinadoDocs: 0,
  canCloseSale: false,
  canUnarchive: false,
  etapaAntesDeArquivar: null,
  canCancel: false,
  canDelete: false,
};

const text = readFileSync(
  new URL("../routes/_authenticated/vendas.$id.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile("route.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
function expression(name: string) {
  const node = nodes.find((n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === name);
  if (!node || !ts.isVariableDeclaration(node))
    throw new Error(`Missing actual route gate: ${name}`);
  return node.initializer!.getText(ast);
}
// FASE 2 item 18 (t_7fcda931): a barra do topo virou montarAcoesVenda + AcoesDaVenda. O teste
// continua usando os gates REAIS da rota (managementCurrent / isGestor) e renderiza o componente.
const montagem = text.slice(text.indexOf("const acoesTopo = montarAcoesVenda({"));
if (!montagem.includes("isGestor,") || !montagem.includes("clicksignAtalhoGestor,"))
  throw new Error("Signature actions wiring not found");

function render(
  manage: boolean,
  edit: boolean,
  legal: boolean,
  sameSale = true,
  role = true,
  clicksign = false,
) {
  const context = vm.createContext({
    hasManagerRole: role,
    id: "fixture-sale",
    user: { id: "fixture-auxiliary" },
    management: {
      saleId: sameSale ? "fixture-sale" : "other-sale",
      userId: "fixture-auxiliary",
      canManage: manage,
      canEdit: edit,
    },
    exports: {},
  });
  const source = `const managementCurrent = ${expression("managementCurrent")}; globalThis.output = (${expression("isGestor")});`;
  vm.runInContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    context,
  );
  const isGestor = context.output as boolean;
  const acoes = montarAcoesVenda({
    ...ESTADO_BASE,
    status: "contrato_conferencia_gestor",
    isGestor,
    clicksignAtalhoGestor: clicksign && isGestor,
    assinaturaBloqueadaJuridico: !legal,
  });
  const todas = [acoes.principal, ...acoes.mais, ...acoes.devolver].filter(Boolean);
  // Os itens do menu "Mais" (fechado na tela) entram como botões simples, com o mesmo disabled/title.
  const linhas = todas.map(
    (a) =>
      `<button${a!.disabled ? ' disabled=""' : ""} title="${a!.disabled ? a!.motivo : (a!.dica ?? "")}">${a!.label}</button>`,
  );
  const html = renderToStaticMarkup(
    React.createElement(AcoesDaVenda, { acoes, onAcao: () => undefined }),
  );
  return linhas.join("") + html;
}

describe("effective sale capability — actual route render, offline", () => {
  it.each([null, {}, [], "true", { can_manage: "true", can_edit: 1 }])(
    "fails closed for malformed/missing RPC %j",
    (value) => {
      expect(saleManagementCapabilities(value).canManage).toBe(false);
      expect(saleManagementCapabilities(value).canEdit).toBe(false);
    },
  );
  it("renders signature and return actions only with effective capability", () => {
    const html = render(true, true, true);
    expect(html).toContain("Enviar direto para assinatura");
    expect(html).toContain("Devolver ao jurídico");
    expect(html).not.toContain('disabled=""');
  });
  it.each([
    [false, false, true, true, true], // other team / inactive / missing profile
    [true, false, true, true, true], // locked or another stage
    [true, true, true, false, true], // stale response from another sale
    [true, true, true, true, false], // broker
  ])("hides actions when manager capability is ineffective", (...args) => {
    expect(render(...args)).not.toContain("Enviar direto para assinatura");
  });
  it("com a Clicksign ligada, o atalho continua 'Enviar direto para assinatura' (abre a escolha)", () => {
    const html = render(true, true, true, true, true, true);
    expect(html).toContain("Enviar direto para assinatura");
    expect(html).not.toContain("Enviar direto pela Clicksign");
    expect(html).toContain("escolha assinatura digital (Clicksign) ou papel");
    expect(render(true, true, false, true, true, true)).toContain('disabled=""');
  });
  it.each([
    [false, false, true, true, true, true],
    [true, false, true, true, true, true],
    [true, true, true, false, true, true],
    [true, true, true, true, false, true],
  ])("com a Clicksign: sem gestão efetiva da venda não há atalho", (...args) => {
    expect(render(...args)).not.toContain("Enviar direto para assinatura");
  });
  it("o botão com Clicksign abre a escolha, não o envio direto pela Clicksign", () => {
    const src = text.slice(
      text.indexOf('case "enviar_direto_assinatura":'),
      text.indexOf('case "dar_ok_contrato":'),
    );
    expect(src).toContain("setAtalhoEscolhaOpen(true)");
    expect(src).not.toContain("setCsSendOpen(true)");
  });
  it("keeps the legal signature block visible and disabled", () => {
    expect(render(true, true, false)).toContain('disabled=""');
    expect(render(true, true, false)).toContain("Jurídico marcou");
  });
});
