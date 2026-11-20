import { createContext } from "react";
import type { ContextoExplicacao } from "@/lib/metas-2027/explicacoes";

/** Ano dos números (realizado) e ano das metas, para os textos do ícone "i" (t_065a0ff9). */
export const ContextoInfo = createContext<ContextoExplicacao>({ ano: 2027, anoPlano: 2027 });
