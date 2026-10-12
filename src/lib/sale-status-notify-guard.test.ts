import { describe, expect, it } from "vitest";
import {
  decidirAvisoStatus,
  JANELA_AVISO_STATUS_MS,
  limitarMotivo,
  MOTIVO_AVISO_MAX,
  ultimaMudanca,
  type UltimaMudancaStatus,
} from "./sale-status-notify-guard";

const AGORA = Date.parse("2026-10-12T12:00:00Z");
const iso = (msAtras: number) => new Date(AGORA - msAtras).toISOString();
const CORRETOR = "cor-1";

const mudanca = (p: Partial<UltimaMudancaStatus> = {}): UltimaMudancaStatus => ({
  para: "enviada_revisao",
  autor_id: CORRETOR,
  motivo: null,
  created_at: iso(5_000),
  ...p,
});

describe("aviso de status de venda: só a mudança real, recente e de quem chamou", () => {
  it("libera a mudança que o próprio usuário acabou de gravar, com o status da venda", () => {
    expect(
      decidirAvisoStatus({
        statusAtual: "enviada_revisao",
        ultima: mudanca(),
        callerId: CORRETOR,
        agora: AGORA,
      }),
    ).toEqual({ ok: true, status: "enviada_revisao", motivo: null });
  });

  it("status falso: venda não está no status da última mudança → não avisa", () => {
    const d = decidirAvisoStatus({
      statusAtual: "aprovada_gestor",
      ultima: mudanca({ para: "enviada_revisao" }),
      callerId: CORRETOR,
      agora: AGORA,
    });
    expect(d).toEqual({ ok: false, motivo: "status_divergente" });
  });

  it("mudança feita por outra pessoa → não avisa", () => {
    const d = decidirAvisoStatus({
      statusAtual: "enviada_revisao",
      ultima: mudanca({ autor_id: "outro" }),
      callerId: CORRETOR,
      agora: AGORA,
    });
    expect(d).toEqual({ ok: false, motivo: "autor_divergente" });
  });

  it("mudança antiga (fora da janela de 2 minutos) → não avisa", () => {
    const d = decidirAvisoStatus({
      statusAtual: "enviada_revisao",
      ultima: mudanca({ created_at: iso(JANELA_AVISO_STATUS_MS + 1_000) }),
      callerId: CORRETOR,
      agora: AGORA,
    });
    expect(d).toEqual({ ok: false, motivo: "mudanca_antiga" });
  });

  it("sem histórico ou repetição da mesma mudança → não avisa", () => {
    expect(
      decidirAvisoStatus({ statusAtual: "enviada_revisao", ultima: null, callerId: CORRETOR }),
    ).toEqual({ ok: false, motivo: "sem_historico" });
    expect(
      decidirAvisoStatus({
        statusAtual: "enviada_revisao",
        ultima: mudanca(),
        callerId: CORRETOR,
        jaAvisado: true,
        agora: AGORA,
      }),
    ).toEqual({ ok: false, motivo: "ja_avisado" });
  });

  it("usa o motivo GRAVADO e limita o tamanho (motivo longo)", () => {
    const longo = "a".repeat(MOTIVO_AVISO_MAX * 4);
    const d = decidirAvisoStatus({
      statusAtual: "devolvida_ajuste",
      ultima: mudanca({ para: "devolvida_ajuste", motivo: longo }),
      callerId: CORRETOR,
      agora: AGORA,
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.motivo).toHaveLength(MOTIVO_AVISO_MAX);
      expect(d.motivo?.endsWith("…")).toBe(true);
    }
    expect(limitarMotivo("  ok  ")).toBe("ok");
    expect(limitarMotivo("   ")).toBeNull();
  });

  it("cancelamento da plataforma: histórico sem autor, autoria conferida na tabela própria", () => {
    const ultima = mudanca({ para: "cancelada", autor_id: null, motivo: "[Plataforma] Duplicada" });
    expect(
      decidirAvisoStatus({
        statusAtual: "cancelada",
        ultima,
        callerId: "denis",
        cancelamentoPlataforma: { actor_user_id: "denis", created_at: iso(3_000) },
        agora: AGORA,
      }),
    ).toEqual({ ok: true, status: "cancelada", motivo: "Duplicada" });
    expect(
      decidirAvisoStatus({
        statusAtual: "cancelada",
        ultima,
        callerId: CORRETOR,
        cancelamentoPlataforma: { actor_user_id: "denis", created_at: iso(3_000) },
        agora: AGORA,
      }).ok,
    ).toBe(false);
  });

  it("duas mudanças na mesma transação: vale a que levou ao status atual", () => {
    const t = iso(2_000);
    const linhas = [
      mudanca({ para: "contrato_assinado", created_at: t }),
      mudanca({ para: "ocorrencia_pendente", created_at: t, motivo: "Automático" }),
      mudanca({ para: "aprovada_juridico", created_at: iso(90_000) }),
    ];
    expect(ultimaMudanca(linhas, "ocorrencia_pendente")?.para).toBe("ocorrencia_pendente");
    expect(ultimaMudanca([], "x")).toBeNull();
  });
});
