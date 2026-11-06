-- t_c6ebfd05 (FASE 2, só com ok do Denis): usuários fictícios da imobiliária de demonstração
-- (ids com prefixo 'de30de30-') NUNCA entram no rodízio de leads nem podem ser responsáveis por lead,
-- mesmo que o módulo de leads seja religado. Só acrescenta a exclusão; o resto das funções fica igual.
-- Reverter: recriar as duas funções sem a linha marcada "demo".

CREATE OR REPLACE FUNCTION public.lead_rodizio_proximo(_org uuid, _apos uuid, _excluir uuid[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH e AS (
    SELECT DISTINCT p.id FROM public.profiles p
      JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
      JOIN public.user_roles r ON r.user_id = p.id AND r.organization_id = _org AND r.role::text = 'corretor'
     WHERE p.organization_id = _org AND p.ativo IS TRUE AND NOT (p.id = ANY (coalesce(_excluir, '{}'::uuid[])))
       AND p.id::text NOT LIKE 'de30de30-%')  -- demo: fictícios fora do rodízio
  SELECT coalesce((SELECT id FROM e WHERE _apos IS NOT NULL AND id > _apos ORDER BY id LIMIT 1),
                  (SELECT id FROM e ORDER BY id LIMIT 1))
$function$;

CREATE OR REPLACE FUNCTION public.lead_pode_ser_responsavel(_user uuid, _org uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _user IS NOT NULL AND _user::text NOT LIKE 'de30de30-%'  -- demo: fictício nunca é responsável por lead
  AND EXISTS (
    SELECT 1 FROM public.organization_members m
      JOIN public.profiles p ON p.id = m.user_id AND p.ativo IS TRUE AND p.organization_id = _org
     WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo)
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _user AND r.organization_id = _org
                AND r.role::text IN ('corretor', 'team_leader', 'gestor', 'admin', 'super_admin'))
$function$;
