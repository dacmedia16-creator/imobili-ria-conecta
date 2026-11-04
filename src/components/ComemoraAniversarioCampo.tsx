import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PERGUNTA_COMEMORA, PERGUNTA_COMEMORA_GESTAO } from "@/lib/data-nascimento";

/**
 * "Você comemora aniversário?" Sim / Não, sempre com uma resposta marcada (t_2d5f0ab6).
 * Usado junto de TODO campo de data de nascimento: Meu acesso, 1º acesso, Editar/Novo usuário e
 * Ficha do colaborador. Quem chama só mostra o campo quando há data digitada.
 */
export function ComemoraAniversarioCampo({
  id,
  value,
  onChange,
  disabled,
  paraGestao = false,
}: {
  /** Prefixo único dos ids (ex.: "perfil-comemora"). */
  id: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Tela da gestão (Editar/Novo usuário): pergunta e aviso na 3ª pessoa. */
  paraGestao?: boolean;
}) {
  const pergunta = paraGestao ? PERGUNTA_COMEMORA_GESTAO : PERGUNTA_COMEMORA;
  return (
    <div className="space-y-1.5" data-testid={id}>
      <p id={`${id}-rotulo`} className="text-sm font-medium">
        {pergunta}
      </p>
      <RadioGroup
        aria-labelledby={`${id}-rotulo`}
        className="flex gap-5"
        value={value ? "sim" : "nao"}
        onValueChange={(v) => onChange(v === "sim")}
        disabled={disabled}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-sim`} value="sim" />
          <Label htmlFor={`${id}-sim`} className="cursor-pointer font-normal">
            Sim
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-nao`} value="nao" />
          <Label htmlFor={`${id}-nao`} className="cursor-pointer font-normal">
            Não
          </Label>
        </div>
      </RadioGroup>
      {!value && (
        <p className="text-xs text-muted-foreground" data-testid={`${id}-aviso-nao`}>
          {paraGestao
            ? "O nome não aparece nos Aniversariantes do mês nem em parabéns de aniversário. A data continua guardada para a pessoa e a gestão."
            : "Seu nome não aparece nos Aniversariantes do mês nem em parabéns de aniversário. A data continua guardada para você e a gestão."}
        </p>
      )}
    </div>
  );
}
