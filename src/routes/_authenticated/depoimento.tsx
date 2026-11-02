// Link que Denis manda no WhatsApp: https://app.somosunihub.com.br/depoimento (t_c7cfaf00).
// Sem token público: fica dentro de /_authenticated (sem sessão vai para o login; ao voltar, o
// ADM retoma aqui — ver guardarRetornoDepoimento). Abre direto o mesmo formulário do convite e
// mostra o que a pessoa já enviou, com o botão para retirar (revogar a autorização).
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/visual/base";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { STATUS_DEP_LABEL, type DepMeu, type DepSituacao } from "@/lib/depoimentos";
import { minhaSituacaoDepoimento, retirarDepoimento } from "@/lib/depoimentos-db";
import {
  DepoimentoForm,
  DepoimentoObrigado,
  Estrelas,
} from "@/components/depoimentos/DepoimentoForm";

export const Route = createFileRoute("/_authenticated/depoimento")({
  head: () => ({ meta: [{ title: "Seu depoimento" }] }),
  component: PaginaDepoimento,
});

function PaginaDepoimento() {
  const { user } = useAuth();
  const [situacao, setSituacao] = useState<DepSituacao | null>(null);
  const [erro, setErro] = useState(false);
  const [enviado, setEnviado] = useState<{ publicavel: boolean } | null>(null);

  const carregar = useCallback(() => {
    setErro(false);
    minhaSituacaoDepoimento()
      .then(setSituacao)
      .catch(() => setErro(true));
  }, []);
  useEffect(carregar, [carregar]);

  const retirar = async (d: DepMeu) => {
    if (!window.confirm("Retirar este depoimento? Ele sai da página do ADM MAX na hora.")) return;
    try {
      await retirarDepoimento(d.id);
      toast.success("Depoimento retirado.");
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível retirar.");
    }
  };

  const meus = situacao?.pode_enviar ? situacao.meus : [];
  const temAtivo = meus.some((d) => d.status === "pendente" || d.status === "aprovado");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MessageSquareQuote}
        title="Seu depoimento"
        description="Conte como o ADM MAX ajuda no seu dia a dia. Leva menos de 1 minuto."
      />
      {erro ? (
        <Card>
          <CardContent className="space-y-3 p-6">
            <p>Não foi possível carregar agora.</p>
            <Button variant="outline" onClick={carregar}>
              Tentar de novo
            </Button>
          </CardContent>
        </Card>
      ) : !situacao ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground">Carregando…</CardContent>
        </Card>
      ) : !situacao.pode_enviar ? (
        <Card>
          <CardContent className="p-6 text-muted-foreground">
            {situacao.motivo === "plataforma"
              ? "A conta da plataforma não envia depoimento. Para testar, use uma conta de corretor."
              : situacao.motivo === "sessao_restrita"
                ? "No modo “Entrar como” não é possível enviar depoimento em nome da pessoa."
                : "Entre em uma imobiliária para enviar o seu depoimento."}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 sm:p-6">
              {enviado ? (
                <DepoimentoObrigado publicavel={enviado.publicavel} />
              ) : temAtivo ? (
                <p className="text-sm text-muted-foreground">
                  Você já tem um depoimento enviado (abaixo). Para mandar outro, retire o anterior.
                </p>
              ) : user ? (
                <DepoimentoForm
                  situacao={situacao}
                  userId={user.id}
                  origem="link"
                  onEnviado={(r) => {
                    setEnviado(r);
                    carregar();
                  }}
                />
              ) : null}
            </CardContent>
          </Card>

          {meus.length > 0 ? (
            <section className="space-y-3" aria-labelledby="meus-dep">
              <h2 id="meus-dep" className="text-lg font-semibold">
                O que você já enviou
              </h2>
              {meus.map((d) => (
                <Card key={d.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Estrelas valor={d.nota} tamanho="h-4 w-4" />
                      <Badge variant="secondary">{STATUS_DEP_LABEL[d.status]}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.criado_em).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    {d.frase ? <p className="font-medium">“{d.frase}”</p> : null}
                    {d.mudou ? <p className="text-sm">{d.mudou}</p> : null}
                    {d.melhorar ? (
                      <p className="text-sm text-muted-foreground">Sugestão: {d.melhorar}</p>
                    ) : null}
                    {(d.status === "pendente" || d.status === "aprovado") && !d.revogado_em ? (
                      <Button size="sm" variant="outline" onClick={() => void retirar(d)}>
                        Retirar depoimento
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
