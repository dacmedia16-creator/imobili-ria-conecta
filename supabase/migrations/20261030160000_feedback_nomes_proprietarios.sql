-- Feedback ao Proprietário: NOMES dos proprietários na lista /feedback e no topo do anúncio (t_28136145,
-- pedido de Denis 30/10). Somente leitura; nenhum dado muda e nenhuma permissão é ampliada.
-- Fonte oficial: a captação exclusiva ligada ao anúncio (exclusive_captures.form_data), na ordem do contrato
--   (public.exclusive_owner_list: 1º, 2º e extras). Só o campo nome_completo sai; CPF/telefone/e-mail não.
-- Qual captação: a mesma do quadro "Ligado à captação" (owner_feedback_captacao): vínculo 'ativo' ou
--   'aguardando_gestor' do código; senão o código antigo trocado (owner_feedback_captura).
-- Quem recebe: só quem já pode ver a captação (exclusive_can_view: captador, gestor/TL dele, admin; módulo
--   ligado; imobiliária da sessão). Os demais recebem nada e a tela mostra "Proprietário não informado".
-- Em lote: uma chamada devolve todos os códigos (sem consulta por anúncio).
-- Rollback: supabase/rollback/20261030160000_feedback_nomes_proprietarios.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_feedback_proprietarios()
RETURNS TABLE(code_key text, nomes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH s AS (SELECT auth.uid() AS uid, public.current_org_id() AS org),
  k AS (
    SELECT DISTINCT l.code_key AS key FROM s, public.exclusive_listing_links l
     WHERE s.uid IS NOT NULL AND s.org IS NOT NULL AND l.organization_id = s.org
       AND coalesce(public.owner_feedback_enabled(), false)),
  cap AS (
    SELECT k.key, coalesce(
      (SELECT l.capture_id FROM public.exclusive_listing_links l
        WHERE l.organization_id = s.org AND l.code_key = k.key AND l.status IN ('ativo', 'aguardando_gestor')
        LIMIT 1),
      public.owner_feedback_captura(s.org, k.key)) AS capture_id
      FROM k, s)
  SELECT cap.key,
         (SELECT array_agg(nullif(btrim(o.e->>'nome_completo'), '') ORDER BY o.n)
            FROM jsonb_array_elements(public.exclusive_owner_list(c.form_data)) WITH ORDINALITY o(e, n)
           WHERE nullif(btrim(o.e->>'nome_completo'), '') IS NOT NULL)
    FROM cap, s
    JOIN public.exclusive_captures c ON c.organization_id = s.org
   WHERE c.id = cap.capture_id AND c.discarded_at IS NULL
     AND public.exclusive_can_view(c.id, s.uid)
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_proprietarios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_proprietarios() TO authenticated;

COMMIT;
