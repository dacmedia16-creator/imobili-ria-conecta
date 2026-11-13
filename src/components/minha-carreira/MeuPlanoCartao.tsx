import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { BookOpen, Target, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ehBroker, ehLider, meuPlanoEnabled, planoDb } from "@/lib/meu-plano-2027/modulo";
import { ANO_PLANO, ORDEM, rotuloPagina } from "@/lib/meu-plano-2027/telas";
import type { Respostas } from "@/lib/meu-plano-2027/regras";
import { MeuPlanoResumo } from "./meu-plano/MeuPlano";
import { BotaoBaixarPlano } from "./meu-plano/BaixarPdf";

type Linha = {
  respostas: Respostas;
  meta_oficial: {
    meta_comissao: number | null;
    meta_vendas: number | null;
    meta_captacoes: number | null;
  } | null;
};

/** Cartão "Meu Plano 2027" em Minha carreira. Só aparece com o módulo ligado na imobiliária. */
export function MeuPlanoCartao({ userId }: { userId: string }) {
  const { roles } = useAuth();
  const [ligado, setLigado] = useState(false);
  const [linha, setLinha] = useState<Linha | null>(null);

  useEffect(() => {
    let vivo = true;
    void meuPlanoEnabled().then(async (on) => {
      if (!vivo || !on) return;
      setLigado(true);
      const { data } = await planoDb
        .from("carreira_plano")
        .select("respostas,meta_oficial")
        .eq("user_id", userId)
        .eq("ano", ANO_PLANO)
        .maybeSingle();
      if (vivo) setLinha((data as Linha | null) ?? { respostas: {}, meta_oficial: null });
    });
    return () => {
      vivo = false;
    };
  }, [userId]);

  if (!ligado) return null;
  const S = linha?.respostas ?? {};
  const ult =
    typeof S["ui.ult"] === "string" && ORDEM.includes(S["ui.ult"] as string)
      ? (S["ui.ult"] as string)
      : null;
  const comecou = !!ult || Object.keys(S).some((k) => !k.startsWith("ui.") && !k.startsWith("ms."));
  const pag = Number(S["ui.pag"]) || 1;

  return (
    <Card data-testid="cartao-meu-plano">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Target className="h-5 w-5" aria-hidden /> Meu Plano 2027
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          O book do Agent Summit 2027: leia e preencha aqui, no celular.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button asChild className="h-12 w-full text-base" data-testid="abrir-meu-plano">
          <Link to="/minha-carreira/plano" search={{ v: "tela", id: ult ?? ORDEM[0] }}>
            🎯 Meu Plano 2027 · {comecou ? "continuar" : "começar"}
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="w-full border-rose-300 text-rose-900 dark:text-rose-200"
        >
          <Link to="/minha-carreira/plano" search={{ v: "book", p: pag }}>
            <BookOpen className="mr-2 h-4 w-4" aria-hidden /> Ler o book completo{" "}
            {pag > 1 ? `· continuar ${rotuloPagina(pag)}` : "· 56 páginas"}
          </Link>
        </Button>
        {linha ? <MeuPlanoResumo S={S} metaOficial={linha.meta_oficial} /> : null}
        <BotaoBaixarPlano userId={userId} S={S} />
        {ehBroker(roles) || ehLider(roles) ? (
          <Button asChild size="sm" variant="secondary" className="w-full">
            <Link to="/minha-carreira/plano" search={{ v: "equipe" }}>
              <Users className="mr-2 h-4 w-4" aria-hidden /> Ver os planos da equipe
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
