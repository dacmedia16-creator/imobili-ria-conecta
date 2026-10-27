#!/usr/bin/env bash
# Teste local (Postgres descartável em docker) da migration 20261027120000_leads_ia_redige + rollback (t_7b59589c).
# Não toca produção. Cria tabelas mínimas, aplica, confere padrão desligado e o contador, desfaz, confere.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-redige-t7b59
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=teste -p 127.0.0.1:55759:5432 postgres:16-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 40); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 0.5; done
sleep 1
P() { docker exec -i "$NOME" psql -v ON_ERROR_STOP=1 -U postgres -q -At "$@"; }
P <<'SQL'
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE TABLE public.organizations (id uuid PRIMARY KEY);
CREATE TABLE public.lead_config (organization_id uuid PRIMARY KEY, ia_ativa boolean NOT NULL DEFAULT false);
CREATE TABLE public.lead_ia_uso (id bigserial PRIMARY KEY, organization_id uuid NOT NULL, conversa_id uuid,
  provedor text NOT NULL, modelo text NOT NULL, ok boolean NOT NULL, fallback boolean NOT NULL DEFAULT false,
  erro text, tokens_entrada integer, tokens_saida integer, custo_usd numeric(12,8), created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.organizations VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.lead_config VALUES ('00000000-0000-0000-0000-00000000000a', true), ('00000000-0000-0000-0000-00000000000b', true);
INSERT INTO public.lead_ia_uso (organization_id, provedor, modelo, ok) VALUES ('00000000-0000-0000-0000-00000000000a', 'gemini', 'x', true);
SQL
P < supabase/migrations/20261027120000_leads_ia_redige.sql
P < supabase/migrations/20261027120000_leads_ia_redige.sql # idempotente
echo "padrao desligado (esperado 0): $(P -c "select count(*) from public.lead_config where ia_redige")"
echo "uso antigo virou 'entender' (esperado entender|f): $(P -c "select uso||'|'||bloqueado from public.lead_ia_uso where id=1")"
P <<'SQL'
INSERT INTO public.lead_ia_uso (organization_id, conversa_id, provedor, modelo, ok, uso, bloqueado, bloqueio, custo_usd) VALUES
 ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'openrouter', 'google/gemini-3.8-flash', true, 'redigir', false, NULL, 0.0015),
 ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'openrouter', 'google/gemini-3.8-flash', true, 'redigir', true, 'valor', 0.0014);
SQL
echo "contador (esperado 2|1|2): $(P -c "select redigidas||'|'||bloqueadas||'|'||conversas from public.lead_ia_redacao_resumo where organization_id='00000000-0000-0000-0000-00000000000a'")"
if P -c "insert into public.lead_ia_uso (organization_id, provedor, modelo, ok, bloqueio) values ('00000000-0000-0000-0000-00000000000a','gemini','x',true,'texto livre com conteúdo')" 2>/dev/null; then echo "FALHA: aceitou conteúdo no bloqueio"; exit 1; else echo "bloqueio com conteúdo recusado: ok"; fi
P < docs/sql/rollback/20261027120000_leads_ia_redige.rollback.sql
echo "depois do rollback, colunas novas (esperado 0): $(P -c "select count(*) from information_schema.columns where table_name in ('lead_config','lead_ia_uso') and column_name in ('ia_redige','uso','bloqueado','bloqueio')")"
echo "uso antigo preservado (esperado 3): $(P -c "select count(*) from public.lead_ia_uso")"
P < supabase/migrations/20261027120000_leads_ia_redige.sql
echo "reaplicar depois do rollback: ok"
