-- Item 16 (decisão de Denis, 27/09/2026): Rafaela Fuentes é da equipe do Gustavo Fuentes.
-- SCRIPT DE DADOS SEPARADO — NÃO É MIGRATION E NÃO FOI APLICADO.
-- Aplicar somente junto com a publicação aprovada, DEPOIS da migration
-- 20260927160000_equipe_historico_vigencia (que cria o histórico e o trigger).
--
-- O que faz:
--   * inclui Rafaela em team_members na equipe "Gustavo Fuentes" (ela hoje é só líder-auxiliar
--     dessa equipe e não é membro de nenhuma);
--   * o trigger trg_team_members_historico grava o vínculo no histórico. A vigência começa no
--     INÍCIO DOS DADOS (correção de cadastro: ela sempre foi da equipe), então as vendas dela
--     assinadas antes de hoje também passam a contar para a equipe do Gustavo.
--     Se Denis preferir que conte só daqui para a frente, apague a linha "set local app...".
--   * Pedro Luiz Barbosa de Lima NÃO é alterado (continua sem equipe).
-- Idempotente: se ela já for membro de alguma equipe, não faz nada.
-- Desfazer: DELETE FROM public.team_members WHERE membro_id = <id da Rafaela>; e remover a linha
-- dela em team_membership_history com origem='team_members' criada por este script.
BEGIN;

SELECT set_config('app.equipe_vigencia_desde',
  (SELECT min(vigente_de)::text FROM public.team_membership_history WHERE origem = 'carga_inicial'),
  true);

INSERT INTO public.team_members (team_id, membro_id)
SELECT t.id, p.id
FROM public.profiles p
JOIN public.teams t ON t.nome = 'Gustavo Fuentes'
WHERE p.nome = 'Rafaela Fuentes'
  AND (SELECT count(*) FROM public.profiles WHERE nome = 'Rafaela Fuentes') = 1
  AND (SELECT count(*) FROM public.teams WHERE nome = 'Gustavo Fuentes') = 1
  AND NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.membro_id = p.id);

-- Conferência (deve retornar 1 linha: Rafaela Fuentes | Gustavo Fuentes | vigência desde o início)
SELECT p.nome, t.nome AS equipe, h.vigente_de, h.vigente_ate, h.origem
FROM public.team_membership_history h
JOIN public.profiles p ON p.id = h.membro_id
JOIN public.teams t ON t.id = h.team_id
WHERE p.nome = 'Rafaela Fuentes';

COMMIT;
