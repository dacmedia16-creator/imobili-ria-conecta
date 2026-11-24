import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { buscarItens, ehAtalhoBusca, itensDaBusca } from "@/lib/telas-lote2";
import type { NavGroup } from "@/lib/menu-lateral";

/**
 * Busca rápida do menu (t_29b7cd5e, item 6 do t_d62be550): Ctrl+K (ou ⌘K) abre, digita, Enter vai.
 * Usa o `ui/command.tsx` (cmdk, MIT) que o projeto já tem, com filtro próprio por trecho do nome
 * (o filtro do cmdk casa letras soltas: "crm" achava "Comparativo 6%"). Só lista os itens que o
 * menu lateral já mostra para o papel; a rota e o banco continuam conferindo o acesso.
 */
export function BuscaRapida({
  groups,
  open,
  onOpenChange,
}: {
  groups: NavGroup[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [consulta, setConsulta] = useState("");
  const itens = useMemo(() => itensDaBusca(groups), [groups]);
  const achados = useMemo(() => buscarItens(itens, consulta), [itens, consulta]);
  // Com texto: lista única por relevância. Sem texto: agrupado como no menu.
  const blocos = useMemo(() => {
    if (consulta.trim()) return [["Telas", achados] as const];
    const m = new Map<string, typeof achados>();
    for (const i of achados) m.set(i.grupo, [...(m.get(i.grupo) ?? []), i]);
    return [...m.entries()];
  }, [achados, consulta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ehAtalhoBusca(e)) return;
      e.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setConsulta("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Busca rápida</DialogTitle>
        <DialogDescription className="sr-only">
          Digite o nome de uma tela e aperte Enter para abrir.
        </DialogDescription>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
        >
          <CommandInput
            value={consulta}
            onValueChange={setConsulta}
            placeholder="Ir para… (ex.: CRM, vendas, captação)"
            data-testid="busca-rapida-campo"
          />
          <CommandList className="max-h-[min(60vh,420px)]" data-testid="busca-rapida-lista">
            <CommandEmpty>Nenhuma tela com esse nome.</CommandEmpty>
            {blocos.map(([grupo, lista]) => (
              <CommandGroup key={grupo} heading={grupo}>
                {lista.map((i) => (
                  <CommandItem
                    key={i.chave}
                    value={i.chave}
                    onSelect={() => {
                      onOpenChange(false);
                      void router.navigate({ to: i.to, search: i.search });
                    }}
                  >
                    <i.icon className="text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{i.label}</span>
                    {consulta.trim() && (
                      <span className="shrink-0 text-xs text-muted-foreground">{i.grupo}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑ ↓ escolhe · Enter abre · Esc fecha</span>
            <kbd className="rounded border bg-muted px-1.5 font-mono">Ctrl K</kbd>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
