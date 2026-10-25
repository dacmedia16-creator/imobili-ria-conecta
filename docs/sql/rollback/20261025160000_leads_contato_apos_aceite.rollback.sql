-- Rollback da migration 20261025160000_leads_contato_apos_aceite.sql (card t_3284da21).
-- Volta ao estado do P2/P3: o app lê de novo todas as colunas de leads (inclusive telefone/e-mail
-- ANTES do aceite) e a RPC lead_contatos some. Não apaga dados.
-- Ordem se for desfazer tudo: este rollback -> 20261025150000 -> 20261025120000.
-- Antes de rodar: publique (git revert + deploy:safe) a versão do app que não chama lead_contatos,
-- ou desligue o módulo Leads na ZZ — senão a tela de leads mostra erro.
BEGIN;
DROP FUNCTION IF EXISTS public.lead_contatos(uuid[]);
DO $$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.leads'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  EXECUTE format('REVOKE SELECT (%s) ON public.leads FROM authenticated', _cols);
END $$;
GRANT SELECT ON public.leads TO authenticated;
COMMIT;
