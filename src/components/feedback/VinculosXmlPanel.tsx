import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  VIA_ACAO,
  VIA_TEXTO,
  ordenarLinks,
  precisaRevisar,
  resumoLinks,
  type BrokerLink,
  type Via,
} from "@/lib/remax-xml-links";

const db = supabase as unknown as SupabaseClient;

/** Só o conflito e o sem cadastro pedem atenção (texto + cor); o resto fica neutro. */
const TOM: Record<Via, string> = {
  id: "",
  admin: "",
  email: "",
  telefone: "",
  conflito: "border-amber-300 bg-amber-50 text-amber-900",
  sem_cadastro: "border-amber-300 bg-amber-50 text-amber-900",
};

/**
 * Revisão do admin: como cada corretor do XML RE/MAX foi ligado a um usuário do ADM.
 * Só leitura. A RPC é exclusiva de admin e não devolve e-mail nem telefone.
 */
export function VinculosXmlPanel({ names }: { names: Record<string, string> }) {
  const [rows, setRows] = useState<BrokerLink[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await db.rpc("remax_xml_broker_links");
      if (!alive) return;
      if (error) setErro(errorMessage(error, "Não foi possível carregar os vínculos"));
      else setRows(ordenarLinks((data ?? []) as BrokerLink[]));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (erro)
    return (
      <p className="text-xs text-muted-foreground" data-testid="vinculos-erro">
        Vínculos do XML indisponíveis: {erro}
      </p>
    );
  if (!rows?.length) return null;

  const resumo = resumoLinks(rows);
  const pendentes = rows.filter(precisaRevisar);
  const lista = todos ? rows : pendentes;

  return (
    <details className="rounded-lg border p-3 text-sm" data-testid="vinculos-xml">
      <summary className="cursor-pointer font-medium">
        Vínculos corretor XML → ADM ({pendentes.length} para revisar de {rows.length})
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Cada corretor do XML RE/MAX é ligado a um usuário pelo ID RE/MAX; sem ID, pelo e-mail; sem
        e-mail, pelo telefone (só se o telefone for de um único corretor). Anúncio sem vínculo fica
        só com o admin.
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {(Object.keys(VIA_TEXTO) as Via[]).map((v) => (
          <span key={v} className={`rounded border bg-card px-2 py-1 ${TOM[v]}`}>
            {VIA_TEXTO[v]}: {resumo[v].corretores} corretor(es) · {resumo[v].anuncios} anúncio(s)
          </span>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
        Mostrar também os ligados pelo ID RE/MAX
      </label>
      <div className="mt-2 grid gap-1">
        {lista.slice(0, 300).map((l) => (
          <div
            key={l.agent_id}
            className={`flex flex-col gap-1 rounded border bg-card px-2 py-1 text-xs sm:flex-row sm:justify-between ${TOM[l.via]}`}
          >
            <span className="min-w-0">
              <span className="font-medium">ID {l.agent_id}</span>
              {l.corretor_xml ? ` · ${l.corretor_xml} (XML)` : ""}
              {l.broker_id ? ` → ${names[l.broker_id] || "usuário do ADM"}` : ""}
              {VIA_ACAO[l.via] && (
                <span className="block text-muted-foreground">{VIA_ACAO[l.via]}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {VIA_TEXTO[l.via]}
              {l.via === "conflito" ? ` (${l.candidatos})` : ""} · {l.anuncios} anúncio(s)
            </span>
          </div>
        ))}
        {!lista.length && <p className="text-xs text-muted-foreground">Nada para revisar.</p>}
      </div>
    </details>
  );
}
