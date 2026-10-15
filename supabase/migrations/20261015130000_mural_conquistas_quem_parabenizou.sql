-- Mural de Conquistas (card t_f40b6920): "quem parabenizou" cada conquista.
-- achievement_feed só devolve a contagem; os nomes moram em profiles, que um corretor não lê de colegas
-- (policy profiles_self_select). Esta RPC devolve só nome de quem parabenizou, nos posts ATIVOS da
-- imobiliária atual e com o módulo ligado. Não devolve e-mail, telefone, valor, comissão nem cliente.
CREATE OR REPLACE FUNCTION public.achievement_cheerers(_post_ids uuid[])
RETURNS TABLE (post_id uuid, user_id uuid, nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.post_id, c.user_id, pr.nome
  FROM public.achievement_cheers c
  JOIN public.achievement_posts p ON p.id = c.post_id
  JOIN public.profiles pr ON pr.id = c.user_id
  WHERE auth.uid() IS NOT NULL
    AND public.achievements_enabled()
    AND p.organization_id = public.current_org_id()
    AND c.organization_id = public.current_org_id()
    AND p.ativo
    AND c.post_id = ANY (coalesce(_post_ids, '{}'::uuid[]))
  ORDER BY c.post_id, c.created_at
  LIMIT 2000
$$;
REVOKE ALL ON FUNCTION public.achievement_cheerers(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.achievement_cheerers(uuid[]) TO authenticated, service_role;
