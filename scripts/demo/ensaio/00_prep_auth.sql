-- Ensaio local: completa o auth mínimo da imagem para ficar igual ao de produção (só estrutura, sem dados).
alter table auth.users add column if not exists phone text default null;
alter table auth.users add column if not exists phone_confirmed_at timestamptz;
alter table auth.users add column if not exists phone_change text default '';
alter table auth.users add column if not exists phone_change_token varchar default '';
alter table auth.users add column if not exists phone_change_sent_at timestamptz;
alter table auth.users add column if not exists confirmed_at timestamptz;
alter table auth.users add column if not exists email_change_token_current varchar default '';
alter table auth.users add column if not exists email_change_confirm_status smallint default 0;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists reauthentication_token varchar default '';
alter table auth.users add column if not exists reauthentication_sent_at timestamptz;
alter table auth.users add column if not exists is_sso_user boolean not null default false;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists is_anonymous boolean not null default false;
alter table auth.users add column if not exists email_change_token_new varchar;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create table if not exists auth.identities (
  provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  email text generated always as (lower(identity_data->>'email')) stored,
  id uuid not null default gen_random_uuid() primary key,
  unique (provider_id, provider));
create table if not exists auth.sessions (id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create schema if not exists cron;
create schema if not exists net;
create schema if not exists pgmq;
create extension if not exists pg_trgm schema extensions;
create extension if not exists unaccent schema extensions;
create extension if not exists btree_gist schema extensions;
do $$ begin if not exists (select 1 from pg_roles where rolname='mt_1b_definer') then create role mt_1b_definer nologin; end if; end $$;
-- gatilhos de auth.users iguais aos de produção (lidos via read-only em 06/11)
CREATE TRIGGER mt_2a_on_auth_user_app_metadata AFTER UPDATE OF raw_app_meta_data ON auth.users FOR EACH ROW EXECUTE FUNCTION public.mt_2a_apply_app_metadata_org();
CREATE CONSTRAINT TRIGGER mt_require_org_on_auth_user_created AFTER INSERT ON auth.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.mt_require_org_new_user();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
