-- Foto do perfil no card da Ficha dos colaboradores. Card t_42a173e1 (pedido de Denis em 03/11/2026,
-- tópico 6238; mudança no banco aprovada por Denis: "aprovo a mudança no banco e pode publicar").
--
-- Única mudança: ficha_colaboradores_listar() passa a devolver 'avatar_url' (profiles.avatar_url).
-- Motivo: a RLS de profiles não deixa staff ler o perfil de outras pessoas, então o front não pode
-- buscar a foto direto da tabela. A foto já é pública no bucket avatars.
-- Mesmo porteiro (ficha_pode_ver_colaboradores: staff/admin/super_admin, sem "Entrar como"), mesma org,
-- mesmos grants. Nenhuma tabela, coluna, RLS ou dado é alterado.
-- Base: corpo da migration 20261030100000_ficha_filhos_faixas.sql (igual à versão no ar em 03/11/2026).
--
-- ROLLBACK: reaplicar o CREATE OR REPLACE de ficha_colaboradores_listar() da migration
-- 20261030100000_ficha_filhos_faixas.sql (sem a linha 'avatar_url'). O front tolera a ausência do campo
-- (mostra as iniciais).
BEGIN;
CREATE OR REPLACE FUNCTION public.ficha_colaboradores_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid;
BEGIN
  IF NOT public.ficha_pode_ver_colaboradores() THEN
    RAISE EXCEPTION 'Sem permissao para ver as fichas dos colaboradores' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  RETURN jsonb_build_object(
    'obrigatoria_a_partir_de', public.ficha_obrigatoria_desde(_org),
    'colaboradores', coalesce((
      SELECT jsonb_agg(x.j ORDER BY x.nome) FROM (
        SELECT p.nome, jsonb_build_object(
          'user_id', p.id,
          'nome', p.nome,
          'email', p.email,
          'telefone', p.telefone,
          'avatar_url', p.avatar_url,
          'papeis', coalesce((SELECT jsonb_agg(DISTINCT ur.role::text) FROM public.user_roles ur
                               WHERE ur.user_id = p.id AND ur.organization_id = _org), '[]'::jsonb),
          'equipes', coalesce((SELECT jsonb_agg(DISTINCT t.nome) FROM public.teams t
                                WHERE t.organization_id = _org
                                  AND (t.lider_id = p.id OR EXISTS (
                                        SELECT 1 FROM public.team_members tm
                                         WHERE tm.team_id = t.id AND tm.membro_id = p.id))), '[]'::jsonb),
          'data_nascimento', b.data_nascimento,
          'completa', public.ficha_esta_completa(f, b.data_nascimento),
          'cadastro_pendente', to_jsonb(public.cadastro_pendencias(p.id, _org)),
          'qtd_filhos', f.qtd_filhos,
          'filhos_faixas', to_jsonb(coalesce(f.filhos_faixas, ARRAY[]::text[])),
          'tem_plano_saude', f.tem_plano_saude,
          'plano_saude', f.plano_saude,
          'emergencia_nome', f.emergencia_nome,
          'emergencia_parentesco', f.emergencia_parentesco,
          'emergencia_telefone', f.emergencia_telefone,
          'hospital_preferencia', f.hospital_preferencia,
          'religiao', f.religiao,
          'preenchida_em', f.preenchida_em,
          'updated_at', f.updated_at) AS j
        FROM public.organization_members m
        JOIN public.profiles p ON p.id = m.user_id AND p.ativo IS TRUE
        LEFT JOIN public.colaborador_fichas f ON f.user_id = p.id AND f.organization_id = _org
        LEFT JOIN public.profile_birthdates b ON b.user_id = p.id
        WHERE m.organization_id = _org AND m.ativo
          AND NOT EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p.id)
      ) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.ficha_colaboradores_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_colaboradores_listar() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
