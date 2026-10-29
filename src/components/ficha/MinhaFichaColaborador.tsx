import { useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dataHoraSp, type SituacaoFicha } from "@/lib/ficha-colaborador";
import { minhaSituacaoFicha } from "@/lib/ficha-colaborador-db";
import { FichaColaboradorForm } from "@/components/ficha/FichaColaboradorForm";

/** "Ficha pessoal e de emergência" no Meu acesso: edição posterior (t_618b64bc). */
export function MinhaFichaColaborador() {
  const [situacao, setSituacao] = useState<SituacaoFicha | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    minhaSituacaoFicha()
      .then((s) => {
        if (!vivo) return;
        setSituacao(s);
        setEstado("ok");
      })
      .catch(() => vivo && setEstado("erro"));
    return () => {
      vivo = false;
    };
  }, []);

  // Visão da plataforma / "Entrar como" / dono da plataforma: a ficha não aparece.
  if (estado === "ok" && situacao && !situacao.aplica) return null;

  return (
    <Card data-testid="perfil-ficha">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4" aria-hidden /> Ficha pessoal e de emergência
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {estado === "carregando" && <p className="text-muted-foreground">Carregando…</p>}
        {estado === "erro" && (
          <p className="text-muted-foreground">Não foi possível carregar sua ficha agora.</p>
        )}
        {estado === "ok" && situacao?.aplica && (
          <>
            <p className="text-xs text-muted-foreground">
              {situacao.completa
                ? `Ficha completa${situacao.ficha?.updated_at ? ` · atualizada em ${dataHoraSp(situacao.ficha.updated_at)}` : ""}.`
                : "Sua ficha está incompleta."}
            </p>
            <FichaColaboradorForm
              key={versao}
              situacao={situacao}
              rotuloSalvar="Salvar alterações"
              onSalvo={(nova) => {
                setSituacao(nova);
                setVersao((v) => v + 1);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
