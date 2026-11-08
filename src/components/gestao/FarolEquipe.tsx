import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { meuPlanoEnabled } from "@/lib/meu-plano-2027/modulo";
import { normalizarEquipeSemana, type LinhaEquipeMetas } from "@/lib/meta-atividades";
import {
  calcularFarol,
  ordenarFarol,
  previsaoTrimestre,
  SINAL_ROTULO,
  type ChaveSinal,
  type LinhaFarol,
} from "@/lib/inteligencia-gestao";
import {
  FEITO_ZERO,
  entradaDaPessoa,
  gargaloDaPessoa,
  insumosPrevisao,
  numerosDoMes,
  pendenciasExtras,
  somaMetas,
  type FarolDados,
  type FarolPessoa,
} from "@/lib/inteligencia-gestao-tela";
import { diasSemVender, type PainelEquipeDados } from "@/lib/painel-equipe-calc";
import type { ProducaoPonta } from "@/lib/producao-por-pessoa-types";
import { carregarFarol, gestaoDb, inteligenciaGestaoEnabled } from "@/lib/inteligencia-gestao-db";
import { lerTaxasPadrao } from "@/components/minha-carreira/Diario";
import { FarolPill, SinalPill } from "./SinalPill";
import { Conversa1a1 } from "./Conversa1a1";

// Painel da Equipe — Inteligência de gestão (cartão t_01d580b6, Partes 1, 2 e 3). Só com o módulo ligado;
// desligado, o painel fica exatamente como antes (nenhum destes componentes aparece).

export type GestaoPainel = {
  farol: FarolDados;
  /** Linhas de carreira_diario_equipe_semana (null = Meu Plano desligado: sem metas → "sem plano"). */
  semana: Map<string, LinhaEquipeMetas & { copia: boolean }> | null;
  metasTrimestre: number | null;
  recarregar: () => void;
};

/** Carrega tudo o que o farol e a previsão precisam. null = módulo desligado (ou falha na checagem). */
export function useGestaoPainel(teamId: string | null, hoje: string): GestaoPainel | null {
  const [st, setSt] = useState<Omit<GestaoPainel, "recarregar"> | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!teamId) return;
    let vivo = true;
    (async () => {
      if (!(await inteligenciaGestaoEnabled())) {
        if (vivo) setSt(null);
        return;
      }
      const tri = [0, 1, 2].map((i) => {
        const m = Number(hoje.slice(5, 7));
        const p = Math.floor((m - 1) / 3) * 3 + 1 + i;
        return `${hoje.slice(0, 4)}-${String(p).padStart(2, "0")}-01`;
      });
      const [farol, planoOn, metas] = await Promise.all([
        carregarFarol(ANO_PLANO).catch(() => null),
        meuPlanoEnabled(),
        Promise.all(tri.map((m) => gestaoDb.rpc("metas_progresso", { _mes: m }))),
      ]);
      let semana: GestaoPainel["semana"] = null;
      if (planoOn) {
        const [r, padrao] = await Promise.all([
          gestaoDb.rpc("carreira_diario_equipe_semana", { _ano: ANO_PLANO }),
          lerTaxasPadrao(),
        ]);
        if (!r.error) {
          const rows = (r.data ?? []) as Record<string, unknown>[];
          const copia = new Set(
            rows.filter((x) => x.respostas == null).map((x) => String(x.user_id)),
          );
          semana = new Map(
            normalizarEquipeSemana(rows, padrao).map((l) => [
              l.user_id,
              { ...l, copia: copia.has(l.user_id) },
            ]),
          );
        }
      }
      const metaMes = metas.map((m) => {
        const eq = ((m.data as { equipe?: Record<string, unknown>[] } | null)?.equipe ?? []).find(
          (e) => e.team_id === teamId,
        );
        return eq?.meta_comissao == null ? null : Number(eq.meta_comissao);
      });
      if (!vivo || !farol) return;
      setSt({ farol, semana, metasTrimestre: somaMetas(metaMes) });
    })();
    return () => {
      vivo = false;
    };
  }, [teamId, hoje, versao]);

  return st ? { ...st, recarregar: () => setVersao((v) => v + 1) } : null;
}

