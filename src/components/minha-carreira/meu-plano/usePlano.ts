import { useCallback, useEffect, useRef, useState } from "react";
import { ANO_PLANO, CAMPO_VALIDO, type Trilha } from "@/lib/meu-plano-2027/telas";
import type { Respostas, TaxasFunil, Valor } from "@/lib/meu-plano-2027/regras";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";

/**
 * Estado do plano do corretor logado + gravação a cada campo.
 * - Cada alteração entra numa fila local (também guardada no aparelho) e é enviada ~0,7 s depois, em lote,
 *   por carreira_plano_salvar (merge atômico no banco). Muitos corretores ao mesmo tempo = chamadas pequenas.
 * - Sem internet / erro: a fila fica guardada e é reenviada com espera crescente (até 30 s), ao voltar a
 *   conexão e ao reabrir a tela. Nada digitado se perde ao recarregar.
 * shortcut: a fila do aparelho vale por usuário + ano; dois aparelhos editando o MESMO campo = vale o último.
 */
export type Plano = {
  respostas: Respostas;
  trilha: Trilha | null;
  ativacao_inicio: string | null;
  assinado_corretor_em: string | null;
  assinado_broker_em: string | null;
  meta_oficial: {
    meta_comissao: number | null;
    meta_vendas: number | null;
    meta_captacoes: number | null;
    meta_vgv: number | null;
  } | null;
  meta_oficial_em: string | null;
};
export type StatusSalvar = "ok" | "salvando" | "pendente" | "erro";

const VAZIO: Plano = {
  respostas: {},
  trilha: null,
  ativacao_inicio: null,
  assinado_corretor_em: null,
  assinado_broker_em: null,
  meta_oficial: null,
  meta_oficial_em: null,
};
const chaveFila = (uid: string) => `meu-plano-${ANO_PLANO}:fila:${uid}`;

function lerFila(uid: string): Respostas {
  try {
    const x = JSON.parse(window.localStorage.getItem(chaveFila(uid)) ?? "null");
    return x && typeof x === "object" ? (x as Respostas) : {};
  } catch {
    return {};
  }
}
function gravarFila(uid: string, fila: Respostas) {
  try {
    if (Object.keys(fila).length) window.localStorage.setItem(chaveFila(uid), JSON.stringify(fila));
    else window.localStorage.removeItem(chaveFila(uid));
  } catch {
    /* navegador sem armazenamento: segue só em memória */
  }
}

