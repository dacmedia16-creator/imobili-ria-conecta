import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";

/** Endereço do Meu Plano 2027 de outra pessoa (t_c9b0f633). */
export const linkPlanoDe = (userId: string) =>
  `/minha-carreira/plano?de=${encodeURIComponent(userId)}`;

/**
 * Nome da pessoa que abre o Meu Plano 2027 dela (t_c9b0f633, Denis 24/11): rankings e cartões dos painéis de metas.
 * Abre /minha-carreira/plano?de=<id>; o banco decide se é "editar" (administrador), "ver" (gestor/líder da equipe)
 * ou recusa. Sem módulo do plano ou sem id, fica só o texto. Fora de um roteador (testes de tela), vira <a> comum.
 */
export function NomeComPlano({
  userId,
  ativo,
  children,
  className,
  titulo,
}: {
  userId: string | null | undefined;
  ativo: boolean;
  children: ReactNode;
  className?: string;
  titulo?: string;
}) {
  const router = useRouter({ warn: false });
  if (!ativo || !userId) return <span className={className}>{children}</span>;
  const comum = {
    className: `${className ?? ""} underline-offset-2 hover:underline focus-visible:underline`,
    title: titulo ?? "Abrir o Meu Plano 2027",
    "data-testid": "nome-abre-plano",
    "data-plano-de": userId,
  };
  if (!router)
    return (
      <a href={linkPlanoDe(userId)} {...comum}>
        {children}
      </a>
    );
  return (
    <Link to="/minha-carreira/plano" search={{ de: userId }} {...comum}>
      {children}
    </Link>
  );
}
