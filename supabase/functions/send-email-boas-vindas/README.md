# send-email-boas-vindas

E-mail de boas-vindas do MAX HUB para o usuário que a imobiliária cadastra no ADM MAX.
**Tudo nasce DESLIGADO** (`email_config.boas_vindas_mode = 'off'`).

## Como funciona

1. Cadastro → INSERT em `public.profiles` → o gatilho `trg_zz_email_boas_vindas` só **anota** uma linha em
   `public.email_outbox`. Ele nunca chama a internet e engole qualquer erro: **o cadastro nunca falha por causa do e-mail**.
   Só anota se a chave não estiver `off` e o usuário tiver nascido depois de `boas_vindas_desde` (sem disparo para os antigos).
2. O pg_cron chama `public.email_disparar()` a cada minuto. Se houver pendência, ele chama esta Edge Function.
3. A função pega os pendentes, lê nome, e-mail e imobiliária **na hora**, monta o e-mail (HTML + texto, modelo único
   em `../_shared/email-boas-vindas/`) e envia pelo SMTP do Zoho (`smtppro.zoho.com:465`, SSL), com o remetente
   `MAX HUB <no-reply@somosmaxhub.com.br>`.
4. **No máximo 1 e-mail por usuário**: `unique (user_id, tipo)` em `email_outbox`. Se o envio falhar, o erro é
   gravado já mascarado, e há nova tentativa em 1, 5, 30 e 30 min. Na 5ª falha, o status vira `falhou`.
   Item travado em `processando` por mais de 15 min vira `falhou` e não é reenviado sozinho.

Modos da chave: `off` (nada), `dry_run` (monta e grava `simulado`, sem enviar) e `live` (envia).

## Segredos (projeto Supabase, nunca no código)

| Onde              | Nome                        | Conteúdo                                                        |
| ----------------- | --------------------------- | --------------------------------------------------------------- |
| Secrets da função | `BOAS_VINDAS_ZOHO_USER`     | `no-reply@somosmaxhub.com.br`                                   |
| Secrets da função | `BOAS_VINDAS_ZOHO_PASSWORD` | senha de aplicativo do Zoho (já cadastrada)                     |
| Secrets da função | `EMAIL_INTERNAL_SECRET`     | segredo aleatório (≥ 32 caracteres), só para o cron             |
| Vault do banco    | `email_boas_vindas_url`     | `https://<ref>.supabase.co/functions/v1/send-email-boas-vindas` |
| Vault do banco    | `email_internal_secret`     | mesmo valor de `EMAIL_INTERNAL_SECRET`                          |

## Teste (só para a allowlist; funciona com a chave desligada)

A allowlist fica em `email_config.allowlist` (padrão: `{dacmedia16@gmail.com}`). Nenhum outro destino é aceito.

```bash
# dados fictícios, para o 1º e-mail da allowlist (cada chamada = 1 envio)
curl -X POST https://<ref>.supabase.co/functions/v1/send-email-boas-vindas \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
  -d '{"acao":"teste","nome":"Denis","imobiliaria":"REMAX - TESTE"}'
# usuário real cujo e-mail está na allowlist (1 vez só; a 2ª chamada responde "ja_enviado")
  -d '{"acao":"teste","user_id":"<uuid>"}'
```

## Ligar (só com OK do Denis)

1. Aplicar a migration `20261020180000_email_boas_vindas_envio.sql` e publicar a função.
2. Criar `EMAIL_INTERNAL_SECRET` e os 2 segredos do Vault (tabela acima).
3. Rodar `supabase/scripts/email_cron_ligar.sql`: grava `boas_vindas_desde = now()`, põe a chave em `live`
   e agenda o cron. Para homologar primeiro, troque `live` por `dry_run`.

## Desligar (efeito imediato, o log é preservado)

```sql
update public.email_config set boas_vindas_mode = 'off' where id;
```

Ou rode `supabase/scripts/email_cron_desligar.sql`, que também tira o cron.
Para remover tudo (apaga o log), use `supabase/rollback/20261020180000_email_boas_vindas_envio.sql`.

## Reenviar manualmente (decisão humana)

```sql
select public.email_reenviar_boas_vindas('<user_id>');  -- volta para a fila; o robô envia na próxima rodada
```

Com a chave `off`, o item fica na fila até ligar. Para mandar na hora, use `{"acao":"processar"}` com a chave
`live`.

## Onde ver o log de envios

```sql
select id, user_id, status, tentativas, ultimo_erro, provider_message_id, origem, criado_em, enviado_em
  from public.email_outbox order by id desc limit 50;
```

Status: `pendente`, `processando`, `enviado`, `simulado`, `falhou` ou `cancelado`. O log da execução da função
fica no painel Supabase → Edge Functions → send-email-boas-vindas → Logs, sem credenciais nem e-mails.

## Testes

- `npx vitest run src/lib/email-boas-vindas` (modelo + regras de envio, SMTP simulado).
- `supabase/tests/run-email-boas-vindas-envio.sh <container-local>` (migration + regras no banco, com ROLLBACK).
