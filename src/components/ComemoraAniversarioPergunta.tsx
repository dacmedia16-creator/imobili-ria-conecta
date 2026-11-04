import { useEffect, useState } from "react";
import { PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PERGUNTA_COMEMORA } from "@/lib/data-nascimento";
import { idDaSessao, lembreteAdiadoNestaSessao } from "@/lib/completar-perfil";
import { perguntaComemoraPendente, responderComemora } from "@/lib/data-nascimento-db";

export const AVISO_PERGUNTA_COMEMORA =
  "Se marcar Não, seu nome não aparece no mural de aniversariantes.";

export function chaveComemoraAdiada(userId: string): string {
  return `max:comemora-pergunta-adiada:${userId}`;
}

/** Falha ao gravar: não pergunta de novo neste login (mesmo padrão dos lembretes de perfil/ficha). */
function lerAdiada(userId: string, sessao: string | null): boolean {
  try {
    if (sessao)
      return lembreteAdiadoNestaSessao(
        window.localStorage.getItem(chaveComemoraAdiada(userId)),
        sessao,
      );
    return window.sessionStorage.getItem(chaveComemoraAdiada(userId)) === "1";
  } catch {
    return false;
  }
}

function gravarAdiada(userId: string, sessao: string | null) {
  try {
    if (sessao) window.localStorage.setItem(chaveComemoraAdiada(userId), sessao);
    else window.sessionStorage.setItem(chaveComemoraAdiada(userId), "1");
  } catch {
    /* sem armazenamento: pode perguntar de novo ao recarregar */
  }
}

/**
 * Pergunta única depois do login (t_05a37081, Denis 04/11/2026): quem já tinha data de nascimento
 * antes do "Comemora aniversário?" (PR #265) responde Sim ou Não uma vez.
 * - Quem vê: o BANCO decide (comemora_pergunta_pendente): data cadastrada e sem resposta.
 * - Fica dentro do AppShell, depois dos porteiros de perfil e ficha: aparece só com o sistema liberado.
 * - Enquanto não responde, vale "Sim" (nada muda no mural).
 * - Erro ao ler = não pergunta; erro ao gravar = avisa, fecha e só pergunta de novo no próximo login.
 * - Visão da plataforma e "Entrar como": nem consulta (o banco também devolve false).
 */
export function ComemoraAniversarioPergunta() {
  const { user, session, loading, platformReady, platformContext, impersonation } = useAuth();
  const userId = user?.id;
  const sessao = idDaSessao(session?.access_token);
  const fora = Boolean(platformContext) || Boolean(impersonation);
  const [aberta, setAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (loading || !platformReady || !userId || fora || lerAdiada(userId, sessao)) {
      setAberta(false);
      return;
    }
    let vivo = true;
    void perguntaComemoraPendente().then((pendente) => {
      if (vivo) setAberta(pendente);
    });
    return () => {
      vivo = false;
    };
  }, [loading, platformReady, userId, fora, sessao]);

  const responder = async (comemora: boolean) => {
    setSalvando(true);
    try {
      await responderComemora(comemora);
      toast.success(
        comemora
          ? "Pronto! Seu aniversário aparece no mural."
          : "Pronto! Seu nome não aparece no mural de aniversariantes.",
      );
    } catch (err: unknown) {
      if (userId) gravarAdiada(userId, sessao);
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar sua resposta agora.");
    } finally {
      setSalvando(false);
      // Fecha sempre: nunca prende a pessoa por erro.
      setAberta(false);
    }
  };

  return (
    <AlertDialog open={aberta}>
      <AlertDialogContent
        className="max-w-[calc(100vw-2rem)] rounded-lg sm:max-w-md"
        data-testid="comemora-pergunta"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary sm:mx-0">
            <PartyPopper className="h-6 w-6" aria-hidden />
          </div>
          <AlertDialogTitle>{PERGUNTA_COMEMORA}</AlertDialogTitle>
          <AlertDialogDescription>
            {AVISO_PERGUNTA_COMEMORA} Você pode mudar depois em Meu acesso.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 text-base sm:min-w-24"
            disabled={salvando}
            onClick={() => void responder(false)}
            data-testid="comemora-pergunta-nao"
          >
            Não
          </Button>
          <Button
            className="h-11 text-base sm:min-w-24"
            disabled={salvando}
            onClick={() => void responder(true)}
            data-testid="comemora-pergunta-sim"
          >
            Sim
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
