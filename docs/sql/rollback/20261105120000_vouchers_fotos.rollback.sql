-- Rollback de 20261105120000_vouchers_fotos (card t_d86ab990).
-- Remove o módulo "Agendar fotos + Vouchers de Fotos": gatilho na captação, RPCs, tabelas photo_* (APAGA
-- vouchers, agenda, sessões, cobranças e histórico do módulo — faça backup antes se já houver uso real),
-- avisos do sino do módulo e as linhas 'vouchers_fotos' de organization_modules. O histórico de liga/desliga
-- (organization_module_history) é preservado. Volta o CHECK e platform_set_organization_module para os 10
-- módulos anteriores. Publique antes o front anterior (sem as RPCs photo_*): com o front novo e sem as
-- funções, o menu "Agendar fotos" some (falha = desligado).
-- Não mexe em exclusive_captures (só o gatilho trg_zz_photo_vouchers é removido).
-- A extensão btree_gist já existia antes e é mantida.

DROP TRIGGER IF EXISTS trg_zz_photo_vouchers ON public.exclusive_captures;

DROP FUNCTION IF EXISTS public.photo_marcar_cobrado(uuid, boolean);
DROP FUNCTION IF EXISTS public.photo_marcar_feita(uuid);
DROP FUNCTION IF EXISTS public.photo_aviso_para_envio(uuid, text);
DROP FUNCTION IF EXISTS public.photo_desmarcar(uuid, text);
DROP FUNCTION IF EXISTS public.photo_responder(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.photo_agendar(uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.photo_avisar_evento(public.photo_sessions, text, text);
DROP FUNCTION IF EXISTS public.photo_destinos_aviso(public.photo_sessions, text);
DROP FUNCTION IF EXISTS public.photo_texto_aviso(public.photo_sessions, text, text);
DROP FUNCTION IF EXISTS public.photo_quando(timestamptz);
DROP FUNCTION IF EXISTS public.photo_avisar(uuid, uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.photo_faixa_remover(uuid);
DROP FUNCTION IF EXISTS public.photo_faixa_salvar(text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.photo_configurar(uuid, numeric);
DROP FUNCTION IF EXISTS public.photo_staff_listar();
DROP FUNCTION IF EXISTS public.photo_financeiro(date);
DROP FUNCTION IF EXISTS public.photo_agenda_listar(date, date);
DROP FUNCTION IF EXISTS public.photo_horarios_livres(date, date);
DROP FUNCTION IF EXISTS public.photo_meu_resumo();
DROP FUNCTION IF EXISTS public.photo_sessao_json(public.photo_sessions);
DROP FUNCTION IF EXISTS public.photo_desmarcacoes_30d(uuid, uuid);
DROP FUNCTION IF EXISTS public.photo_papeis_que_penalizam();
DROP FUNCTION IF EXISTS public.photo_bloqueado_ate(uuid, uuid);
DROP FUNCTION IF EXISTS public.photo_status_voucher(public.photo_vouchers);
DROP FUNCTION IF EXISTS public.photo_imovel_label(public.exclusive_captures);
DROP FUNCTION IF EXISTS public.photo_vouchers_trg();
DROP FUNCTION IF EXISTS public.photo_vouchers_conferir(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.photo_captacoes_assinadas(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.photo_hoje();
DROP FUNCTION IF EXISTS public.photo_voucher_vencimento(date);
DROP FUNCTION IF EXISTS public.photo_org_ativa();
-- Tabelas depois das RPCs (funções com parâmetro do tipo da linha dependem delas) e antes de
-- photo_eh_*/photo_modulo_ligado (as políticas de RLS dependem dessas funções).
DELETE FROM public.notifications WHERE tipo IN ('foto_marcada', 'foto_confirmada', 'foto_recusada', 'foto_desmarcada');
DROP TABLE IF EXISTS public.photo_history;
DROP TABLE IF EXISTS public.photo_penalidades;
DROP TABLE IF EXISTS public.photo_sessions;
DROP TABLE IF EXISTS public.photo_agenda;
DROP TABLE IF EXISTS public.photo_vouchers;
DROP TABLE IF EXISTS public.photo_settings;

DROP FUNCTION IF EXISTS public.photo_eh_financeiro(uuid);
DROP FUNCTION IF EXISTS public.photo_eh_admin(uuid);
DROP FUNCTION IF EXISTS public.photo_eh_fotografo(uuid, uuid);

DROP FUNCTION IF EXISTS public.vouchers_fotos_enabled();
DROP FUNCTION IF EXISTS public.photo_modulo_ligado(uuid);

DELETE FROM public.organization_modules WHERE module = 'vouchers_fotos';

ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia')
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
