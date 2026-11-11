import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { planoDb } from "@/lib/meu-plano-2027/modulo";
import { ANO_PLANO } from "@/lib/meu-plano-2027/telas";
import { AVISO_VIGENCIA, planoVigente } from "@/lib/meu-plano-2027/vigencia";
import type { TaxasFunil } from "@/lib/meu-plano-2027/regras";
import {
  montarQuadro,
  normalizarEquipeSemana,
  ordenarPorDistancia,
  rotulosPeriodo,
  textoLinha,
  type Faixa,
  type Feito,
  type LinhaEquipeMetas,
  type LinhaQuadro,
  type MetasSemana,
} from "@/lib/meta-atividades";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/visual/base";

// Meta x atividades (cartão t_09c29e96): quadro "Sua semana" (feito no Diário x meta do Meu Plano 2027)
// e a mesma visão por corretor para gestor/TL (conversa 1:1). Sem pontos e fora do ranking.

const COR: Record<Faixa, { barra: string; texto: string; rotulo: string }> = {
  verde: {
    barra: "bg-emerald-500",
    texto: "text-emerald-700 dark:text-emerald-400",
    rotulo: "meta batida",
  },
  amarelo: {
    barra: "bg-amber-400",
    texto: "text-amber-700 dark:text-amber-400",
    rotulo: "perto da meta",
  },
  vermelho: {
    barra: "bg-red-500",
    texto: "text-red-700 dark:text-red-400",
    rotulo: "abaixo de 70%",
  },
};

function Linha({ l }: { l: LinhaQuadro }) {
  const t = textoLinha(l.feito, l.meta);
  const c = COR[l.faixa];
  return (
    <li className="space-y-1" data-testid={`semana-${l.chave}`} data-faixa={l.faixa}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-medium">{l.rotulo}</span>
        <span className="tabular-nums">
          <span className="font-semibold">{t.de}</span>{" "}
          <span className={`text-xs ${c.texto}`}>· {t.resto}</span>
        </span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${l.rotulo}: ${t.de}, ${c.rotulo}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={l.pct}
      >
        <div className={`h-full rounded-full ${c.barra}`} style={{ width: `${l.pct}%` }} />
      </div>
      {l.mes ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          No mês: {l.mes.feito} de {l.mes.meta}
        </p>
      ) : null}
    </li>
  );
}

/** Quadro de feito x meta (corretor ou uma linha da equipe). */
export function QuadroSemana({
  semana,
  mes,
  metas,
  hoje,
  compacto = false,
}: {
  semana: Feito;
  mes: Omit<Feito, "captMes">;
  metas: MetasSemana;
  hoje: string;
  compacto?: boolean;
}) {
  const linhas = montarQuadro(semana, mes, metas);
  const per = rotulosPeriodo(hoje);
  return (
    <div className="space-y-3">
      {compacto ? null : (
        <p className="text-xs text-muted-foreground">
          {per.semana} (segunda a domingo) · mês de {per.mes}
        </p>
      )}
      <ul className="space-y-3">
        {linhas.map((l) => (
          <Linha key={l.chave} l={l} />
        ))}
      </ul>
      <p className="text-sm" data-testid="semana-comprador">
        <span className="font-medium">Visitas com comprador:</span>{" "}
        <span className="tabular-nums">
          {semana.visitaComprador} na semana · {mes.visitaComprador} no mês
        </span>{" "}
        <span className="text-xs text-muted-foreground">(só contagem, sem meta)</span>
      </p>
    </div>
  );
}

/** Feito da semana/mês sem comparar com meta (antes de 01/01/2027). */
export function FeitoSemana({
  semana,
  mes,
  hoje,
  compacto = false,
}: {
  semana: Feito;
  mes: Omit<Feito, "captMes">;
  hoje: string;
  compacto?: boolean;
}) {
  const per = rotulosPeriodo(hoje);
  return (
    <div className="space-y-2" data-testid="semana-feito">
      {compacto ? null : (
        <p className="text-xs text-muted-foreground">
          {per.semana} (segunda a domingo) · mês de {per.mes}
        </p>
      )}
      <ul className="space-y-1 text-sm tabular-nums">
        <li>
          Ligações: {semana.ligacoes} na semana · {mes.ligacoes} no mês
        </li>
        <li>
          V1: {semana.v1} na semana · {mes.v1} no mês
        </li>
        <li>
          V2: {semana.v2} na semana · {mes.v2} no mês
        </li>
        <li>
          ACM: {semana.acm} na semana · {mes.acm} no mês
        </li>
        <li>Captações no mês: {semana.captMes}</li>
        <li>
          Visitas com comprador: {semana.visitaComprador} na semana · {mes.visitaComprador} no mês
        </li>
      </ul>
      <p className="text-sm text-muted-foreground" data-testid="aviso-vigencia">
        {AVISO_VIGENCIA}
      </p>
    </div>
  );
}

