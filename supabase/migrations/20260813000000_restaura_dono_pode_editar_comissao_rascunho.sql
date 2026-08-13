-- Bug: a migration 20260805110000 liberou o DONO da venda (corretor ou gestor/team_leader
-- criando uma venda pra si mesmo) editar a divisão da comissão em rascunho/devolvida_ajuste,
-- espelhando corretorPodeEditar (sale-permissions.ts). Depois, 20260811030000 (schema do
-- Lançamento) e 20260811050000 fizeram CREATE OR REPLACE de can_edit_sale_comissao pra adicionar
-- o ramo do Lançamento, mas substituíram a função inteira e derrubaram sem querer esse ramo
-- genérico do dono -- restando só um ramo específico pra modalidade='lancamento' com role
-- 'lancamento'. Resultado: gestor/team_leader criando uma venda normal (não-Lançamento) pra si
-- mesmo volta a ficar travado na Divisão da comissão logo no rascunho, com o erro "Somente o
-- gestor/team leader (ou financeiro/admin) pode editar a divisão da comissão desta venda." --
-- mesmo sendo o dono. Restaura o ramo do dono, mantendo o ramo do Lançamento (redundante pra
-- vendas modalidade='lancamento', mas inofensivo).
CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_active_user(_user) AND (
      public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (
        public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
        AND NOT public.is_sale_locked(_sale_id)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.status::text = ANY(ARRAY[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
          ])
        )
      )
      OR (
        public.has_role(_user, 'lancamento'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.corretor_id = _user
          AND s.modalidade = 'lancamento'
          AND s.status::text = ANY(ARRAY['rascunho','devolvida_ajuste'])
        )
      )
      OR (
        NOT public.is_sale_locked(_sale_id)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.corretor_id = _user
          AND s.status::text = ANY(ARRAY['rascunho','devolvida_ajuste'])
        )
      )
    );
$function$;
