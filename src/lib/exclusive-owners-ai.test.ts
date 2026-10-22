// t_58effd65 — leitura por IA do contrato assinado com 3+ proprietários (dados fictícios).
import { describe, expect, it } from "vitest";
import { applySignedContract, captureOwners, normalizeForm } from "./exclusive-captures";
import { buildSignedContractPrompt, sanitizeSignedContractAi } from "./exclusive-captures-ai";

describe("IA do contrato assinado: vários proprietários", () => {
  it("prompt pede a lista de proprietários adicionais", () => {
    expect(buildSignedContractPrompt()).toContain('"proprietarios_adicionais"');
  });

  it("4 proprietários: 3º e 4º viram proprietarios_extras; sem o 2º, extras são ignorados", () => {
    const v = sanitizeSignedContractAi(
      {
        proprietario_1: { nome_completo: "Ana Ficticia" },
        proprietario_2: { nome_completo: "Bruno Ficticio" },
        proprietarios_adicionais: [
          { nome_completo: "Carla Ficticia", lixo: "x" },
          { nome_completo: "Davi Ficticio" },
          {},
        ],
      },
      "2026-10-22",
    );
    expect(v.proprietarios_extras).toEqual([
      { nome_completo: "Carla Ficticia" },
      { nome_completo: "Davi Ficticio" },
    ]);
    const sem2 = sanitizeSignedContractAi(
      { proprietario_1: { nome_completo: "Ana" }, proprietarios_adicionais: [{ nome_completo: "C" }] },
      "2026-10-22",
    );
    expect(sem2.proprietarios_extras).toBeUndefined();
  });

  it("aplica 4 proprietários num cadastro vazio, na ordem, e lista o que preencheu", () => {
    const { form, filled } = applySignedContract(normalizeForm({}), {
      proprietario_1: { nome_completo: "Ana Ficticia" },
      proprietario_2: { nome_completo: "Bruno Ficticio" },
      proprietarios_extras: [{ nome_completo: "Carla Ficticia" }, { nome_completo: "Davi Ficticio" }],
    });
    expect(captureOwners(form).map((o) => o.nome_completo)).toEqual([
      "Ana Ficticia",
      "Bruno Ficticio",
      "Carla Ficticia",
      "Davi Ficticio",
    ]);
    expect(filled.some((f) => /proprietário 4/.test(f))).toBe(true);
  });

  it("captação antiga (só 1º/2º) continua igual e não cria extras", () => {
    const { form } = applySignedContract(normalizeForm({}), {
      proprietario_1: { nome_completo: "Ana Ficticia" },
      proprietario_2: { nome_completo: "Bruno Ficticio" },
    });
    expect(captureOwners(form)).toHaveLength(2);
    expect(form).not.toHaveProperty("proprietarios_extras");
  });

  it("não sobrescreve proprietário já digitado", () => {
    const base = normalizeForm({
      proprietario_1: { nome_completo: "Digitado 1" },
      proprietario_2: { nome_completo: "Digitado 2" },
      proprietarios_extras: [{ nome_completo: "Digitado 3" }],
    });
    const { form } = applySignedContract(base, {
      proprietario_1: { nome_completo: "IA 1" },
      proprietario_2: { nome_completo: "IA 2" },
      proprietarios_extras: [{ nome_completo: "IA 3", email: "c@example.com" }],
    });
    const owners = captureOwners(form);
    expect(owners.map((o) => o.nome_completo)).toEqual(["Digitado 1", "Digitado 2", "Digitado 3"]);
    expect(owners[2].email).toBe("c@example.com");
  });
});
