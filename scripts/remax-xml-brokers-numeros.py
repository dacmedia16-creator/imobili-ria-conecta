#!/usr/bin/env python3
"""Contagens do cruzamento corretor do XML -> perfil (migration 20261016210000, t_e8265cce). Saída: SÓ NÚMEROS.

Roda a regra SQL de verdade (remax_xml_ingest + gatilho de cruzamento) num Postgres LOCAL descartável com o
schema de produção, dentro de BEGIN/ROLLBACK. Nunca aponte para produção.

Entradas (somente leitura):
  --xml       arquivo VRSync (ex.: feed781.xml)
  --perfis    linhas 'P|<uuid>|<remax_id>|<md5 email_key>|<md5 tel_key>' dos perfis ativos da imobiliária
              (consulta só-leitura que já sai com hash; ver docs/remax-xml-feed.md)
  --container nome do container local com psql (padrão t-e826-pg)
  --migrations arquivos .sql das migrations 20261016200000 e 20261016210000

Privacidade: e-mail e telefone do XML viram a mesma chave normalizada da migration e são trocados por valores
fictícios (um por chave), iguais dos dois lados. Nenhum nome, e-mail ou telefone vai para o banco ou para a saída.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys


def tag(name, s):
    m = re.search(r'<%s[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</%s>' % (name, name), s, re.S)
    return m.group(1).strip() if m else None


def email_key(e):
    k = re.sub(r'\s', '', e or '').lower()
    return k or None


def tel_key(t):  # igual a public.remax_tel_key
    x = re.sub(r'\D', '', t or '').lstrip('0')
    d = x[2:] if len(x) in (12, 13) and x.startswith('55') else x
    e = d[:2] + d[3:] if len(d) == 11 and d[2] == '9' else d
    return e if len(e) == 10 else None


md5 = lambda v: hashlib.md5(v.encode()).hexdigest()


class Fake:
    """Hash da chave -> valor fictício estável (e-mail ou telefone)."""
    def __init__(self):
        self.mail, self.tel = {}, {}

    def m(self, h):
        return None if not h else self.mail.setdefault(h, 'u%05d@x.invalid' % len(self.mail))

    def t(self, h):
        return None if not h else self.tel.setdefault(h, '19%08d' % len(self.tel))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--xml', required=True)
    ap.add_argument('--perfis', required=True)
    ap.add_argument('--container', default='t-e826-pg')
    ap.add_argument('--migrations', nargs='+', required=True)
    a = ap.parse_args()

    fk = Fake()
    perfis = []
    for ln in open(a.perfis):
        p = ln.rstrip('\n').split('|')
        if len(p) == 5 and p[0] == 'P':
            perfis.append(dict(id=p[1], remax_id=p[2] or None, email=fk.m(p[3]), telefone=fk.t(p[4])))

    s = open(a.xml, encoding='utf-8-sig').read()
    listings = []
    for it in re.findall(r'<Listing>(.*?)</Listing>', s, re.S):
        if tag('TransactionType', it) != 'For Sale':
            continue
        ci = tag('ContactInfo', it) or ''
        e, t = email_key(tag('Email', ci)), tel_key(tag('Telephone', ci))
        listings.append(dict(code=tag('ListingID', it) or '', corretor_nome='x',
                             corretor_email=fk.m(md5(e) if e else None), corretor_telefone=fk.t(md5(t) if t else None)))
    del s

    mig = ''.join(open(f).read() for f in a.migrations)
    mig = '\n'.join(l for l in mig.splitlines() if not re.match(r'^(BEGIN|COMMIT|ROLLBACK);\s*$', l))
    lit = lambda v: "$J$" + v + "$J$"
    sql = f"""\\set ON_ERROR_STOP 1
SET client_min_messages = warning;
BEGIN;
{mig}
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE _o AS SELECT gen_random_uuid() id;
INSERT INTO public.organizations (id, slug, nome, status) SELECT id, 'num-' || left(id::text, 8), 'Num', 'ativa' FROM _o;
INSERT INTO public.profiles (id, nome, email, telefone, ativo, organization_id, remax_id)
  SELECT p.id, 'p', p.email, p.telefone, true, (SELECT id FROM _o), p.remax_id
    FROM jsonb_to_recordset({lit(json.dumps(perfis))}::jsonb) p(id uuid, remax_id text, email text, telefone text);
SET LOCAL session_replication_role = origin;
SELECT public.remax_xml_ingest((SELECT id FROM _o), {lit(json.dumps(listings))}::jsonb, {len(listings)}, now()) IS NOT NULL;
CREATE TEMP TABLE _m AS SELECT * FROM public.remax_xml_broker_match((SELECT id FROM _o));
SELECT 'N|' || json_build_object(
  'perfis_ativos', (SELECT count(*) FROM public.profiles WHERE organization_id = (SELECT id FROM _o)),
  'anuncios_venda', (SELECT count(*) FROM public.remax_xml_listings WHERE organization_id = (SELECT id FROM _o)),
  'corretores_xml', (SELECT count(*) FROM _m),
  'ligados_por_id', (SELECT count(*) FROM _m WHERE via = 'id'),
  'ligados_por_email', (SELECT count(*) FROM _m WHERE via = 'email'),
  'ligados_por_telefone', (SELECT count(*) FROM _m WHERE via = 'telefone'),
  'em_conflito', (SELECT count(*) FROM _m WHERE via = 'conflito'),
  'sem_correspondencia', (SELECT count(*) FROM _m WHERE via = 'sem_cadastro'),
  'avisos_com_vinculo', (SELECT count(*) FROM public.remax_xml_broker_revisao r JOIN _m ON _m.agent_id = r.agent_id
                          WHERE r.organization_id = (SELECT id FROM _o) AND _m.profile_id IS NOT NULL),
  'anuncios_com_corretor_ligado', (SELECT count(*) FROM public.remax_xml_listings l JOIN _m ON _m.agent_id = l.agent_id
                          WHERE l.organization_id = (SELECT id FROM _o) AND _m.profile_id IS NOT NULL),
  'conflitos_por_motivo', (SELECT coalesce(json_object_agg(motivo, n), '{{}}') FROM (SELECT motivo, count(*) n
     FROM public.remax_xml_broker_revisao r JOIN _m ON _m.agent_id = r.agent_id
    WHERE r.organization_id = (SELECT id FROM _o) AND _m.profile_id IS NULL GROUP BY motivo) z));
ROLLBACK;
"""
    r = subprocess.run(['docker', 'exec', '-i', a.container, 'psql', '-U', 'supabase_admin', '-d', 'postgres',
                        '-X', '-q', '-At'], input=sql, capture_output=True, text=True)
    out = [l[2:] for l in r.stdout.splitlines() if l.startswith('N|')]
    if r.returncode != 0 or not out:
        # erro do psql pode citar valores: mostra só a primeira linha, sem trecho de dado
        print('falhou (psql %s): %s' % (r.returncode, (r.stderr.splitlines() or ['?'])[0][:120]), file=sys.stderr)
        sys.exit(1)
    print(json.dumps(json.loads(out[0]), indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
