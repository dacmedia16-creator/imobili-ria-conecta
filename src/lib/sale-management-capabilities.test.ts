import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { saleManagementCapabilities } from "./sale-management-capabilities";

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
const branch = nodes.find(
  (n) =>
    ts.isJsxExpression(n) &&
    n.expression?.getText(ast).startsWith('isGestor && status === "contrato_conferencia_gestor"'),
) as ts.JsxExpression;
if (!branch) throw new Error("Signature branch not found");

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
    // Atalho com Clicksign (t_70ebc484): abre "Como vai ser assinado?"; desligado = papel de sempre.
    clicksignAtalhoGestor: clicksign,
    setAtalhoEscolhaOpen: () => undefined,
    id: "fixture-sale",
    user: { id: "fixture-auxiliary" },
    management: {
      saleId: sameSale ? "fixture-sale" : "other-sale",
      userId: "fixture-auxiliary",
      canManage: manage,
      canEdit: edit,
    },
    status: "contrato_conferencia_gestor",
    sale: { contrato_libera_assinatura: legal },
    Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
      React.createElement("button", props),
    Send: () => null,
    XCircle: () => null,
    exports: {},
    require: () => jsxRuntime,
  });
  const source = `const managementCurrent = ${expression("managementCurrent")}; const isGestor = ${expression("isGestor")}; globalThis.output = (${branch.expression!.getText(ast)});`;
  vm.runInContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    context,
  );
  return renderToStaticMarkup(context.output);
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
    const src = branch.expression!.getText(ast);
    expect(src).toContain("setAtalhoEscolhaOpen(true)");
    expect(src).not.toContain("setCsSendOpen(true)");
  });
  it("keeps the legal signature block visible and disabled", () => {
    expect(render(true, true, false)).toContain('disabled=""');
    expect(render(true, true, false)).toContain("Jurídico marcou");
  });
});
