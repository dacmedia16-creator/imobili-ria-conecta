-- Locação — água e gás "incluídos no condomínio" (t_778e6bef, pedido de Denis 20/11, tópico 6238).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só depois da revisão do MAX Principal e do "pode publicar" de Denis.
-- Depende da 20261211120000_locacao_boletos_condominio_gas (locacao_tem_gas).
--
-- Rollback: supabase/rollback/20261211150000_locacao_agua_gas_condominio.sql
-- Teste:    supabase/tests/run-locacao-agua-gas-condominio.sh (homologação, transação desfeita; nunca produção).
--
-- Contexto (lido em produção, só leitura, 20/11): nenhuma imobiliária personalizou a lista de documentos (Regras), então
-- não há "arquivo de água" obrigatório; o que trava é o campo obrigatório "código de água" (imv_agua) dos dados do
-- contrato — sem conta própria, o corretor subia uma conta só para tirar o código. No gás, o "Boleto do gás" (PR #368)
-- aparece quando há código de gás.
--
-- O que muda (nenhuma tabela, linha ou arquivo é alterado):
--  1) Na tela, imóvel de condomínio ganha "Água incluída no condomínio" e "Gás incluído no condomínio". Marcado, o campo
--     do código grava o motivo ("incluída/incluído no condomínio"): o código de água deixa de faltar e o boleto do gás
--     some (locacao_tem_gas já ignora texto com "condomínio" — vale também para o texto livre antigo).
--  2) Função nova (interna, fechada ao navegador): locacao_contas_condominio(_l) → {"agua": bool, "gas": bool}.
--     Regra = texto com "condomínio" no código de água/gás (mesma regra do texto livre antigo).
--  3) locacao_json passa a devolver "contas_condominio": a troca de titularidade mostra a conta como "não se aplica
--     (incluída no condomínio)" e ela não entra no aviso de protocolo faltando. pos.tit não é gravado.
-- Função redefinida (o rollback devolve o texto exato de produção lido em 20/11): locacao_json.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE FUNCTION public.locacao_contas_condominio(_l public.locacoes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object(
      'agua', coalesce(c.valores->>'imv_agua', '') ~* 'condom[ií]nio',
      'gas', coalesce(c.valores->>'imv_gas', '') ~* 'condom[ií]nio')
    FROM (SELECT coalesce((SELECT d.valores FROM public.locacao_contrato_dados d WHERE d.locacao_id = _l.id), '{}'::jsonb)
                 AS valores) c
$$;
REVOKE ALL ON FUNCTION public.locacao_contas_condominio(public.locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_json(_l public.locacoes)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT to_jsonb(_l) || jsonb_build_object(
    'codigo', 'LOC-' || lpad(_l.numero::text, 4, '0'),
    'corretor_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _l.corretor_id),
    'coordenador_nome', (SELECT p.nome FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        JOIN public.profiles p ON p.id = t.lider_id
       WHERE tm.membro_id = _l.corretor_id AND t.organization_id = _l.organization_id
       ORDER BY tm.created_at DESC LIMIT 1),
    -- t_778e6bef: água/gás incluídos no condomínio (titularidade não se aplica, sem aviso de protocolo).
    'contas_condominio', public.locacao_contas_condominio(_l))
$function$;
REVOKE ALL ON FUNCTION public.locacao_json(public.locacoes) FROM PUBLIC, anon, authenticated;

COMMIT;
