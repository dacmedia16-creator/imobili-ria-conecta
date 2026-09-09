#!/usr/bin/env node
/** Local-only SQL/RLS integration test. No env files, credentials or network calls.
 * Install @electric-sql/pglite@0.5.8 OUTSIDE the repo, then run:
 * node scripts/test-relatorio-ocorrencias-sql.mjs /path/to/catalog-directory
 * PGLITE_MODULE may point to an already approved installation (default below).
 * Catalogs: effective columns/policies/helpers. Any missing supplemental helper
 * comes from a versioned migration and is counted separately in the result.
 * Fixture models catalog columns, ID keys and RLS, not all constraints/triggers,
 * Supabase JWT/PostgREST, storage, grants, or downstream tables/policies.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = process.argv[2];
assert.ok(catalogDir, 'Provide the directory of the collected catalogs');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE || resolve(catalogDir, 'sql-test/node_modules/@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite();
let checks = 0;
let versionedSupplementalHelpers = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const read = (path) => readFile(path, 'utf8');
const migrationPath = resolve(repo, 'supabase/migrations/20260909193000_relatorio_ocorrencias_concluidas.sql');
const columns = JSON.parse(await read(resolve(catalogDir, 'catalog-columns.json')));
const policies = JSON.parse(await read(resolve(catalogDir, 'catalog-policies.json')));
const effectiveFunctions = JSON.parse(await read(resolve(catalogDir, 'catalog-functions.json')));
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const ident = (s) => `"${s.replaceAll('"', '""')}"`;
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const tables = [...new Set(columns.map(c => c.table_name))].sort();
const types = await read(resolve(repo, 'src/integrations/supabase/types.ts'));
const constants = types.slice(types.indexOf('export const Constants'));
const enumValues = (name) => [...constants.match(new RegExp(`${name}: \\[([\\s\\S]*?)\\]`))[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
const allowedRoles = ['corretor', 'gestor', 'team_leader', 'financeiro', 'admin', 'super_admin', 'juridico', 'lancamento'];
for (const role of allowedRoles) check(enumValues('app_role').includes(role), `versioned role ${role}`);
check(!columns.some(c => /tenant|organization|company|imobiliaria_id/.test(c.column_name)), 'no tenant key in collected source tables');

async function loadVersionedFunction(name, filename) {
  versionedSupplementalHelpers++;
  const sql = await read(resolve(repo, 'supabase/migrations', filename));
  const start = sql.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, 'i'));
  assert.ok(start >= 0, name);
  const part = sql.slice(start);
  const delimiter = part.match(/\bAS\s+(\$[a-z_]*\$)/i)[1];
  const end = part.indexOf(delimiter, part.indexOf(delimiter) + delimiter.length) + delimiter.length;
  await db.exec(part.slice(0, end) + ';');
}
async function asActor(actor, action) {
  await db.exec('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actor.id || '']);
    await db.exec(`SET LOCAL ROLE ${ident(actor.dbRole || 'authenticated')}`);
    return await action();
  } finally { await db.exec('ROLLBACK'); }
}
async function result(actor, sql) {
  try {
    return await asActor(actor, async () => {
      const r = await db.query(sql);
      return { rows: r.rows, affectedRows: r.affectedRows };
    });
  } catch (e) {
    // Unexpected fixture failures must not masquerade as authorization denials.
    if (e.code !== '42501') throw e;
    return { denied: e.code };
  }
}
const rpc = (actor) => asActor(actor, async () => (await db.query('SELECT public.relatorio_ocorrencias_concluidas() AS payload')).rows[0].payload);
async function deny(actor) {
  await assert.rejects(() => rpc(actor), e => e.code === '42501', actor.name);
  checks++;
}
async function state() {
  return {
    policies: (await db.query('SELECT * FROM pg_policies ORDER BY schemaname, tablename, policyname')).rows,
    relations: (await db.query("SELECT relname, relrowsecurity, relforcerowsecurity, relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r' ORDER BY relname")).rows,
    helpers: (await db.query("SELECT p.proname, pg_get_functiondef(p.oid) AS definition, p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth') AND p.proname <> 'relatorio_ocorrencias_concluidas' ORDER BY n.nspname, p.proname")).rows,
    data: await Promise.all(tables.map(async t => [t, (await db.query(`SELECT to_jsonb(t) AS row FROM public.${ident(t)} t ORDER BY to_jsonb(t)::text`)).rows])),
  };
}

try {
  await db.exec(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE public_probe NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, public_probe;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.app_role AS ENUM (${enumValues('app_role').map(q).join(',')});
    CREATE TYPE public.sale_status AS ENUM (${enumValues('sale_status').map(q).join(',')});`);
  for (const table of tables) {
    const defs = columns.filter(c => c.table_name === table).map(c => {
      const type = c.data_type === 'USER-DEFINED' ? (table === 'user_roles' ? 'public.app_role' : 'public.sale_status') : c.data_type;
      return `${ident(c.column_name)} ${type}${c.column_name === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`;
    });
    if (table === 'team_co_leaders') defs.push('PRIMARY KEY (team_id,user_id)');
    await db.exec(`CREATE TABLE public.${ident(table)} (${defs.join(',')}); ALTER TABLE public.${ident(table)} ENABLE ROW LEVEL SECURITY; GRANT SELECT, INSERT, UPDATE, DELETE ON public.${ident(table)} TO authenticated;`);
  }
  // Dependency of effective can_view_sale/sales_select. Not part of collected catalog:
  // empty, RLS enabled with no policies; no synthetic helper return values.
  await db.exec('CREATE TABLE public.sale_commission_extras(sale_id uuid,user_id uuid); ALTER TABLE public.sale_commission_extras ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.sale_commission_extras TO authenticated; SET check_function_bodies=off;');
  for (const f of effectiveFunctions) await db.exec(f.definition + ';');
  for (const [name, filename] of [
    ['has_any_role','20260630234432_402b303f-6c36-4705-8df5-ca347531757b.sql'],
    ['is_sale_locked','20260702035842_868455b0-6ede-4512-824c-cc1dc77565e0.sql'],
    ['leads_team_or_parent','20260804210000_add_team_co_leaders.sql'],
    ['sees_own_team_leader','20260804210000_add_team_co_leaders.sql'],
    ['sees_team','20260721190000_fix_teams_rls_recursion.sql'],
    ['can_edit_sale_stage','20260825171500_gestor_edita_rascunho_equipe.sql'],
    ['can_read_principal_sale_as_co_leader','20260908202500_co_leader_read_principal_sales.sql'],
  ]) if (!effectiveFunctions.some(f => f.proname === name)) await loadVersionedFunction(name, filename);
  await db.exec('SET check_function_bodies=on');
  for (const p of policies) {
    assert.equal(p.schemaname, 'public');
    const roles = p.roles.slice(1, -1).split(',').map(ident).join(',');
    await db.exec(`CREATE POLICY ${ident(p.policyname)} ON public.${ident(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${roles}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''};`);
  }
  const actors = allowedRoles.map((role, i) => ({ name: role, id: uuid(i+1) }));
  actors.push(
    {name:'inactive',id:uuid(20)}, {name:'missing-profile',id:uuid(21)},
    {name:'no-role',id:uuid(22)}, {name:'null-active',id:uuid(23)},
    {name:'legacy-coordenador',id:uuid(24)}, {name:'null-uid',id:null},
    {name:'anon',id:null,dbRole:'anon'}, {name:'public-execute',id:uuid(1),dbRole:'public_probe'},
  );
  for (const [i, actor] of actors.entries()) {
    if (!actor.id || actor.name === 'missing-profile' || actor.name === 'public-execute') continue;
    await db.query('INSERT INTO public.profiles(id,nome,ativo,email,telefone) VALUES ($1,$2,$3,$4,$5)', [actor.id, `Pessoa sintética ${i}`, actor.name === 'null-active' ? null : actor.name !== 'inactive', 'SECRET_EMAIL', 'SECRET_PHONE']);
  }
  for (const [i, role] of allowedRoles.entries()) await db.query('INSERT INTO public.user_roles(user_id,role) VALUES ($1,$2)', [uuid(i+1),role]);
  for (const id of [20,21,23]) await db.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'corretor')", [uuid(id)]);
  await db.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'coordenador')", [uuid(24)]);
  // Multiple roles must not duplicate a profile. Role-less historical owner and structural people.
  await db.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'gestor')", [uuid(1)]);
  for (const id of [30,31,32,33,34]) await db.query('INSERT INTO public.profiles(id,nome,ativo,email) VALUES ($1,$2,false,$3)', [uuid(id), `Histórico ${id}`, 'SECRET_HISTORY']);
  await db.exec(`INSERT INTO public.teams(id,nome,lider_id,parent_team_id,cor) VALUES
    (${q(uuid(100))},'Equipe A',${q(uuid(2))},NULL,'SECRET_COLOR'),
    (${q(uuid(101))},'Equipe B',${q(uuid(31))},${q(uuid(100))},'SECRET_COLOR'),
    (${q(uuid(102))},'Equipe C',${q(uuid(3))},NULL,'SECRET_COLOR');
    INSERT INTO public.team_members(membro_id,team_id,tipo) VALUES (${q(uuid(1))},${q(uuid(100))},'corretor'), (${q(uuid(33))},${q(uuid(101))},'corretor'), (${q(uuid(33))},${q(uuid(101))},'corretor');
    INSERT INTO public.team_co_leaders(user_id,team_id) VALUES (${q(uuid(32))},${q(uuid(101))}), (${q(uuid(3))},${q(uuid(100))});`);
  for (const [id, owner, status] of [[200,30,'ocorrencia_concluida'],[201,1,'rascunho'],[202,3,'rascunho'],[203,30,'ocorrencia_concluida']]) {
    await db.query('INSERT INTO public.sales(id,corretor_id,status,codigo_interno,imovel_id,modalidade,parceria_cpf_cnpj,parceria_pix,imovel_endereco) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uuid(id),uuid(owner),status,`COD-${id}`,`IMOVEL-${id}`,'usado','SECRET_CPF','SECRET_PIX','SECRET_ADDRESS']);
  }
  for (const [id, sale, status, value, date] of [[300,200,'concluida',1000,'2026-08-01'],[301,200,'concluida',null,null],[302,201,'pendente',2000,'2026-09-01'],[303,202,'analise_financeiro',3000,'2026-09-02'],[304,203,'devolvida_gestor',4000,null]]) {
    await db.query('INSERT INTO public.occurrences(id,sale_id,status,valor_comissao,data_assinatura,observacoes,financiamento_banco) VALUES ($1,$2,$3,$4,$5,$6,$7)', [uuid(id),uuid(sale),status,value,date,'SECRET_OBS','SECRET_BANK']);
  }
  check((await db.query('SELECT public.is_active_user($1) AS active',[uuid(21)])).rows[0].active, 'effective old helper allows missing profile; RPC must not');
  await assert.rejects(() => rpc(actors[0]), e => e.code === '42883'); checks++;
  console.log('RED verified: RPC absent (42883) before migration');
  const before = await state();
  const inserts = {
    occurrences:`(id,sale_id,status) VALUES (${q(uuid(900))},${q(uuid(202))},'pendente')`,
    sales:`(id,corretor_id,status) VALUES (${q(uuid(900))},${q(uuid(3))},'rascunho')`,
    profiles:`(id,nome,ativo) VALUES (${q(uuid(900))},'Synthetic insert',true)`,
    teams:`(id,nome,lider_id) VALUES (${q(uuid(900))},'Synthetic team',${q(uuid(3))})`,
    team_members:`(id,membro_id,team_id) VALUES (${q(uuid(900))},${q(uuid(22))},${q(uuid(102))})`,
    team_co_leaders:`(user_id,team_id) VALUES (${q(uuid(22))},${q(uuid(102))})`,
    user_roles:`(id,user_id,role) VALUES (${q(uuid(900))},${q(uuid(22))},'corretor')`,
  };
  async function directMatrix() {
    const matrix = {};
    for (const actor of actors) for (const table of tables) {
      const key = table === 'team_co_leaders' ? 'team_id' : 'id';
      for (const [op, sql] of Object.entries({
        select:`SELECT to_jsonb(t) AS row FROM public.${ident(table)} t ORDER BY to_jsonb(t)::text`,
        update:`UPDATE public.${ident(table)} SET ${key}=${key} RETURNING ${key}`,
        delete:`DELETE FROM public.${ident(table)} RETURNING ${key}`,
        insert:`INSERT INTO public.${ident(table)} ${inserts[table]} RETURNING ${key}`,
      })) matrix[`${actor.name}/${table}/${op}`] = await result(actor, sql);
    }
    return matrix;
  }
  const baseline = await directMatrix();
  check(baseline['corretor/occurrences/select'].rows.every(r => r.row.id !== uuid(300)), 'cross-team completed occurrence is hidden directly');
  check(baseline['admin/occurrences/update'].rows.length > 0, 'positive write control');
  const migration = await read(migrationPath);
  await db.exec(migration);
  equal(await state(), before, 'migration preserves data, policies, table privileges/RLS and helpers');
  const expected = {
    occs: ['id','sale_id','valor_comissao','data_assinatura'], sales:['id','codigo_interno','imovel_id','corretor_id'],
    profiles:['id','nome'], teams:['id','nome','parent_team_id','lider_id'], members:['membro_id','team_id'], coLeaders:['user_id','team_id'],
  };
  let canonical;
  for (const actor of actors.slice(0,allowedRoles.length)) {
    const payload = await rpc(actor);
    equal(Object.keys(payload).sort(),Object.keys(expected).sort(),`${actor.name}: exact envelope`);
    for (const [key, fields] of Object.entries(expected)) {
      check(Array.isArray(payload[key]), `${key} is array`);
      for (const row of payload[key]) equal(Object.keys(row).sort(),fields.toSorted(), `${key} allowlist`);
      equal(new Set(payload[key].map(row => row.id || JSON.stringify(row))).size,payload[key].length, `${key} unique`);
    }
    if (canonical) equal(payload,canonical,`${actor.name}: same authorized dataset`);
    canonical = payload;
    check(!JSON.stringify(payload).includes('SECRET_'),'no sensitive sentinels');
  }
  equal(canonical.occs.map(o=>o.id),[uuid(300),uuid(301)],'only completed occurrences');
  equal(canonical.sales.map(s=>s.id),[uuid(200)],'sales linked via occurrence status, unique despite multiple occurrences');
  equal(canonical.occs[1].data_assinatura,null,'no date fallback');
  equal(canonical.occs[1].valor_comissao,null,'preserve commission null');
  equal(canonical.profiles.map(p=>p.id),[1,2,3,8,20,23,30,31,32,33].map(uuid),'canonical roles plus inactive historical owner/leader/co-leader/member; unrelated excluded');
  equal(canonical.teams.length,3,'whole canonical hierarchy');
  equal(canonical.members.length,2,'deduplicate canonical links');
  equal(canonical.coLeaders.length,2,'whole co-leader links');
  for (const actor of actors.slice(allowedRoles.length)) await deny(actor);
  // Even a forged sub cannot override SQL ACL for anon.
  await deny({name:'anon-with-sub',id:uuid(1),dbRole:'anon'});
  await assert.rejects(() => asActor(actors[0],()=>db.query('SELECT public.relatorio_ocorrencias_concluidas($1::uuid)',[uuid(5)])), e=>e.code==='42883'); checks++;
  const metadata = (await db.query("SELECT prosecdef, provolatile, pronargs, proconfig, pg_get_function_result(oid) AS result FROM pg_proc WHERE oid='public.relatorio_ocorrencias_concluidas()'::regprocedure")).rows[0];
  equal(metadata,{prosecdef:true,provolatile:'s',pronargs:0,proconfig:['search_path=""'],result:'jsonb'},'security definer stable empty search path no args');
  const afterMatrix = await directMatrix();
  equal(afterMatrix,baseline,'every direct SELECT/INSERT/UPDATE/DELETE unchanged across all actors/tables');
  equal(await state(),before,'RPC/matrix have no persistent side effects');
  await db.exec('BEGIN');
  for (const t of ['occurrences','sales','team_members','team_co_leaders','teams','user_roles']) await db.exec(`DELETE FROM public.${ident(t)}`);
  await db.query("INSERT INTO public.user_roles(user_id,role) VALUES ($1,'financeiro')",[uuid(4)]);
  await db.query('DELETE FROM public.profiles WHERE id<>$1',[uuid(4)]);
  // Cannot nest asActor transaction here: identity set directly inside this rollback scope.
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uuid(4)]);
  await db.exec('SET LOCAL ROLE authenticated');
  equal((await db.query('SELECT public.relatorio_ocorrencias_concluidas() AS payload')).rows[0].payload, Object.fromEntries(Object.keys(expected).map(k=>[k,[]])), 'all empty arrays, no nulls');
  await db.exec('ROLLBACK');
  await db.exec('DROP FUNCTION public.relatorio_ocorrencias_concluidas()');
  await assert.rejects(()=>rpc(actors[0]),e=>e.code==='42883'); checks++;
  equal(await state(),before,'rollback DROP RPC restores original catalog/data');
  equal(await directMatrix(),baseline,'rollback restores direct permission matrix');
  console.log(JSON.stringify({status:'PASS',checks,actors:actors.length,directOperationsPerPhase:Object.keys(baseline).length,phases:['before','after','rollback'],effectivePolicies:policies.length,effectiveHelpers:effectiveFunctions.length,versionedSupplementalHelpers,postgres:(await db.query('SELECT version() AS version')).rows[0].version,limits:'Synthetic fixture; not full constraints/triggers/grants, JWT/PostgREST, storage, or downstream policies. No remote access.'},null,2));
} finally { await db.close(); }
