import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EspecialistasDaImobiliaria,
  EspecialistasShell,
} from "@/components/especialistas-diretorio";
import { listPublicAgencies, type PublicAgency } from "@/lib/positioning-db";
import { isValidAgencySlug } from "@/lib/especialistas-publico";

// /especialistas/<slug>: busca + filtro de região só dos corretores dessa imobiliária.
// Imobiliária desligada, sem especialista ou inexistente: "não encontrada" (o banco também devolve vazio).
export const Route = createFileRoute("/especialistas/$slug")({
  ssr: false,
  beforeLoad: () => {
    if (import.meta.env.VITE_HOMOLOG_ONLY === "true") throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      {
        title:
          import.meta.env.VITE_HOMOLOG_ONLY === "true"
            ? "ADM MAX — Homologação"
            : "Especialistas por região — RE/MAX",
      },
      {
        name: "description",
        content:
          import.meta.env.VITE_HOMOLOG_ONLY === "true"
            ? "Ambiente interno de demonstração do ADM MAX."
            : "Encontre corretores por bairro, condomínio ou cidade.",
      },
    ],
  }),
  component: AgencySpecialistsPage,
});

function AgencySpecialistsPage() {
  const { slug } = Route.useParams();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "missing"; total: number }
    | { kind: "ok"; agency: PublicAgency; total: number }
  >({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    if (!isValidAgencySlug(slug)) {
      setState({ kind: "missing", total: 0 });
      return;
    }
    listPublicAgencies()
      .then((rows) => {
        if (!alive) return;
        const agency = rows.find((row) => row.slug === slug);
        setState(
          agency
            ? { kind: "ok", agency, total: rows.length }
            : { kind: "missing", total: rows.length },
        );
      })
      .catch(() => {
        if (alive) setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    if (state.kind === "ok") document.title = `Especialistas — ${state.agency.nome}`;
  }, [state]);

  if (state.kind === "ok")
    return <EspecialistasDaImobiliaria agency={state.agency} mostrarOutras={state.total > 1} />;

  return (
    <EspecialistasShell
      titulo="Encontre um especialista"
      subtitulo="Busque corretores por bairro, condomínio ou cidade."
    >
      {state.kind === "loading" && <p className="text-sm text-slate-500">Carregando…</p>}
      {state.kind === "error" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Não foi possível carregar os especialistas agora.
        </div>
      )}
      {state.kind === "missing" && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 font-medium text-slate-800">Imobiliária não encontrada</h3>
          <p className="mt-1 text-sm text-slate-500">
            Esta página não está disponível. Veja as imobiliárias com especialistas publicados.
          </p>
          <Button className="mt-5" asChild>
            <Link to="/especialistas">Ver imobiliárias</Link>
          </Button>
        </div>
      )}
    </EspecialistasShell>
  );
}
