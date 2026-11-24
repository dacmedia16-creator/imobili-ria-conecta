import { Pill } from "@/components/visual/base";
import { SELO_META, type SeloMeta } from "@/lib/metas-2027/consolidado";
import { TEXTO_ESTADO, type EstadoPlano } from "@/lib/meu-plano-2027/linha-equipe";

/**
 * Etiqueta da meta ("Conta na meta", "Falta a meta oficial"…) — a MESMA da lista "Meu Plano 2027 — equipe" e dos
 * rankings do painel de metas (t_adaaa240). Texto e cor vêm de SELO_META.
 */
export function SeloMetaPill({ selo }: { selo: SeloMeta }) {
  return (
    <Pill tom={SELO_META[selo].tom} className="py-0 text-[11px]">
      <span data-testid="selo-meta" data-selo={selo}>
        {SELO_META[selo].texto}
      </span>
    </Pill>
  );
}

/** "✅ assinado" / "📝 em preenchimento" / "não começou" (mesmo texto da lista da equipe). */
export function EstadoPlanoTexto({ estado }: { estado: EstadoPlano }) {
  return (
    <span data-testid="estado-plano" data-estado={estado}>
      {TEXTO_ESTADO[estado]}
    </span>
  );
}
