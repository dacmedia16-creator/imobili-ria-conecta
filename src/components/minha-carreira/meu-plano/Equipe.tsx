import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, ListSkeleton, Pill } from "@/components/visual/base";
import { calc, type Respostas, type TaxasFunil } from "@/lib/meu-plano-2027/regras";
import { ANO_PLANO, ORDEM, inicioNoventaDias, progresso, tela } from "@/lib/meu-plano-2027/telas";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";
import { PlanoCtx, Bloco, Stat } from "./campos";
import { Cockpit, CorpoTela } from "./telas";
import { IndiceTelas } from "./IndiceTelas";
import { SeloPagina } from "./Leitor";
import { NavInferior } from "./MeuPlano";
import { BotaoBaixarPlano } from "./BaixarPdf";
import { OQueFalta } from "./OQueFalta";
import { BotaoReabrirPlano } from "./ReabrirPlano";
import { useAuth } from "@/lib/auth";
import {
  contarNaMeta,
  planoComSelo,
  SELO_META,
  type MetaOficialGravada,
} from "@/lib/metas-2027/consolidado";

type Membro = {
  user_id: string;
  nome: string;
  /** Legado: trilha escolhida antes do caminho único (o banco ainda devolve; o app não usa). */
  trilha: string | null;
  ativacao_inicio: string | null;
  respostas: Respostas;
  assinado_corretor_em: string | null;
  assinado_broker_em: string | null;
  meta_oficial_em: string | null;
  /** Lido à parte de carreira_plano (a RPC só devolve a data). */
  meta_oficial?: MetaOficialGravada | null;
  updated_at: string | null;
};
/**
 * Telas que o broker/TL percorre ao abrir o plano (t_fb929978, Denis 23/11): a ordem do corretor, sem a p52 (o
 * cockpit, que já está no resumo do fim). Passo = posição nesta lista; `RESUMO` (= tamanho da lista) = o resumo.
 */
export const TELAS_EQUIPE = ORDEM.filter((id) => id !== "p52");
const RESUMO = TELAS_EQUIPE.length;

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

/**
 * Admin/administrador principal (a imobiliária toda) e gestor/team leader (só a própria equipe; o banco filtra,
 * decisão de Denis 21/11/2026, t_48670ed3): lista e o plano completo, somente leitura.
 * `broker` = vê a imobiliária (só muda textos). `assina` = mostra "Assinar o pacto como broker" (gestor/admin/
 * dono; o banco confere em meu_plano_eh_broker). Ausente = segue `broker`.
 */
