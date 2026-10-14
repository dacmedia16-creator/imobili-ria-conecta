import type { ReactNode } from "react";
import { ageDays, ageLabel, ageTone, faixaTexto, type AgeTone, type OpportunityPost } from "@/lib/oportunidades";
import { dataCurta } from "@/lib/oportunidades-mural";
import { Card, CardContent } from "@/components/ui/card";
import { Pill } from "@/components/visual/base";

/** Cor da borda por idade, igual à maquete: verde hoje, verde-claro 1–2, amarelo 3–5, cinza 6–7. */
export const BORDA_IDADE: Record<AgeTone, string> = {
  hoje: "border-l-[#1e9e4a]",
  recente: "border-l-[#7cc68f]",
  meio: "border-l-[#e6b400]",
  vencendo: "border-l-[#9aa3b5] opacity-[.82]",
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
    <Card data-tom={ageTone(idade)} className={`relative border-l-[6px] ${BORDA_IDADE[ageTone(idade)]}`}>
      <CardContent className="space-y-1.5 p-3">
        <span className="absolute right-3 top-3 text-[11px] text-muted-foreground">{ageLabel(idade)}</span>
        <div className="flex flex-wrap gap-1.5 pr-24">
          <Pill tom="slate">{post.tipo ?? "—"}</Pill>
          {post.finalidade && <Pill tom={post.finalidade === "Venda" ? "blue" : "violet"}>{post.finalidade}</Pill>}
        </div>
        <h3 className="text-[15px] font-semibold">{post.bairro ?? "—"}</h3>
        <div className="text-xs text-muted-foreground">
          💵 {post.kind === "outros" ? "—" : faixaTexto(post)} · 👤 {post.corretor} · 📅 {dataCurta(post.posted_at)}
        </div>
        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[12.5px] italic text-foreground/80">“{post.texto}”</p>
        {encaixes}
      </CardContent>
    </Card>
  );
}
