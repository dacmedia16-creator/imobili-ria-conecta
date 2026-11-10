-- Rollback de 20261111120000_locacao_fase2_financeiro.sql (Locação Fase 2 — Financeiro parte 1, t_be750361).
-- Remove só o que a Fase 2 criou: contratos, cobranças, descontos, repasses, histórico financeiro, regras financeiras
-- e o papel 'financeiro' da locação. A Fase 1 (esteira, documentos, comissão) fica intacta: as 3 funções da Fase 1
-- redefinidas pela Fase 2 voltam EXATAMENTE ao texto da migration 20261110120000 (copiado por mkrollback.sh).
-- ATENÇÃO: apaga o histórico financeiro registrado. Em produção, exportar antes (ver docs/locacao/ROLLBACK-FASE2.md).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP TRIGGER IF EXISTS locacao_fin_contrato_na_chave ON public.locacoes;
DROP FUNCTION IF EXISTS public.locacao_fin_config_salvar(jsonb);
DROP FUNCTION IF EXISTS public.locacao_fin_extrato(text);
DROP FUNCTION IF EXISTS public.locacao_fin_repasse_desfazer(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_fin_repasse_feito(uuid, date, text);
DROP FUNCTION IF EXISTS public.locacao_fin_desconto_remover(uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_desconto(uuid, text, numeric);
DROP FUNCTION IF EXISTS public.locacao_fin_cancelar(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_fin_estornar(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_fin_baixa(uuid, date, numeric, text);
DROP FUNCTION IF EXISTS public.locacao_fin_gerar_cobrancas(date);
DROP FUNCTION IF EXISTS public.locacao_fin_contrato_ativar(uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_contrato_salvar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.locacao_fin_contrato(uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_painel(date);
DROP FUNCTION IF EXISTS public.locacao_fin_trg_chaves();
DROP FUNCTION IF EXISTS public.locacao_fin_criar_contrato(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_fin_pega_ct(uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_pega_cob(uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_ct_json(public.locacao_contratos);
DROP FUNCTION IF EXISTS public.locacao_fin_cob_json(public.locacao_cobrancas);
DROP FUNCTION IF EXISTS public.locacao_fin_repasse_calc(public.locacao_cobrancas);
DROP FUNCTION IF EXISTS public.locacao_fin_encargos(public.locacao_cobrancas, date, public.locacao_fin_config);
DROP FUNCTION IF EXISTS public.locacao_fin_evento(uuid, uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.locacao_fin_ctx();
DROP FUNCTION IF EXISTS public.locacao_fin_pode_regras(uuid, uuid);
DROP FUNCTION IF EXISTS public.locacao_fin_brl(numeric);
DROP FUNCTION IF EXISTS public.locacao_fin_hoje();
DROP FUNCTION IF EXISTS public.locacao_fin_cfg(uuid);

DROP TABLE IF EXISTS public.locacao_fin_eventos;
DROP FUNCTION IF EXISTS public.locacao_fin_eventos_imutavel();
DROP TABLE IF EXISTS public.locacao_repasses;
DROP TABLE IF EXISTS public.locacao_fin_descontos;
DROP TABLE IF EXISTS public.locacao_cobrancas;
DROP TABLE IF EXISTS public.locacao_contratos;
DROP SEQUENCE IF EXISTS public.locacao_contratos_numero_seq;
DROP TABLE IF EXISTS public.locacao_fin_config;

-- Papel 'financeiro' sai antes de o CHECK voltar à lista da Fase 1.
DELETE FROM public.locacao_papeis WHERE papel = 'financeiro';
ALTER TABLE public.locacao_papeis DROP CONSTRAINT locacao_papeis_papel_check;
ALTER TABLE public.locacao_papeis ADD CONSTRAINT locacao_papeis_papel_check CHECK (papel IN ('gestora', 'contratos', 'vistoria'));

-- Funções da Fase 1 restauradas (texto literal de 20261110120000_locacao_fase1.sql).
CREATE OR REPLACE FUNCTION public.locacao_pode_ver(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_l.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL AND (
    _l.corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id AND p.user_id = auth.uid())
    OR public.locacao_eh_gerencia(auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['financeiro']::public.app_role[])
    OR (public.has_any_role(auth.uid(), ARRAY['gestor', 'team_leader']::public.app_role[])
        AND public.is_lead_of(auth.uid(), _l.corretor_id))), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_pode_ver(public.locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_contexto() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _uid uuid := auth.uid(); _c public.locacao_config;
BEGIN
  _c := public.locacao_cfg(_org);
  RETURN jsonb_build_object(
    'usuario_id', _uid,
    'papeis', (SELECT coalesce(jsonb_agg(x ORDER BY x), '[]') FROM unnest(ARRAY['gestora', 'contratos', 'vistoria']) x
                WHERE public.locacao_tem_papel(_uid, x)),
    'admin', public.has_any_role(_uid, ARRAY['admin', 'super_admin']::public.app_role[]),
    'gerencia', public.locacao_eh_gerencia(_uid),
    've_comissao', public.locacao_eh_gerencia(_uid) OR public.has_any_role(_uid, ARRAY['financeiro']::public.app_role[])
                   OR public.locacao_tem_papel(_uid, 'gestora'),
    'config', to_jsonb(_c) - 'organization_id' - 'atualizado_por',
    'pessoas', (SELECT coalesce(jsonb_object_agg(papel, nomes), '{}') FROM (
        SELECT p.papel, jsonb_agg(pr.nome ORDER BY pr.nome) AS nomes FROM public.locacao_papeis p
          JOIN public.profiles pr ON pr.id = p.user_id
         WHERE p.organization_id = _org AND pr.ativo GROUP BY p.papel) s));
END $$;
REVOKE ALL ON FUNCTION public.locacao_contexto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_contexto() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_papel_definir(_user uuid, _papel text, _ativo boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária atribui papéis.' USING ERRCODE = '42501';
  END IF;
  IF _papel IS NULL OR _papel NOT IN ('gestora', 'contratos', 'vistoria') OR _ativo IS NULL THEN
    RAISE EXCEPTION 'Papel inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
                  WHERE m.user_id = _user AND m.organization_id = _org AND m.ativo AND p.ativo) THEN
    RAISE EXCEPTION 'Pessoa não pertence a esta imobiliária.' USING ERRCODE = '42501';
  END IF;
  IF _ativo THEN
    INSERT INTO public.locacao_papeis (organization_id, user_id, papel, criado_por) VALUES (_org, _user, _papel, auth.uid())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.locacao_papeis WHERE organization_id = _org AND user_id = _user AND papel = _papel;
  END IF;
  RETURN _ativo;
END $$;
REVOKE ALL ON FUNCTION public.locacao_papel_definir(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_papel_definir(uuid, text, boolean) TO authenticated;

COMMIT;
