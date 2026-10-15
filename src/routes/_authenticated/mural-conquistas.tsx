import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/visual/base";
import { BirthdaysCard, FeedCard, RankingCard } from "@/components/mural/MuralConquistasView";
import {
  cheer,
  guardMuralRoute,
  loadBirthdays,
  loadCheerers,
  loadFeed,
  loadRanking,
} from "@/lib/mural-conquistas-db";
import {
  agruparQuemParabenizou,
  aplicarParabens,
  confirmarParabens,
  desfazerParabens,
  diaAtualSP,
  mesAtualSP,
  nomeMes,
  ultimosMeses,
  type BirthdayRow,
  type FeedPost,
  type RankingRow,
} from "@/lib/mural-conquistas";

export const Route = createFileRoute("/_authenticated/mural-conquistas")({
  head: () => ({ meta: [{ title: "Mural de Conquistas" }] }),
  // Módulo desligado: redireciona antes de montar a página (nenhuma consulta do mural é feita).
  beforeLoad: guardMuralRoute,
  component: MuralConquistasPage,
});

type Estado<T> = { data: T | null; error: string | null };
const CARREGANDO = { data: null, error: null };

function MuralConquistasPage() {
  const atual = useMemo(() => mesAtualSP(), []);
  const hoje = useMemo(() => diaAtualSP(), []);
  const meses = useMemo(() => ultimosMeses(12), []);
  const [periodo, setPeriodo] = useState(atual);
  const [feed, setFeed] = useState<Estado<FeedPost[]>>(CARREGANDO);
  const [quem, setQuem] = useState<Record<string, string[]>>({});
  const [ranking, setRanking] = useState<Estado<RankingRow[]>>(CARREGANDO);
  const [birthdays, setBirthdays] = useState<Estado<BirthdayRow[]>>(CARREGANDO);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const feedRef = useRef<FeedPost[]>([]);

  const carregarQuem = useCallback(async (ids: string[]) => {
    try {
      setQuem(agruparQuemParabenizou(await loadCheerers(ids)));
    } catch {
      /* lista de nomes é complemento: o contador continua visível */
    }
  }, []);

  const carregarFeed = useCallback(async () => {
    setFeed(CARREGANDO);
    try {
      const posts = await loadFeed(30);
      feedRef.current = posts;
      setFeed({ data: posts, error: null });
      void carregarQuem(posts.map((p) => p.id));
    } catch (e) {
      setFeed({ data: null, error: errorMessage(e, "Não foi possível carregar o mural.") });
    }
  }, [carregarQuem]);

  const carregarAniversarios = useCallback(async () => {
    setBirthdays(CARREGANDO);
    try {
      setBirthdays({ data: await loadBirthdays(hoje.mes), error: null });
    } catch (e) {
      setBirthdays({
        data: null,
        error: errorMessage(e, "Não foi possível carregar os aniversariantes."),
      });
    }
  }, [hoje.mes]);

  const carregarRanking = useCallback(async (p: { ano: number; mes: number }) => {
    setRanking(CARREGANDO);
    try {
      setRanking({ data: await loadRanking(p.ano, p.mes), error: null });
    } catch (e) {
      setRanking({ data: null, error: errorMessage(e, "Não foi possível carregar o ranking.") });
    }
  }, []);

  useEffect(() => {
    void carregarFeed();
    void carregarAniversarios();
  }, [carregarFeed, carregarAniversarios]);

  useEffect(() => {
    void carregarRanking(periodo);
  }, [carregarRanking, periodo]);

  const onCheer = useCallback(
    async (postId: string) => {
      const antes = feedRef.current.find((p) => p.id === postId);
      if (!antes || antes.cheered_by_me || pending.has(postId)) return;
      setPending((s) => new Set(s).add(postId));
      feedRef.current = aplicarParabens(feedRef.current, postId);
      setFeed({ data: feedRef.current, error: null });
      try {
        const total = await cheer(postId);
        feedRef.current = confirmarParabens(feedRef.current, postId, total);
        setFeed({ data: feedRef.current, error: null });
        void carregarQuem(feedRef.current.map((p) => p.id));
      } catch (e) {
        feedRef.current = desfazerParabens(feedRef.current, postId, antes);
        setFeed({ data: feedRef.current, error: null });
        toast.error(errorMessage(e, "Não foi possível registrar o parabéns. Tente de novo."));
      } finally {
        setPending((s) => {
          const n = new Set(s);
          n.delete(postId);
          return n;
        });
      }
    },
    [pending, carregarQuem],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Trophy}
        title="Mural de Conquistas"
        description={`Vendas assinadas da imobiliária, ranking e aniversariantes · ${nomeMes(atual.ano, atual.mes)}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <FeedCard
          feed={feed}
          quem={quem}
          pending={pending}
          onCheer={onCheer}
          onRetry={carregarFeed}
        />
        <div className="space-y-6">
          <RankingCard
            ranking={ranking}
            periodo={periodo}
            meses={meses}
            onPeriodo={setPeriodo}
            onRetry={() => carregarRanking(periodo)}
          />
          <BirthdaysCard birthdays={birthdays} hoje={hoje} onRetry={carregarAniversarios} />
        </div>
      </div>
    </div>
  );
}
