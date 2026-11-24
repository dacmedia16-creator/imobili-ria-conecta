import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, ShieldAlert } from "lucide-react";
import { ErrorState, ListSkeleton } from "@/components/visual/base";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";
import { MeuPlano, type Vista } from "./MeuPlano";

/** Resposta de carreira_plano_acesso (migration 20270101120000). */
export type AcessoPlano = { modo: "editar" | "ver" | "proprio"; nome?: string | null };

/** Texto da faixa do topo (t_c9b0f633, pedido de Denis 24/11). */
export function textoFaixa(a: AcessoPlano): string {
  const nome = a.nome?.trim() || "corretor";
  return a.modo === "editar"
    ? `Plano de ${nome} · editando como administrador`
    : `Plano de ${nome} · modo leitura`;
}

/** Erro de permissão vira a recusa amigável (o banco responde 42501 / "Sem acesso"). */
export const ehRecusa = (msg: string | null | undefined, code?: string | null) =>
  code === "42501" || /Sem acesso ao plano|Só o administrador/i.test(msg ?? "");

/**
 * Meu Plano 2027 de OUTRA pessoa, aberto pelo nome nos rankings e cartões dos painéis de metas (t_c9b0f633).
 * Mesmas telas que a pessoa preenche. O banco decide o modo (carreira_plano_acesso):
 * - "editar": administrador da imobiliária (admin/super_admin) ou super admin da plataforma em "Entrar como";
 *   grava por carreira_plano_admin_salvar/_usar_meta (histórico antes/depois). Não assina pela pessoa.
 * - "ver": gestor/líder da equipe da pessoa, somente leitura.
 * - recusa (42501): corretor comum, fora da equipe ou outra imobiliária. A RLS também não devolve o plano.
 */
export function PlanoDaPessoa({
  userId,
  vista,
  ir,
}: {
  userId: string;
  vista: Vista;
  ir: (v: Vista, replace?: boolean) => void;
}) {
  const [acesso, setAcesso] = useState<AcessoPlano | null>(null);
  const [erro, setErro] = useState<{ msg: string; recusa: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    setAcesso(null);
    const { data, error } = await planoDb.rpc("carreira_plano_acesso", { _corretor: userId });
    if (error) {
      const recusa = ehRecusa(error.message, (error as { code?: string }).code);
      setErro({ msg: recusa ? "" : erroPlano(error.message), recusa });
      return;
    }
    setAcesso((data ?? { modo: "ver" }) as AcessoPlano);
  }, [userId]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (erro?.recusa)
    return (
      <div
        role="alert"
        data-testid="plano-recusado"
        className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100"
      >
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <b>Você não tem acesso ao plano desta pessoa.</b> Só o administrador da imobiliária e o
          gestor ou líder da equipe dela podem abrir.
        </span>
      </div>
    );
  if (erro) return <ErrorState onRetry={() => void carregar()}>{erro.msg}</ErrorState>;
  if (!acesso) return <ListSkeleton />;

  const editar = acesso.modo === "editar";
  return (
    <div className="space-y-3">
      <div
        role="status"
        data-testid="faixa-plano-pessoa"
        data-modo={acesso.modo}
        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${
          editar
            ? "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
            : "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
        }`}
      >
        {editar ? (
          <Pencil className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span>{textoFaixa(acesso)}</span>
      </div>
      <MeuPlano
        key={`${userId}:${acesso.modo}`}
        userId={userId}
        vista={vista}
        ir={ir}
        modo={acesso.modo === "proprio" ? "proprio" : acesso.modo}
        nome={acesso.nome ?? null}
      />
    </div>
  );
}
