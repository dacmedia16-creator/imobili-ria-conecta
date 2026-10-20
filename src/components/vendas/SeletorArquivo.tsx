// Seletor de arquivo no padrão do sistema (botão + nome do arquivo). O input nativo mostrava o texto
// do navegador ("Escolher ficheiro / Nenhum ficheiro selecionado") e sem estilo (Denis 19/10).
import { useId, useRef } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function SeletorArquivo({
  arquivo,
  onChange,
  accept,
  disabled,
  rotulo = "Escolher arquivo",
  vazio = "Nenhum arquivo selecionado",
  ariaLabel,
}: {
  arquivo: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
  disabled?: boolean;
  rotulo?: string;
  vazio?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label
        htmlFor={id}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-ring",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <Upload className="h-4 w-4" />
        {rotulo}
        <input
          id={id}
          ref={ref}
          type="file"
          accept={accept}
          aria-label={ariaLabel ?? rotulo}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            onChange(e.target.files?.[0] ?? null);
            // Permite escolher o mesmo arquivo de novo depois de trocar.
            if (ref.current) ref.current.value = "";
          }}
        />
      </label>
      <span
        className="min-w-0 flex-1 text-xs text-muted-foreground [overflow-wrap:anywhere]"
        data-testid="seletor-arquivo-nome"
        title={arquivo?.name}
      >
        {arquivo ? arquivo.name : vazio}
      </span>
    </div>
  );
}
