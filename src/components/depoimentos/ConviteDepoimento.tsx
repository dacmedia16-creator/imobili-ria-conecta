// Convite automático para o depoimento (t_c7cfaf00). Quem decide se abre é o BANCO
// (depoimento_minha_situacao): conta com 14+ dias, pelo menos 1 ação real, sem envio recente, sem
// "Não quero" e fora do "Agora não" (30 dias). Nunca no primeiro acesso.
// - Abre alguns segundos depois de entrar, para não disputar a tela com o carregamento.
// - Fechar no X vale só para este login; "Agora não" grava 30 dias; "Não quero" grava para sempre.
// - Visão da plataforma, "Entrar como" e dono da plataforma: nem consulta (o banco também recusa).
// - Falha ao ler = não abre (nunca atrapalha o uso).
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { idDaSessao, lembreteAdiadoNestaSessao } from "@/lib/completar-perfil";
import { abreConviteAutomatico, type DepSituacao } from "@/lib/depoimentos";
import { minhaSituacaoDepoimento, responderConvite } from "@/lib/depoimentos-db";
import { DepoimentoForm, DepoimentoObrigado } from "./DepoimentoForm";

const ATRASO_MS = 4000;
const chaveFechado = (uid: string) => `max:depoimento-convite-fechado:${uid}`;

function fechadoNesteLogin(uid: string, sessao: string | null): boolean {
  try {
    return lembreteAdiadoNestaSessao(window.localStorage.getItem(chaveFechado(uid)), sessao);
  } catch {
    return false;
  }
}

export function ConviteDepoimento() {
  const { user, session, loading, platformReady, platformAdmin, platformContext, impersonation } =
    useAuth();
  const userId = user?.id;
  const sessao = idDaSessao(session?.access_token);
  const caminho = useRouterState({ select: (s) => s.location.pathname });
  const [situacao, setSituacao] = useState<DepSituacao | null>(null);
  const [aberto, setAberto] = useState(false);
  const [enviado, setEnviado] = useState<{ publicavel: boolean } | null>(null);
  const fora = platformAdmin || Boolean(platformContext) || Boolean(impersonation);

  useEffect(() => {
    if (loading || !platformReady || !userId || fora || !sessao) return;
    if (fechadoNesteLogin(userId, sessao)) return;
    let vivo = true;
    const t = setTimeout(() => {
      minhaSituacaoDepoimento()
        .then((s) => {
          if (!vivo) return;
          setSituacao(s);
          setAberto(abreConviteAutomatico(s, fechadoNesteLogin(userId, sessao)));
        })
        .catch(() => undefined);
    }, ATRASO_MS);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [loading, platformReady, userId, fora, sessao]);

  // Na própria página /depoimento o formulário já está na tela.
  if (!userId || !situacao || !situacao.pode_enviar || caminho.startsWith("/depoimento")) return null;

  const fecharSoAgora = () => {
    try {
      if (sessao) window.localStorage.setItem(chaveFechado(userId), sessao);
    } catch {
      /* sem armazenamento: pode voltar ao recarregar */
    }
    setAberto(false);
  };

  const responder = async (r: "agora_nao" | "nao_quero") => {
    try {
      await responderConvite(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar.");
    }
    fecharSoAgora();
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fecharSoAgora())}>
      <DialogContent className="max-w-xl" data-testid="convite-depoimento">
        <DialogHeader>
          <DialogTitle>Como o ADM MAX tem ajudado você?</DialogTitle>
          <DialogDescription>Leva menos de 1 minuto.</DialogDescription>
        </DialogHeader>
        {enviado ? (
          <>
            <DepoimentoObrigado publicavel={enviado.publicavel} />
            <div className="flex justify-end">
              <Button onClick={() => setAberto(false)}>Fechar</Button>
            </div>
          </>
        ) : (
          <DepoimentoForm
            situacao={situacao}
            userId={userId}
            origem="convite"
            onEnviado={setEnviado}
            rodape={
              <>
                <Button type="button" variant="ghost" onClick={() => void responder("nao_quero")}>
                  Não quero
                </Button>
                <Button type="button" variant="outline" onClick={() => void responder("agora_nao")}>
                  Agora não
                </Button>
              </>
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
