-- Recuperado de supabase_migrations.schema_migrations (versão 20260805065139) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

ALTER TABLE public.clientes ADD COLUMN created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.clientes ADD COLUMN updated_by uuid REFERENCES auth.users(id);

DROP POLICY clientes_write ON public.clientes;

CREATE POLICY clientes_insert ON public.clientes
  FOR INSERT WITH CHECK (public.is_active_user(auth.uid()));

CREATE POLICY clientes_update ON public.clientes
  FOR UPDATE USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));
