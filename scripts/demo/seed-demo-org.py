#!/usr/bin/env python3
"""Imobiliária de DEMONSTRAÇÃO (ZZ Teste Provisionamento) — gerador de dados 100% fictícios.

FASE 1 (t_c6ebfd05): este script NÃO conecta em banco nenhum. Ele só:
  --dry-run (padrão)     mostra contagens e totais do que seria criado;
  --sql ARQ              grava o SQL de carga (uma transação, idempotente) para revisão/ensaio local;
  --cleanup-sql ARQ      grava o SQL de limpeza (remove só o que tem a marca de demonstração).

Marca de demonstração: todo id criado começa com 'de30de30-' e fica na org ZZ; e-mails em @demo.invalid;
telefones +55 15 90000-XXXX. Ids determinísticos (uuid5) => rodar de novo não duplica nada.
Parâmetros confirmados por Denis em 06/11: VGV médio de R$ 26 mi POR MÊS; sem login de teste
(entrada pelo "Entrar como"; usuário no Auth SEM senha utilizável).
"""
import argparse, hashlib, json, math, random, uuid
from datetime import date, datetime, timedelta, timezone

ORG = "eb0a260a-db2f-4cbf-b031-f0c2aebb407c"
ORG_SLUG = "zz-teste-provisionamento"
PREFIX = "de30de30"
NS = uuid.UUID("6d61782d-6465-6d6f-2d7a-7a2d73656564")
SAZONAL = [0.84, 0.90, 1.06, 0.95, 1.12, 1.00, 0.88, 1.10, 1.18, 0.96, 1.07, 0.94]
NOMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Heitor", "Isabela", "João", "Karina",
         "Lucas", "Mariana", "Nícolas", "Olívia", "Paulo", "Renata", "Samuel", "Tatiane", "Vinícius", "Yasmin", "Rafael",
         "Letícia", "Murilo", "Patrícia", "Gustavo", "Camila", "Rodrigo", "Juliana", "Felipe"]
SOBRENOMES = ["Albuquerque", "Barreto", "Campos", "Duarte", "Esteves", "Fontana", "Guedes", "Hoffmann", "Ilha",
              "Junqueira", "Lacerda", "Moura", "Nogueira", "Orsini", "Prado", "Quintela", "Rezende", "Siqueira",
              "Toledo", "Valença", "Xavier", "Zanetti"]
BAIRROS = ["Campolim", "Jardim Europa", "Vila Hortência", "Centro", "Jardim Vergueiro", "Wanel Ville",
           "Jardim Santa Rosália", "Além Ponte", "Éden", "Jardim Paulistano", "Parque Campolim", "Vila Jardini"]
TIPOS = [("Apartamento", 40), ("Casa", 38), ("Terreno", 8), ("Comercial", 3), ("Cobertura", 3), ("Studio", 2)]
MIDIAS = [("Site Remax", 18), ("Indicação", 16), ("Portal", 14), ("Tráfego Pago", 12), ("Instagram", 8),
          ("Placa", 7), ("Facebook", 5), ("Imovelweb", 4), ("Outro", 16)]
SALAS = ["Sala Ipê", "Sala Jatobá", "Sala Cedro", "Auditório"]
FINALIDADES = [("Reunião com cliente", 45), ("Reunião de equipe", 25), ("FIC", 18), ("Outra finalidade", 7),
               ("Treinamento", 3), ("Diretoria", 2)]


def did(*parts):
    """Id determinístico com a marca de demonstração no prefixo."""
    h = uuid.uuid5(NS, "|".join(map(str, parts))).hex
    return f"{PREFIX}-{h[8:12]}-4{h[13:16]}-8{h[17:20]}-{h[20:32]}"


