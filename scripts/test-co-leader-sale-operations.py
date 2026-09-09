"""Real PostgreSQL regression; catalog + synthetic case 630601093-153. No network."""
from sql_harness import sql as raw_sql,cat,BASE,quote
import json
checks=0
def uid(n): return f'00000000-0000-0000-0000-{n:012}'
def qid(n): return quote(uid(n))
def sql(text): return raw_sql(f"SET request.jwt.claim.sub = '{uid(7)}'; " + text)
def check(value,label):
 global checks
 assert value,label
 checks+=1

def actor(n,body,prepare=''):
 return sql(f"BEGIN; {prepare} SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = '{uid(n)}'; {body}; ROLLBACK;")
def denied(n,body,message,prepare=''):
 try: actor(n,body,prepare)
 except RuntimeError as e:
  check(message in str(e),f'wrong denial: {e}'); return
 raise AssertionError('Expected denial: '+body)

for n in range(1,12): sql(f"INSERT INTO auth.users(id) VALUES ({qid(n)});")
for n in range(1,12):
 if n!=6: sql(f"INSERT INTO public.profiles(id,nome,ativo) VALUES ({qid(n)},'Pessoa sintética {n}',true);")
 role={5:'corretor',7:'admin',8:'juridico'}.get(n,'gestor')
 sql(f"INSERT INTO public.user_roles(user_id,role) VALUES ({qid(n)},'{role}');")
for t,leader in [(100,1),(101,10)]: sql(f"INSERT INTO teams(id,lider_id,nome) VALUES ({qid(t)},{qid(leader)},'Equipe sintética {t}');")
for n,t in [(2,100),(3,101),(4,100),(6,100)]: sql(f"INSERT INTO team_co_leaders(team_id,user_id) VALUES ({qid(t)},{qid(n)});")
sql(f'UPDATE profiles SET ativo=false WHERE id={qid(4)};')
sql(f"INSERT INTO team_members(team_id,membro_id) VALUES ({qid(100)},{qid(5)});")
for sale,owner in [(200,1),(201,10),(202,5)]:
 sql(f"""INSERT INTO sales(id,corretor_id,codigo_interno,imovel_id,status,modalidade,valor_negociado,valor_total_comissao,
 corretor_captador,corretor_captador_id,corretor_vendedor,corretor_vendedor_id,valor_comissao_captador,valor_comissao_vendedor,valor_comissao_imobiliaria,
 contrato_libera_assinatura,previsao_recebimento_valor,previsao_recebimento_data,previsao_recebimento_forma)
 VALUES ({qid(sale)},{qid(owner)},'{"630601093-153" if sale==200 else "FIXTURE-"+str(sale)}','IMOVEL-{sale}','contrato_conferencia_gestor','padrao',100000,6000,
 'Corretor sintético',{qid(owner)},'Corretor sintético',{qid(owner)},1500,1500,3000,true,6000,'2026-10-01','pix');
 INSERT INTO sale_payment(sale_id,tipo_pagamento,entrada_valor) VALUES ({qid(sale)},'vista',100000);
 INSERT INTO sale_documents(id,sale_id,tipo,parte,status) VALUES ({qid(sale+200)},{qid(sale)},'contrato','juridico','aprovado');
 INSERT INTO sale_parties(sale_id,papel,nome) VALUES ({qid(sale)},'comprador_1','Comprador sintético'),({qid(sale)},'vendedor_1','Vendedor sintético');
 """)
