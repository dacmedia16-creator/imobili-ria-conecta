# Reconciliação do histórico de migrations do ADM (t_8f7aa245)

Este documento é só um plano. Nada foi escrito no banco remoto e não foi feito nenhum `migration repair`.

## Situação lida em 11/10/2026 (projeto xvvymgurpchhlmbpjbgc)

| Item | Quantidade |
|---|---|
| Versões no remoto (`supabase_migrations.schema_migrations`) | 314 |
| Arquivos em `supabase/migrations` (origin/main 4ab373f) | 308 |
| Mesma versão nos dois lados | 151 (88 com SQL idêntico; 63 diferentes, incluindo as 30 registradas sem SQL) |
| Só no remoto | 163 (115 têm arquivo local com o mesmo nome e outro número, ou seja, foram renumeradas; 47 têm SQL no remoto e nenhum arquivo; 1 está sem SQL e sem arquivo) |
| Só no local | 157 (115 são as renumeradas; 42 não aparecem no remoto com nenhum nome) |
| Remotas registradas sem SQL | 31 (30 têm arquivo local na mesma versão; 1, `20260901233000`, não tem arquivo) |

As 42 só locais foram conferidas contra o banco (`pg_get_functiondef`):
- as funções que criam estão no banco com o mesmo corpo ou foram substituídas por migrations posteriores;
- 3 objetos não existem mais porque migrations posteriores os removeram (`tmp_parse_tempo_venda_dias`, `resumo_desempenho_30d` e `visao_executiva_stats`).

Os efeitos dessas migrations já estão no banco. Só o registro do histórico diverge.

Algumas funções `exclusive_*` aparecem como diferentes porque `supabase/multiempresa/migrations` (43 arquivos aplicados à parte) as redefine depois. Isso é esperado.

## As duas versões pedidas

- O `20261009060000_desarquivar_venda` só redefine `validate_sale_status_transition()`. A versão `20261009070000` substitui essa função logo depois, então o corpo de 060000 não existe mais isoladamente no banco.
- O `20261009070000_criador_edita_rascunho` redefine `can_edit_sale_stage()` e `validate_sale_status_transition()`. **Os dois corpos no banco são idênticos ao arquivo local** (comparação sem diferenças de espaço).
- O SQL efetivo lido do banco está em `20261009_recuperado_do_banco.sql`, junto com as ACLs atuais. Os arquivos locais das duas versões continuam sendo a fonte. O registro remoto só está sem o texto (`statements` vazio).

## Opções para o próximo `db push`

1. **Repair em lote (`migration repair --status applied/reverted` nas 320 divergências)**: **não recomendado.** Reescreve o histórico de 163 versões que não têm relação entre si e torna invisível o que foi realmente aplicado. O SQL das 47 remotas sem arquivo continuaria fora do repositório.
2. **Repositório espelha o remoto (recomendado).** Só muda arquivos no Git, sem escrita remota, e segue `manifesto-reconciliacao.csv`:
   - `RENOMEAR` (115): `git mv` do arquivo local para o número da versão remota. O conteúdo não muda.
   - `CRIAR_DO_REMOTO` (47): grava o arquivo com o `statements` do remoto, exatamente como está lá.
   - `CRIAR_NOOP_DOCUMENTADO` (1): cria `20260901233000` com um comentário explicando que ela foi aplicada sem SQL registrado e que o efeito dela foi substituído depois.
   - `ARQUIVAR` (42): move os arquivos para `supabase/migrations_arquivo/`. Eles saem da pasta lida pela CLI, mas continuam no Git.
   - Ajusta as 4 citações a caminhos renomeados ou arquivados (testes ou scripts) e roda `audit:sql`, `vitest`, `tsc` e `build`.
   - Resultado esperado: o conjunto de versões de `supabase/migrations` fica igual ao do remoto, e o próximo `db push --dry-run` mostra só as migrations novas.
3. **Baseline (squash)**: substitui tudo por um dump do schema atual e marca no remoto só a versão de baseline. Fica mais limpo, mas exige `pg_dump` com conexão Postgres e um repair remoto das 314 linhas. Vale só se o histórico antigo não interessar mais.

### Opcional, depois da opção 2 e com aprovação

Preencher `statements` das 30 versões remotas vazias com o texto do arquivo local, como o histórico já faz para as demais:
- via SQL, com `UPDATE` condicionado a `statements is null or = '{}'`;
- sem efeito sobre o schema;
- com leitura de volta por `md5`.

Isso só melhora a rastreabilidade e não é necessário para o `db push`.

## Riscos da opção 2

- **Renomear arquivos já citados:** 4 citações dependem dos caminhos e quebram se não forem ajustadas. Mitigação: rodar a suíte completa no PR.
- **Ordem diferente no ambiente de homologação ou local (`supabase db reset`):** ao adotar os números do remoto, a ordem passa a ser a de produção, que é a real. Mesmo assim, é preciso fazer um `db reset` local de prova antes do merge, porque migrations antigas com 1 statement (dump inicial) podem depender de objetos fora de ordem.
- **Nenhum risco para produção:** não há escrita remota. O rollback é reverter o commit.

## Execução da opção 2 (t_412dfcf2, 11/10/2026)

- Manifesto recalculado contra o remoto atual (315 versões): 115 `RENOMEAR`, 47 `CRIAR_DO_REMOTO`, 1 `CRIAR_NOOP_DOCUMENTADO`, 42 `ARQUIVAR`. É idêntico ao `manifesto-reconciliacao.csv`. O que foi aplicado está em `manifesto-aplicado-t_412dfcf2.csv`.
- Os arquivos que nunca foram aplicados com a própria versão foram para `supabase/migrations_arquivo/` (`git mv`, sem apagar). Também foram ajustadas 4 citações: 3 testes e 1 script de rollback.
- `supabase migration list` (CLI 2.120, sessão somente leitura) deu 315 locais = 315 remotas e 0 divergências. `db push --dry-run` respondeu "Remote database is up to date".
- O `db diff` não roda até o fim. O banco sombra para em `20260824030000_remove_pagamento_final_duplicado_630591158_25.sql`, uma migration de dados que exige a venda real e que não foi alterada aqui. Para comparar o schema, use `db dump` ou o diff contra uma cópia restaurada de produção, nunca o banco sombra vazio.
- Em 14 versões, o texto local difere de `statements` do remoto mesmo ignorando espaços e comentários (6 renomeadas, 8 já existentes na main): 20260726003903, 20260728001136, 20260818140456, 20260818234052, 20260819135904, 20260901212500, 20260901215000, 20260901215500, 20260902011500, 20260902022000, 20260902154000, 20260902164500, 20260902200000, 20260902203000. Isso foi só registrado e não foi corrigido. A CLI usa a versão, não o texto, para decidir o `push`.
- Nenhuma escrita no banco do ADM.
