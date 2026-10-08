import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChamadoDetalhe,
  rpcLivre,
  SeloStatus,
  SeloTipo,
  type ChamadoLinha,
} from "@/components/ChamadoDetalhe";
import { idade } from "@/lib/ajuda-sugestoes";

export const Route = createFileRoute("/_authenticated/ajuda")({
  head: () => ({ meta: [{ title: "Ajuda e sugestões" }] }),
  component: AjudaPage,
});

/** "Meus chamados" para todos; o admin da imobiliária também vê os da imobiliária (só leitura). */
function AjudaPage() {
  const { hasAny, platformContext } = useAuth();
  const podeVerOrg = hasAny(["admin", "super_admin"]) && !platformContext;
  const [aba, setAba] = useState<"meus" | "org">("meus");
  const [lista, setLista] = useState<ChamadoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await rpcLivre("support_ticket_list", { _escopo: aba });
    if (error) toast.error(error.message);
    setLista((data as ChamadoLinha[] | null) ?? []);
    setCarregando(false);
  }, [aba]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const atual = lista.find((c) => c.id === sel) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajuda e sugestões</h1>
        <p className="text-sm text-muted-foreground">
          Para abrir um chamado, use o botão “Ajuda e sugestões” no canto da tela.
        </p>
      </div>

      {podeVerOrg && (
        <div className="flex gap-2 border-b">
          {(["meus", "org"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setAba(t);
                setSel(null);
              }}
              className={`border-b-2 px-4 py-2 text-sm ${aba === t ? "border-primary font-medium" : "border-transparent text-muted-foreground"}`}
            >
              {t === "meus" ? "Meus chamados" : "Chamados da imobiliária"}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {aba === "meus" ? "Meus chamados" : "Chamados da imobiliária (só leitura)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {!carregando && lista.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum chamado ainda.
              </p>
            )}
            {lista.map((c) => (
              <button
                key={c.id}
                onClick={() => setSel(c.id)}
                className={`w-full rounded-md border p-3 text-left ${sel === c.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">#{c.numero}</span>
                  <SeloTipo tipo={c.tipo} />
                  <SeloStatus status={c.status} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {idade(c.last_message_at)}
                  </span>
                </div>
                <div className="mt-1 truncate text-sm">{c.assunto}</div>
                {aba === "org" && (
                  <div className="text-xs text-muted-foreground">{c.autor_nome ?? "Usuário"}</div>
                )}
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {atual ? (
              <ChamadoDetalhe
                key={atual.id}
                chamado={atual}
                modo={aba === "org" ? "leitura" : "autor"}
                onMudou={carregar}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Escolha um chamado para ver a conversa.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
