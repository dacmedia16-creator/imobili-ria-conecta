-- Rollback da 20261211150000_locacao_agua_gas_condominio (t_778e6bef). Rodar em transação, DEPOIS de voltar o site.
-- Devolve locacao_json com o texto exato de produção (lido em 20/11/2026) e apaga locacao_contas_condominio.
-- Nenhum dado é alterado: os campos já gravados como "incluída/incluído no condomínio" continuam nos dados do contrato
-- (e seguem valendo como texto livre, como antes desta migration).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.locacao_json(_l public.locacoes)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT to_jsonb(_l) || jsonb_build_object(
    'codigo', 'LOC-' || lpad(_l.numero::text, 4, '0'),
    'corretor_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _l.corretor_id),
    'coordenador_nome', (SELECT p.nome FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        JOIN public.profiles p ON p.id = t.lider_id
       WHERE tm.membro_id = _l.corretor_id AND t.organization_id = _l.organization_id
       ORDER BY tm.created_at DESC LIMIT 1))
$function$;
REVOKE ALL ON FUNCTION public.locacao_json(public.locacoes) FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.locacao_contas_condominio(public.locacoes);

COMMIT;
