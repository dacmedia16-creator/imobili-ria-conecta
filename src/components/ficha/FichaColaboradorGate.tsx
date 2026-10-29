import { useEffect, useState, type ReactNode } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { idDaSessao, lembreteAdiadoNestaSessao } from "@/lib/completar-perfil";
import {
  chaveFichaAdiada,
  dataHoraSp,
  modoFicha,
  pendenciasCadastro,
  PENDENCIA_LABEL,
  type ModoFicha,
  type SituacaoFicha,
} from "@/lib/ficha-colaborador";
import { minhaSituacaoFicha } from "@/lib/ficha-colaborador-db";
import { FichaColaboradorForm } from "@/components/ficha/FichaColaboradorForm";
import { CadastroPendenteForm } from "@/components/ficha/CadastroPendenteForm";

function lerAdiada(userId: string, sessao: string | null): boolean {
  try {
    if (sessao)
      return lembreteAdiadoNestaSessao(
        window.localStorage.getItem(chaveFichaAdiada(userId)),
        sessao,
      );
    return window.sessionStorage.getItem(chaveFichaAdiada(userId)) === "1";
  } catch {
    return false;
  }
}

function gravarAdiada(userId: string, sessao: string | null) {
  try {
    if (sessao) window.localStorage.setItem(chaveFichaAdiada(userId), sessao);
    else window.sessionStorage.setItem(chaveFichaAdiada(userId), "1");
  } catch {
    /* sem armazenamento: volta a aparecer ao recarregar */
  }
}

/**
 * Porteiro da ficha pessoal e de emergência (t_618b64bc). Vale para todos os papéis.
 * Desde t_b98f3e4b também cobra o cadastro (nome, telefone e, para corretor/gestor/team leader,
 * CPF e ID RE/MAX), na mesma tela e com o mesmo prazo. Quem já completou a ficha vê só o cadastro.
 * - Antes do prazo (decidido no BANCO): tela com "Preencher depois" (volta no próximo login).
 * - Depois do prazo: só libera ao salvar; sempre com "Sair".
 * - Visão da plataforma, "Entrar como" e dono da plataforma: o banco devolve aplica=false.
 * - Fica dentro de /_authenticated: login, troca de senha e convite não passam por aqui; contas de
 *   serviço/integração não usam esta tela (o bloqueio é só de interface, não das APIs).
 * - Falha ao ler a situação libera o acesso (nunca trava ninguém por erro).
 */
export function FichaColaboradorGate({ children }: { children: ReactNode }) {
  const { user, session, loading, platformReady, platformContext, impersonation } = useAuth();
  const userId = user?.id;
  const sessao = idDaSessao(session?.access_token);
  const [modo, setModo] = useState<ModoFicha | "carregando">("carregando");
  const [situacao, setSituacao] = useState<SituacaoFicha | null>(null);
  // Na visão da plataforma e no "Entrar como" nem consulta (o banco também recusa).
  const fora = Boolean(platformContext) || Boolean(impersonation);

  useEffect(() => {
    if (loading || !platformReady) return;
    if (!userId || fora) {
      setModo(null);
      return;
    }
    let vivo = true;
    setModo("carregando");
    minhaSituacaoFicha()
      .then((s) => {
        if (!vivo) return;
        setSituacao(s);
        setModo(modoFicha(s, lerAdiada(userId, sessao)));
      })
      .catch(() => vivo && setModo(null));
    return () => {
      vivo = false;
    };
  }, [loading, platformReady, userId, fora, sessao]);

  if (fora || !userId) return <>{children}</>;
  if (modo === "carregando") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (modo === "bloqueio" || modo === "lembrete") {
    return (
      <FichaTela
        situacao={situacao}
        bloqueio={modo === "bloqueio"}
        onSalvo={(nova) => {
          setSituacao(nova);
          // Releitura do banco: só libera se ele disser que está completa. Respeita um
          // "Preencher depois" clicado enquanto salvava.
          setModo(modoFicha(nova, lerAdiada(userId, sessao)));
        }}
        onDepois={() => {
          gravarAdiada(userId, sessao);
          setModo(null);
        }}
      />
    );
  }
  return <>{children}</>;
}

function FichaTela({
  situacao,
  bloqueio,
  onSalvo,
  onDepois,
}: {
  situacao: SituacaoFicha | null;
  bloqueio: boolean;
  onSalvo: (s: SituacaoFicha) => void;
  onDepois: () => void;
}) {
  const { signOut } = useAuth();
  const prazo = situacao?.aplica ? dataHoraSp(situacao.obrigatoria_a_partir_de) : "";
  const pend = pendenciasCadastro(situacao);
  const fichaFalta = Boolean(situacao?.aplica && !situacao.completa);
  // Remonta SÓ o formulário que salvou (relê o banco); o outro mantém o que já foi digitado.
  const [versaoCad, setVersaoCad] = useState(0);
  const [versaoFicha, setVersaoFicha] = useState(0);
  const salvoCadastro = (nova: SituacaoFicha) => {
    setVersaoCad((v) => v + 1);
    onSalvo(nova);
  };
  const salvoFicha = (nova: SituacaoFicha) => {
    setVersaoFicha((v) => v + 1);
    onSalvo(nova);
  };
  const itens = [
    ...pend.map((p) => PENDENCIA_LABEL[p]),
    ...(fichaFalta ? ["Ficha pessoal e de emergência"] : []),
  ];
  return (
    <div
      className="min-h-screen bg-muted/40 px-4 py-6 sm:py-10"
      data-testid={bloqueio ? "ficha-bloqueio" : "ficha-lembrete"}
    >
      <div className="mx-auto w-full max-w-lg space-y-5 rounded-2xl border bg-background p-5 shadow-sm sm:p-7">
        <div className="space-y-1 text-center">
          <img src="/remax-icon.png" alt="" className="mx-auto h-10 w-10 object-contain" />
          <h1 className="text-xl font-semibold tracking-tight">Atualize seu cadastro</h1>
          <p className="text-sm text-muted-foreground">
            {bloqueio
              ? "Para continuar usando o sistema, complete os dados abaixo. Leva cerca de 2 minutos."
              : `Complete os dados abaixo. A partir de ${prazo || "breve"} eles serão obrigatórios para entrar no sistema.`}
          </p>
        </div>
        {itens.length > 0 && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
            data-testid="cadastro-faltando"
          >
            <p className="font-medium">Falta completar:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {itens.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
        {pend.length > 0 && (
          <section className="space-y-3" data-testid="cadastro-secao">
            <h2 className="text-sm font-semibold">Dados do cadastro</h2>
            <CadastroPendenteForm
              key={`c${versaoCad}`}
              situacao={situacao}
              onSalvo={salvoCadastro}
            />
          </section>
        )}
        {fichaFalta && (
          <section className="space-y-3">
            {pend.length > 0 && (
              <h2 className="text-sm font-semibold">Ficha pessoal e de emergência</h2>
            )}
            <FichaColaboradorForm
              key={`f${versaoFicha}`}
              situacao={situacao}
              rotuloSalvar={pend.length > 0 ? "Salvar ficha" : "Salvar e entrar"}
              onSalvo={salvoFicha}
            />
          </section>
        )}
        <div className="space-y-5">
          {!bloqueio && (
            <Button
              variant="outline"
              className="h-11 w-full text-base"
              onClick={onDepois}
              data-testid="ficha-depois"
            >
              Preencher depois
            </Button>
          )}
          <button
            type="button"
            className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => void signOut().then(() => window.location.assign("/auth"))}
            data-testid="ficha-sair"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}
