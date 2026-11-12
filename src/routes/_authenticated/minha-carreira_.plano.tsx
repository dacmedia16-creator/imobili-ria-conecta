import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { ArrowLeft, Target, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/visual/base";
import { ehBroker, ehLider, guardMeuPlanoRoute } from "@/lib/meu-plano-2027/modulo";
import { TOTAL_PAGINAS } from "@/lib/meu-plano-2027/book";
import { tela } from "@/lib/meu-plano-2027/telas";
import { MeuPlano, type Vista } from "@/components/minha-carreira/meu-plano/MeuPlano";
import { EquipePlano } from "@/components/minha-carreira/meu-plano/Equipe";

// Meu Plano 2027 (cartão t_1ac2e95d). Rota própria fora do layout de Minha carreira. Só abre com o
// módulo "meu_plano_2027" ligado na imobiliária; o banco repete a regra (RLS + RPCs).
type Busca = {
  v?: "trilha" | "tela" | "book" | "fim" | "equipe";
  id?: string;
  p?: number;
  m?: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/_authenticated/minha-carreira_/plano")({
  head: () => ({ meta: [{ title: "Meu Plano 2027" }] }),
  validateSearch: (raw: Record<string, unknown>): Busca => {
    const v = raw.v;
    const b: Busca = {};
    if (v === "trilha" || v === "fim" || v === "equipe") b.v = v;
    if (v === "tela" && typeof raw.id === "string" && tela(raw.id)) {
      b.v = "tela";
      b.id = raw.id;
    }
    if (v === "book") {
      const p = Number(raw.p);
      b.v = "book";
      b.p = Number.isInteger(p) && p >= 1 && p <= TOTAL_PAGINAS ? p : 1;
    }
    if (b.v === "equipe" && typeof raw.m === "string" && UUID.test(raw.m)) b.m = raw.m;
    return b;
  },
  beforeLoad: guardMeuPlanoRoute,
  component: MeuPlanoPage,
});

function MeuPlanoPage() {
  const { user, roles } = useAuth();
  const busca = Route.useSearch();
  const navigate = useNavigate({ from: "/minha-carreira/plano" });
  const broker = ehBroker(roles);
  // Equipe: broker vê a imobiliária; team leader vê só a própria equipe (o banco filtra).
  const veEquipe = broker || ehLider(roles);

  const ir = useCallback(
    (v: Vista, replace?: boolean) => {
      const search: Busca =
        v.v === "tela"
          ? { v: "tela", id: v.id }
          : v.v === "book"
            ? { v: "book", p: v.p }
            : { v: v.v };
      void navigate({ search, replace });
    },
    [navigate],
  );
  const abrirMembro = useCallback(
    (m: string | null) => void navigate({ search: m ? { v: "equipe", m } : { v: "equipe" } }),
    [navigate],
  );

  if (!user) return null;
  const vista: Vista =
    busca.v === "tela" && busca.id
      ? { v: "tela", id: busca.id }
      : busca.v === "book"
        ? { v: "book", p: busca.p ?? 1 }
        : busca.v === "fim"
          ? { v: "fim" }
          : { v: "trilha" };

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link to="/minha-carreira">
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden /> Minha carreira
          </Link>
        </Button>
        {veEquipe ? (
          <Button
            size="sm"
            variant={busca.v === "equipe" ? "default" : "outline"}
            className="ml-auto"
            onClick={() => void navigate({ search: busca.v === "equipe" ? {} : { v: "equipe" } })}
            data-testid="ver-equipe"
          >
            <Users className="mr-1 h-4 w-4" aria-hidden />{" "}
            {busca.v === "equipe" ? "Meu plano" : "Equipe"}
          </Button>
        ) : null}
      </div>
      {busca.v === "equipe" && veEquipe ? (
        <>
          <PageHeader
            icon={Users}
            title="Meu Plano 2027 — equipe"
            description={
              broker
                ? "Planos da imobiliária, somente leitura."
                : "Planos da sua equipe, somente leitura."
            }
          />
          <EquipePlano aberto={busca.m ?? null} abrir={abrirMembro} broker={broker} />
        </>
      ) : (
        <>
          {vista.v === "trilha" ? (
            <PageHeader
              icon={Target}
              title="Meu Plano 2027"
              description="O book do Agent Summit 2027 para ler e preencher no celular."
            />
          ) : null}
          <MeuPlano userId={user.id} vista={vista} ir={ir} />
        </>
      )}
    </div>
  );
}
