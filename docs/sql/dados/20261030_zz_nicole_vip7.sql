-- t_ccaa41c0 (Denis 30/10/2026, tópico 6238): liga a Nicole para leads reais SÓ na ZZ Teste Provisionamento.
-- Rollback em 1 passo: supabase/rollback/20261030220000_leads_ia_vip7_liberacao.sql (bloco "ZZ").
DO $$
DECLARE _zz constant uuid := 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c';
  _eder constant uuid := 'c7952784-3cf6-4191-9f37-a9a6579770dc';
  _desde constant timestamptz := '2026-10-30 00:00:00-03';
  _n integer; _conv integer; _msg integer; _resp integer;
BEGIN
  IF (SELECT nome FROM public.organizations WHERE id = _zz) IS DISTINCT FROM 'ZZ Teste Provisionamento' THEN
    RAISE EXCEPTION 'ZZ nao confere';
  END IF;
  IF NOT public.lead_pode_ser_responsavel(_eder, _zz) THEN RAISE EXCEPTION 'Eder nao pode ser responsavel'; END IF;

  UPDATE public.lead_config
     SET ia_envio_modo = 'todos', ia_envio_desde = _desde, ia_primeira_auto = true,
         ia_org_nome = 'VIP7 Imóveis', ia_corretor_passagem_id = _eder, ia_aviso_corretor_whats = true,
         ia_reengajar_h0 = 3, ia_reengajar_h2_sem_resposta = 48, ia_envio_limite_dia = 30, updated_at = now()
   WHERE organization_id = _zz;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN RAISE EXCEPTION 'config: % linhas', _n; END IF;

  -- Leads reais de hoje (de _desde em diante) ainda sem 1ª mensagem: canal real + texto refeito (VIP7) + pendente.
  CREATE TEMP TABLE _hoje ON COMMIT DROP AS
  SELECT l.id AS lead_id, cv.id AS conversa_id
    FROM public.leads l JOIN public.lead_conversas cv ON cv.lead_id = l.id
   WHERE l.organization_id = _zz AND l.created_at >= _desde AND NOT l.simulado
     AND coalesce(l.externo_id, '') NOT LIKE 'teste-%' AND l.telefone IS NOT NULL
     AND l.etapa NOT IN ('ganho', 'perdido')
     AND cv.canal = 'teste' AND cv.estado = 'ativa' AND cv.primeira_enviada_em IS NULL
     AND (SELECT count(*) FROM public.lead_mensagens m WHERE m.conversa_id = cv.id) = 1
     AND EXISTS (SELECT 1 FROM public.lead_mensagens m WHERE m.conversa_id = cv.id AND m.autor = 'ia' AND m.status = 'nao_enviada');

  UPDATE public.lead_conversas cv SET canal = 'ziontalk', updated_at = now()
    FROM _hoje h WHERE cv.id = h.conversa_id;
  GET DIAGNOSTICS _conv = ROW_COUNT;
  UPDATE public.lead_mensagens m
     SET texto = public.lead_ia_primeira_msg(l, c, public.lead_ia_org_nome(_zz)),
         status = public.lead_ia_status_saida(m.conversa_id)
    FROM _hoje h, public.leads l, public.lead_config c
   WHERE m.conversa_id = h.conversa_id AND l.id = h.lead_id AND c.organization_id = _zz AND m.status = 'nao_enviada';
  GET DIAGNOSTICS _msg = ROW_COUNT;

  -- Leads reais de hoje com corretor de teste/banco, ainda não aceitos: ficam com a Nicole, sem responsável.
  WITH r AS (
    UPDATE public.leads l
       SET responsavel_id = NULL, atribuido_em = NULL, aceito_em = NULL, ultima_interacao_em = NULL,
           no_banco_desde = NULL, tentativas_aceite = 0, updated_at = now()
     WHERE l.organization_id = _zz AND l.created_at >= _desde AND NOT l.simulado
       AND coalesce(l.externo_id, '') NOT LIKE 'teste-%' AND l.aceito_em IS NULL
       AND l.etapa NOT IN ('ganho', 'perdido')
       AND (l.responsavel_id IS NOT NULL OR l.no_banco_desde IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.lead_conversas cv WHERE cv.lead_id = l.id AND cv.estado = 'passada')
    RETURNING l.id, l.organization_id)
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
  SELECT organization_id, id, 'nota', 'com a IA',
         'Lead tirado do corretor de teste/banco: fica com a Nicole e vai ao corretor quando ela passar o cliente (t_ccaa41c0).'
    FROM r;
  GET DIAGNOSTICS _resp = ROW_COUNT;
  RAISE NOTICE 'ZZ ligada: conversas=% mensagens=% leads_sem_responsavel=%', _conv, _msg, _resp;
END $$;
