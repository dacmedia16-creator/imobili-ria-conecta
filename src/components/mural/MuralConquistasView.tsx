import { Trophy, Cake, Medal, PartyPopper } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton } from "@/components/visual/base";
import {
  dataVenda,
  descricaoImovel,
  iniciais,
  nomeMes,
  participantes,
  rankingComPosicao,
  resumoQuemParabenizou,
  rotuloAniversario,
  rotuloPontos,
  type BirthdayRow,
  type FeedPost,
  type RankingRow,
} from "@/lib/mural-conquistas";

// Telas puras do Mural (só props): a página cuida das consultas. Nunca exibem valor, comissão ou cliente.

type Estado<T> = { data: T | null; error: string | null };

function Avatar({ nome }: { nome: string | null }) {
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
      aria-hidden
    >
      {iniciais(nome)}
    </span>
  );
}

function Erro({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p>{msg}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function FeedPostItem({
  post,
  quem,
  pending,
  onCheer,
}: {
  post: FeedPost;
  quem: string[];
  pending: boolean;
  onCheer: (id: string) => void;
}) {
  const pessoas = participantes(post);
  const nomes = pessoas.map((p) => p.nome);
  const titulo =
    nomes.length > 1
      ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`
      : (nomes[0] ?? "Equipe");
  const imovel = descricaoImovel(post);
  const resumo = resumoQuemParabenizou(quem, post.cheers);
  return (
    <li className="flex gap-3 border-b py-4 last:border-b-0" data-testid="mural-post">
      <Avatar nome={nomes[0] ?? null} />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-semibold">🏆 {titulo}</span>{" "}
          {nomes.length > 1 ? "venderam!" : "vendeu!"}
          {imovel && <span className="text-muted-foreground"> {imovel}</span>}
          <span className="ml-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            Contrato assinado
          </span>
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {pessoas.map((p) => (
            <li key={p.nome}>
              <span className="font-medium text-foreground">{p.nome}</span> · {p.papel}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-muted-foreground">{dataVenda(post.venda_em)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={post.cheered_by_me ? "secondary" : "default"}
            disabled={post.cheered_by_me || pending}
            aria-pressed={post.cheered_by_me}
            onClick={() => onCheer(post.id)}
          >
            {post.cheered_by_me ? "👏 Você parabenizou" : "👏 Parabenizar"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {post.cheers} parabéns
            {resumo && <span title={quem.join(", ")}> · {resumo}</span>}
          </span>
        </div>
      </div>
    </li>
  );
}

export function FeedCard({
  feed,
  quem,
  pending,
  onCheer,
  onRetry,
}: {
  feed: Estado<FeedPost[]>;
  quem: Record<string, string[]>;
  pending: Set<string>;
  onCheer: (id: string) => void;
  onRetry?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-primary" aria-hidden /> Conquistas recentes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {feed.error ? (
          <Erro msg={feed.error} onRetry={onRetry} />
        ) : feed.data === null ? (
          <ListSkeleton rows={3} />
        ) : feed.data.length === 0 ? (
          <EmptyState icon={PartyPopper}>
            Ainda não há conquistas. Quando uma venda tiver o contrato assinado, ela aparece aqui.
          </EmptyState>
        ) : (
          <ul>
            {feed.data.map((p) => (
              <FeedPostItem
                key={p.id}
                post={p}
                quem={quem[p.id] ?? []}
                pending={pending.has(p.id)}
                onCheer={onCheer}
              />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Só entram vendas com contrato assinado. Sem valor, comissão ou nome do cliente.
        </p>
      </CardContent>
    </Card>
  );
}

export function RankingCard({
  ranking,
  periodo,
  meses,
  onPeriodo,
  onRetry,
}: {
  ranking: Estado<RankingRow[]>;
  periodo: { ano: number; mes: number };
  meses: { ano: number; mes: number }[];
  onPeriodo: (p: { ano: number; mes: number }) => void;
  onRetry?: () => void;
}) {
  const valor = `${periodo.ano}-${periodo.mes}`;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Medal className="h-4 w-4 text-primary" aria-hidden /> Ranking do mês
          </span>
          <select
            aria-label="Mês do ranking"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-normal"
            value={valor}
            onChange={(e) => {
              const [a, m] = e.target.value.split("-").map(Number);
              onPeriodo({ ano: a, mes: m });
            }}
          >
            {meses.map((m) => (
              <option key={`${m.ano}-${m.mes}`} value={`${m.ano}-${m.mes}`}>
                {nomeMes(m.ano, m.mes)}
              </option>
            ))}
          </select>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ranking.error ? (
          <Erro msg={ranking.error} onRetry={onRetry} />
        ) : ranking.data === null ? (
          <ListSkeleton rows={3} />
        ) : ranking.data.length === 0 ? (
          <EmptyState icon={Medal}>
            Nenhuma venda assinada em {nomeMes(periodo.ano, periodo.mes)}.
          </EmptyState>
        ) : (
          <ol className="divide-y" data-testid="mural-ranking">
            {rankingComPosicao(ranking.data).map((r) => (
              <li key={r.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-7 shrink-0 font-semibold text-primary">{r.posicao}º</span>
                  <span className="truncate">{r.nome ?? "—"}</span>
                </span>
                <b className="shrink-0">{rotuloPontos(r.pontos)}</b>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Conta por quantidade de vendas (captador e vendedor contam 1 cada), no horário de São
          Paulo. Sem valores.
        </p>
      </CardContent>
    </Card>
  );
}

export function BirthdaysCard({
  birthdays,
  hoje,
  onRetry,
}: {
  birthdays: Estado<BirthdayRow[]>;
  hoje: { dia: number; mes: number };
  onRetry?: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cake className="h-4 w-4 text-primary" aria-hidden /> Aniversariantes do mês
        </CardTitle>
      </CardHeader>
      <CardContent>
        {birthdays.error ? (
          <Erro msg={birthdays.error} onRetry={onRetry} />
        ) : birthdays.data === null ? (
          <ListSkeleton rows={2} />
        ) : birthdays.data.length === 0 ? (
          <EmptyState icon={Cake}>
            Nenhum aniversariante neste mês. Cada pessoa pode informar o aniversário em Meu perfil.
          </EmptyState>
        ) : (
          <ul className="divide-y" data-testid="mural-aniversarios">
            {birthdays.data.map((b) => (
              <li key={b.user_id} className="flex items-center gap-3 py-2">
                <Avatar nome={b.nome} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{b.nome ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{rotuloAniversario(b, hoje)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
