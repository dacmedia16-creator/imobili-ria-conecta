#!/usr/bin/env node
/**
 * Piloto de leads — P0 "preparar a org ZZ" (card t_2472761a; D1 "sim" de Denis em 24/10/2026).
 *
 * SÓ na imobiliária "ZZ Teste Provisionamento" (id e slug conferidos). Sem dados reais.
 * Padrão = SIMULAÇÃO (não grava nada, nem conecta): mostra o que seria criado.
 * Gravar exige --apply + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no ambiente (nunca no argumento)
 * e só deve rodar depois da migration 20261025120000 e do "sim" de Denis no tópico 6238.
 *
 * O que cria (idempotente: o que já existe é pulado):
 *  1) 3 corretores de teste: nome "ZZ Corretor Teste N", e-mail zz-corretor-teste-N@max-piloto.invalid
 *     (.invalid = domínio reservado, sem destinatário real), SEM telefone e com aviso por WhatsApp
 *     desligado (D1/D2). O e-mail de boas-vindas que a produção enfileira é cancelado em seguida.
 *  2) 1 captação fictícia (rascunho) por corretor, para testar "lead vai para o dono da captação" (D4).
 *  3) leads_preparar_org: motivos de perda padrão + configuração (prazo de aceite 30 min — D3).
 * NÃO liga o módulo: isso é feito no painel Plataforma → Imobiliárias (fica no histórico).
 * Nenhuma mensagem de WhatsApp é enviada. Desfazer: ver bloco "Reversão" no fim deste arquivo.
 */
const ZZ_ID = "eb0a260a-db2f-4cbf-b031-f0c2aebb407c";
const ZZ_SLUG = "zz-teste-provisionamento";
const N = 3;

export const corretores = Array.from({ length: N }, (_, i) => ({
  nome: `ZZ Corretor Teste ${i + 1}`,
  email: `zz-corretor-teste-${i + 1}@max-piloto.invalid`,
}));
const BAIRROS = ["Centro (fictício)", "Campolim (fictício)", "Jardim Teste (fictício)"];
const TIPOS = ["Apartamento", "Casa", "Terreno"];
export const captacaoFicticia = (i) => ({
  template: "campolim",
  status: "rascunho",
  broker_name: corretores[i].nome,
  form_data: {
    imovel: {
      tipo_imovel: TIPOS[i % TIPOS.length],
      bairro: BAIRROS[i % BAIRROS.length],
      municipio: "Sorocaba",
      valor_imovel: String(300000 + i * 150000),
      observacoes: "CAPTAÇÃO FICTÍCIA — piloto de leads (t_2472761a). Não é imóvel real.",
    },
  },
});

function plano() {
  console.log(`Imobiliária alvo: ZZ Teste Provisionamento (${ZZ_ID}, slug ${ZZ_SLUG})`);
  console.log("1) Corretores de teste (papel corretor, sem telefone, WhatsApp desligado):");
  for (const c of corretores) console.log(`   - ${c.nome} <${c.email}>`);
  console.log("2) Captações fictícias (rascunho), 1 por corretor:");
  corretores.forEach((c, i) => {
    const im = captacaoFicticia(i).form_data.imovel;
    console.log(`   - ${im.tipo_imovel} · ${im.bairro} · captador: ${c.nome}`);
  });
  console.log("3) leads_preparar_org: 7 motivos de perda padrão + prazo de aceite 30 min.");
  console.log("Depois (manual, painel Plataforma): ligar o módulo 'Leads' só na ZZ.");
}

async function aplicar() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = (r, etapa) => {
    if (r.error) throw new Error(`${etapa}: ${r.error.message}`);
    return r.data;
  };

  const org = must(
    await db.from("organizations").select("id,slug,status").eq("id", ZZ_ID).maybeSingle(),
    "org",
  );
  if (!org || org.slug !== ZZ_SLUG || org.status !== "ativa")
    throw new Error("Trava: a org alvo não é a ZZ ativa. Nada foi gravado.");
  const migration = await db.from("lead_config").select("organization_id").limit(1);
  if (migration.error) throw new Error("Migration de leads ainda não aplicada. Nada foi gravado.");

  const ids = [];
  for (const c of corretores) {
    const atual = must(
      await db.from("profiles").select("id,organization_id").eq("email", c.email).maybeSingle(),
      "perfil",
    );
    let id = atual?.id;
    if (atual && atual.organization_id !== ZZ_ID)
      throw new Error(`${c.email} existe em outra org.`);
    if (!id) {
      const r = await db.auth.admin.createUser({
        email: c.email,
        email_confirm: true,
        user_metadata: { nome: c.nome },
        app_metadata: { organization_id: ZZ_ID },
      });
      if (r.error || !r.data?.user) throw new Error(`criar ${c.email}: ${r.error?.message}`);
      id = r.data.user.id;
      console.log(`criado: ${c.nome}`);
    } else console.log(`já existia: ${c.nome}`);
    // Boas-vindas: cancela o que a produção enfileirou (domínio .invalid não entrega a ninguém).
    must(
      await db
        .from("email_outbox")
        .update({ status: "cancelado", ultimo_erro: "piloto_leads_teste_t_2472761a" })
        .eq("user_id", id)
        .in("status", ["pendente", "processando"]),
      "cancelar boas-vindas",
    );
    must(
      await db
        .from("profiles")
        .update({ telefone: null })
        .eq("id", id)
        .eq("organization_id", ZZ_ID),
      "telefone",
    );
    must(
      await db
        .from("user_roles")
        .update({ notificar_whatsapp: false })
        .eq("user_id", id)
        .eq("organization_id", ZZ_ID),
      "whatsapp off",
    );
    ids.push(id);
  }

  for (let i = 0; i < ids.length; i++) {
    const existe = must(
      await db
        .from("exclusive_captures")
        .select("id")
        .eq("organization_id", ZZ_ID)
        .eq("captor_id", ids[i])
        .limit(1),
      "captação",
    );
    if (existe.length) {
      console.log(`captação já existia: ${corretores[i].nome}`);
      continue;
    }
    must(
      await db.from("exclusive_captures").insert({
        ...captacaoFicticia(i),
        captor_id: ids[i],
        created_by: ids[i],
        organization_id: ZZ_ID,
      }),
      "criar captação",
    );
    console.log(`captação fictícia criada: ${corretores[i].nome}`);
  }

  const n = must(await db.rpc("leads_preparar_org", { _org: ZZ_ID }), "preparar org");
  console.log(`motivos de perda criados agora: ${n}`);
  console.log("Pronto. Falta ligar o módulo 'Leads' na ZZ pelo painel Plataforma.");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  plano();
  if (process.argv.includes("--apply")) {
    aplicar().catch((e) => {
      console.error(`ERRO: ${e.message}`);
      process.exit(1);
    });
  } else console.log("\nSIMULAÇÃO: nada foi gravado. Use --apply só com autorização.");
}

/* Reversão (só ZZ, manual, com autorização):
 *  - Desligar o módulo "Leads" da ZZ no painel Plataforma.
 *  - Captações fictícias: descartar (discarded_at) as 3 de "ZZ Corretor Teste N".
 *  - Corretores de teste: desativar no "Usuários da plataforma" (ou excluir os 3 usuários .invalid).
 *  - Banco inteiro do piloto: docs/sql/rollback/20261025120000_leads_piloto.rollback.sql.
 */
