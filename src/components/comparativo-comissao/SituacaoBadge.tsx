import type { SituacaoComissao } from "@/lib/comparativo-comissao-types";
import { Pill, type Tom } from "@/components/visual/base";

// Mesma convenção de tom já usada em STATUS_TONE (src/lib/status.ts): vermelho/alerta pra
// "abaixo" (perda de comissão), verde/positivo pra "igual", azul/informativo pra "acima".
// Etiqueta do padrão visual (onda 2): sempre cor + texto.
const TOM: Record<SituacaoComissao, Tom> = {
  abaixo: "red",
  igual: "green",
  acima: "blue",
};

const LABEL: Record<SituacaoComissao, string> = {
  abaixo: "Abaixo de 6%",
  igual: "Igual a 6%",
  acima: "Acima de 6%",
};

export function SituacaoBadge({
  situacao,
  className,
}: {
  situacao: SituacaoComissao | null;
  className?: string;
}) {
  if (!situacao) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Pill tom={TOM[situacao]} className={className}>
      {LABEL[situacao]}
    </Pill>
  );
}
