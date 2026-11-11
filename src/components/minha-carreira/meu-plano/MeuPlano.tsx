import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Download,
  Loader2,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorState, ListSkeleton, Pill } from "@/components/visual/base";
import { calc, fmt, metaOficialDoPlano, type Respostas } from "@/lib/meu-plano-2027/regras";
import { ORDEM, TRILHAS, progresso, tela, vizinhos, type Trilha } from "@/lib/meu-plano-2027/telas";
import { LEIA } from "@/lib/meu-plano-2027/book";
import { erroPlano, planoDb } from "@/lib/meu-plano-2027/modulo";
import { metasDoCalc, snapshotMudou } from "@/lib/meta-atividades";
import { PlanoCtx, Aviso, Bloco, Stat } from "./campos";
import { CorpoTela } from "./telas";
import { Leitor, PaginaOriginal } from "./Leitor";
import { usePlano, type StatusSalvar } from "./usePlano";

export type Vista =
  { v: "trilha" } | { v: "tela"; id: string } | { v: "book"; p: number } | { v: "fim" };

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";

export function SalvoIndicador({ status, msg }: { status: StatusSalvar; msg: string | null }) {
  if (status === "erro")
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-amber-700"
        role="status"
        data-testid="salvo"
      >
        <CloudOff className="h-3.5 w-3.5" aria-hidden /> {msg ?? "Sem conexão"}: guardado no
        aparelho
      </span>
    );
  if (status === "salvando" || status === "pendente")
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        role="status"
        data-testid="salvo"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> salvando…
      </span>
    );
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-emerald-700"
      role="status"
      data-testid="salvo"
    >
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> salvo
    </span>
  );
}