sql("INSERT INTO storage.buckets(id,name) VALUES ('sale-documents','sale-documents'),('external','external');")
sql(f"INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','{uid(200)}/contrato.pdf'),('sale-documents','{uid(201)}/contrato.pdf'),('external','{uid(200)}/externo.pdf');")
# Baseline before the patch: canonical SELECT is allowed, write RPC deterministically denied.
check(actor(2,f'SELECT count(*) FROM sales WHERE id={qid(200)}')=='1','RED sale readable')
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Sem permissão para acessar esta venda')
print('RED PASS: canonical read succeeds, original signature transition denied')
baseline_functions={f['signature']:f['definition'] for f in cat('functions')}
baseline_policies=sql('SELECT row_to_json(p) FROM pg_policies p ORDER BY schemaname,tablename,policyname')
unchanged={name:sql(f'SELECT pg_get_functiondef({quote(name)}::regprocedure)') for name in ['can_view_sale(uuid,uuid)','is_lead_of(uuid,uuid)','can_edit_sale_stage(uuid,uuid)','can_edit_sale_comissao(uuid,uuid)']}
# Each direct operation uses a transaction and a synthetic actor; no business state survives.
probes={
 'other_sale_read':f'SELECT count(*) FROM sales WHERE id={qid(201)}',
 'other_sale_write':f"WITH u AS (UPDATE sales SET imovel_observacoes='attempt' WHERE id={qid(201)} RETURNING id) SELECT count(*) FROM u",
 'other_doc_read':f'SELECT count(*) FROM sale_documents WHERE sale_id={qid(201)}',
 'external_storage':"SELECT count(*) FROM storage.objects WHERE bucket_id='external'",
 'other_storage':f"SELECT count(*) FROM storage.objects WHERE name='{uid(201)}/contrato.pdf'",
 'role_write':f"WITH u AS (UPDATE user_roles SET role='admin' WHERE user_id={qid(2)} RETURNING id) SELECT count(*) FROM u",
 'team_write':f"WITH u AS (UPDATE teams SET nome='attempt' WHERE id={qid(101)} RETURNING id) SELECT count(*) FROM u",
 'sale_delete':f'WITH u AS (DELETE FROM sales WHERE id={qid(200)} RETURNING id) SELECT count(*) FROM u'
}
def probe(body):
 try: return actor(2,body)
 except RuntimeError as e:
  check(any(reason in str(e) for reason in ['policy','permiss','Você não pode alterar seu próprio papel']),'unexpected matrix error '+str(e)); return 'DENIED'
before={k:probe(v) for k,v in probes.items()}
print(sql((BASE/'repo/supabase/migrations/20260909213000_co_leader_sale_operations.sql').read_text()))
for n,expected in [(2,True),(3,False),(4,False),(6,False),(5,False),(1,True)]:
 data=json.loads(actor(n,f'SELECT sale_management_capabilities({qid(200)})'))
 check(data['can_manage']==expected, f'actor {n} effective capability')
 if n in [2,3,4,6,5]: check(data['auxiliary']==(n==2),f'actor {n} auxiliary')