const CHAVES: ChaveSinal[] = ["sem_vender", "atividade", "leads", "gestoes", "captacoes"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Linha = { pessoa: FarolPessoa; linha: LinhaFarol; equipe: LinhaEquipeMetas | null };

/** Bloco "Há quantos dias sem vender" ampliado com o farol (uma linha por corretor). */
export function FarolEquipe({
  dados,
  gestao,
  hoje,
}: {
  dados: PainelEquipeDados;
  gestao: GestaoPainel;
  hoje: string;
}) {
  const [aberto, setAberto] = useState<string | null>(null);
  const linhas: Linha[] = useMemo(() => {
    const dias = new Map(diasSemVender(dados, hoje).map((x) => [x.userId, x.dias]));
    const agora = new Date();
    const out: Linha[] = [];
    for (const p of gestao.farol.pessoas) {
      if (!dias.has(p.user_id)) continue; // só quem é desta equipe
      const eq = gestao.semana?.get(p.user_id) ?? null;
      const linha = calcularFarol(
        entradaDaPessoa(p, gestao.farol, {
          dias_sem_vender: dias.get(p.user_id) ?? null,
          semana: eq?.semana ?? FEITO_ZERO,
          metas: eq?.metas ?? null,
          copiaMetas: eq?.copia ?? false,
        }),
        hoje,
        agora,
      );
      out.push({ pessoa: p, linha, equipe: eq });
    }
    const ordem = ordenarFarol(out.map((l) => ({ ...l.linha, ref: l })));
    return ordem.map((o) => o.ref);
  }, [dados, gestao, hoje]);

  const sel = linhas.find((l) => l.pessoa.user_id === aberto) ?? null;

  return (
    <div className="space-y-3" data-testid="farol-equipe">
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum corretor desta equipe no farol.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-normal">Corretor</th>
                <th className="py-1 pr-2 font-normal">Farol</th>
                {CHAVES.map((k) => (
                  <th key={k} className="py-1 pr-2 font-normal">
                    {SINAL_ROTULO[k]}
                  </th>
                ))}
                <th className="py-1 pr-2 font-normal">Onde perde mais</th>
                <th className="py-1 font-normal">Última 1:1</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ pessoa, linha }) => {
                const g = gargaloDaPessoa(pessoa);
                const u = pessoa.ultima_1a1;
                return (
                  <tr
                    key={pessoa.user_id}
                    className="border-t align-top"
                    data-testid="farol-linha"
                    data-farol={linha.farol}
                  >
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline"
                        onClick={() => setAberto(pessoa.user_id)}
                        title="Abrir a conversa 1:1"
                      >
                        {pessoa.nome}
                      </button>
                      {linha.metaDe ? (
                        <div className="text-[11px] text-muted-foreground" data-testid="meta-de">
                          {linha.metaDe}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <FarolPill farol={linha.farol} />
                    </td>
                    {linha.sinais.map((s) => (
                      <td key={s.chave} className="py-2 pr-2">
                        <SinalPill s={s} curto />
                      </td>
                    ))}
                    <td className="py-2 pr-2 text-xs" data-testid="farol-gargalo">
                      {g.tipo === "gargalo" ? (
                        <span title={`${g.texto} ${g.dica}`}>{g.texto.split(".")[0]}</span>
                      ) : (
                        <span className="text-muted-foreground">{g.texto}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {u ? (
                        <>
                          {ddmm(u.data)}
                          {u.proxima_data < hoje ? (
                            <span className="block text-amber-700 dark:text-amber-400">
                              próxima atrasada ({ddmm(u.proxima_data)})
                            </span>
                          ) : (
                            <span className="block">próxima {ddmm(u.proxima_data)}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Ordem: risco alto → atenção → tranquilo → novo. Não é ranking. Clique no nome para abrir a
        conversa 1:1. Detalhe de ligações, V1, V2 e ACM em{" "}
        <Link to="/minha-carreira" className="font-medium text-primary hover:underline">
          Equipe: feito x meta
        </Link>
        .
      </p>
      <Conversa1a1
        aberta={!!sel}
        onClose={() => setAberto(null)}
        pessoa={sel?.pessoa ?? null}
        linha={sel?.linha ?? null}
        hoje={hoje}
        numeros={
          sel
            ? numerosDoMes({
                dias_sem_vender: diasDe(dados, sel.pessoa.user_id, hoje),
                mes: sel.equipe?.mes ?? FEITO_ZERO,
                captMes: sel.equipe?.semana.captMes ?? 0,
                metas: sel.equipe?.metas ?? null,
              })
            : {}
        }
        extras={sel ? pendenciasExtras(sel.pessoa, gestao.farol, hoje, new Date()) : []}
        onSalvo={gestao.recarregar}
      />
    </div>
  );
}

function diasDe(dados: PainelEquipeDados, userId: string, hoje: string) {
  return diasSemVender(dados, hoje).find((x) => x.userId === userId)?.dias ?? null;
}

const R = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Linha "Previsão do trimestre" no bloco "Meta do mês". */
export function PrevisaoTrimestre({
  dados,
  pontas,
  hoje,
  meta,
}: {
  dados: PainelEquipeDados;
  pontas: readonly ProducaoPonta[];
  hoje: string;
  meta: number | null;
}) {
  const p = useMemo(() => {
    const i = insumosPrevisao(dados, pontas, hoje);
    return { ...previsaoTrimestre({ ...i, meta }), numero: i.trimestre.numero };
  }, [dados, pontas, hoje, meta]);
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-2.5" data-testid="previsao-trimestre">
      <div className="text-xs font-medium text-muted-foreground">
        Previsão do {p.numero}º trimestre (VGC da equipe)
      </div>
      <div className="font-semibold tabular-nums">
        {R(p.valor)}
        {p.meta ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            de {R(p.meta)} ({p.pctMeta}%)
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{p.frase}</p>
    </div>
  );
}
