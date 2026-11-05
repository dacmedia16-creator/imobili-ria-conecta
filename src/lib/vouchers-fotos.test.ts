import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: vi.fn() } },
}));

import {
  agruparPorDia,
  chaveDia,
  contarVouchers,
  isoSaoPaulo,
  mensagemErroFoto,
  ordenarSessoes,
  progressoMeta,
  situacaoImovel,
  somarDias,
  vouchersUsaveis,
  type SessaoFoto,
  type Voucher,
} from "./vouchers-fotos";
import { vouchersFotosEnabled } from "./vouchers-fotos-module";
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_LABELS } from "./platform-organizations";
import { inviteModules } from "./org-invites";

const v = (o: Partial<Voucher>): Voucher => ({
  id: "v",
  mes_ref: "2026-11-01",
  seq: 1,
  gerado_em: "2026-11-05T12:00:00Z",
  vence_em: "2027-02-28",
  status: "disponivel",
  sessao_id: null,
  imovel: null,
  ...o,
});

describe("barra x de 3", () => {
  it("abaixo da meta: texto, % e quantas faltam", () => {
    const p = progressoMeta({ assinadas: 2, meta: 3 });
    expect(p.texto).toBe("2 de 3");
    expect(p.pct).toBe(67);
    expect(p.batida).toBe(false);
    expect(p.frase).toMatch(/Falta 1 captação assinada/);
    expect(progressoMeta({ assinadas: 0, meta: 3 }).frase).toMatch(/Faltam 3 captações/);
  });
  it("meta batida e extras (+1 por captação a mais)", () => {
    const p = progressoMeta({ assinadas: 5, meta: 3 });
    expect(p.texto).toBe("3 de 3");
    expect(p.pct).toBe(100);
    expect(p.extras).toBe(2);
    expect(p.frase).toMatch(/\+1 voucher/);
  });
});

describe("vouchers", () => {
  it("usáveis: só disponíveis e dentro da validade do dia escolhido, o que vence antes primeiro", () => {
    const lista = [
      v({ id: "b", vence_em: "2027-02-28" }),
      v({ id: "a", vence_em: "2027-01-31", mes_ref: "2026-10-01" }),
      v({ id: "x", status: "usado" }),
      v({ id: "y", status: "vencido", vence_em: "2026-10-01" }),
    ];
    expect(vouchersUsaveis(lista, null).map((x) => x.id)).toEqual(["a", "b"]);
    expect(vouchersUsaveis(lista, "2027-02-10").map((x) => x.id)).toEqual(["b"]);
  });
  it("contagem por status", () => {
    expect(contarVouchers([v({}), v({ status: "agendado" }), v({ status: "vencido" })])).toEqual({
      disponivel: 1,
      agendado: 1,
      usado: 0,
      vencido: 1,
    });
  });
});

describe("imóvel", () => {
  it("sessão aberta bloqueia; voucher já usado deixa agendar só sem voucher", () => {
    const base = { id: "c", imovel: "Casa", tem_sessao_aberta: false, voucher_ja_usado: false };
    expect(situacaoImovel(base)).toEqual({ pode: true, comVoucher: true, motivo: null });
    expect(situacaoImovel({ ...base, tem_sessao_aberta: true }).pode).toBe(false);
    const usado = situacaoImovel({ ...base, voucher_ja_usado: true });
    expect(usado.pode).toBe(true);
    expect(usado.comVoucher).toBe(false);
    expect(situacaoImovel(undefined).pode).toBe(false);
  });
});

