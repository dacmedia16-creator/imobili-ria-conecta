-- Tour guiado de primeiro acesso: guarda, POR USUÁRIO, se a pessoa já concluiu ou fechou o tour, para não
-- reabrir em outro aparelho. Card t_2e09bc40, pedido de Denis em 26/10/2026, tópico 6238.
--
-- ADITIVA (só cria uma tabela nova; não altera nada existente). Idempotente.
-- Rollback: docs/sql/rollback/20261026120000_tour_primeiro_acesso.rollback.sql
--
-- Regras:
--  1) Uma linha por (usuário, tour). Sem dado pessoal além do próprio user_id.
--  2) RLS: cada pessoa só lê, cria e altera a PRÓPRIA linha (user_id = auth.uid()). Ninguém lê a de outro,
--     nem da mesma imobiliária. Sem DELETE para authenticated (apagar a conta apaga em cascata).
--  3) anon não tem acesso nenhum.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_tour_estado (
  user_id       uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tour          text        NOT NULL CONSTRAINT user_tour_estado_tour_check CHECK (tour ~ '^[a-z][a-z0-9_]{1,39}$'),
  status        text        NOT NULL CONSTRAINT user_tour_estado_status_check CHECK (status IN ('concluido', 'fechado')),
  passo         integer     NOT NULL DEFAULT 0 CONSTRAINT user_tour_estado_passo_check CHECK (passo BETWEEN 0 AND 50),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour)
);

COMMENT ON TABLE public.user_tour_estado IS
  'Tour guiado: se o usuário concluiu ou fechou (t_2e09bc40). RLS: só a própria linha.';

ALTER TABLE public.user_tour_estado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tour_estado_select_proprio ON public.user_tour_estado;
CREATE POLICY user_tour_estado_select_proprio ON public.user_tour_estado
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_tour_estado_insert_proprio ON public.user_tour_estado;
CREATE POLICY user_tour_estado_insert_proprio ON public.user_tour_estado
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS user_tour_estado_update_proprio ON public.user_tour_estado;
CREATE POLICY user_tour_estado_update_proprio ON public.user_tour_estado
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.user_tour_estado FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_tour_estado TO authenticated;
GRANT ALL ON public.user_tour_estado TO service_role;

COMMIT;
