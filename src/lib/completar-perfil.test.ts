import { describe, expect, it } from "vitest";
import {
  camposFaltando,
  candidatoCompletarPerfil,
  normalizarCpf,
  precisaCompletarPerfil,
  type PerfilParaCompletar,
} from "./completar-perfil";

const completo: PerfilParaCompletar = {
  nome: "Amanda Rodrigues da Silva",
  telefone: "(15) 99123-4567",
  avatar_url: "https://x/avatars/a.jpg",
  cpf: "529.982.247-25",
  creci: "123456-F",
};
const vazio: PerfilParaCompletar = {
  nome: "Amanda Rodrigues da Silva",
  telefone: null,
  avatar_url: null,
  cpf: null,
  creci: null,
};
const base = { platformAdmin: false, emVisaoDaPlataforma: false, vendoComo: false };
const NOVA = "2026-10-20T14:00:00Z";
const ANTIGA = "2026-10-06T18:15:47Z";

describe("completar perfil no primeiro acesso", () => {
  it("corretor novo com perfil incompleto vê a tela", () => {
    expect(
      precisaCompletarPerfil({ ...base, roles: ["corretor"], createdAt: NOVA, perfil: vazio }),
    ).toBe(true);
  });

  it("some quando o perfil fica completo", () => {
    expect(
      precisaCompletarPerfil({ ...base, roles: ["corretor"], createdAt: NOVA, perfil: completo }),
    ).toBe(false);
  });

  it("não bloqueia quem já usava o sistema (conta antiga), mesmo incompleto", () => {
    expect(
      precisaCompletarPerfil({ ...base, roles: ["corretor"], createdAt: ANTIGA, perfil: vazio }),
    ).toBe(false);
  });

  it("marcação manual na conta liga a tela para conta antiga (conferência com conta de teste)", () => {
    expect(
      precisaCompletarPerfil({
        ...base,
        roles: ["corretor"],
        createdAt: ANTIGA,
        forcar: true,
        perfil: vazio,
      }),
    ).toBe(true);
  });

  it("admin, gestor, team leader e demais papéis não passam pela tela", () => {
    for (const roles of [
      ["admin"],
      ["gestor"],
      ["team_leader"],
      ["corretor", "gestor"],
      ["financeiro"],
    ]) {
      expect(precisaCompletarPerfil({ ...base, roles, createdAt: NOVA, perfil: vazio })).toBe(
        false,
      );
    }
  });

  it("super-admin da plataforma, visão da plataforma e 'Ver como' nunca veem a tela", () => {
    const r = { roles: ["corretor"] };
    expect(candidatoCompletarPerfil({ ...base, ...r, platformAdmin: true })).toBe(false);
    expect(candidatoCompletarPerfil({ ...base, ...r, emVisaoDaPlataforma: true })).toBe(false);
    expect(candidatoCompletarPerfil({ ...base, ...r, vendoComo: true })).toBe(false);
    expect(candidatoCompletarPerfil({ ...base, roles: [] })).toBe(false);
  });

  it("foto é obrigatória", () => {
    expect(camposFaltando({ ...completo, avatar_url: null })).toEqual(["foto"]);
  });

  it("lista o que falta e valida CPF, telefone e nome", () => {
    expect(camposFaltando(vazio)).toEqual(["foto", "telefone", "cpf", "creci"]);
    expect(camposFaltando({ ...completo, nome: "Amanda" })).toEqual(["nome"]);
    expect(camposFaltando({ ...completo, cpf: "111.111.111-11" })).toEqual(["cpf"]);
    expect(camposFaltando({ ...completo, telefone: "1234" })).toEqual(["telefone"]);
  });

  it("normaliza CPF para o formato do banco", () => {
    expect(normalizarCpf("52998224725")).toBe("529.982.247-25");
    expect(normalizarCpf("529.982.247-25")).toBe("529.982.247-25");
    expect(normalizarCpf("52998224700")).toBeNull();
  });
});
