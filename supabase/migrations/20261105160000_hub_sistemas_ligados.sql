-- Passo 3, etapa 1 (cartão t_311cc909): o Hub mostra Visita, Estudo, Academia e 60 Dias só quando o módulo está
-- ligado em organization_modules para a imobiliária de quem está logado. Autorizado por Denis em 05/11/2026
-- (construir e testar); publicar depende de outro "sim".
-- Só LEITURA: não muda nenhuma chave, nenhuma tabela e nenhuma política. Não bloqueia URL direta nem a ponte da
-- Conta MAX (etapas 2 a 4).
-- Regras:
--  * Admin da plataforma (platform_admins) recebe os 4, sempre.
--  * Os outros recebem os módulos ligados na imobiliária atual (current_org_id(): membro ativo, org 'ativa',
--    perfil ativo). Sem imobiliária ativa = lista vazia.
--  * Academia segue a mesma regra da academia_enabled(): o perfil "só fotógrafo" não recebe.
--  * academia_enabled() continua existindo e igual (reversão do front não depende desta função).
-- Rollback: docs/sql/rollback/20261105160000_hub_sistemas_ligados.rollback.sql

CREATE OR REPLACE FUNCTION public.sistemas_ligados()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN ARRAY[]::text[]
    WHEN public.is_platform_super_admin(auth.uid()) THEN ARRAY['visita', 'estudo', 'academia', 'sessenta']
    ELSE coalesce((
      SELECT array_agg(m.module ORDER BY m.module)
        FROM public.organization_modules m
       WHERE m.organization_id = public.current_org_id()
         AND m.enabled
         AND m.module IN ('visita', 'estudo', 'academia', 'sessenta')
         AND NOT (m.module = 'academia' AND public.eh_so_fotografo(auth.uid()))
    ), ARRAY[]::text[])
  END
$function$;

COMMENT ON FUNCTION public.sistemas_ligados() IS
  'Hub (t_311cc909): sistemas ligados na imobiliária de quem está logado (plataforma = todos). Só leitura.';

REVOKE ALL ON FUNCTION public.sistemas_ligados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sistemas_ligados() TO authenticated;
