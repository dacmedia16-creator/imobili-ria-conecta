-- Rollback de 20261109120000_proposta_compra.sql (t_4cff61a6). GERADO por mk_rollback.py a partir da migration.
-- Remove só o que a migration criou: propostas, partes, códigos, assinaturas, histórico e tentativas somem
-- (os links param de abrir). Nenhuma venda, parte de venda, captação ou lead é apagado: a venda criada por
-- "Criar venda em rascunho" continua existindo (é venda normal) e o lead continua na etapa em que está.
-- A chave 'proposta_compra' sai de organization_modules ANTES de o CHECK voltar à lista anterior.
-- Reverter junto o front (PR): a tela de Módulos lista 'proposta_compra' e o CHECK deixaria de aceitar.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.proposta_publica_assinar(text, text, text, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.proposta_publica_ler(text, text);
DROP FUNCTION IF EXISTS public.proposta_ip_bloqueado(text);
DROP FUNCTION IF EXISTS public.proposta_publica_parte(text, text);
DROP FUNCTION IF EXISTS public.proposta_criar_venda(uuid);
DROP FUNCTION IF EXISTS public.proposta_contraproposta(uuid);
DROP FUNCTION IF EXISTS public.proposta_recusar(uuid, text);
DROP FUNCTION IF EXISTS public.proposta_envio_resultado(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.proposta_envio_dados(uuid[]);
DROP FUNCTION IF EXISTS public.proposta_envio_preparar(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.proposta_registrar_pdf(uuid, integer, text);
DROP FUNCTION IF EXISTS public.proposta_salvar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.proposta_criar(uuid, uuid);
DROP FUNCTION IF EXISTS public.proposta_pendencias();
DROP FUNCTION IF EXISTS public.proposta_lista_captacao(uuid);
DROP FUNCTION IF EXISTS public.proposta_detalhe(uuid);
DROP FUNCTION IF EXISTS public.proposta_lead_para_proposta(public.propostas_compra);
DROP FUNCTION IF EXISTS public.proposta_pendencias_envio(uuid);
DROP FUNCTION IF EXISTS public.proposta_pega(uuid);
DROP FUNCTION IF EXISTS public.proposta_pode_operar(public.propostas_compra);
DROP FUNCTION IF EXISTS public.proposta_pode_ver(public.propostas_compra);
DROP FUNCTION IF EXISTS public.proposta_ctx();
DROP FUNCTION IF EXISTS public.proposta_invalidar(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.proposta_parte_inserir(uuid, uuid, text, integer, text, text, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.proposta_evento(public.propostas_compra, text, text);
DROP FUNCTION IF EXISTS public.proposta_conteudo_hash(uuid);
DROP FUNCTION IF EXISTS public.proposta_conteudo(uuid);
DROP FUNCTION IF EXISTS public.proposta_codigo_documento(uuid);
DROP FUNCTION IF EXISTS public.proposta_situacao(text, date);
DROP FUNCTION IF EXISTS public.proposta_precisa_conjuge(text);
DROP FUNCTION IF EXISTS public.proposta_doc(text);
DROP FUNCTION IF EXISTS public.proposta_fone(text);
DROP FUNCTION IF EXISTS public.proposta_estado_civil(text);
DROP FUNCTION IF EXISTS public.proposta_codigo_hash(uuid, text);
DROP FUNCTION IF EXISTS public.proposta_codigo_texto(uuid);
DROP FUNCTION IF EXISTS public.proposta_token(uuid);
DROP FUNCTION IF EXISTS public.proposta_hmac(text);
DROP FUNCTION IF EXISTS public.proposta_sha(text);
DROP FUNCTION IF EXISTS public.proposta_hoje();
DROP FUNCTION IF EXISTS public.proposta_compra_enabled();
DROP FUNCTION IF EXISTS public.proposta_compra_modulo_ligado(uuid);
DROP TABLE IF EXISTS public.proposta_tentativas;
DROP TABLE IF EXISTS public.proposta_eventos;
DROP TABLE IF EXISTS public.proposta_assinaturas;
DROP TABLE IF EXISTS public.proposta_codigos;
DROP TABLE IF EXISTS public.proposta_partes;
DROP TABLE IF EXISTS public.propostas_compra;
DELETE FROM vault.secrets WHERE name = 'proposta_compra_chave';

-- O histórico de liga/desliga (organization_module_history) fica: é auditoria e não tem CHECK de módulo.
DELETE FROM public.organization_modules WHERE module = 'proposta_compra';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta', 'meu_plano_2027',
                    'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento'));

-- platform_set_organization_module igual à da 20261108200000.
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
                                        'avisos_exclusividade', 'inteligencia_gestao', 'link_acompanhamento')
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
