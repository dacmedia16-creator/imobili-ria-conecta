import { Pill } from "@/components/visual/base";
import { FAROL_ROTULO, type Farol, type Sinal } from "@/lib/inteligencia-gestao";
import { TOM_COR, TOM_FAROL } from "@/lib/inteligencia-gestao-tela";

// Inteligência de gestão (cartão t_01d580b6): etiquetas do farol. Sempre cor + texto (regra de Denis).

export function FarolPill({ farol }: { farol: Farol }) {
  return (
    <Pill tom={TOM_FAROL[farol]} className="shrink-0">
      <span data-testid="farol-geral" data-farol={farol}>
        {FAROL_ROTULO[farol]}
      </span>
    </Pill>
  );
}

/** Um sinal: cor + texto. "sem plano"/"sem dado"/"aguardando" ficam cinza (sem cor de alerta). */
export function SinalPill({ s, curto = false }: { s: Sinal; curto?: boolean }) {
  const texto =
    s.cor === "sem_plano"
      ? "sem plano"
      : s.cor === "sem_dado"
        ? "—"
        : s.cor === "aguardando"
          ? curto
            ? "jan/2027"
            : s.texto
          : curto
            ? rotuloCurto(s)
            : s.texto;
  return (
    <span data-sinal={s.chave} data-cor={s.cor} title={s.texto}>
      <Pill tom={TOM_COR[s.cor]} className="whitespace-normal text-left">
        {texto}
      </Pill>
    </span>
  );
}

const CURTO: Record<string, string> = { verde: "ok", amarelo: "atenção", vermelho: "alerta" };
function rotuloCurto(s: Sinal): string {
  if (s.chave === "sem_vender") return s.texto.replace(" sem vender", "");
  return CURTO[s.cor] ?? s.texto;
}
