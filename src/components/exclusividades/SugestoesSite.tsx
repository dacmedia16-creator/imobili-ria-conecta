import { useEffect, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateBR } from "@/lib/exclusive-captures";
import { siteSuggestions } from "@/lib/feedback-captacao-db";
import { resumoSugestao, type SiteSuggestions } from "@/lib/remax-site";

/**
 * Sugestões do site RE/MAX para a captação (1 a 3, só do ID do captador). Nada é ligado sozinho:
 * o corretor clica em "É este" e a ligação segue o fluxo normal (exclusive_listing_link, regras do PR #56).
 * Sem coleta ou com erro: não mostra nada e a tela continua com o código digitado.
 */
export function SugestoesSite({
  captureId,
  busy,
  onEscolher,
}: {
  captureId: string;
  busy: boolean;
  onEscolher: (code: string) => void;
}) {
  const [data, setData] = useState<SiteSuggestions | null>(null);
  useEffect(() => {
    let alive = true;
    siteSuggestions(captureId).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [captureId]);
  if (!data?.items?.length) return null;

  return (
    <div
      className="rounded-md border border-violet-300 bg-violet-50 p-3"
      data-testid="sugestoes-site"
    >
      <div className="flex items-center gap-2 font-medium text-violet-900">
        <Sparkles className="h-4 w-4" /> Achamos no site da RE/MAX
      </div>
      <p className="mb-2 text-xs text-violet-900/80">
        Anúncios do seu ID parecidos com esta captação
        {data.coleta ? ` (site lido em ${formatDateBR(data.coleta.slice(0, 10))})` : ""}. Confira e
        clique em “É este” — nada é ligado sem a sua confirmação.
      </p>
      <ul className="space-y-2">
        {data.items.map((s) => (
          <li key={s.code} className="rounded-md border bg-white p-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-mono text-sm font-medium">{s.code}</span>{" "}
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 ${s.confianca === "alta" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}
                >
                  {s.confianca === "alta" ? "Muito provável" : "Possível"}
                </span>
              </div>
              <span className="flex gap-1">
                {s.url && (
                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      Ver no site <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={busy}
                  onClick={() => onEscolher(s.code)}
                >
                  É este
                </Button>
              </span>
            </div>
            <div className="mt-1">
              {[s.rua, s.numero].filter(Boolean).join(", ") || "Endereço não informado no site"}
              {s.bairro ? ` · ${s.bairro}` : ""}
            </div>
            <div className="text-muted-foreground">{resumoSugestao(s)}</div>
            {s.motivos?.length > 0 && (
              <div className="text-muted-foreground">Por quê: {s.motivos.join(", ")}.</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
