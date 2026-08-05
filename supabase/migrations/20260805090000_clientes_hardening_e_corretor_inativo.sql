-- Revisão a fundo (item 1 de 2): clientes.metas_write original permitia DELETE pra qualquer
-- usuário ativo, sem UI nenhuma usando isso — trava DELETE de vez (sem policy pra DELETE = sempre
-- negado). Também adiciona created_by/updated_by pra auditoria: quem criou/editou um cliente fica
-- rastreável, em vez de restringir UPDATE por "quem já tem venda ligada a esse cliente" — essa
-- restrição foi cogitada mas quebraria o próprio objetivo do cadastro (reconhecer e corrigir dado
-- de cliente que negociou com OUTRA equipe antes: no momento do UPDATE, a venda atual ainda não
-- tem o cliente_id salvo, então a checagem falharia bem no caso que o recurso existe pra resolver).
ALTER TABLE public.clientes ADD COLUMN created_by uuid REFERENCES auth.users(id);
ALTER TABLE public.clientes ADD COLUMN updated_by uuid REFERENCES auth.users(id);

DROP POLICY clientes_write ON public.clientes;

CREATE POLICY clientes_insert ON public.clientes
  FOR INSERT WITH CHECK (public.is_active_user(auth.uid()));

CREATE POLICY clientes_update ON public.clientes
  FOR UPDATE USING (public.is_active_user(auth.uid())) WITH CHECK (public.is_active_user(auth.uid()));

-- Sem policy de DELETE = ninguém apaga (nem corretor, nem gestor) — só via acesso direto ao banco.
