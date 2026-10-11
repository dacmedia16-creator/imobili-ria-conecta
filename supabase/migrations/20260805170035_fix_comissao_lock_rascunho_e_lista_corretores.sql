-- Bug 1: can_edit_sale_comissao nunca liberava o DONO da venda (corretor OU gestor criando pra si
-- mesmo) durante rascunho/devolvida_ajuste — só cobria financeiro/admin/super_admin (sempre) e
-- gestor/team_leader nos status de revisão (enviada_revisao em diante). Isso trava a inserção em
-- sale_commission_extras ("+Outro captador/vendedor") logo na criação do rascunho, contradizendo
-- corretorPodeEditar (sale-permissions.ts), que já libera o dono nesses dois status.
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

-- Bug 2: a lista de "Corretor captador/vendedor" (vendas.$id.tsx) buscava ids direto de
-- user_roles (role='corretor'), mas user_roles_self_select só deixa cada um ver a própria linha
-- (exceto quem já é 'admin'). Pra gestor/team_leader/super_admin/financeiro isso sempre voltava
-- vazio (ou só a própria linha, se o próprio usuário também fosse corretor) — o Select some e cai
-- no fallback de texto livre. RPC dedicada, mesmo padrão de cliente_historico/metas_progresso:
-- não expõe user_roles inteira, só id+nome de quem é corretor ativo.
CREATE OR REPLACE FUNCTION public.list_active_corretores()
 RETURNS TABLE(id uuid, nome text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.nome
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.is_active_user(auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'corretor')
  ORDER BY p.nome;
$function$;

GRANT EXECUTE ON FUNCTION public.list_active_corretores() TO authenticated;
