# Cadastro único: sincronização ADM MAX → Estudo de Mercado e Visita Prova

Plano aprovado por Denis em 11/10/2026 (cartões t_5406fe1b e t_41bcad66). Bancos continuam separados.

## Como funciona
1. Gatilhos em `profiles`, `user_roles`, `organization_members`, `team_members` e `teams.lider_id` só anotam a pessoa em `sync_outbox` (1 pendente por pessoa). Nunca chamam a internet nem fazem o cadastro falhar.
2. O pg_cron (`sync-satelites`, a cada minuto) roda `sync_disparar('processar')`, que só chama a função se o modo geral não for `off` e houver pendência.
3. A função `sync-satelites` monta o estado atual da pessoa (`sync_estado_desejado`), traduz o papel (tabela 4.1) e envia em lote, assinado com HMAC, para `adm-sync-apply` do Estudo e do Visita.
4. Cada satélite aplica no próprio banco e devolve o resultado. Tudo vai para `sync_log`; conflitos vão para `sync_conflicts` (decisão humana); falhas tentam de novo em 1, 5, 15, 60 e 360 min e depois ficam `falhou`.

## Travas (todas precisam estar ligadas para gravar)
| Onde | Chave | Padrão |
|---|---|---|
| ADM | `sync_config.mode` (`off`/`dry_run`/`live`) | `off` |
| ADM | `sync_org_map.mode` por imobiliária | `off` |
| ADM | `sync_config.allow_deactivate` | `false` |
| Satélite | secret `ADM_SYNC_MODE` | `off` (ausente = off) |
| Satélite | secret `ADM_SYNC_ALLOWED_ORGS` | vazio = recusa tudo |

## Regras de segurança
- Só altera conta **gerenciada** (linha em `adm_sync_links` do satélite). Contas só do satélite (ex.: exclusivos do Visita) nunca são alteradas; aparecem em `so_no_satelite` no relatório.
- E-mail igual = vincula. Telefone, nome, primeiro+último nome ou mesmo usuário de e-mail com outro domínio = **conflito**, não cria.
- Rebaixar `owner` no Estudo, conta de outra imobiliária, conta da plataforma, e-mail novo já em uso = conflito.
- Equipe inexistente no Estudo: só relata. Nunca cria equipe. Nunca apaga nada.
- Visita: se passar do limite do plano, cria e avisa (`limite_corretores_do_plano_ultrapassado`).
- Desligar = suspende/inativa + `ban` no Auth + `adm_sync_revoke_sessions` (derruba refresh tokens). As pontes Conta MAX recusam conta banida/inativa (`account_inactive`).
- `super_admin` do ADM fica fora da sincronização.

## Operação
- Reconciliação sob demanda (sempre `dry_run`, nunca grava): `select public.sync_disparar('reconciliar');` → resultado em `sync_reconcile_runs`.
- Reprocessar falhas: `select public.sync_reprocessar();` (ou `array[ids]`).
- Reenviar a imobiliária inteira: `select public.sync_enfileirar_org('<adm_org_id>');`
- Ligar o robô: `supabase/scripts/sync_cron_ligar.sql`. Desligar: `supabase/scripts/sync_cron_desligar.sql`.

## Dia de ligar `allow_deactivate` (achado 1 da auditoria t_7de49c67) — SÓ COM OK DO DENIS
Desativação adiada volta como `nada_a_fazer` e a outbox fica `ok`; ligar a flag NÃO reenfileira ninguém sozinho.
0. Pré-requisito: correções do cartão t_6e4a9c38 publicadas (ADM `sync-satelites`; Estudo `adm-sync-apply` + `conta-max-bridge`; Visita `adm-sync-apply`).
1. Prévia sem gravar: `select public.sync_disparar('reconciliar');` e conferir em `sync_reconcile_runs` (último registro) `por_acao.desativar` e `por_conflito` (owners viram `desativar_owner`).
2. Nos 2 satélites, criar o secret `ADM_SYNC_ALLOW_DEACTIVATE=true` (trava local; sem ele nada é desativado).
3. No ADM: `update public.sync_config set allow_deactivate = true, updated_at = now();`
4. Reenfileirar a Única: `select public.sync_enfileirar_org('00000000-0000-4000-8000-000000000001', 'ligar_allow_deactivate');`
5. Acompanhar: `select status, count(*) from public.sync_outbox group by 1;`, `sync_log` com `acao like '%desativar%'` e `sync_conflicts` abertos.
Reversão: `allow_deactivate=false` + remover o secret dos satélites; quem foi desligado volta reativando no ADM.

