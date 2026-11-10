-- Usado só pelo run-locacao-docs-ia.sh na regressão da suíte da Fase 1: com a migration 20261112120000, uma locação
-- residencial com fiador só vai à Conferência com os dados do contrato. Este trecho completa os dados (fictícios)
-- logo antes de cada envio da suíte da Fase 1, para ela continuar testando o resto da esteira.
SELECT public.locacao_contrato_salvar(pg_temp.id('L'), jsonb_build_object(
  'loc_rg', '11.111.111-1', 'loc_nacionalidade', 'brasileira', 'loc_estado_civil', 'solteiro(a)', 'loc_profissao', 'analista',
  'loc_endereco', 'Rua Atual Fictícia, 5', 'prop_nome', 'Proprietária Fictícia', 'prop_cpf', '111.444.777-35',
  'prop_rg', '22.222.222-2', 'prop_nacionalidade', 'brasileira', 'prop_estado_civil', 'solteiro(a)', 'prop_profissao', 'professora',
  'prop_endereco', 'Rua da Dona Fictícia, 9', 'fia_nome', 'Fiador Fictício', 'fia_cpf', '529.982.247-25', 'fia_rg', '33.333.333-3',
  'fia_nacionalidade', 'brasileira', 'fia_estado_civil', 'solteiro(a)', 'fia_profissao', 'comerciante', 'fia_endereco', 'Rua F, 3',
  'fia_matricula', '12.345', 'fia_cartorio', '1º Oficial (fictício)', 'imv_inscricao', '11.22.33', 'imv_energia', '4000123456',
  'imv_agua', '98765', 'imv_vagas', 'não possui', 'prazo_meses', '30', 'inicio', '2026-12-01', 'dia_vencimento', '10'));