check(json.loads(actor(1,f'SELECT sale_management_capabilities({qid(202)})'))['can_manage'],'principal manager member sale')
for n in [3,4,6,5]:
 denied(n,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Sem permissão para acessar esta venda')
for n,s in [(2,200),(1,202)]:
 result=actor(n,f"""UPDATE sales SET imovel_observacoes='conferido' WHERE id={qid(s)};
 UPDATE sale_parties SET nome='Parte revisada' WHERE sale_id={qid(s)} AND papel='comprador_1';
 UPDATE sale_payment SET observacoes='Pagamento conferido' WHERE sale_id={qid(s)};
 SELECT sync_occurrence_commissions({qid(s)});
 SELECT change_sale_status({qid(s)},'aguardando_assinatura');
 SELECT status||':'||imovel_observacoes FROM sales WHERE id={qid(s)};
 SELECT count(*) FROM sale_status_history WHERE sale_id={qid(s)} AND autor_id={qid(n)} AND para='aguardando_assinatura';
 SELECT count(*) FROM activity_logs WHERE sale_id={qid(s)} AND autor_id={qid(n)} AND acao='status_change';""")
 check(result.endswith('aguardando_assinatura:conferido\n1\n1'),f'actor {n} save + transition + audit: {result}')
# Guards must fail for the intended reason, not for missing test schema.
denied(2,f"SELECT change_sale_status({qid(200)},'rascunho')",'Transição de status não permitida')
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'liberação do jurídico',f'UPDATE sales SET contrato_libera_assinatura=false WHERE id={qid(200)};')
denied(2,f"UPDATE sales SET contrato_libera_assinatura=true WHERE id={qid(200)}",'não pode transferir',f'UPDATE sales SET contrato_libera_assinatura=false WHERE id={qid(200)};')
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Anexe o contrato',f'DELETE FROM sale_documents WHERE sale_id={qid(200)};')
denied(2,f"UPDATE sales SET corretor_id={qid(2)} WHERE id={qid(200)}",'não pode transferir')
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'sem conta vinculada',f"UPDATE sales SET indicador_captador='Sem vínculo' WHERE id={qid(200)};")
# Missing payment is seeded by rollback-only disabling its consistency trigger, not by mocking the validator.
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Falta detalhar',f'ALTER TABLE sale_payment DISABLE TRIGGER trg_bloquear_edicao_pagamento_inconsistente; DELETE FROM sale_payment WHERE sale_id={qid(200)}; ALTER TABLE sale_payment ENABLE TRIGGER trg_bloquear_edicao_pagamento_inconsistente;')
# Lock: the auxiliary cannot change an accepted occurrence/sale or submit signature.
locked=f"INSERT INTO occurrences(id,sale_id,aceita_financeiro) VALUES ({qid(300)},{qid(200)},true);"
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Sem permissão',locked)
check(actor(2,f"WITH u AS (UPDATE sales SET imovel_observacoes='bad' WHERE id={qid(200)} RETURNING id) SELECT count(*) FROM u",locked)=='0','locked sale rejects UPDATE')
# Canonical sync on an existing occurrence, prior to acceptance; manual rows stay untouched.
existing=f"INSERT INTO occurrences(id,sale_id,valor_comissao,aceita_financeiro) VALUES ({qid(300)},{qid(200)},6000,false); INSERT INTO occurrence_commissions(occurrence_id,papel,nome,valor,managed_by_sale) VALUES ({qid(300)},'outro','Manual',77,false);"
sync_result=actor(2,f"SELECT sync_occurrence_commissions({qid(200)}); SELECT count(*) FROM occurrence_commissions WHERE occurrence_id={qid(300)} AND managed_by_sale; SELECT valor FROM occurrence_commissions WHERE occurrence_id={qid(300)} AND NOT managed_by_sale;",existing).splitlines()
check(sync_result[0]=='2' and float(sync_result[1])==77,'sync real and preserve manual: '+str(sync_result))
denied(2,f'UPDATE occurrences SET prev_recebimento_recebido_valor=1 WHERE id={qid(300)}','exclusivos do financeiro',existing)
valid_occurrence=f'SELECT criar_ocorrencia_completa({qid(200)});'
check(actor(7,f'UPDATE occurrences SET aceita_financeiro=true WHERE sale_id={qid(200)}; SELECT aceita_financeiro FROM occurrences WHERE sale_id={qid(200)}',valid_occurrence).endswith('t'),'valid acceptance control: admin')
denied(2,f'UPDATE occurrences SET aceita_financeiro=true WHERE sale_id={qid(200)}','exclusivos do financeiro',valid_occurrence)
denied(2,f"INSERT INTO occurrences(sale_id,prev_recebimento_recebido_valor) VALUES ({qid(200)},99)",'exclusivos do financeiro')
denied(2,f"SELECT change_sale_status({qid(200)},'ocorrencia_concluida')",'responsabilidade do financeiro')
# Additional manager actions, using the existing transition graph and canonical calculation.
for target in ['cancelada','arquivada','em_elaboracao_contrato','contrato_conferencia_corretor']:
 check(actor(2,f"SELECT change_sale_status({qid(200)},'{target}','Motivo de teste'); SELECT status FROM sales WHERE id={qid(200)}").endswith(target),'manager transition '+target)
denied(2,f"SELECT change_sale_status({qid(200)},'cancelada')",'Informe o motivo')
draft=f"UPDATE sales SET status='rascunho' WHERE id={qid(200)};"
check(actor(2,f"UPDATE sales SET valor_comissao_imobiliaria=3000 WHERE id={qid(200)}; SELECT change_sale_status({qid(200)},'aprovada_gestor'); SELECT status FROM sales WHERE id={qid(200)}",draft).endswith('aprovada_gestor'),'draft edit and direct legal handoff')
signed=f"UPDATE sales SET status='aguardando_assinatura' WHERE id={qid(200)}; INSERT INTO sale_documents(sale_id,tipo,parte) VALUES ({qid(200)},'contrato_assinado','juridico');"
check(actor(2,f"SELECT marcar_contrato_assinado_e_criar_ocorrencia({qid(200)}); SELECT status FROM sales WHERE id={qid(200)}; SELECT count(*) FROM occurrences WHERE sale_id={qid(200)}",signed).endswith('ocorrencia_pendente\n1'),'signed contract + canonical occurrence creation')
pending=f"SELECT criar_ocorrencia_completa({qid(200)}); UPDATE sales SET status='ocorrencia_pendente' WHERE id={qid(200)};"
check(actor(2,f"SELECT change_sale_status({qid(200)},'ocorrencia_analise_financeiro'); SELECT status FROM sales WHERE id={qid(200)}",pending).endswith('ocorrencia_analise_financeiro'),'handoff to finance')
for stage in ['aprovada_gestor','em_elaboracao_contrato','ocorrencia_analise_financeiro','ocorrencia_concluida']:
 check(json.loads(actor(2,f'SELECT sale_management_capabilities({qid(200)})',f"DO $$ BEGIN PERFORM criar_ocorrencia_completa({qid(200)}); END $$; UPDATE sales SET status='{stage}' WHERE id={qid(200)};"))['can_edit'] is False,'readonly stage '+stage)
