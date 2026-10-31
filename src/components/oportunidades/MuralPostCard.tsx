import type { ReactNode } from "react";
import {
  ageDays,
  ageLabel,
  ageTone,
  faixaTexto,
  type AgeTone,
  type OpportunityPost,
} from "@/lib/oportunidades";
import { dataCurta } from "@/lib/oportunidades-mural";
import { Card, CardContent } from "@/components/ui/card";
import { Pill } from "@/components/visual/base";

/** Idade do post em selo de texto (sem faixa lateral nem cartão apagado — item 17, t_55ee647c). */
const TOM_IDADE: Record<AgeTone, "green" | "amber" | "slate"> = {
  hoje: "green",
  recente: "green",
  meio: "amber",
  vencendo: "slate",
};

/**
 * Cartão do mural. `encaixes` é o espaço reservado para os selos
 * ("possível encaixe", "encaixe com captação da equipe") e o botão "não encaixa",
 * que vêm de outro componente; o cartão só posiciona.
 */
export function MuralPostCard({
  post,
  now,
  encaixes,
}: {
  post: OpportunityPost;
  now?: Date;
  encaixes?: ReactNode;
}) {
  const idade = ageDays(post.posted_at, now);
  return (
    <Card data-tom={ageTone(idade)} className="relative">
      <CardContent className="space-y-1.5 p-3">
        <Pill tom={TOM_IDADE[ageTone(idade)]} className="absolute right-3 top-3">
          {ageLabel(idade)}
        </Pill>
        <div className="flex flex-wrap gap-1.5 pr-24">
          <Pill tom="slate">{post.tipo ?? "—"}</Pill>
          {post.finalidade && (
            <Pill tom={post.finalidade === "Venda" ? "blue" : "violet"}>{post.finalidade}</Pill>
          )}
        </div>
        <h3 className="text-[15px] font-semibold">{post.bairro ?? "—"}</h3>
        <div className="text-xs text-muted-foreground">
          💵 {post.kind === "outros" ? "—" : faixaTexto(post)} · 👤 {post.corretor} · 📅 publicado
          em {dataCurta(post.posted_at)}
        </div>
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[12.5px] italic text-foreground/80">
          “{post.texto}”
        </p>
        {encaixes}
      </CardContent>
    </Card>
  );
}
