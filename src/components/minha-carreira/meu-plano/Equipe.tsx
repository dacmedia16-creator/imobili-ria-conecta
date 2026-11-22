import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, ListSkeleton, Pill } from "@/components/visual/base";
import { calc, type Respostas, type TaxasFunil } from "@/lib/meu-plano-2027/regras";
import {
  ANO_PLANO,
  ORDEM,
  feitosDaTela,
  inicioNoventaDias,
  progresso,
  tela,
} from "@/lib/meu-plano-2027/telas";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";
import { PlanoCtx, Bloco, Stat } from "./campos";
import { Cockpit, CorpoTela } from "./telas";
import { BotaoBaixarPlano } from "./BaixarPdf";
import { OQueFalta } from "./OQueFalta";
import { BotaoReabrirPlano } from "./ReabrirPlano";
import { useAuth } from "@/lib/auth";
import { contarNaMeta, planoComSelo, SELO_META } from "@/lib/metas-2027/consolidado";

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
  updated_at: string | null;
};
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
  const { user } = useAuth();

  const carregar = useCallback(async () => {
    setErro(null);
    const [r, t] = await Promise.all([
      planoDb.rpc("carreira_plano_equipe", { _ano: ANO_PLANO }),
      planoDb
        .from("carreira_taxas")
        .select("funil_v2_cre,funil_v1_v2,funil_folga")
        .is("user_id", null)
        .maybeSingle(),
    ]);
    if (r.error) {
      setErro(erroPlano(r.error.message));
      return;
    }
    setLista(
      ((r.data ?? []) as Membro[]).map((m) => ({
        ...m,
        respostas: (m.respostas ?? {}) as Respostas,
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
    // Mesma regra do somarPlanos (seloMeta): situacaoPlano + metaDoPlano com as taxas padrão (em número, como o
    // painel de metas lê em lerTaxasPadrao). Só exibição; nada é gravado.
    const n = (v: unknown) => (v == null ? null : Number(v));
    const padrao = taxas
      ? { v2cre: n(taxas.v2cre), v1v2: n(taxas.v1v2), folga: n(taxas.folga) }
      : null;
    return (lista ?? []).map((m) => ({
      m,
      p: progresso(m.respostas),
      selo: planoComSelo({ assinadoEm: m.assinado_corretor_em, respostas: m.respostas }, padrao)
        .selo,
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
    return (
      <PlanoCtx.Provider value={ctx}>
        <div className="space-y-3" data-testid="broker-plano">
          <Button variant="outline" size="sm" onClick={() => abrir(null)}>
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Equipe
          </Button>
          <Bloco className="border-dashed border-rose-700/60">
            <p className="text-sm">
              <Eye className="mr-1 inline h-4 w-4" aria-hidden />
              Somente leitura · plano de <b>{m.nome}</b> · {p.telas}/{p.total} telas · {p.pct}%
              preenchido
            </p>
          </Bloco>
          <OQueFalta S={S} />
          <BotaoBaixarPlano userId={m.user_id} nome={m.nome} S={S} rotulo="Baixar o plano em PDF" />
          <h3 className="text-base font-semibold">Cockpit (plano em uma página)</h3>
          <Cockpit />
          <Bloco titulo="Pacto com o broker">
            <div className="flex justify-between border-b border-dashed py-2 text-sm">
              <span>Corretor</span>
              <span className={m.assinado_corretor_em ? "font-semibold" : "text-muted-foreground"}>
                {m.assinado_corretor_em ? `✔ ${quando(m.assinado_corretor_em)}` : "pendente"}
              </span>
            </div>
            <div className="flex justify-between py-2 text-sm">
              <span>Broker</span>
              <span className={m.assinado_broker_em ? "font-semibold" : "text-muted-foreground"}>
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
          <h3 className="pt-2 text-base font-semibold">Todas as respostas, página por página</h3>
          {ORDEM.filter((id) => id !== "p52").map((id) => {
            const t = tela(id)!;
            const f = feitosDaTela(id, S);
            return (
              <details key={id} className="rounded-xl border bg-card">
                <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold">
                  <span>
                    {t.t}
                    {t.opcional ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (opcional)
                      </span>
                    ) : null}
                  </span>
                  <Pill tom={t.req.length && f === t.req.length ? "green" : "slate"}>
                    {t.req.length ? `${f}/${t.req.length}` : "—"}
                  </Pill>
                </summary>
                <fieldset disabled className="space-y-3 px-3 pb-3">
                  <CorpoTela id={id} />
                </fieldset>
              </details>
            );
          })}
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
          (plano assinado e com meta de comissão)
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