check(actor(2,f"SELECT insert_sale_document({qid(200)},'outros','outros','{uid(200)}/novo.pdf','novo.pdf'); SELECT count(*) FROM sale_documents WHERE sale_id={qid(200)}").endswith('2'),'insert document via real RPC')
check(actor(2,f"SELECT archive_sale_document({qid(400)}); SELECT count(*) FROM sale_documents WHERE sale_id={qid(200)}").endswith('0'),'archive document via real RPC')
denied(2,f"SELECT insert_sale_document({qid(201)},'outros','outros','{uid(201)}/novo.pdf','novo.pdf')",'Sem permissão')
check(actor(2,f"INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','{uid(200)}/novo.pdf'); SELECT count(*) FROM storage.objects WHERE name='{uid(200)}/novo.pdf'").endswith('1'),'exact sale storage upload policy')
denied(2,f"INSERT INTO storage.objects(bucket_id,name) VALUES ('sale-documents','{uid(201)}/novo.pdf')",'row-level security')
denied(2,f"INSERT INTO storage.objects(bucket_id,name) VALUES ('external','{uid(200)}/novo.pdf')",'row-level security')
for change in [f'DELETE FROM team_co_leaders WHERE user_id={qid(2)};',f'UPDATE profiles SET ativo=false WHERE id={qid(2)};']:
 check(json.loads(actor(2,f'SELECT sale_management_capabilities({qid(200)})',change))['can_manage'] is False,'revocation immediate')
# New branch only; existing global predicates unchanged, downstream probes unchanged.
for name,definition in unchanged.items(): check(sql(f'SELECT pg_get_functiondef({quote(name)}::regprocedure)')==definition,'unchanged helper '+name)
for k,v in probes.items(): check(probe(v)==before[k],'no access expansion: '+k)
check(actor(2,f'SELECT count(*) FROM sale_documents WHERE sale_id={qid(200)}')=='1','own contract visible')
check(actor(2,f"SELECT count(*) FROM storage.objects WHERE bucket_id='sale-documents' AND name='{uid(200)}/contrato.pdf'")=='1','own storage visible')
# Rollback exact definitions and additive DDL; no CASCADE on shared helpers.
policies=sql("SELECT json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname)) FROM pg_policies WHERE policyname LIKE 'co_leader_%'")
rollback='BEGIN;\n'+'\n'.join(f'DROP POLICY "{p["name"]}" ON {p["schema"]}."{p["table"]}";' for p in json.loads(policies))
rollback+='\nDROP TRIGGER enforce_co_leader_sale_scope ON sales;\nDROP FUNCTION enforce_co_leader_sale_scope();\n'
rollback+='DROP TRIGGER enforce_co_leader_occurrence_scope ON occurrences; DROP FUNCTION enforce_co_leader_occurrence_scope();\n'
for name in ['change_sale_status(uuid,text,text)','validate_sale_status_transition()','enforce_sale_comissao_lock()','archive_sale_document(uuid)','insert_sale_document(uuid,text,text,text,text,doc_status,text,text)','update_contrato_pendencia(uuid,text,boolean)']:
 rollback+=baseline_functions[name]+';\n'
rollback+='DROP FUNCTION sale_management_capabilities(uuid); DROP FUNCTION can_edit_sale_as_co_leader(uuid); DROP FUNCTION can_manage_sale_as_co_leader(uuid); COMMIT;'
(BASE/'repo/supabase/rollback').mkdir(exist_ok=True)
(BASE/'repo/supabase/rollback/20260909213000_co_leader_sale_operations.sql').write_text(rollback)
sql(rollback)
check(sql('SELECT row_to_json(p) FROM pg_policies p ORDER BY schemaname,tablename,policyname')==baseline_policies,'rollback policies exact')
denied(2,f"SELECT change_sale_status({qid(200)},'aguardando_assinatura')",'Sem permissão para acessar esta venda')
print('GREEN + ROLLBACK PASS:',checks,'assertions; real SQL/RLS/triggers, synthetic actors only')
