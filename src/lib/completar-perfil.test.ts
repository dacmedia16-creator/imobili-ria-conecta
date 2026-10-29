import { describe, expect, it } from "vitest";
import {
  camposFaltando,
  candidatoCompletarPerfil,
  idDaSessao,
  lembreteAdiadoNestaSessao,
  modoCompletarPerfil,
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

  it("CRECI é opcional: vazio não falta; preenchido inválido falta (t_5c4bd214)", () => {
    expect(camposFaltando({ ...completo, creci: null })).toEqual([]);
    expect(camposFaltando({ ...completo, creci: "   " })).toEqual([]);
    expect(camposFaltando({ ...completo, creci: "12" })).toEqual(["creci"]);
    expect(camposFaltando({ ...completo, creci: "#123456" })).toEqual(["creci"]);
    const input = { ...base, roles: ["corretor"], perfil: { ...completo, creci: null } };
    expect(modoCompletarPerfil({ ...input, createdAt: NOVA })).toBeNull();
    expect(modoCompletarPerfil({ ...input, createdAt: ANTIGA })).toBeNull();
  });

  it("lista o que falta e valida CPF, telefone e nome", () => {
    expect(camposFaltando(vazio)).toEqual(["foto", "telefone", "cpf"]);
    expect(camposFaltando({ ...completo, nome: "Amanda" })).toEqual(["nome"]);
    expect(camposFaltando({ ...completo, cpf: "111.111.111-11" })).toEqual(["cpf"]);
    expect(camposFaltando({ ...completo, telefone: "1234" })).toEqual(["telefone"]);
  });

  it("corretor antigo incompleto vê o lembrete (pode pular), não a tela obrigatória", () => {
    const input = { ...base, roles: ["corretor"], createdAt: ANTIGA, perfil: vazio };
    expect(modoCompletarPerfil(input)).toBe("lembrete");
    expect(precisaCompletarPerfil(input)).toBe(false);
  });

  it("corretor novo incompleto continua obrigado a completar", () => {
    expect(
      modoCompletarPerfil({ ...base, roles: ["corretor"], createdAt: NOVA, perfil: vazio }),
    ).toBe("obrigatorio");
  });

  it("perfil completo não vê nada, seja conta antiga ou nova", () => {
    for (const createdAt of [ANTIGA, NOVA]) {
      expect(
        modoCompletarPerfil({ ...base, roles: ["corretor"], createdAt, perfil: completo }),
      ).toBeNull();
    }
  });

  it("admin e demais papéis, plataforma e 'Ver como' não veem o lembrete", () => {
    for (const roles of [["admin"], ["gestor"], ["team_leader"], ["corretor", "admin"], []]) {
      expect(modoCompletarPerfil({ ...base, roles, createdAt: ANTIGA, perfil: vazio })).toBeNull();
    }
    const c = { roles: ["corretor"], createdAt: ANTIGA, perfil: vazio };
    expect(modoCompletarPerfil({ ...base, ...c, platformAdmin: true })).toBeNull();
    expect(modoCompletarPerfil({ ...base, ...c, emVisaoDaPlataforma: true })).toBeNull();
    expect(modoCompletarPerfil({ ...base, ...c, vendoComo: true })).toBeNull();
  });

  it("'Agora não' vale só para o mesmo login; login novo mostra de novo", () => {
    expect(lembreteAdiadoNestaSessao("sessao-1", "sessao-1")).toBe(true);
    expect(lembreteAdiadoNestaSessao("sessao-1", "sessao-2")).toBe(false);
    expect(lembreteAdiadoNestaSessao(null, "sessao-1")).toBe(false);
    expect(lembreteAdiadoNestaSessao("sessao-1", null)).toBe(false);
  });

  it("lê o session_id do token e ignora token inválido", () => {
    const payload = btoa(JSON.stringify({ sub: "u1", session_id: "abc-123" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(idDaSessao(`h.${payload}.s`)).toBe("abc-123");
    expect(idDaSessao("lixo")).toBeNull();
    expect(idDaSessao(null)).toBeNull();
  });

  it("normaliza CPF para o formato do banco", () => {
    expect(normalizarCpf("52998224725")).toBe("529.982.247-25");
    expect(normalizarCpf("529.982.247-25")).toBe("529.982.247-25");
    expect(normalizarCpf("52998224700")).toBeNull();
  });
});
