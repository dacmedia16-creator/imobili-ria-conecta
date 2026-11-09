-- Rollback de 20261110120000_locacao_fase1.sql (Módulo de Locação Fase 1, t_74426f94).
-- Remove só o que a migration criou: locações, documentos (registros), histórico, papéis e regras de locação.
-- Nenhuma venda, captação, lead, usuário ou papel do sistema (user_roles) é tocado.
-- A chave 'locacao' sai de organization_modules ANTES de o CHECK voltar à lista anterior.
-- Bucket 'locacao-documentos': se ainda tiver arquivos, esvazie ANTES pela API de Storage (painel Supabase →
-- Storage → locacao-documentos → selecionar tudo → Delete); com arquivos o bucket é mantido e um aviso é exibido.
-- Reverter junto o front (PR): a tela de Módulos lista 'locacao' e o CHECK deixaria de aceitar.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.locacao_protocolo(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_pos_acao(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.locacao_corretor_minuta(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_contratos_acao(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.locacao_enviar_documentacao(uuid);
DROP FUNCTION IF EXISTS public.locacao_documento_ver(uuid);
DROP FUNCTION IF EXISTS public.locacao_documento_remover(uuid);
DROP FUNCTION IF EXISTS public.locacao_documento_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.locacao_documento_preparar(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_gestora_decidir(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.locacao_enviar_pre(uuid);
DROP FUNCTION IF EXISTS public.locacao_salvar_pre(uuid, jsonb);
DROP FUNCTION IF EXISTS public.locacao_criar();
DROP FUNCTION IF EXISTS public.locacao_papel_definir(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.locacao_papeis_lista();
DROP FUNCTION IF EXISTS public.locacao_config_salvar(jsonb);
DROP FUNCTION IF EXISTS public.locacao_detalhe(uuid);
DROP FUNCTION IF EXISTS public.locacao_lista();
DROP FUNCTION IF EXISTS public.locacao_contexto();
DROP FUNCTION IF EXISTS public.locacao_json(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_docs_faltando(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_checklist(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_mover(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.locacao_evento(public.locacoes, text, text);
DROP FUNCTION IF EXISTS public.locacao_exige(public.locacoes, text[], text);
DROP FUNCTION IF EXISTS public.locacao_pega(uuid);
DROP FUNCTION IF EXISTS public.locacao_pode_ver(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_ctx();
DROP FUNCTION IF EXISTS public.locacao_tem_papel(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_eh_gerencia(uuid);
DROP FUNCTION IF EXISTS public.locacao_cfg(uuid);
DROP FUNCTION IF EXISTS public.locacao_enabled();
DROP FUNCTION IF EXISTS public.locacao_modulo_ligado(uuid);
DROP TABLE IF EXISTS public.locacao_eventos;
DROP TABLE IF EXISTS public.locacao_documentos;
DROP TABLE IF EXISTS public.locacoes;
DROP SEQUENCE IF EXISTS public.locacoes_numero_seq;
DROP TABLE IF EXISTS public.locacao_papeis;
DROP TABLE IF EXISTS public.locacao_config;
DROP FUNCTION IF EXISTS public.locacao_docs_padrao();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'locacao-documentos') THEN
    RAISE NOTICE 'Bucket locacao-documentos tem arquivos: esvazie pela API de Storage e rode de novo para remover o bucket.';
  ELSE
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.buckets WHERE id = 'locacao-documentos';
  END IF;
END $$;

DELETE FROM public.organization_modules WHERE module = 'locacao';
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra'));

-- platform_set_organization_module igual à da 20261109120000.
CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento', 'proposta_compra')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

COMMIT;
