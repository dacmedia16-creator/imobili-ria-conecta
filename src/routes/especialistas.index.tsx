import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { EspecialistasShell, ImobiliariasLista } from "@/components/especialistas-diretorio";
import { listPublicAgencies, type PublicAgency } from "@/lib/positioning-db";
import { directAgencySlug } from "@/lib/especialistas-publico";

// /especialistas: imobiliárias publicadas (só as ligadas pela plataforma e com ao menos 1 especialista).
// Com uma única imobiliária publicada, vai direto para a página dela. O link antigo continua valendo.
export const Route = createFileRoute("/especialistas/")({
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
            : "Ache um especialista — RE/MAX",
      },
      {
        name: "description",
        content:
          import.meta.env.VITE_HOMOLOG_ONLY === "true"
            ? "Ambiente interno de demonstração do ADM MAX."
            : "Escolha a imobiliária e encontre corretores por bairro, condomínio ou cidade.",
      },
    ],
  }),
  component: AgenciesPage,
});

function AgenciesPage() {
  const navigate = useNavigate();
  const [agencies, setAgencies] = useState<PublicAgency[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    listPublicAgencies()
      .then((rows) => {
        if (!alive) return;
        const slug = directAgencySlug(rows);
        if (slug) {
          void navigate({ to: "/especialistas/$slug", params: { slug }, replace: true });
          return;
        }
        setAgencies(rows);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <EspecialistasShell
      titulo="Encontre um especialista"
      subtitulo="Escolha a imobiliária para ver os corretores e as regiões em que cada um atua."
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Não foi possível carregar as imobiliárias agora.
        </div>
      )}
      {!error && agencies === null && <p className="text-sm text-slate-500">Carregando…</p>}
      {!error && agencies?.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-3 font-medium text-slate-800">Nenhuma imobiliária disponível</h3>
        </div>
      )}
      {agencies && agencies.length > 0 && (
        <>
          <h2 className="mb-6 text-xl font-semibold text-slate-900">Imobiliárias</h2>
          <ImobiliariasLista agencies={agencies} />
        </>
      )}
    </EspecialistasShell>
  );
}