export function EquipePlano({
  aberto,
  abrir,
  broker = true,
  assina,
}: {
  aberto: string | null;
  abrir: (id: string | null) => void;
  broker?: boolean;
  assina?: boolean;
}) {
  const podeAssinar = assina ?? broker;
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [taxas, setTaxas] = useState<TaxasFunil | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Abrir entra na 1ª tela; trocar de corretor volta para a 1ª tela.
  const [passo, setPasso] = useState(0);
  useEffect(() => setPasso(0), [aberto]);
  const { user } = useAuth();

  const carregar = useCallback(async () => {
    setErro(null);
    const [r, t, mo] = await Promise.all([
      planoDb.rpc("carreira_plano_equipe", { _ano: ANO_PLANO }),
      planoDb
        .from("carreira_taxas")
        .select("funil_v2_cre,funil_v1_v2,funil_folga")
        .is("user_id", null)
        .maybeSingle(),
      // Valores da meta oficial GRAVADA no clique (t_bd480fee). A RLS de carreira_plano deixa ler exatamente as
      // mesmas pessoas da lista (admin: imobiliária; gestor/TL: a equipe que lidera).
      planoDb
        .from("carreira_plano")
        .select("user_id,meta_oficial")
        .eq("ano", ANO_PLANO)
        .not("meta_oficial", "is", null),
    ]);
    if (r.error || mo.error) {
      setErro(erroPlano((r.error ?? mo.error)!.message));
      return;
    }
    const gravadas = new Map(
      ((mo.data ?? []) as { user_id: string; meta_oficial: MetaOficialGravada | null }[]).map(
        (x) => [x.user_id, x.meta_oficial] as const,
      ),
    );
    setLista(
      ((r.data ?? []) as Membro[]).map((m) => ({
        ...m,
        respostas: (m.respostas ?? {}) as Respostas,
        meta_oficial: gravadas.get(m.user_id) ?? null,
      })),
    );
    const x = t.data as {
      funil_v2_cre: number | null;
      funil_v1_v2: number | null;
      funil_folga: number | null;
    } | null;
    setTaxas(x ? { v2cre: x.funil_v2_cre, v1v2: x.funil_v1_v2, folga: x.funil_folga } : null);
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  const linhas = useMemo(() => {
    // Mesma regra do somarPlanos e dos painéis de metas (seloMeta, t_91ec7aa3): conta quem tem a meta oficial
    // GRAVADA (botão verde ou assinatura), dentro do limite. Só exibição; nada é gravado.
    const n = (v: unknown) => (v == null ? null : Number(v));
    const padrao = taxas
      ? { v2cre: n(taxas.v2cre), v1v2: n(taxas.v1v2), folga: n(taxas.folga) }
      : null;
    return (lista ?? []).map((m) => ({
      m,
      p: progresso(m.respostas),
      selo: planoComSelo(
        {
          assinadoEm: m.assinado_corretor_em,
          respostas: m.respostas,
          metaOficial: m.meta_oficial,
          metaOficialEm: m.meta_oficial_em,
        },
        padrao,
      ).selo,
    }));
  }, [lista, taxas]);

  if (erro) return <ErrorState onRetry={() => void carregar()}>{erro}</ErrorState>;
  if (!lista) return <ListSkeleton />;

  const m = aberto ? lista.find((x) => x.user_id === aberto) : null;
  if (aberto && m) {
    const S = m.respostas;
    const C = calc(S, taxas);
    const ctx = {
      S,
      C,
      set: () => undefined,
      ro: true,
      inicio: inicioNoventaDias(m.ativacao_inicio, S),
    };
    const p = progresso(S);
    async function assinarBroker() {
      setOcupado(true);
      const { error } = await planoDb.rpc("carreira_plano_assinar_broker", {
        _corretor: m!.user_id,
        _ano: ANO_PLANO,
      });
      setOcupado(false);
      if (error) toast.error(erroPlano(error.message));
      else {
        toast.success("Pacto assinado como broker.");
        await carregar();
      }
    }
    const irPasso = (n: number) => {
      setPasso(Math.max(0, Math.min(RESUMO, n)));
      if (typeof window.scrollTo === "function") window.scrollTo({ top: 0 });
    };
    // O índice também lista a p52 (cockpit): ela leva ao resumo, onde o cockpit está.
    const irTela = (id: string) => {
      const i = TELAS_EQUIPE.indexOf(id);
      irPasso(i >= 0 ? i : RESUMO);
    };
    const noResumo = passo >= RESUMO;
    const t = noResumo ? null : tela(TELAS_EQUIPE[passo])!;
    return (
      <PlanoCtx.Provider value={ctx}>
        <div className="space-y-3 pb-20 md:pb-0" data-testid="broker-plano">
          <div className="sticky top-0 z-20 -mx-4 space-y-1.5 border-b border-dashed border-rose-700/60 bg-background/95 px-4 py-1.5 backdrop-blur md:mx-0 md:rounded-lg md:border">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => abrir(null)}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Equipe
              </Button>
              {noResumo ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => irPasso(RESUMO)}
                  data-testid="ir-resumo"
                >
                  <FileText className="mr-1 h-4 w-4" aria-hidden /> Ir direto ao resumo
                </Button>
              )}
            </div>
            <p className="text-sm" data-testid="faixa-somente-leitura">
              <Eye className="mr-1 inline h-4 w-4" aria-hidden />
              Somente leitura · plano de <b>{m.nome}</b> · {p.telas}/{p.total} telas · {p.pct}%
              preenchido
            </p>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span data-testid="posicao-tela">
                {noResumo ? "Resumo do plano" : `Tela ${passo + 1} de ${RESUMO}`}
              </span>
              <IndiceTelas atual={t?.id ?? "p52"} S={S} irTela={irTela} />
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <i
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(100 * Math.min(passo + 1, RESUMO)) / RESUMO}%` }}
              />
            </div>
          </div>
          {t ? (
            <div className="space-y-3" data-testid={`equipe-tela-${t.id}`}>
              <Bloco className="border-primary/40">
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{t.ev}</p>
                <h2 className="text-lg font-semibold">
                  {t.t}{" "}
                  <span className="align-middle" data-testid="selo-tela">
                    <SeloPagina id={t.id} S={S} />
                  </span>
                </h2>
                {t.opcional ? (
                  <p className="text-xs text-muted-foreground">
                    Tela opcional: não conta no % do plano.
                  </p>
                ) : null}
              </Bloco>
              {/* Trava dupla: ctx.ro + fieldset disabled (nenhum campo aceita digitação). */}
              <fieldset disabled className="min-w-0 space-y-3">
                <CorpoTela id={t.id} />
              </fieldset>
            </div>
          ) : (
            <div className="space-y-3" data-testid="equipe-resumo">
              <OQueFalta S={S} />
              <BotaoBaixarPlano
                userId={m.user_id}
                nome={m.nome}
                S={S}
                rotulo="Baixar o plano em PDF"
              />
              <h3 className="text-base font-semibold">Cockpit (plano em uma página)</h3>
              <Cockpit />
              <Bloco titulo="Pacto com o broker">
                <div className="flex justify-between border-b border-dashed py-2 text-sm">
                  <span>Corretor</span>
                  <span
                    className={m.assinado_corretor_em ? "font-semibold" : "text-muted-foreground"}
                  >
                    {m.assinado_corretor_em ? `✔ ${quando(m.assinado_corretor_em)}` : "pendente"}
                  </span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span>Broker</span>
                  <span
                    className={m.assinado_broker_em ? "font-semibold" : "text-muted-foreground"}
                  >
                    {m.assinado_broker_em ? `✔ ${quando(m.assinado_broker_em)}` : "pendente"}
                  </span>
                </div>
                {!podeAssinar ? null : m.assinado_corretor_em ? (
                  <Button
                    className="w-full"
                    disabled={ocupado || !!m.assinado_broker_em}
                    onClick={() => void assinarBroker()}
                    data-testid="assinar-broker"
                  >
                    {m.assinado_broker_em ? "Pacto assinado ✔" : "Assinar o pacto como broker"}
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">O corretor ainda não assinou.</p>
                )}
                {/* Reabrir: broker (imobiliária) e TL (só a equipe dele; o banco confere). Nunca o próprio plano. */}
                {m.assinado_corretor_em && m.user_id !== user?.id ? (
                  <div className="pt-2">
                    <BotaoReabrirPlano userId={m.user_id} nome={m.nome} aoReabrir={carregar} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Desfaz a assinatura para o corretor corrigir o plano. Nenhum valor é apagado.
                    </p>
                  </div>
                ) : null}
              </Bloco>
            </div>
          )}
          <NavInferior>
            <Button
              variant="outline"
              className="flex-1"
              disabled={passo === 0}
              onClick={() => irPasso(passo - 1)}
              data-testid="equipe-anterior"
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Anterior
            </Button>
            {noResumo ? (
              <Button
                className="flex-1"
                onClick={() => abrir(null)}
                data-testid="equipe-voltar-lista"
              >
                Voltar à equipe
              </Button>
            ) : (
              <Button
                className="flex-1"
                onClick={() => irPasso(passo + 1)}
                data-testid="equipe-proxima"
              >
                {passo === RESUMO - 1 ? "Ver resumo" : "Próxima"}
                <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            )}
          </NavInferior>
        </div>
      </PlanoCtx.Provider>
    );
  }

  const comecou = linhas.filter((l) => l.p.pct > 0).length;
  const contam = contarNaMeta(linhas);
  return (
    <div className="space-y-3" data-testid="broker-equipe">
      <div className="grid grid-cols-3 gap-2">
        <Stat v={`${comecou}/${linhas.length}`} rot="começaram" />
        <Stat v={linhas.filter((l) => l.m.assinado_corretor_em).length} rot="pactos assinados" />
        <Stat v={linhas.filter((l) => l.m.meta_oficial_em).length} rot="metas oficiais" />
      </div>
      <p
        className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm"
        data-testid="contador-conta-meta"
      >
        <b className="tabular-nums">
          {contam} de {linhas.length}
        </b>{" "}
        já contam na meta{" "}
        <span className="text-xs text-muted-foreground">
          (meta oficial gravada no botão verde "Usar como minha meta oficial", mesmo sem assinar)
        </span>
      </p>
      {linhas.length === 0 ? (
        <EmptyState>
          {broker
            ? "Ninguém da imobiliária começou o plano ainda."
            : "Ninguém da sua equipe começou o plano ainda."}
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {linhas.map(({ m: x, p, selo }) => (
            <li key={x.user_id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{x.nome}</p>
                  <Pill tom={SELO_META[selo].tom} className="py-0 text-[11px]">
                    <span data-testid="selo-meta" data-selo={selo}>
                      {SELO_META[selo].texto}
                    </span>
                  </Pill>
                </div>
                <p className="text-xs text-muted-foreground">
                  {p.telas}/{p.total} telas ·{" "}
                  {x.assinado_corretor_em
                    ? "✅ assinado · "
                    : x.updated_at || Object.keys(x.respostas).length
                      ? "📝 em preenchimento · "
                      : ""}
                  {x.updated_at ? `mexeu em ${quando(x.updated_at)}` : "não começou"}
                </p>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <i
                    className={`block h-full rounded-full ${p.pct === 100 ? "bg-emerald-600" : "bg-primary"}`}
                    style={{ width: `${p.pct}%` }}
                  />
                </div>
              </div>
              <b className="w-10 text-right text-sm tabular-nums">{p.pct}%</b>
              {x.updated_at || Object.keys(x.respostas).length ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => abrir(x.user_id)}
                  data-testid="abrir-plano"
                >
                  Abrir
                </Button>
              ) : (
                <span className="w-[3.75rem]" />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {broker
          ? "Você vê os planos só desta imobiliária, em somente leitura. O corretor edita; você assina o pacto depois dele."
          : podeAssinar
            ? "Você vê os planos só da sua equipe, em somente leitura. O corretor edita; você assina o pacto depois dele."
            : "Você vê os planos só da sua equipe, em somente leitura. O corretor edita; o broker assina o pacto."}
      </p>
    </div>
  );
}
