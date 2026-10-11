-- Mesmo problema do list_active_corretores (migration anterior): gestoresGerais/teamLeadersGerais
-- em vendas.$id.tsx são o fallback "todo mundo com papel gestor / todo líder de time" usado quando
-- a venda não tem time associado, mas liam direto de user_roles (role='gestor') e teams (lider_id) —
-- ambas restritas por RLS a "só o que o usuário already vê", então pra qualquer um que não seja
-- admin/super_admin (ou já enxergue aquele time específico) o fallback voltava vazio. Mesma solução:
-- RPC SECURITY DEFINER dedicada, sem expor as tabelas inteiras.
CREATE OR REPLACE FUNCTION public.list_active_gestores()
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
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'gestor')
  ORDER BY p.nome;
$function$;

CREATE OR REPLACE FUNCTION public.list_active_team_leaders()
 RETURNS TABLE(id uuid, nome text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.id, p.nome
  FROM public.profiles p
  WHERE p.ativo = true
    AND public.is_active_user(auth.uid())
    AND EXISTS (SELECT 1 FROM public.teams t WHERE t.lider_id = p.id)
  ORDER BY p.nome;
$function$;

GRANT EXECUTE ON FUNCTION public.list_active_gestores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_team_leaders() TO authenticated;