function LeiaAntes({
  ids,
  titulo = "Leia antes (opcional)",
  verPagina,
  abrirBook,
}: {
  ids?: string[];
  titulo?: string;
  verPagina: (n: number) => void;
  abrirBook: (n: number) => void;
}) {
  if (!ids?.length) return null;
  return (
    <details className="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20">
      <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
        📖 {titulo} · {ids.length} {ids.length > 1 ? "páginas" : "página"}
      </summary>
      <div className="space-y-2 px-3.5 pb-3">
        {ids.map((id) => {
          const l = LEIA[id];
          return (
            <details
              key={id}
              className="border-t border-dashed border-amber-200 pt-2 dark:border-amber-900"
            >
              <summary className="cursor-pointer text-sm">
                {l.t} <span className="text-xs text-muted-foreground">p.{l.pdf - 1}</span>
              </summary>
              <p className="mt-1 text-[13px]">{l.r}</p>
              <div className="mt-1 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => verPagina(l.pdf)}>
                  🖼 ver página original
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrirBook(l.pdf)}>
                  📖 abrir no book
                </Button>
              </div>
            </details>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Não trava o fluxo: pode pular e voltar quando quiser.
        </p>
      </div>
    </details>
  );
}

/** Tela do corretor: escolha de trilha, passo a passo, leitor do book e fim. */
export function MeuPlano({
  userId,
  vista,
  ir,
}: {
  userId: string;
  vista: Vista;
  ir: (v: Vista, replace?: boolean) => void;
}) {
  const h = usePlano(userId);
  const { plano } = h;
  const [original, setOriginal] = useState<number | null>(null);
  const [vindoDoBook, setVindoDoBook] = useState<number | null>(null);
  const [metaConf, setMetaConf] = useState<{ atual: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const S: Respostas = plano?.respostas ?? {};
  const C = useMemo(() => calc(S, h.taxasPadrao), [S, h.taxasPadrao]);
  const trilha: Trilha = plano?.trilha ?? "planejamento";

  // Meta x atividades (t_09c29e96): cópia das metas da semana (campos ms.*) para o team leader, que não
  // lê o plano. Atualiza junto com o plano, a partir da mesma calc().
  useEffect(() => {
    if (!plano) return;
    const dif = snapshotMudou(S, metasDoCalc(C));
    if (Object.keys(dif).length) h.setVarios(dif);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C, !!plano]);

  // Última página do book e última tela ficam no próprio plano (campos internos "ui.*").
  useEffect(() => {
    if (!plano) return;
    if (vista.v === "book" && String(S["ui.pag"] ?? "") !== String(vista.p))
      h.set("ui.pag", String(vista.p));
    if (
      vista.v === "tela" &&
      plano.trilha &&
      ORDEM[plano.trilha].includes(vista.id) &&
      S["ui.ult"] !== vista.id
    )
      h.set("ui.ult", vista.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, !!plano]);

  const irTela = useCallback(
    (id: string, deBook?: number) => {
      setVindoDoBook(deBook ?? null);
      ir({ v: "tela", id });
      window.scrollTo(0, 0);
    },
    [ir],
  );
  const abrirBook = useCallback(
    (n: number) => {
      setOriginal(null);
      ir({ v: "book", p: n });
    },
    [ir],
  );

  if (h.erroCarga)
    return <ErrorState onRetry={() => void h.recarregar()}>{h.erroCarga}</ErrorState>;
  if (!plano) return <ListSkeleton />;

  const ctx = { S, C, set: h.set, ro: false, inicio: plano.ativacao_inicio, trilha };

  async function escolher(t: Trilha) {
    setOcupado(true);
    try {
      await h.escolherTrilha(t);
      irTela(ORDEM[t][0]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function trazerNumeros() {
    setOcupado(true);
    const { data, error } = await planoDb.rpc("carreira_plano_meus_numeros");
    setOcupado(false);
    if (error) {
      toast.error(erroPlano(error.message));
      return;
    }
    const d = (data ?? {}) as Record<string, number | null>;
    const map: [string, number | null | undefined][] = [
      ["d.comissao", d.comissao],
      ["d.trans", d.transacoes],
      ["d.cres", d.cres],
      ["d.ticket", d.ticket],
      ["d.ativos", d.ativos],
    ];
    let n = 0;
    for (const [k, v] of map)
      if (v != null && Number.isFinite(Number(v))) {
        h.set(k, String(Math.round(Number(v) * 100) / 100).replace(".", ","));
        n++;
      }
    toast.success(
      n
        ? `${n} números trazidos do ADM MAX (últimos 12 meses). Confira e corrija se precisar.`
        : "O ADM MAX ainda não tem números seus.",
    );
  }

  async function usarMeta(substituir: boolean) {
    const m = metaOficialDoPlano(C);
    if (!m) {
      toast.error("Complete as telas anteriores para calcular o VGC.");
      return;
    }
    setOcupado(true);
    try {
      await h.enviar();
      const r = await h.usarMeta(m, substituir);
      if (r.status === "existe") {
        const a = r.atual;
        setMetaConf({
          atual: a
            ? [
                a.meta_comissao != null ? `comissão ${fmt.brl0(Number(a.meta_comissao))}` : null,
                a.meta_vendas != null ? `${a.meta_vendas} vendas` : null,
                a.meta_captacoes != null ? `${a.meta_captacoes} captações` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "definida"
            : "definida",
        });
      } else toast.success("Meta oficial de 2027 gravada em Minha carreira.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function assinar() {
    setOcupado(true);
    try {
      const r = await h.assinar();
      toast.success(
        r.metaGravada
          ? "Pacto assinado. Sua meta de 2027 já está em Minha carreira. Agora é a vez do seu broker."
          : "Pacto assinado. Agora é a vez do seu broker.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const barraSalvar = (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>Cada campo é salvo assim que você digita.</span>
      <SalvoIndicador status={h.status} msg={h.msg} />
    </div>
  );

  const modal = original ? (
    <PaginaOriginal pdf={original} onFechar={() => setOriginal(null)} abrirNoBook={abrirBook} />
  ) : null;

  // ----- Escolha de trilha -----
  if (vista.v === "trilha") {
    return (
      <div className="space-y-3" data-testid="meu-plano-trilha">
        <Button
          className="w-full bg-gradient-to-r from-rose-900 to-rose-700 text-white"
          onClick={() => abrirBook(Number(S["ui.pag"]) || 1)}
        >
          <BookOpen className="mr-2 h-4 w-4" aria-hidden /> Ler o book completo · 56 páginas
        </Button>
        <Bloco className="border-primary/40">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
            Como usar este plano
          </p>
          <h2 className="text-lg font-semibold">Escolha a sua trilha</h2>
          <p className="text-sm">
            Este book não é um livro para ler. É uma ferramenta para preencher, assinar e levar para
            o ano. Leva de 50 a 60 minutos. Aqui você <b>lê e preenche na mesma tela</b>, uma página
            por vez, e tudo é salvo a cada campo.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setOriginal(13)}>
            🖼 ver página original
          </Button>
        </Bloco>
        {(Object.keys(TRILHAS) as Trilha[]).map((k) => {
          const t = TRILHAS[k];
          const on = plano.trilha === k;
          return (
            <button
              key={k}
              type="button"
              disabled={ocupado}
              onClick={() => void escolher(k)}
              data-trilha={k}
              className={`block w-full rounded-2xl border-2 p-4 text-left ${on ? "border-primary bg-primary/10" : "bg-card"}`}
            >
              <b className="text-lg">
                {on ? "✔ " : ""}Trilha {t.n}
              </b>
              <span className="block text-sm">{t.quem}</span>
              <span className="block text-sm text-muted-foreground">
                Preenche: {t.o} · <b>{ORDEM[k].length} telas</b>
              </span>
              <span className="mt-1.5 inline-block">
                <Pill tom="blue">Objetivo: {t.obj}</Pill>
              </span>
            </button>
          );
        })}
        <Bloco titulo="O que você vai ter no fim">
          <ol className="list-decimal pl-5 text-sm">
            <li>O número que a sua vida custa</li>
            <li>Quantas captações você precisa fazer para chegar nele</li>
            <li>Onde você vai jogar e no que vai se especializar</li>
            <li>O que você faz toda semana</li>
            <li>Um pacto assinado com o seu broker</li>
          </ol>
        </Bloco>
        <LeiaAntes
          ids={[
            "carta",
            "cultura",
            "modelo",
            "dados",
            "conceitos",
            "como",
            "areas",
            "agenda",
            "loja",
          ]}
          verPagina={setOriginal}
          abrirBook={abrirBook}
        />
        {modal}
      </div>
    );
  }

  // ----- Leitor do book -----
  if (vista.v === "book") {
    return (
      <>
        <Leitor
          pagina={vista.p}
          S={S}
          trilha={plano.trilha}
          irPagina={(n) => ir({ v: "book", p: n }, true)}
          preencher={(id) => irTela(id, vista.p)}
        />
      </>
    );
  }

  // ----- Fim -----
  if (vista.v === "fim") {
    const p = progresso(S, plano.trilha);
    return (
      <div className="space-y-3" data-testid="meu-plano-fim">
        <Bloco className="bg-primary text-center text-primary-foreground">
          <p className="text-2xl font-extrabold">PARABÉNS!</p>
          <p>Você acabou de escrever o seu plano.</p>
          <p className="text-2xl font-extrabold">{p.pct}%</p>
          <p className="text-sm opacity-90">
            preenchido · {p.telas}/{p.total} telas completas
          </p>
        </Bloco>
        <Bloco>
          <p className="text-sm">
            Lembre-se: planejamento só se torna realidade com ação. Volte nele todo mês, todo
            trimestre e toda vez que bater a vontade de parar, na sua frase:
          </p>
          <div className="my-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-sm dark:bg-red-950/30">
            {typeof S["pq.frase"] === "string" && S["pq.frase"] ? S["pq.frase"] : "(seu porquê)"}
          </div>
        </Bloco>
        {plano.trilha === "ativacao" ? (
          <Aviso tom="green">
            Quando fechar a primeira venda, faça a trilha Planejamento: suas respostas dos Passos 1
            a 3 já estarão lá.
          </Aviso>
        ) : null}
        <LeiaAntes
          ids={["empreendedor"]}
          titulo="Leia depois (opcional)"
          verPagina={setOriginal}
          abrirBook={abrirBook}
        />
        <Button className="w-full" onClick={() => irTela("p52")}>
          Ver meu cockpit
        </Button>
        {modal}
      </div>
    );
  }

  // ----- Tela de exercício -----
  const t = tela(vista.id);
  if (!t) return <ErrorState>Tela não encontrada.</ErrorState>;
  const viz = vizinhos(t.id, trilha);
  const prog = progresso(S, plano.trilha);
  const meta = metaOficialDoPlano(C);
  const mo = plano.meta_oficial;
  const metaMudou =
    mo &&
    meta &&
    (Math.round(Number(mo.meta_comissao)) !== Math.round(meta.comissao) ||
      Number(mo.meta_vendas) !== meta.vendas);

  const extras = {
    irPara: (id: string) => irTela(id),
    p15: (
      <Bloco>
        <p className="text-sm">
          O ADM MAX já tem 5 destes números (últimos 12 meses). Toque para trazer e depois confira.
        </p>
        <Button
          size="sm"
          className="mt-2 w-full"
          disabled={ocupado}
          onClick={() => void trazerNumeros()}
          data-testid="trazer-numeros"
        >
          <Download className="mr-1 h-4 w-4" aria-hidden /> Trazer meus números do ADM MAX
        </Button>
      </Bloco>
    ),
    p32: (
      <Bloco className="border-2 border-emerald-600">
        <h3 className="flex items-center gap-2 font-semibold">
          <Target className="h-4 w-4" aria-hidden /> Isso vira a sua meta 2027
        </h3>
        <p className="text-sm">
          O Objetivo 2027 passa a ser a sua meta anual oficial em Minha carreira (Meu mês).
        </p>
        {mo ? (
          <Aviso tom="green">
            ✔ Meta oficial gravada em {dataHora(plano.meta_oficial_em)}: VGC{" "}
            {fmt.brl0(Number(mo.meta_comissao))} · {mo.meta_vendas ?? "—"} transações ·{" "}
            {mo.meta_captacoes ?? "—"} captações.
            {metaMudou ? (
              <>
                <br />
                <b>Os números do plano mudaram depois disso.</b> Toque de novo para atualizar.
              </>
            ) : null}
          </Aviso>
        ) : meta ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Vai gravar: VGC {fmt.brl0(meta.comissao)} · {meta.vendas} transações ·{" "}
            {meta.captacoes ?? "—"} captações
            {meta.vgv ? ` · VGV ${fmt.brl0(meta.vgv)}` : ""}.
          </p>
        ) : null}
        <Button
          className="mt-2 w-full bg-emerald-700 text-white hover:bg-emerald-800"
          disabled={ocupado || !meta}
          onClick={() => void usarMeta(false)}
          data-testid="usar-meta"
        >
          Usar como minha meta oficial de 2027
        </Button>
      </Bloco>
    ),
    p45: (
      <Bloco titulo="Assinaturas">
        <div className="flex justify-between border-b border-dashed py-2 text-sm">
          <span>Corretor</span>
          <span className={plano.assinado_corretor_em ? "font-semibold" : "text-muted-foreground"}>
            {plano.assinado_corretor_em
              ? `✔ assinado em ${dataHora(plano.assinado_corretor_em)}`
              : "pendente"}
          </span>
        </div>
        <div className="flex justify-between py-2 text-sm">
          <span>Broker</span>
          <span className={plano.assinado_broker_em ? "font-semibold" : "text-muted-foreground"}>
            {plano.assinado_broker_em
              ? `✔ assinado em ${dataHora(plano.assinado_broker_em)}`
              : "pendente: assina no painel de gestão"}
          </span>
        </div>
        <Button
          className="mt-1 w-full"
          disabled={ocupado || !!plano.assinado_corretor_em}
          onClick={() => void assinar()}
          data-testid="assinar-pacto"
        >
          {plano.assinado_corretor_em ? "Pacto assinado ✔" : "Assinar como corretor"}
        </Button>
      </Bloco>
    ),
  };

  return (
    <PlanoCtx.Provider value={ctx}>
      <div className="space-y-3 pb-20" data-testid={`tela-${t.id}`}>
        <div className="sticky top-0 z-20 -mx-4 border-b bg-background/95 px-4 py-1.5 backdrop-blur md:static md:mx-0 md:rounded-lg md:border">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {viz.i >= 0
                ? `Trilha ${TRILHAS[trilha].n} · tela ${viz.i + 1} de ${viz.total}`
                : `Fora da trilha ${TRILHAS[trilha].n}`}
            </span>
            <span>
              {prog.pct}% ·{" "}
              <button
                type="button"
                className="font-semibold text-rose-800 dark:text-rose-300"
                onClick={() => abrirBook(t.pdf)}
              >
                📖 book
              </button>
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <i
              className="block h-full rounded-full bg-primary"
              style={{ width: `${viz.i >= 0 ? (100 * (viz.i + 1)) / viz.total : 0}%` }}
            />
          </div>
        </div>
        {vindoDoBook ? (
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={() => abrirBook(vindoDoBook)}
          >
            ← Voltar ao book (p. {vindoDoBook})
          </Button>
        ) : null}
        <Bloco className="border-primary/40">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
            {t.ev} · pág. {t.pdf - 1} do book
          </p>
          <h2 className="text-lg font-semibold">
            {t.t} {t.recorrente ? <Pill tom="amber">recorrente</Pill> : null}
          </h2>
          <p className="text-sm">{t.intro}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOriginal(t.pdf)}
              data-testid="ver-original"
            >
              🖼 ver página original
            </Button>
            <Button size="sm" variant="outline" onClick={() => abrirBook(t.pdf)}>
              📖 abrir no book
            </Button>
          </div>
        </Bloco>
        {barraSalvar}
        <LeiaAntes ids={t.leia} verPagina={setOriginal} abrirBook={abrirBook} />
        <CorpoTela id={t.id} extras={extras} />
        {viz.i < 0 ? <Aviso>Esta página não faz parte da trilha {TRILHAS[trilha].n}.</Aviso> : null}
        <NavInferior>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => (viz.anterior ? irTela(viz.anterior) : ir({ v: "trilha" }))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" aria-hidden /> Voltar
          </Button>
          <Button
            className="flex-1"
            onClick={() => (viz.proxima ? irTela(viz.proxima) : ir({ v: "fim" }))}
            data-testid="proxima"
          >
            {viz.i === viz.total - 1 ? "Concluir ✔" : "Próximo"}{" "}
            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </NavInferior>
      </div>
      <ConfirmDialog
        open={!!metaConf}
        onOpenChange={(o) => !o && setMetaConf(null)}
        title="Substituir a sua meta anual de 2027?"
        description={
          <>
            <p>Você já tem uma meta anual de 2027: {metaConf?.atual}.</p>
            <p>Quer trocar pelos números do plano?</p>
          </>
        }
        confirmLabel="Substituir"
        onConfirm={() => void usarMeta(true)}
        testId="confirmar-meta"
      />
      {modal}
    </PlanoCtx.Provider>
  );
}

export const NavInferior = ({ children }: { children: ReactNode }) => (
  <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-background px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] md:static md:z-auto md:rounded-lg md:border">
    {children}
  </div>
);

/** Resumo no cartão de Minha carreira: progresso e meta oficial. */
export function MeuPlanoResumo({
  S,
  trilha,
  metaOficial,
}: {
  S: Respostas;
  trilha: Trilha | null;
  metaOficial: {
    meta_comissao: number | null;
    meta_vendas: number | null;
    meta_captacoes: number | null;
  } | null;
}) {
  const p = progresso(S, trilha);
  return (
    <div className="space-y-2">
      {trilha ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat v={`${p.pct}%`} rot="do plano preenchido" />
          <Stat v={`${p.telas}/${p.total}`} rot={`telas · trilha ${TRILHAS[trilha].n}`} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Você ainda não escolheu sua trilha. Leva de 50 a 60 minutos.
        </p>
      )}
      {metaOficial ? (
        <p className="text-xs text-emerald-700">
          ✔ Meta oficial 2027: {fmt.brl0(Number(metaOficial.meta_comissao))} de comissão ·{" "}
          {metaOficial.meta_vendas ?? "—"} transações · {metaOficial.meta_captacoes ?? "—"}{" "}
          captações
        </p>
      ) : null}
    </div>
  );
}
