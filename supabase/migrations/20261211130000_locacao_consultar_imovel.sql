-- Locação: "Consultar imóvel" (t_241e03a9, pedido de Denis 20/11/2026, tópico 6238).
-- Qualquer pessoa da imobiliária com a Locação liberada consulta se um imóvel já tem processo andando, pelo código do
-- imóvel (ficha.imovel_id) ou por parte do endereço. Devolve SÓ: código, endereço do imóvel, status simplificado, etapa,
-- nome do corretor responsável e quantos processos ativos há. NADA de locatário, proprietário, fiador, documentos,
-- valores ou observações (LGPD). Não muda tabela, RLS nem SELECT de locacoes: só cria esta função.
-- Status (ajuste de Denis 20/11, t_56101806): chave entregue = "alugado" (também se depois encerrada); encerrada sem
-- chave (reprovada/cancelada/desistência) ou sem processo = "livre"; processo ativo antes da chave prevalece sobre ambos.
-- Rollback: supabase/rollback/20261211130000_locacao_consultar_imovel.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.locacao_consultar_imovel(_termo text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _org uuid := public.locacao_ctx();  -- login ativo + imobiliária atual + módulo Locação ligado
  _de constant text := 'áàâãäéèêëíìîïóòôõöúùûüçñ';
  _pa constant text := 'aaaaaeeeeiiiiooooouuuucn';
  _t text := btrim(coalesce(_termo, ''));
  _q text;
BEGIN
  IF length(_t) < 3 THEN
    RAISE EXCEPTION 'Digite pelo menos 3 letras ou números.' USING ERRCODE = '22023';
  END IF;
  IF length(_t) > 100 THEN
    RAISE EXCEPTION 'Busca longa demais (máximo 100 caracteres).' USING ERRCODE = '22023';
  END IF;
  -- Sem diferenciar maiúsculas/acentos; % e _ digitados valem como texto, não como curinga.
  _q := '%' || replace(replace(replace(translate(lower(_t), _de, _pa), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN (
    WITH todos AS (
      SELECT l.etapa, l.situacao, l.corretor_id, l.atualizado_em, l.chave_em, b.cod, b.ender,
             -- Mesmo imóvel = mesmo código; sem código, mesmo endereço (sem maiúsculas/acentos).
             coalesce('c:' || translate(lower(b.cod), _de, _pa), 'e:' || translate(lower(b.ender), _de, _pa)) AS chave,
             (translate(lower(coalesce(b.cod, '')), _de, _pa) LIKE _q
              OR translate(lower(concat_ws(' ', l.endereco, l.ficha->>'complemento')), _de, _pa) LIKE _q) AS casou
        FROM public.locacoes l
        CROSS JOIN LATERAL (SELECT nullif(btrim(l.ficha->>'imovel_id'), '') AS cod,
               btrim(concat_ws(' — ', nullif(btrim(l.endereco), ''), nullif(btrim(l.ficha->>'complemento'), ''))) AS ender) b
       WHERE l.organization_id = _org
    ), marcados AS (
      -- Todos os processos do imóvel achado (mesmo os que não casaram com o termo): evita "Livre" falso quando o
      -- processo ativo do mesmo código foi digitado com outro endereço.
      SELECT t.*,
             -- 0 livre < 1 alugado < 2..4 processo ativo antes da chave (vale o maior grau do imóvel).
             -- Chave entregue (chave_em / etapa comissão) = alugado, mesmo se depois for encerrada (t_56101806).
             CASE WHEN t.chave_em IS NOT NULL OR t.etapa = 'comissao' THEN 1
                  WHEN t.situacao <> 'ativa' THEN 0
                  WHEN t.etapa IN ('pre_analise', 'aprovacao') THEN 2
                  WHEN t.etapa = 'documentacao' THEN 3
                  ELSE 4 END AS grau
        FROM todos t
       WHERE t.chave IN (SELECT x.chave FROM todos x WHERE x.casou)
    ), imoveis AS (
      SELECT DISTINCT ON (m.chave) m.chave, m.cod, m.ender, m.grau, m.etapa, m.corretor_id,
             count(*) FILTER (WHERE m.grau > 1) OVER (PARTITION BY m.chave) AS ativos
        FROM marcados m
       ORDER BY m.chave, m.grau DESC, m.atualizado_em DESC
    ), top AS (
      SELECT * FROM imoveis i ORDER BY i.grau DESC, i.ender, i.cod LIMIT 10
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'imovel_id', t.cod,
             'endereco', nullif(t.ender, ''),
             'status', CASE t.grau WHEN 0 THEN 'livre' WHEN 1 THEN 'alugado' WHEN 2 THEN 'pre_analise'
                                   WHEN 3 THEN 'documentacao' ELSE 'contrato' END,
             'etapa', CASE WHEN t.grau > 1 THEN t.etapa END,
             'corretor', CASE WHEN t.grau > 1 THEN (SELECT p.nome FROM public.profiles p WHERE p.id = t.corretor_id) END,
             'processos_ativos', t.ativos)
           ORDER BY t.grau DESC, t.ender, t.cod), '[]'::jsonb)
      FROM top t);
END $$;

REVOKE ALL ON FUNCTION public.locacao_consultar_imovel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_consultar_imovel(text) TO authenticated;

COMMIT;
