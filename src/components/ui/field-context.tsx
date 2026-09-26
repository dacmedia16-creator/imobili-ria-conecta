import * as React from "react";

// Liga automaticamente o rótulo de um <Field> aos campos dentro dele (leitor de tela).
// Fora de um <Field> o contexto é nulo e nada muda.
export const FieldLabelContext = React.createContext<string | null>(null);

type A11yProps = {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

export function useFieldLabelledBy(props: A11yProps): string | undefined {
  const labelId = React.useContext(FieldLabelContext);
  if (!labelId || props.id || props["aria-label"] || props["aria-labelledby"]) {
    return props["aria-labelledby"];
  }
  return labelId;
}
