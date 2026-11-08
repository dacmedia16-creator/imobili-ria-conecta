import { useEffect, useState } from "react";
import { CalendarClock, Thermometer } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/visual/base";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { meuPlanoEnabled } from "@/lib/meu-plano-2027/modulo";
import { metasDoPlano, type MetasSemana } from "@/lib/meta-atividades";
import { contagem, normalizarContagens } from "@/lib/minha-carreira-diario";
import { calcularFarol, type Gargalo, type LinhaFarol } from "@/lib/inteligencia-gestao";
import {
  FEITO_ZERO,
  dataComDia,
  diasDesde,
  entradaDaPessoa,
  gargaloDaPessoa,
  pendenciasExtras,
  umAUmAtrasadas,
  type PendenciaExtra,
  type Ultima1a1,
} from "@/lib/inteligencia-gestao-tela";
import { carregarFarol, gestaoDb, inteligenciaGestaoEnabled } from "@/lib/inteligencia-gestao-db";
import { lerPlano } from "@/components/minha-carreira/Diario";
import { FarolPill, SinalPill } from "./SinalPill";

// Minha carreira — Inteligência de gestão (cartão t_01d580b6, Parte 5). O corretor vê só o PRÓPRIO
// termômetro (a RPC devolve só ele) e a própria próxima 1:1; sem ranking e sem colegas.
// Módulo desligado = nada aqui aparece e nenhuma consulta extra além da checagem.

export type MinhaGestaoEstado = {
  on: boolean;
  linha: LinhaFarol | null;
  gargalo: Gargalo | null;
  ultima: Ultima1a1 | null;
  /** Lead sem resposta / Reunião 45 dias (meus) + 1:1 atrasada (gestor/TL). */
  extras: PendenciaExtra[];
};

const DESLIGADO: MinhaGestaoEstado = {
  on: false,
  linha: null,
  gargalo: null,
  ultima: null,
  extras: [],
};

export function useMinhaGestao(userId: string | null): MinhaGestaoEstado {
  const { hasAny } = useAuth();
  const lider = hasAny(["admin", "super_admin", "gestor", "team_leader"]);
  const [st, setSt] = useState<MinhaGestaoEstado>(DESLIGADO);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    (async () => {
      if (!(await inteligenciaGestaoEnabled())) return;
      const [d, cont, vendas, planoOn, equipe] = await Promise.all([
        carregarFarol(ANO_PLANO, userId).catch(() => null),
        gestaoDb.rpc("meu_diario_contagens"),
        gestaoDb.rpc("minhas_comissoes"),
        meuPlanoEnabled(),
        lider ? carregarFarol(ANO_PLANO).catch(() => null) : Promise.resolve(null),
      ]);
      const eu = d?.pessoas.find((p) => p.user_id === userId);
      if (!vivo || !d || !eu) return;
      const c = normalizarContagens((cont.data as Record<string, unknown>[]) ?? [], planoOn);
      let metas: MetasSemana | null = null;
      if (planoOn) {
        const p = await lerPlano(userId);
        metas = metasDoPlano(p.respostas, p.padrao);
      }
      const ultimaVenda =
        ((vendas.data ?? []) as { venda_em: string | null }[])
          .map((v) => v.venda_em)
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? null;
      const hoje = d.hoje;
      const linha = calcularFarol(
        entradaDaPessoa(eu, d, {
          dias_sem_vender: diasDesde(ultimaVenda, hoje),
          semana: {
            ...FEITO_ZERO,
            ligacoes: contagem(c, "ligacao", "semana"),
            v1: contagem(c, "v1", "semana"),
            v2: contagem(c, "v2", "semana"),
            acm: contagem(c, "acm", "semana"),
            visitaComprador: contagem(c, "visita_comprador", "semana"),
            captMes: c.captacao.mes,
          },
          metas,
          copiaMetas: false,
        }),
        hoje,
        new Date(),
      );
      if (!vivo) return;
      setSt({
        on: true,
        linha,
        gargalo: gargaloDaPessoa(eu),
        ultima: eu.ultima_1a1,
        extras: [
          ...pendenciasExtras(eu, d, hoje, new Date()),
          ...(equipe ? umAUmAtrasadas(equipe, hoje) : []),
        ],
      });
    })();
    return () => {
      vivo = false;
    };
  }, [userId, lider]);

  return st;
}

export function MeuTermometro({ linha }: { linha: LinhaFarol }) {
  const acesos = linha.acesos.length;
  return (
    <Card data-testid="meu-termometro">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Thermometer className="h-5 w-5" aria-hidden /> Meu termômetro
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Os mesmos sinais que a gestão vê sobre você. Sem ranking e sem comparação com colegas.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <FarolPill farol={linha.farol} />
          <span className="text-sm text-muted-foreground">
            {linha.farol === "novo"
              ? "Menos de 60 dias na equipe: ainda sem farol de produção."
              : `${acesos} de 5 sinais acesos`}
          </span>
        </div>
        <ul className="space-y-1.5">
          {linha.sinais.map((s) => (
            <li key={s.chave} className="flex flex-wrap items-center gap-2 text-sm">
              <SinalPill s={s} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function MinhaProxima1a1({ ultima, hoje }: { ultima: Ultima1a1 | null; hoje: string }) {
  return (
    <Card data-testid="minha-proxima-1a1">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarClock className="h-5 w-5" aria-hidden /> Minha próxima 1:1
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!ultima ? (
          <p className="text-muted-foreground">
            Nenhuma conversa 1:1 registrada ainda. Quando a gestão marcar, a data aparece aqui.
          </p>
        ) : (
          <>
            <p>
              <span className="font-semibold">{dataComDia(ultima.proxima_data)}</span>
              {ultima.com ? ` com ${ultima.com}` : ""}{" "}
              {ultima.proxima_data < hoje ? <Pill tom="amber">atrasada</Pill> : null}
            </p>
            <p className="text-xs text-muted-foreground">Combinado em {dataComDia(ultima.data)}</p>
            {ultima.combinados.length === 0 ? (
              <p className="text-muted-foreground">Nada foi combinado na última conversa.</p>
            ) : (
              <ul className="space-y-1" data-testid="meus-combinados">
                {ultima.combinados.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden>{c.feito === true ? "✅" : "⬜"}</span>
                    <span>{c.texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Linha "Onde você perde mais" no fim do "Sua semana". */
export function OndePerdeMais({ g }: { g: Gargalo }) {
  return (
    <p className="rounded-md border bg-muted/30 p-2 text-sm" data-testid="onde-perde-mais">
      <span className="font-medium">Onde você perde mais (90 dias):</span>{" "}
      {g.tipo === "gargalo" ? (
        <>
          {g.texto} <span className="text-muted-foreground">Dica: {g.dica}</span>
        </>
      ) : g.tipo === "pouco_dado" ? (
        <span className="text-muted-foreground">pouco dado ainda.</span>
      ) : (
        <span className="text-muted-foreground">nenhuma etapa bem abaixo da equipe.</span>
      )}
    </p>
  );
}
