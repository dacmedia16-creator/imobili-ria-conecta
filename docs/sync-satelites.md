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

## Reversão
1. Instantânea: `update public.sync_config set mode='off';` (ou a org em `off`, ou `ADM_SYNC_MODE=off` no satélite).
2. Parar o robô: `sync_cron_desligar.sql`.
3. Desfazer alterações: `sync_log.detalhe` guarda as ações por pessoa; contas criadas ficam em `adm_sync_links` (origem `criado_pela_sync`).
4. Remover a estrutura: `supabase/rollback/20261011120000_sync_satelites.sql` (ADM) e `supabase/rollback/20261011120000_adm_sync_receptor.sql` (satélites).

## Secrets
- ADM `sync-satelites`: `SYNC_INTERNAL_SECRET`, `ESTUDO_SYNC_URL`, `ESTUDO_SYNC_SECRET`, `VISITA_SYNC_URL`, `VISITA_SYNC_SECRET`. Vault: `sync_satelites_url`, `sync_internal_secret`.
- Satélites `adm-sync-apply`: `ADM_SYNC_SECRET` (= `*_SYNC_SECRET` do ADM, ≥32 caracteres), `ADM_SYNC_SECRET_NEXT` (troca), `ADM_SYNC_MODE`, `ADM_SYNC_ALLOWED_ORGS`.
- A chave service_role de cada banco nunca sai do próprio projeto.

## Testes
- ADM: `vitest run src/lib/sync-satelites.test.ts`; integração no homolog: `psql -f supabase/tests/sync_satelites.sql` (termina em ROLLBACK).
- Satélites: `node --test supabase/functions/adm-sync-apply/*.test.ts`.
