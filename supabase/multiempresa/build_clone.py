#!/usr/bin/env python3
"""Gera DDL de um clone ESTRUTURAL local (sem dados) a partir do catálogo extraído em modo somente leitura.

Uso: python3 build_clone.py <dir_catalogo> > clone.sql
O catálogo e o SQL gerado ficam FORA do repositório (não commitar). Só para Postgres local descartável.
"""
import json
import sys
from pathlib import Path

CAT = Path(sys.argv[1])


def load(name):
    return json.loads((CAT / f'catalog-{name}.json').read_text())


def q(ident):
    return '"' + ident.replace('"', '""') + '"'


out = []
w = out.append

w('-- CLONE ESTRUTURAL LOCAL gerado do catálogo. NUNCA aplicar em banco remoto.')
w("SET check_function_bodies = off;")
w("SET client_min_messages = warning;")
w('CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;')
w('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;')
w('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;')

# enums
enums = {}
for e in load('enums'):
    enums.setdefault(e['typname'], []).append(e['enumlabel'])
for t, labels in enums.items():
    w(f"CREATE TYPE public.{q(t)} AS ENUM (" + ', '.join("'" + l.replace("'", "''") + "'" for l in labels) + ');')

# tables
cols = {}
for c in load('columns'):
    cols.setdefault(c['table_name'], []).append(c)
tables = load('tables')
for t in tables:
    name = t['relname']
    parts = []
    for c in sorted(cols[name], key=lambda c: c['ordinal_position']):
        d = f"  {q(c['column_name'])} {c['fmt']}"
        if c['is_generated'] == 'ALWAYS':
            d += f" GENERATED ALWAYS AS ({c['generation_expression']}) STORED"
        elif c['is_identity'] == 'YES':
            d += f" GENERATED {c['identity_generation']} AS IDENTITY"
        elif c['column_default'] is not None:
            d += f" DEFAULT {c['column_default']}"
        if c['is_nullable'] == 'NO':
            d += ' NOT NULL'
        parts.append(d)
    w(f'CREATE TABLE public.{q(name)} (\n' + ',\n'.join(parts) + '\n);')

# functions (after tables: signatures may use row types)
for f in load('functions'):
    w(f['definition'].rstrip().rstrip(';') + ';')

# constraints: p/u/c before f/x
cons = load('constraints')
order = {'p': 0, 'u': 1, 'c': 2, 'x': 3, 'f': 4}
for k in sorted((c for c in cons if c['contype'] in order), key=lambda c: order[c['contype']]):
    w(f"ALTER TABLE public.{q(k['relname'])} ADD CONSTRAINT {q(k['conname'])} {k['definition']};")

for i in load('indexes'):
    w(i['indexdef'] + ';')

for t in load('triggers'):
    w(t['definition'] + ';')
for t in load('ext_triggers'):
    if t['nspname'] == 'auth':
        w(t['definition'] + ';')

# RLS + policies
for t in tables:
    w(f"ALTER TABLE public.{q(t['relname'])} ENABLE ROW LEVEL SECURITY;")
    if t['relforcerowsecurity']:
        w(f"ALTER TABLE public.{q(t['relname'])} FORCE ROW LEVEL SECURITY;")
for p in load('policies'):
    roles = p['roles'].strip('{}')
    stmt = f"CREATE POLICY {q(p['policyname'])} ON {p['schemaname']}.{q(p['tablename'])} AS {p['permissive']} FOR {p['cmd']} TO {roles}"
    if p['qual'] is not None:
        stmt += f" USING ({p['qual']})"
    if p['with_check'] is not None:
        stmt += f" WITH CHECK ({p['with_check']})"
    w(stmt + ';')

# grants de tabela (relacl)
PRIV = {'a': 'INSERT', 'r': 'SELECT', 'w': 'UPDATE', 'd': 'DELETE', 'D': 'TRUNCATE', 'x': 'REFERENCES', 't': 'TRIGGER', 'm': 'MAINTAIN'}
for r in load('relacl'):
    if r['relkind'] != 'r':
        continue
    rel = f"public.{q(r['relname'])}"
    w(f'REVOKE ALL ON {rel} FROM anon, authenticated, service_role;')
    for item in (r['acl'] or '{}').strip('{}').split(','):
        if not item or '=' not in item:
            continue
        grantee, rest = item.split('=', 1)
        privs = rest.split('/')[0].replace('*', '')
        if grantee in ('anon', 'authenticated', 'service_role'):
            names = [PRIV[ch] for ch in privs if ch in PRIV]
            if names:
                w(f"GRANT {', '.join(names)} ON {rel} TO {grantee};")

# ACL de funções
for f in load('functions'):
    sig = f"public.{q(f['proname'])}({f['args']})"
    if f['acl'] is None:
        continue
    w(f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated, service_role;')
    for item in f['acl'].strip('{}').split(','):
        grantee = item.split('=', 1)[0]
        if grantee == '':
            w(f'GRANT EXECUTE ON FUNCTION {sig} TO PUBLIC;')
        elif grantee in ('anon', 'authenticated', 'service_role'):
            w(f'GRANT EXECUTE ON FUNCTION {sig} TO {grantee};')

# Grants por coluna não vieram no catálogo (consulta column_acl negada depois: HTTP 401). Fonte: migration
# 20260925100000_exclusive_captures.sql, coerente com relacl de profiles (authenticated sem SELECT de tabela).
w('GRANT SELECT (id, nome, email, telefone, ativo, created_at, updated_at, avatar_url, '
  'public_profile_enabled, pagina_pessoal_url, instagram_url) ON public.profiles TO authenticated;')
# Confirmado na leitura read-only da produção em 28/09/2026 (Fase 2a): além dos 11 acima, só existe
# UPDATE(enabled) para service_role (redundante com o grant de tabela, mantido por fidelidade).
w('GRANT UPDATE (enabled) ON public.exclusive_capture_settings TO service_role;')

for b in load('buckets'):
    mimes = 'NULL' if b['allowed_mime_types'] is None else "ARRAY[" + ','.join(f"'{m}'" for m in b['allowed_mime_types']) + ']'
    lim = 'NULL' if b['file_size_limit'] is None else str(b['file_size_limit'])
    w(f"INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('{b['id']}', '{b['id']}', {str(b['public']).lower()}, {lim}, {mimes});")

print('\n'.join(out))
