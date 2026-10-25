-- Rollback de 20261025180000_leads_ia_atendimento (card t_8046ecb0).
-- Apaga a IA de atendimento: gatilho, funções, conversas, mensagens, lista de opt-out e colunas ia_* de
-- lead_config. ATENÇÃO: o histórico das conversas e os opt-outs são perdidos. Antes, exporte se precisar:
--   COPY (SELECT * FROM public.lead_mensagens) TO STDOUT WITH CSV HEADER;
--   COPY (SELECT * FROM public.lead_ia_optouts) TO STDOUT WITH CSV HEADER;
-- Os eventos 'ia' da linha do tempo viram 'nota' (o texto continua visível).
BEGIN;

DROP TRIGGER IF EXISTS zz_lead_ia_iniciar ON public.leads;

DROP FUNCTION IF EXISTS public.lead_ia_canal_definir(uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_aplicar(uuid, integer, text, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.lead_ia_config_salvar(boolean, text, text);
DROP FUNCTION IF EXISTS public.lead_ia_parar(uuid);
DROP FUNCTION IF EXISTS public.lead_ia_cliente_simular(uuid, text);
DROP FUNCTION IF EXISTS public.lead_ia_iniciar();
DROP FUNCTION IF EXISTS public.lead_ia_registrar_cliente(uuid, text, text);
DROP FUNCTION IF EXISTS public.lead_ia_passar(uuid, text, text);
DROP FUNCTION IF EXISTS public.lead_ia_tocar(uuid);
DROP FUNCTION IF EXISTS public.lead_ia_status_saida(uuid);
DROP FUNCTION IF EXISTS public.lead_ia_mascarar(text);
DROP FUNCTION IF EXISTS public.lead_ia_contatos(text, text);
DROP FUNCTION IF EXISTS public.lead_ia_primeira_msg(public.leads, public.lead_config, text);
DROP FUNCTION IF EXISTS public.lead_ia_imovel(uuid, uuid);
DROP FUNCTION IF EXISTS public.lead_ia_e_optout(text);
DROP FUNCTION IF EXISTS public.lead_ia_norm(text);

DROP TABLE IF EXISTS public.lead_mensagens;
DROP TABLE IF EXISTS public.lead_conversas;
DROP TABLE IF EXISTS public.lead_ia_optouts;
DROP FUNCTION IF EXISTS public.lead_ia_pode_ver(uuid);

UPDATE public.lead_eventos SET tipo = 'nota', nota = left('[IA] ' || coalesce(nota, para, ''), 2000), para = NULL
 WHERE tipo = 'ia';
ALTER TABLE public.lead_eventos DROP CONSTRAINT lead_eventos_tipo_check;
ALTER TABLE public.lead_eventos ADD CONSTRAINT lead_eventos_tipo_check
  CHECK (tipo IN ('criado', 'etapa', 'atribuido', 'nota', 'vinculo',
                  'aceite', 'devolvido_banco', 'redistribuido', 'ligacao'));

ALTER TABLE public.lead_config
  DROP COLUMN IF EXISTS ia_canal,
  DROP COLUMN IF EXISTS ia_boas_vindas,
  DROP COLUMN IF EXISTS ia_nome,
  DROP COLUMN IF EXISTS ia_ativa;

COMMIT;