export function usePlano(userId: string) {
  const [plano, setPlano] = useState<Plano | null>(null);
  const [taxasPadrao, setTaxasPadrao] = useState<TaxasFunil | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusSalvar>("ok");
  const [msg, setMsg] = useState<string | null>(null);
  const fila = useRef<Respostas>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enviando = useRef(false);
  const tentativas = useRef(0);

  const enviar = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (enviando.current) return;
    const lote = { ...fila.current };
    const chaves = Object.keys(lote);
    if (!chaves.length) {
      setStatus("ok");
      return;
    }
    enviando.current = true;
    setStatus("salvando");
    const corpo: Record<string, Valor> = {};
    for (const k of chaves) corpo[k] = lote[k] === undefined || lote[k] === "" ? null : lote[k];
    const { error } = await planoDb.rpc("carreira_plano_salvar", {
      _ano: ANO_PLANO,
      _campos: corpo,
    });
    enviando.current = false;
    if (error) {
      tentativas.current += 1;
      setStatus("erro");
      setMsg(erroPlano(error.message));
      const espera = Math.min(30_000, 2_000 * 2 ** Math.min(4, tentativas.current - 1));
      timer.current = setTimeout(() => void enviar(), espera);
      return;
    }
    tentativas.current = 0;
    setMsg(null);
    // Tira da fila só o que não mudou enquanto enviava.
    for (const k of chaves) if (fila.current[k] === lote[k]) delete fila.current[k];
    gravarFila(userId, fila.current);
    if (Object.keys(fila.current).length) {
      setStatus("pendente");
      timer.current = setTimeout(() => void enviar(), 300);
    } else setStatus("ok");
  }, [userId]);

  const carregar = useCallback(async () => {
    setErroCarga(null);
    const [p, t] = await Promise.all([
      planoDb
        .from("carreira_plano")
        .select(
          "respostas,trilha,ativacao_inicio,assinado_corretor_em,assinado_broker_em,meta_oficial,meta_oficial_em",
        )
        .eq("user_id", userId)
        .eq("ano", ANO_PLANO)
        .maybeSingle(),
      planoDb
        .from("carreira_taxas")
        .select("funil_v2_cre,funil_v1_v2,funil_folga")
        .is("user_id", null)
        .maybeSingle(),
    ]);
    if (p.error) {
      setErroCarga(erroPlano(p.error.message));
      return;
    }
    const base: Plano = p.data
      ? { ...VAZIO, ...(p.data as Plano), respostas: (p.data.respostas ?? {}) as Respostas }
      : VAZIO;
    // Fila guardada no aparelho (ex.: caiu a internet) vale por cima do banco e é reenviada.
    const pend = lerFila(userId);
    for (const k of Object.keys(pend)) if (!CAMPO_VALIDO.test(k)) delete pend[k];
    fila.current = { ...pend, ...fila.current };
    setPlano({ ...base, respostas: { ...base.respostas, ...fila.current } });
    const tx = t.data as {
      funil_v2_cre: number | null;
      funil_v1_v2: number | null;
      funil_folga: number | null;
    } | null;
    setTaxasPadrao(
      tx
        ? {
            v2cre: tx.funil_v2_cre == null ? null : Number(tx.funil_v2_cre),
            v1v2: tx.funil_v1_v2 == null ? null : Number(tx.funil_v1_v2),
            folga: tx.funil_folga == null ? null : Number(tx.funil_folga),
          }
        : null,
    );
    if (Object.keys(fila.current).length) void enviar();
  }, [userId, enviar]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Ao esconder a aba / voltar a conexão: envia o que estiver pendente.
  useEffect(() => {
    const agora = () => void enviar();
    const vis = () => document.visibilityState === "hidden" && agora();
    window.addEventListener("online", agora);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", agora);
      document.removeEventListener("visibilitychange", vis);
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(fila.current).length) void enviar();
    };
  }, [enviar]);

  const set = useCallback(
    (k: string, v: Valor) => {
      if (!CAMPO_VALIDO.test(k)) return;
      setPlano((p) => (p ? { ...p, respostas: { ...p.respostas, [k]: v } } : p));
      fila.current[k] = v;
      gravarFila(userId, fila.current);
      setStatus("pendente");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void enviar(), 700);
    },
    [userId, enviar],
  );

  const setVarios = useCallback(
    (campos: Respostas) => {
      for (const [k, v] of Object.entries(campos)) set(k, v);
    },
    [set],
  );

  const escolherTrilha = useCallback(async (trilha: Trilha) => {
    const { data, error } = await planoDb.rpc("carreira_plano_trilha", {
      _ano: ANO_PLANO,
      _trilha: trilha,
    });
    if (error) throw new Error(erroPlano(error.message));
    setPlano((p) => ({
      ...(p ?? VAZIO),
      trilha,
      ativacao_inicio: (data as string | null) ?? p?.ativacao_inicio ?? null,
    }));
  }, []);

  const assinar = useCallback(async () => {
    await enviar();
    const { data, error } = await planoDb.rpc("carreira_plano_assinar", { _ano: ANO_PLANO });
    if (error) throw new Error(erroPlano(error.message));
    setPlano((p) => (p ? { ...p, assinado_corretor_em: data as string } : p));
  }, [enviar]);

  type MetaResp = {
    status: "gravada" | "existe";
    meta?: Plano["meta_oficial"];
    atual?: Plano["meta_oficial"];
  };
  const usarMeta = useCallback(
    async (
      m: { comissao: number; vgv: number | null; vendas: number; captacoes: number | null },
      substituir: boolean,
    ) => {
      const { data, error } = await planoDb.rpc("carreira_plano_usar_meta", {
        _ano: ANO_PLANO,
        _comissao: m.comissao,
        _vgv: m.vgv,
        _vendas: m.vendas,
        _captacoes: m.captacoes,
        _substituir: substituir,
      });
      if (error) throw new Error(erroPlano(error.message));
      const r = data as MetaResp;
      if (r.status === "gravada")
        setPlano((p) =>
          p ? { ...p, meta_oficial: r.meta ?? null, meta_oficial_em: new Date().toISOString() } : p,
        );
      return r;
    },
    [],
  );

  return {
    plano,
    taxasPadrao,
    erroCarga,
    status,
    msg,
    set,
    setVarios,
    escolherTrilha,
    assinar,
    usarMeta,
    recarregar: carregar,
    enviar,
  };
}