/** Convite para quem ainda não fez o plano (no lugar do quadro). */
export function ConvitePlano() {
  return (
    <div
      className="space-y-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm"
      data-testid="semana-convite"
    >
      <p>Faça seu Meu Plano 2027 para ver suas metas da semana.</p>
      <Button asChild size="sm" data-testid="semana-convite-link">
        <Link to="/minha-carreira/plano" search={{ v: "trilha" }}>
          <Target className="mr-1 h-4 w-4" aria-hidden /> Fazer meu plano
        </Link>
      </Button>
    </div>
  );
}

// Visão do gestor / team leader ---------------------------------------------------------------------------

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

export function EquipeMetas({ hoje, padrao }: { hoje: string; padrao: TaxasFunil | null }) {
  const [linhas, setLinhas] = useState<LinhaEquipeMetas[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const vigente = planoVigente(hoje);

  useEffect(() => {
    let vivo = true;
    void planoDb
      .rpc("carreira_diario_equipe_semana", { _ano: ANO_PLANO })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(errorMessage(error, "Não foi possível carregar a equipe."));
        else {
          setErro(null);
          const n = normalizarEquipeSemana(data as Record<string, unknown>[], padrao);
          setLinhas(
            vigente
              ? ordenarPorDistancia(n)
              : [...n].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
          );
        }
      });
    return () => {
      vivo = false;
    };
  }, [padrao, vigente]);

  const per = rotulosPeriodo(hoje);
  return (
    <section
      className="space-y-2 rounded-lg border bg-muted/30 p-3"
      data-testid="diario-equipe-metas"
    >
      <div className="space-y-0.5">
        <span className="text-sm font-semibold">Equipe: feito x meta da semana</span>
        <p className="text-xs text-muted-foreground">
          {per.semana} · Para a conversa 1:1 com cada corretor. Sem ranking e sem pontos
          {vigente ? "; quem está mais longe da meta aparece primeiro." : "."}
        </p>
      </div>
      {erro ? (
        <p className="text-sm text-destructive">{erro}</p>
      ) : !linhas ? (
        <ListSkeleton />
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum corretor na sua equipe.</p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((l) => {
            const ab = aberto === l.user_id;
            return (
              <li
                key={l.user_id}
                className="rounded-md border bg-background p-3"
                data-testid="equipe-metas-corretor"
              >
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  aria-expanded={ab}
                  onClick={() => setAberto(ab ? null : l.user_id)}
                >
                  <span className="font-medium">{l.nome}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.metas
                      ? vigente
                        ? `${l.semana.ligacoes}/${l.metas.ligacoes} ligações · ${l.semana.v1}/${l.metas.v1} V1 · ${l.semana.v2}/${l.metas.v2} V2`
                        : `${l.semana.ligacoes} ligações · ${l.semana.v1} V1 · ${l.semana.v2} V2`
                      : "sem Meu Plano 2027"}
                    {" · "}
                    {ab ? "fechar" : "abrir"}
                  </span>
                </button>
                {ab ? (
                  <div className="mt-3 space-y-2">
                    {l.metas && vigente ? (
                      <QuadroSemana
                        semana={l.semana}
                        mes={l.mes}
                        metas={l.metas}
                        hoje={hoje}
                        compacto
                      />
                    ) : l.metas ? (
                      <FeitoSemana semana={l.semana} mes={l.mes} hoje={hoje} compacto />
                    ) : (
                      <p className="text-sm text-muted-foreground" data-testid="equipe-sem-plano">
                        Ainda não fez o Meu Plano 2027. Feito na semana: {l.semana.ligacoes}{" "}
                        ligações, {l.semana.v1} V1, {l.semana.v2} V2, {l.semana.acm} ACM,{" "}
                        {l.semana.visitaComprador} com comprador.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Último registro: {l.ultimo ? dataBR(l.ultimo) : "—"}
                      {l.antigasMes > 0
                        ? ` · ${l.antigasMes} visita(s) antiga(s) no mês, fora das metas`
                        : ""}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