def esc(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


def pick(rng, pares):
    tot = sum(p for _, p in pares)
    x = rng.uniform(0, tot)
    for v, p in pares:
        x -= p
        if x <= 0:
            return v
    return pares[-1][0]


def montar(a):
    rng = random.Random(a.semente)
    hoje = date.fromisoformat(a.hoje) if a.hoje else date.today()
    # ---------- pessoas ----------
    papeis = (["gestor"] * a.gestores + ["team_leader"] * a.team_leaders + ["corretor"] * a.corretores
              + ["admin"] * a.admins + ["staff"] * a.staff + ["financeiro"] * a.financeiro + ["juridico"] * a.juridico)
    pessoas, usados = [], set()
    for i, papel in enumerate(papeis):
        while True:
            nome = f"{rng.choice(NOMES)} {rng.choice(SOBRENOMES)}"
            if nome not in usados:
                usados.add(nome); break
        slug = hashlib.md5(nome.encode()).hexdigest()[:6]
        pessoas.append({"id": did("user", i), "nome": nome + " (Demo)", "papel": papel,
                        "email": f"demo.{papel}.{i:03d}.{slug}@demo.invalid",
                        "telefone": f"+55 15 90000-{1000 + i:04d}"})
    lideres = [p for p in pessoas if p["papel"] in ("gestor", "team_leader")]
    corretores = [p for p in pessoas if p["papel"] == "corretor"]
    # equipes: 1 por líder, corretores distribuídos
    equipes = [{"id": did("team", i), "nome": f"Equipe {['Ipê','Jatobá','Cedro','Aroeira','Peroba','Jacarandá','Mogno','Angico','Cumaru','Sucupira','Imbuia','Pau-Brasil','Jequitibá','Copaíba','Andiroba','Bálsamo','Cerejeira','Freijó','Garapa'][i % 19]}",
                "lider_id": l["id"], "cor": ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"][i % 6]}
               for i, l in enumerate(lideres)]
    membros = {c["id"]: equipes[i % len(equipes)] for i, c in enumerate(corretores)} if equipes else {}
    # ---------- força de venda: desigual (campeões + cauda longa) ----------
    ordem = corretores[:]
    rng.shuffle(ordem)
    ativos_venda = ordem[: a.vendedores_ativos]
    pesos = [1 / (k + 1) ** a.concentracao for k in range(len(ativos_venda))]
    # ---------- vendas ----------
    inicio_mes = date(hoje.year, hoje.month, 1)
    meses = []
    m = inicio_mes
    for _ in range(a.meses):
        m = (m - timedelta(days=1)).replace(day=1)
        meses.append(m)
    meses.reverse()
    fatores = [SAZONAL[i % 12] for i in range(len(meses))]
    fatores = [f * len(fatores) / sum(fatores) for f in fatores]
    vendas = []
    for mi, mes in enumerate(meses):
        alvo = a.vgv_mensal * fatores[mi]
        soma, lote = 0.0, []
        while soma < alvo:
            ticket = min(max(rng.lognormvariate(math.log(a.ticket_mediano), 0.55), 160_000), 3_800_000)
            ticket = round(ticket / 1000) * 1000
            lote.append(ticket); soma += ticket
        fator = alvo / soma
        ult = (mes.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        for k, t in enumerate(lote):
            valor = round(t * fator / 1000) * 1000
            vend = rng.choices(ativos_venda, pesos)[0]
            capt = vend if rng.random() < 0.43 else rng.choices(ativos_venda, pesos)[0]
            dia_ass = mes + timedelta(days=rng.randrange((ult - mes).days + 1))
            idade = (hoje - ult).days
            if idade > 75:
                status = "ocorrencia_concluida"
            elif idade > 35:
                status = rng.choices(["ocorrencia_concluida", "ocorrencia_analise_financeiro"], [80, 20])[0]
            else:
                status = rng.choices(["ocorrencia_concluida", "ocorrencia_analise_financeiro", "ocorrencia_pendente",
                                      "contrato_assinado"], [30, 30, 25, 15])[0]
            pct = rng.choice([5.0, 5.5, 6.0, 6.0, 6.0])
            vendas.append({"id": did("sale", mi, k), "mes": mes, "valor": valor, "anunciado": round(valor * rng.uniform(1.02, 1.12) / 1000) * 1000,
                           "vend": vend, "capt": capt, "ass": dia_ass, "status": status, "pct": pct,
                           "comissao": round(valor * pct / 100, 2), "tipo": pick(rng, TIPOS), "midia": pick(rng, MIDIAS),
                           "bairro": rng.choice(BAIRROS), "financ": rng.random() < 0.35})
    # vendas em andamento (esteira) no mês corrente
    abertas = []
    for k in range(a.vendas_abertas):
        st = rng.choices(["rascunho", "enviada_revisao", "aprovada_gestor", "em_elaboracao_contrato", "aguardando_assinatura"],
                         [20, 20, 15, 25, 20])[0]
        valor = round(min(max(rng.lognormvariate(math.log(a.ticket_mediano), 0.5), 160_000), 3_000_000) / 1000) * 1000
        vend = rng.choices(ativos_venda, pesos)[0]
        abertas.append({"id": did("open", k), "status": st, "valor": valor, "vend": vend, "capt": vend,
                        "criada": hoje - timedelta(days=rng.randrange(1, 40)), "tipo": pick(rng, TIPOS),
                        "bairro": rng.choice(BAIRROS), "pct": 6.0})
    # ---------- captações exclusivas ----------
    capts = []
    for mi, mes in enumerate(meses + [inicio_mes]):
        n = max(1, round(a.captacoes_mes * fatores[min(mi, len(fatores) - 1)]))
        for k in range(n):
            quem = rng.choices(ativos_venda, pesos)[0] if rng.random() < 0.8 else rng.choice(corretores)
            criada = mes + timedelta(days=rng.randrange(27))
            if criada > hoje:
                criada = hoje - timedelta(days=1)
            r = rng.random()
            if r < a.taxa_assinadas:
                st, ass = "aprovada", min(criada + timedelta(days=rng.randrange(2, 12)), hoje)
            elif r < a.taxa_assinadas + 0.10:
                st, ass = "em_assinatura", None
            elif r < a.taxa_assinadas + 0.20:
                st, ass = "enviada", None
            else:
                st, ass = "rascunho", None
            capts.append({"id": did("capt", mi, k), "quem": quem, "criada": criada, "status": st, "signed_on": ass,
                          "tipo": pick(rng, TIPOS), "bairro": rng.choice(BAIRROS), "prazo": rng.choice([90, 120, 180, 180])})
    # ---------- reservas de salas (90 dias para trás e 14 para frente) ----------
    reservas = []
    for d in range(-90, 15):
        dia = hoje + timedelta(days=d)
        if dia.weekday() >= 5:
            continue
        for s in SALAS:
            hora = 8
            while hora < 18:
                if rng.random() < 0.35:
                    dur = rng.choice([1, 1, 2, 2, 3])
                    if hora + dur > 19:
                        break
                    resp = rng.choice(pessoas)
                    reservas.append({"id": did("res", dia, s, hora), "sala": s, "dia": dia, "ini": hora, "fim": hora + dur,
                                     "resp": resp, "fin": pick(rng, FINALIDADES)})
                    hora += dur
                else:
                    hora += 1
    return {"hoje": hoje, "pessoas": pessoas, "equipes": equipes, "membros": membros, "vendas": vendas,
            "abertas": abertas, "capts": capts, "reservas": reservas, "meses": meses, "ativos": ativos_venda}


def resumo(d, a):
    v = d["vendas"]
    por_mes = {}
    for x in v:
        k = x["mes"].strftime("%Y-%m")
        n, s = por_mes.get(k, (0, 0))
        por_mes[k] = (n + 1, s + x["valor"])
    por_corretor = {}
    for x in v:
        por_corretor[x["vend"]["id"]] = por_corretor.get(x["vend"]["id"], 0) + x["valor"]
    ordem = sorted(por_corretor.values(), reverse=True)
    total = sum(ordem)
    papeis = {}
    for p in d["pessoas"]:
        papeis[p["papel"]] = papeis.get(p["papel"], 0) + 1
    st = {}
    for x in v + d["abertas"]:
        st[x["status"]] = st.get(x["status"], 0) + 1
    cs = {}
    for c in d["capts"]:
        cs[c["status"]] = cs.get(c["status"], 0) + 1
    print("=== DRY-RUN (nada é gravado) — org", ORG_SLUG, ORG)
    print("Usuários fictícios:", len(d["pessoas"]), papeis, "| equipes:", len(d["equipes"]))
    print("  Auth: 1 linha por pessoa em auth.users, e-mail @demo.invalid, encrypted_password VAZIO (sem senha utilizável),"
          " provider email; só serve para o 'Entrar como' (magic link gerado no servidor). Nenhum login de teste.")
    print("  WhatsApp: notificar_whatsapp=false em todos os papéis; telefones +55 15 90000-XXXX.")
    print(f"Vendas fechadas (12 meses): {len(v)}  VGV total R$ {total:,.0f}  média/mês R$ {total/len(por_mes):,.0f}"
          f"  ticket médio R$ {total/len(v):,.0f}  comissão total R$ {sum(x['comissao'] for x in v):,.0f}")
    for k in sorted(por_mes):
        n, s = por_mes[k]
        print(f"  {k}: {n:3d} vendas  R$ {s:,.0f}")
    print(f"Vendedores com venda: {len(ordem)} de {a.corretores} corretores | top5 = {sum(ordem[:5])/total:.1%}"
          f" | top10 = {sum(ordem[:10])/total:.1%} | maior = R$ {ordem[0]:,.0f} | menor = R$ {ordem[-1]:,.0f}")
    print("Status das vendas (inclui esteira em andamento):", dict(sorted(st.items())))
    assin = [c for c in d["capts"] if c["signed_on"]]
    print(f"Captações exclusivas: {len(d['capts'])} {dict(sorted(cs.items()))} | assinadas/mês ≈ {len(assin)/(len(d['meses'])+1):.1f}")
    print(f"Reservas de sala: {len(d['reservas'])} em {len(SALAS)} salas (futuras com lembrete já marcado como enviado)")
    print("Metas: 1 por corretor ativo por mês (", len(d["ativos"]) * len(d["meses"]), ") | Minhas metas:", len(d["ativos"]))
    print("Módulos a ligar na ZZ: captacao_exclusiva, feedback_proprietario, reserva_salas, mural_conquistas, ranking_valores")


def sql_carga(d, a):
    o = []
    w = o.append
    hoje = d["hoje"]
    w("-- CARGA DEMO ZZ — gerado por scripts/demo/seed-demo-org.py. NÃO RODAR EM PRODUÇÃO SEM AUTORIZAÇÃO (FASE 2).")
    w("begin;")
    w(f"do $$ begin if (select slug from public.organizations where id = '{ORG}') is distinct from '{ORG_SLUG}' then"
      " raise exception 'org errada: abortado'; end if; end $$;")
    w(f"do $$ begin if exists (select 1 from public.sync_org_map where adm_org_id = '{ORG}' and mode <> 'off') then"
      " raise exception 'sync da ZZ não está off: abortado'; end if; end $$;")
    w("select set_config('app.virou_venda', 'off', true);")
    w(f"select set_config('app.equipe_vigencia_desde', {esc((d['meses'][0]).isoformat() + 'T03:00:00Z')}, true);")
    # módulos (antes das vendas, para o Mural gerar os posts)
    for mod in ("captacao_exclusiva", "feedback_proprietario", "reserva_salas", "mural_conquistas", "ranking_valores"):
        w(f"insert into public.organization_modules (organization_id, module, enabled) values ('{ORG}', '{mod}', true)"
          " on conflict (organization_id, module) do update set enabled = true, updated_at = now();")
    # usuários (auth sem senha) -> handle_new_user cria member/profile/role corretor
    for p in d["pessoas"]:
        meta = {"provider": "email", "providers": ["email"], "organization_id": ORG}
        w("insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,"
          " raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ("
          f"'00000000-0000-0000-0000-000000000000', '{p['id']}', 'authenticated', 'authenticated', {esc(p['email'])}, '',"
          f" now(), {esc(meta)}, {esc({'nome': p['nome']})}, now(), now(), false, false) on conflict (id) do nothing;")
        w("insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at) values ("
          f"'{p['id']}', '{p['id']}', {esc({'sub': p['id'], 'email': p['email'], 'email_verified': True, 'phone_verified': False})},"
          " 'email', now(), now()) on conflict do nothing;")
    ids = ",".join(f"'{p['id']}'" for p in d["pessoas"])
    w(f"update public.email_outbox set status = 'cancelado', ultimo_erro = 'demo', atualizado_em = now()"
      f" where user_id in ({ids}) and status = 'pendente';")
    for p in d["pessoas"]:
        w(f"update public.profiles set nome = {esc(p['nome'])}, telefone = {esc(p['telefone'])} where id = '{p['id']}';")
        if p["papel"] != "corretor":
            w(f"insert into public.user_roles (id, user_id, role, organization_id) values ('{did('role', p['id'])}', '{p['id']}',"
              f" '{p['papel']}', '{ORG}') on conflict (user_id, role) do nothing;")
            if p["papel"] in ("admin", "staff", "financeiro", "juridico"):
                w(f"delete from public.user_roles where user_id = '{p['id']}' and role = 'corretor';")
        for sat in ("estudo", "visita", "sessenta"):
            w(f"insert into public.sync_exclusoes (adm_user_id, satelite, motivo, decidido_por) values ('{p['id']}', '{sat}',"
              " 'demo ZZ: usuário fictício (t_c6ebfd05)', 'Denis') on conflict do nothing;")
    w(f"update public.user_roles set notificar_whatsapp = false, notificar_toda_atualizacao = false where user_id in ({ids});")
    for e in d["equipes"]:
        w(f"insert into public.teams (id, lider_id, nome, cor, organization_id) values ('{e['id']}', '{e['lider_id']}',"
          f" {esc(e['nome'])}, '{e['cor']}', '{ORG}') on conflict (id) do nothing;")
    for uid, e in d["membros"].items():
        w(f"insert into public.team_members (id, membro_id, team_id, organization_id) values ('{did('tm', uid)}', '{uid}',"
          f" '{e['id']}', '{ORG}') on conflict do nothing;")
    # captações
    unit = did("unit", 1)
    w(f"insert into public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)"
      f" values ('{unit}', '{ORG}', 'Unidade Demo', 'J-00000', 'Demo Imóveis Ltda (fictícia)', 'Rua Fictícia, 100', 'Sorocaba', 'SP',"
      " '00.000.000/0001-00', 'RE/MAX Demo') on conflict (id) do nothing;")
    for c in d["capts"]:
        fd = {"imovel": {"tipo_imovel": c["tipo"], "bairro": c["bairro"], "cidade": "Sorocaba", "endereco": f"Rua Demo {abs(hash(c['id'])) % 900 + 10}"},
              "condicoes": {"prazo_dias_numero": str(c["prazo"])}, "proprietario_1": {"nome": "Proprietário Fictício"}}
        w("insert into public.exclusive_captures (id, captor_id, created_by, template, status, form_data, broker_name, created_on_sp,"
          f" created_at, organization_id, signed_on, unit_id) values ('{c['id']}', '{c['quem']['id']}', '{c['quem']['id']}', 'remax-padrao',"
          f" '{c['status']}', {esc(fd)}, {esc(c['quem']['nome'])}, '{c['criada']}', '{c['criada']}T13:00:00Z', '{ORG}',"
          f" {esc(c['signed_on'].isoformat() if c['signed_on'] else None)}, '{unit}') on conflict (id) do nothing;")
    # vendas fechadas
    for s in d["vendas"] + [dict(x, ass=None, mes=None, anunciado=x["valor"], comissao=round(x["valor"] * 0.06, 2), midia="Portal", financ=False)
                            for x in d["abertas"]]:
        lider = d["membros"].get(s["vend"]["id"])
        lider_id = lider["lider_id"] if lider else None
        criada = (s["ass"] - timedelta(days=30)) if s.get("ass") else s["criada"]
        w("insert into public.sales (id, corretor_id, status, valor_anunciado, valor_negociado, percentual_comissao, valor_total_comissao,"
          " corretor_captador_id, corretor_vendedor_id, coordenador_id, team_leader_id, midia, tipo_imovel, imovel_bairro, imovel_cidade,"
          " imovel_uf, modalidade, created_at, organization_id) values ("
          f"'{s['id']}', '{s['vend']['id']}', '{s['status']}', {s['anunciado']}, {s['valor']}, {s['pct']}, {s['comissao']},"
          f" '{s['capt']['id']}', '{s['vend']['id']}', {esc(lider_id)}, {esc(lider_id)}, {esc(s['midia'])}, {esc(s['tipo'])},"
          f" {esc(s['bairro'])}, 'Sorocaba', 'SP', 'padrao', '{criada}T12:00:00Z', '{ORG}') on conflict (id) do nothing;")
        w(f"insert into public.sale_parties (id, sale_id, papel, nome, organization_id) values ('{did('pv', s['id'])}', '{s['id']}',"
          f" 'vendedor_1', 'Vendedor Fictício', '{ORG}'), ('{did('pc', s['id'])}', '{s['id']}', 'comprador_1', 'Comprador Fictício', '{ORG}')"
          " on conflict (id) do nothing;")
        caminho = ["rascunho", "enviada_revisao", "aprovada_gestor", "em_elaboracao_contrato", "aguardando_assinatura",
                   "contrato_assinado", "ocorrencia_pendente", "ocorrencia_analise_financeiro", "ocorrencia_concluida"]
        ate = caminho.index(s["status"])
        base = datetime.combine(criada, datetime.min.time(), timezone.utc) + timedelta(hours=12)
        for i in range(1, ate + 1):
            if s.get("ass") and caminho[i] == "contrato_assinado":
                quando = datetime.combine(s["ass"], datetime.min.time(), timezone.utc) + timedelta(hours=15)
            elif s.get("ass") and i > caminho.index("contrato_assinado"):
                quando = datetime.combine(s["ass"], datetime.min.time(), timezone.utc) + timedelta(days=3 * (i - 5), hours=15)
            else:
                quando = base + timedelta(days=2 * i)
            w("insert into public.sale_status_history (id, sale_id, de, para, autor_id, created_at, organization_id) values ("
              f"'{did('h', s['id'], i)}', '{s['id']}', '{caminho[i-1]}', '{caminho[i]}', null, '{quando.isoformat()}', '{ORG}')"
              " on conflict (id) do nothing;")
        if ate >= caminho.index("ocorrencia_pendente"):
            occ = did("occ", s["id"])
            concl = s["status"] == "ocorrencia_concluida"
            prev = (s["ass"] + timedelta(days=20)).isoformat()
            w("insert into public.occurrences (id, sale_id, data_assinatura, valor_anunciado, valor_negociado, percentual_comissao,"
              " valor_comissao, midia, status, prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma,"
              " prev_recebimento_recebido_em, prev_recebimento_recebido_valor, organization_id) values ("
              f"'{occ}', '{s['id']}', '{s['ass']}', {s['anunciado']}, {s['valor']}, {s['pct']}, {s['comissao']}, {esc(s['midia'])},"
              f" '{'concluida' if concl else 'pendente'}', {s['comissao']}, '{prev}', 'PIX',"
              f" {esc(prev if concl else None)}, {esc(s['comissao'] if concl else None)}, '{ORG}') on conflict (id) do nothing;")
            partes = [("corretor_vendedor", s["vend"]["id"], 0.25, "vendedor"), ("corretor_captador", s["capt"]["id"], 0.22, "captador")]
            if lider_id:
                partes += [("lider_vendedor", lider_id, 0.075, "vendedor"), ("lider_captador", lider_id, 0.075, "captador")]
            for papel, uid, frac, lado in partes:
                w("insert into public.occurrence_commissions (id, occurrence_id, papel, percentual, valor, user_id, lado, organization_id)"
                  f" values ('{did('oc', occ, papel)}', '{occ}', '{papel}', {round(frac*100, 2)}, {round(s['comissao']*frac, 2)}, '{uid}',"
                  f" '{lado}', '{ORG}') on conflict (id) do nothing;")
    # metas e minhas metas
    for p in d["ativos"]:
        for mes in d["meses"]:
            w(f"insert into public.metas (id, tipo, corretor_id, mes, meta_comissao, organization_id) values ('{did('meta', p['id'], mes)}',"
              f" 'corretor', '{p['id']}', '{mes}', 25000, '{ORG}') on conflict (id) do nothing;")
        w(f"insert into public.minhas_metas (id, organization_id, user_id, periodo, inicio, meta_comissao, meta_vgv, meta_vendas, meta_captacoes)"
          f" values ('{did('mm', p['id'])}', '{ORG}', '{p['id']}', 'ano', '{hoje.year}-01-01', 300000, 5000000, 12, 24)"
          " on conflict (organization_id, user_id, periodo, inicio) do nothing;")
    # salas e reservas
    for i, s in enumerate(SALAS):
        w(f"insert into public.agency_rooms (id, organization_id, nome, ativo, ordem) values ('{did('room', s)}', '{ORG}', {esc(s)}, true, {i})"
          " on conflict (id) do nothing;")
    for r in d["reservas"]:
        futura = r["dia"] >= hoje
        w("insert into public.room_reservations (id, room, reserved_date, start_time, end_time, responsible_id, responsible_name, purpose,"
          " reminder_sent_at, organization_id) values ("
          f"'{r['id']}', {esc(r['sala'])}, '{r['dia']}', '{r['ini']:02d}:00', '{r['fim']:02d}:00', '{r['resp']['id']}', {esc(r['resp']['nome'])},"
          f" {esc(r['fin'])}, {'now()' if futura else 'null'}, '{ORG}') on conflict (id) do nothing;")
    w("commit;")
    return "\n".join(o) + "\n"


def sql_limpeza():
    m = f"'{PREFIX}-%'"
    u = f"(select id from auth.users where id::text like {m} and email like '%@demo.invalid')"
    return "\n".join([
        "-- LIMPEZA DEMO ZZ — remove só registros com a marca (id 'de30de30-…' na org ZZ / e-mail @demo.invalid).",
        "begin;",
        f"do $$ begin if (select slug from public.organizations where id = '{ORG}') is distinct from '{ORG_SLUG}' then raise exception 'org errada'; end if; end $$;",
        f"delete from public.room_reservations where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.agency_rooms where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.metas where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.minhas_metas where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.sales where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.exclusive_history where organization_id = '{ORG}' and capture_id::text like {m};",
        f"delete from public.exclusive_documents where organization_id = '{ORG}' and capture_id::text like {m};",
        f"delete from public.exclusive_captures where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.exclusive_units where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.team_members where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.teams where organization_id = '{ORG}' and id::text like {m};",
        f"delete from public.activity_logs where organization_id = '{ORG}' and (payload->>'target_user') like {m};",
        f"delete from public.sync_exclusoes where adm_user_id in {u};",
        f"delete from public.email_outbox where user_id in {u};",
        f"delete from auth.users where id in {u};  -- cascata: profiles, user_roles, organization_members, notifications…",
        "commit;", ""])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vgv-mensal", type=float, default=26_000_000)
    ap.add_argument("--meses", type=int, default=12)
    ap.add_argument("--corretores", type=int, default=90)
    ap.add_argument("--vendedores-ativos", type=int, default=64, help="corretores com pelo menos 1 venda no período")
    ap.add_argument("--concentracao", type=float, default=0.75, help="maior = mais concentrado nos campeões")
    ap.add_argument("--ticket-mediano", type=float, default=400_000)
    ap.add_argument("--gestores", type=int, default=12)
    ap.add_argument("--team-leaders", type=int, default=7)
    ap.add_argument("--admins", type=int, default=3)
    ap.add_argument("--staff", type=int, default=4)
    ap.add_argument("--financeiro", type=int, default=2)
    ap.add_argument("--juridico", type=int, default=2)
    ap.add_argument("--captacoes-mes", type=float, default=28)
    ap.add_argument("--taxa-assinadas", type=float, default=0.45)
    ap.add_argument("--vendas-abertas", type=int, default=30)
    ap.add_argument("--semente", type=int, default=20261106)
    ap.add_argument("--hoje", default=None, help="AAAA-MM-DD (padrão: hoje)")
    ap.add_argument("--sql", help="grava o SQL de carga neste arquivo (não executa)")
    ap.add_argument("--cleanup-sql", help="grava o SQL de limpeza neste arquivo (não executa)")
    a = ap.parse_args()
    d = montar(a)
    resumo(d, a)
    if a.sql:
        open(a.sql, "w").write(sql_carga(d, a)); print("SQL de carga gravado (não executado):", a.sql)
    if a.cleanup_sql:
        open(a.cleanup_sql, "w").write(sql_limpeza()); print("SQL de limpeza gravado (não executado):", a.cleanup_sql)


if __name__ == "__main__":
    main()
