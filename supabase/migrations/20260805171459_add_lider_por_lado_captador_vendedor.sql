-- Gestor/Team Leader hoje são um único par (coordenador_id/team_leader_id) compartilhado pra
-- venda inteira, mas captador e vendedor podem ser de equipes diferentes (corretor_captador_id/
-- corretor_vendedor_id já não filtram por equipe, de propósito). Este par novo é "quem lidera cada
-- lado" — um campo por lado que aceita qualquer gestor OU team leader (papel resolvido em tempo de
-- exibição via user_roles, não guardado aqui).
--
-- Decisão: mantém coordenador_id/team_leader_id intactos — eles continuam servindo só a "Divisão
-- da comissão" (quem recebe um corte da comissão como gestor/team leader), que é um conceito
-- financeiro separado de "quem supervisiona este lado do negócio". Nenhuma outra tabela/policy usa
-- essas colunas (conferido: só vendas.$id.tsx lê/escreve os dois pares).
ALTER TABLE public.sales ADD COLUMN lider_captador_id uuid REFERENCES public.profiles(id);
ALTER TABLE public.sales ADD COLUMN lider_vendedor_id uuid REFERENCES public.profiles(id);

UPDATE public.sales
SET lider_captador_id = coalesce(coordenador_id, team_leader_id),
    lider_vendedor_id = coalesce(coordenador_id, team_leader_id)
WHERE coordenador_id IS NOT NULL OR team_leader_id IS NOT NULL;
