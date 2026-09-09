"""Local SQL harness from effective catalogs; synthetic identity, no network in test path."""
import json,pathlib,os,subprocess,sys
BASE=pathlib.Path(os.environ.get('ADM_SALE_TEST_WORKSPACE', pathlib.Path(__file__).parent)).resolve()
ROOT=BASE/'pg-root'
ENV={**os.environ,'LD_LIBRARY_PATH':str(ROOT/'usr/lib/x86_64-linux-gnu')}
PSQL=[str(ROOT/'usr/lib/postgresql/18/bin/psql'),'-X','-q','-h',str(ROOT/'tmp'),'-p','55432','-U','postgres','-v','ON_ERROR_STOP=1','-At']
def sql(text):
 r=subprocess.run(PSQL,input=text,text=True,env=ENV,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr+'\nSQL excerpt: '+text[:350])
 return r.stdout.strip()
def cat(name): return json.loads((BASE/f'catalog-{name}.json').read_text())
def ident(s): return '"'+s.replace('"','""')+'"'
def quote(s): return "'"+s.replace("'","''")+"'"
def setup():
 sql("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; CREATE SCHEMA auth; DROP SCHEMA IF EXISTS storage CASCADE; CREATE SCHEMA storage;")
 for role in ['authenticated','anon','service_role']:
  sql(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') THEN CREATE ROLE {role} NOLOGIN; END IF; END $$;")
 sql("CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '{}'::jsonb$$; GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon;")
 enums=cat('enums'); names={(e['nspname'],e['typname']) for e in enums}
 for schema,name in sorted(names):
  sql(f'CREATE TYPE {schema}.{ident(name)} AS ENUM ('+','.join(quote(e['enumlabel']) for e in enums if (e['nspname'],e['typname'])==(schema,name))+');')
 columns=cat('columns'); tables={(c['table_schema'],c['table_name']) for c in columns}
 # Storage internal service schemas are not needed; only objects and buckets carry app policies.
 tables={t for t in tables if t[0]=='public' or t[1] in ['objects','buckets']}
 for schema,table in sorted(tables):
  defs=[]
  for c in columns:
   if (c['table_schema'],c['table_name'])!=(schema,table): continue
   typ=c['data_type']
   if typ=='USER-DEFINED': typ=schema+'.'+ident(c['udt_name'])
   if typ=='ARRAY': typ=ident(c['udt_name'][1:])+'[]'
   default=c['column_default']
   if default and ('nextval' in default or ('storage.' in default and '(' in default)): default=None
   defs.append(ident(c['column_name'])+' '+typ+(' DEFAULT '+default if default else '')+(' NOT NULL' if c['is_nullable']=='NO' else ''))
  sql(f'CREATE TABLE {schema}.{ident(table)} ('+','.join(defs)+');')
 # Real constraints, including FK to minimal synthetic auth.users, excluding storage service internals.
 constraints=cat('constraints')
 for k in sorted(constraints,key=lambda k: ('FOREIGN KEY' in k['definition'],k['conname'])):
  if (k['nspname'],k['relname']) in tables and not k['definition'].startswith('TRIGGER'):
   sql(f"ALTER TABLE {k['nspname']}.{ident(k['relname'])} ADD CONSTRAINT {ident(k['conname'])} {k['definition']};")
 functions=cat('functions')
 sql('SET check_function_bodies=off;\n'+';\n'.join(f['definition'] for f in functions)+';')
 for schema,table in tables:
  sql(f'ALTER TABLE {schema}.{ident(table)} ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON {schema}.{ident(table)} TO authenticated;')
 for p in cat('policies'):
  if (p['schemaname'],p['tablename']) not in tables: continue
  roles=','.join(ident(r) if r!='public' else 'PUBLIC' for r in p['roles'].strip('{}').split(','))
  sql(f"CREATE POLICY {ident(p['policyname'])} ON {p['schemaname']}.{ident(p['tablename'])} AS {p['permissive']} FOR {p['cmd']} TO {roles}"+(f" USING ({p['qual']})" if p['qual'] else '')+(f" WITH CHECK ({p['with_check']})" if p['with_check'] else '')+';')
 for t in cat('triggers'):
  sql(t['definition']+';')
 print('BOOTSTRAP PASS',len(tables),'tables;',len(functions),'effective functions;',len(cat('triggers')),'effective triggers')
if __name__=='__main__':
 if sys.argv[1:] == ['--setup']: setup()
 else:
  for file in sys.argv[1:]: print(sql(pathlib.Path(file).read_text()))
