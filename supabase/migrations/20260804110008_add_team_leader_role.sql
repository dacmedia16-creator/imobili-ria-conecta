-- Novo papel "Team Leader": mesmas permissões de gestor (ver migration seguinte). ADD VALUE
-- precisa rodar isolado — não pode ser usado na mesma transação em que é criado.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'team_leader';