## Imobiliária nova: provisionamento automático (cartão t_c0844acb, ligado em 12/10/2026)
1. Gatilho `trg_zz_sync_provisao` (AFTER INSERT em `organizations`) só anota a org em `sync_org_provision` (pendente, +2 min). Não anota se `provision_mode='off'` ou se já existe `sync_org_map` (as 4 ligadas à mão).
2. A cada execução, `sync-satelites` chama `processarProvisionamento`: envia `{acao:'provisionar_org', modo:'dry_run'}` assinado para os 2 satélites. Se algum responder `conflito` (mesmo CNPJ, mesmo nome ou nome contido, ignorando RE/MAX/LTDA/acentos; no Estudo também o mesmo slug), registra em `sync_conflicts` (`adm_org_id`, `adm_user_id` nulo), marca `aguardando_humano` e **não cria nada**.
3. Em `live`: cria nos 2 satélites (RPC `adm_sync_provisionar_org`, 1 transação, idempotente por `adm_org_id`). Visita = imobiliária + assinatura Plano Teste R$ 0 sem Asaas + 8 módulos + `adm_sync_orgs`; Estudo = organização + `adm_sync_orgs` (origem `provisionado_adm`, já aceita sem entrar no `ADM_SYNC_ALLOWED_ORGS`).
4. Só com os 2 ids `sync_provisao_concluir` grava `sync_org_map` (live, Estudo/Visita ligados) e chama `sync_enfileirar_org` → pessoas seguem pelo sync normal. Falha no meio = nova tentativa (1/5/15/60/360 min; o reenvio devolve `ja_provisionada` onde já criou).
5. Travas: `sync_config.provision_mode` (`off`/`dry_run`/`live`) + secret `ADM_SYNC_ALLOW_PROVISION=true` em cada satélite (sem ele o satélite só faz prévia) + `ADM_SYNC_MODE`.
6. Operação: reenviar `select public.sync_provisao_enfileirar('<org>');` · excluir org (teste) `select public.sync_provisao_ignorar('<org>', 'motivo');` · fila `select status, count(*) from public.sync_org_provision group by 1;`.
7. Atenção: desativar o **dono** (owner) no Estudo continua indo para `sync_conflicts` (`desativar_owner`), por regra.
8. Reversão: `update public.sync_config set provision_mode='off';` (instantâneo); estrutura: `supabase/rollback/20261012150000_sync_provisionar_org.sql` (ADM) e `supabase/rollback/20261012150000_adm_sync_provisionar_org.sql` (satélites). Orgs já criadas não são apagadas.
9. Ensaio 12/10: org "ZZ Teste Provisionamento" (dry_run → live → trava → idempotência → suspensa nos 3, sem apagar).

## Reversão
1. Instantânea: `update public.sync_config set mode='off';` (ou a org em `off`, ou `ADM_SYNC_MODE=off` no satélite).
2. Parar o robô: `sync_cron_desligar.sql`.
3. Desfazer alterações: `sync_log.detalhe` guarda as ações por pessoa; contas criadas ficam em `adm_sync_links` (origem `criado_pela_sync`).
4. Remover a estrutura: `supabase/rollback/20261011120000_sync_satelites.sql` (ADM) e `supabase/rollback/20261011120000_adm_sync_receptor.sql` (satélites).

## Secrets
- ADM `sync-satelites`: `SYNC_INTERNAL_SECRET`, `ESTUDO_SYNC_URL`, `ESTUDO_SYNC_SECRET`, `VISITA_SYNC_URL`, `VISITA_SYNC_SECRET`, `SESSENTA_SYNC_URL`, `SESSENTA_SYNC_SECRET` (60 Dias MAX). Vault: `sync_satelites_url`, `sync_internal_secret`.
- Satélites `adm-sync-apply`: `ADM_SYNC_SECRET` (= `*_SYNC_SECRET` do ADM, ≥32 caracteres), `ADM_SYNC_SECRET_NEXT` (troca), `ADM_SYNC_MODE`, `ADM_SYNC_ALLOWED_ORGS`.
- A chave service_role de cada banco nunca sai do próprio projeto.

## Testes
- ADM: `vitest run src/lib/sync-satelites.test.ts`; integração no homolog: `psql -f supabase/tests/sync_satelites.sql` (termina em ROLLBACK).
- Satélites: `node --test supabase/functions/adm-sync-apply/*.test.ts`.
