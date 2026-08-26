-- Participantes de uma venda representam a funcao exercida naquela negociacao,
-- nao necessariamente o papel global do usuario. Disponibiliza todos os perfis
-- ativos sem expor email, telefone ou a tabela completa de permissoes.
CREATE OR REPLACE FUNCTION public.list_active_users()
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
  ORDER BY p.nome;
$function$;

GRANT EXECUTE ON FUNCTION public.list_active_users() TO authenticated;