describe("datas em São Paulo", () => {
  it("dia civil de Brasília (23h de SP = 02h UTC do dia seguinte)", () => {
    expect(chaveDia("2026-11-11T02:00:00Z")).toBe("2026-11-10");
    expect(isoSaoPaulo("2026-11-12", "09:00")).toBe("2026-11-12T09:00:00-03:00");
    expect(somarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(somarDias("2026-11-05", -90)).toBe("2026-08-07");
  });
  it("horários agrupados por dia, em ordem", () => {
    const g = agruparPorDia([
      "2026-11-12T14:00:00Z",
      "2026-11-11T12:00:00Z",
      "2026-11-12T12:00:00Z",
    ]);
    expect(g.map((d) => d.dia)).toEqual(["2026-11-11", "2026-11-12"]);
    expect(g[1].horarios).toEqual(["2026-11-12T12:00:00Z", "2026-11-12T14:00:00Z"]);
  });
});

describe("sessões e erros", () => {
  const s = (id: string, status: SessaoFoto["status"], inicio: string) =>
    ({ id, status, inicio }) as SessaoFoto;
  it("abertas primeiro (mais próxima antes), depois o histórico (mais recente antes)", () => {
    const r = ordenarSessoes([
      s("velha", "feita", "2026-10-01T12:00:00Z"),
      s("depois", "confirmada", "2026-11-20T12:00:00Z"),
      s("logo", "aguardando", "2026-11-10T12:00:00Z"),
      s("recente", "cancelada", "2026-11-01T12:00:00Z"),
    ]);
    expect(r.map((x) => x.id)).toEqual(["logo", "depois", "recente", "velha"]);
  });
  it("mensagens do banco viram texto claro; desconhecida usa o padrão", () => {
    expect(
      mensagemErroFoto(
        { message: "Agendamento bloqueado ate 12/11/2026 10:00 (3 desmarcacoes em 30 dias)" },
        "x",
      ),
    ).toBe("Agendamento bloqueado até 12/11/2026 10:00 (3 desmarcações em 30 dias).");
    expect(mensagemErroFoto({ message: "Horario indisponivel (sessao...)" }, "x")).toMatch(
      /2 h \+ 1 h/,
    );
    expect(mensagemErroFoto({ message: "Este imovel ja usou um voucher" }, "x")).toMatch(
      /1 por imóvel/,
    );
    expect(mensagemErroFoto({ message: "algo estranho" }, "padrão")).toBe("padrão");
    expect(mensagemErroFoto(null, "padrão")).toBe("padrão");
  });
});

describe("módulo vouchers_fotos", () => {
  it("ligado só quando a RPC devolve true; erro ou exceção = desligado", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await vouchersFotosEnabled()).toBe(true);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await vouchersFotosEnabled()).toBe(false);
    rpc.mockRejectedValueOnce(new Error("rede"));
    expect(await vouchersFotosEnabled()).toBe(false);
    expect(rpc).toHaveBeenCalledWith("vouchers_fotos_enabled");
  });
  it("toggle na Plataforma com o label certo e nasce desligado no convite", () => {
    expect(ORGANIZATION_MODULES).toContain("vouchers_fotos");
    expect(ORGANIZATION_MODULE_LABELS.vouchers_fotos).toMatch(/Agendar fotos/);
    expect(inviteModules().vouchers_fotos).toBe(false);
  });
  it("migration: só o super-admin da plataforma liga; módulo na CHECK e na lista da RPC", () => {
    const sql = readFileSync("supabase/migrations/20261105120000_vouchers_fotos.sql", "utf8");
    expect(sql).toMatch(/is_platform_super_admin\(_actor\)/);
    expect(sql).toMatch(/'academia', 'vouchers_fotos'\)\);/);
    expect(sql).toMatch(/_module NOT IN \([^)]*'vouchers_fotos'\)/);
  });
  it("telas: rotas protegidas pela guarda e WhatsApp só depois da ação gravada", () => {
    for (const arq of ["agendar-fotos.tsx", "fotografo.tsx"]) {
      const f = readFileSync(`src/routes/_authenticated/${arq}`, "utf8");
      expect(f).toContain("beforeLoad: guardVouchersFotosRoute");
    }
    const ag = readFileSync("src/routes/_authenticated/agendar-fotos.tsx", "utf8");
    // o aviso vem depois do toast de sucesso (só dispara se a RPC gravou)
    expect(ag.indexOf('avisarFoto(String(data), "marcada"')).toBeGreaterThan(
      ag.indexOf('rpc("photo_agendar"'),
    );
  });
});
