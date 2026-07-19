import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type WizardStep = {
  key: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
};

type Props = {
  steps: WizardStep[];
  current: string;
  onChange: (key: string) => void;
  onBeforeLeave?: (fromKey: string, toKey: string) => Promise<boolean> | boolean;
  dirty?: boolean;
  /** Renderizado no lugar do "Próximo" (que fica sem função) quando o usuário está na última etapa. */
  lastStepAction?: React.ReactNode;
};

export function Wizard({ steps, current, onChange, onBeforeLeave, dirty, lastStepAction }: Props) {
  const enabled = useMemo(() => steps.filter((s) => !s.disabled), [steps]);
  const idx = Math.max(
    0,
    enabled.findIndex((s) => s.key === current),
  );
  const activeKey = enabled[idx]?.key ?? enabled[0]?.key;
  const active = enabled[idx] ?? enabled[0];
  const progress = enabled.length > 1 ? Math.round((idx / (enabled.length - 1)) * 100) : 100;

  const requestChange = async (toKey: string) => {
    if (!toKey || toKey === activeKey) return;
    if (onBeforeLeave) {
      const ok = await onBeforeLeave(activeKey, toKey);
      if (!ok) return;
    }
    onChange(toKey);
  };
  const go = (i: number) => {
    const step = enabled[i];
    if (step) requestChange(step.key);
  };


  return (
    <div className="space-y-4">
      {/* Desktop stepper */}
      <div className="hidden md:block">
        <ol className="flex items-center gap-2">
          {enabled.map((s, i) => {
            const done = i < idx;
            const isActive = s.key === activeKey;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => go(i)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : done
                        ? "text-foreground hover:bg-muted"
                        : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : "border-border bg-background",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">{s.label}</span>
                </button>
                {i < enabled.length - 1 && <div className="h-px flex-1 bg-border" />}
              </li>
            );
          })}
        </ol>
        <Progress value={progress} className="mt-3 h-1" />
      </div>

      {/* Mobile step selector */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Etapa {idx + 1} de {enabled.length}
          </span>
          <span className="text-xs text-muted-foreground">{progress}%</span>
        </div>
        <Select value={activeKey} onValueChange={requestChange}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {enabled.map((s, i) => (
              <SelectItem key={s.key} value={s.key}>
                {i + 1}. {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Progress value={progress} className="mt-2 h-1" />
      </div>


      {/* Step content */}
      <div className="pt-2">{active?.content}</div>

      {/* Nav */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => go(idx - 1)} disabled={idx === 0}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
        </Button>
        <span className="text-xs text-muted-foreground">
          {dirty ? "Alterações não salvas" : `${idx + 1} / ${enabled.length}`}
        </span>
        {idx >= enabled.length - 1 && lastStepAction ? (
          lastStepAction
        ) : (
          <Button variant="default" onClick={() => go(idx + 1)} disabled={idx >= enabled.length - 1}>
            {dirty ? "Salvar e avançar" : "Próximo"} <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>

    </div>
  );
}
