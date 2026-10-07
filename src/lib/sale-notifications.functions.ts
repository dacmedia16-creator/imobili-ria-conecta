import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { currentContextOrg, type OrgAdminClient } from "@/lib/org-scope";
import {
  chegouAoJuridico,
  proximoResponsavelRoles,
  STATUS_LABEL,
  type SaleStatus,
} from "@/lib/status";
import { responsaveisDaVenda } from "@/lib/sale-permissions";

type Participavel = Parameters<typeof responsaveisDaVenda>[0];

/**
 * Corretores participantes da venda e líderes (principal + auxiliar) das equipes deles, só dentro
 * da agência da venda (service_role ignora RLS: filtro explícito por organization_id).
 */
async function responsaveisELideresNaAgencia(
  admin: OrgAdminClient,
  orgId: string,
  sale: Participavel & { id: string },
  leaderIdsForCorretor: (a: OrgAdminClient, o: string, c: string | null) => Promise<string[]>,
): Promise<{ responsaveis: string[]; liderIds: string[] }> {
  const { data: extrasVenda } = await admin
    .from("sale_commission_extras")
    .select("papel, user_id")
    .eq("organization_id", orgId)
    .eq("sale_id", sale.id);
  const responsaveis = responsaveisDaVenda(
    sale,
    (extrasVenda ?? []) as { papel: string | null; user_id: string | null }[],
  );
  const listas = await Promise.all(responsaveis.map((id) => leaderIdsForCorretor(admin, orgId, id)));
  return { responsaveis, liderIds: Array.from(new Set(listas.flat())) };
}

/**
 * Visão da plataforma (super-admin dentro de outra imobiliária): os avisos abaixo gravam com
 * service_role (notifications, activity_logs, sale_comment_recipients) e mandam WhatsApp para
 * pessoas reais — nada disso entra na auditoria do contexto. Decisão: SUPRIMIR os avisos enquanto
 * o contexto estiver ativo. A alteração da venda em si segue pelo JWT e é auditada no banco.
 * Falha fechada: se não der para confirmar o contexto (rede/5xx), também não avisa.
 */
async function avisosSuprimidosNoContexto(user: object): Promise<boolean> {
  try {
    return (await currentContextOrg(user)) !== null;
  } catch {
    return true;
  }
}

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
// Teto por envio: sem isso um ZionTalk lento segura a requisição inteira (o laço é em série).
const ZIONTALK_TIMEOUT_MS = 10_000;
/** Erro de envio sem dados pessoais: mascara sequências longas de dígitos (telefone). */
export function erroSemDadosPessoais(texto: string): string {
  return texto.replace(/\+?\d[\d\s().-]{6,}\d/g, "[numero]").slice(0, 200);
}
// Sem APP_URL configurado (dev local), cai no endereço padrão do `npm run dev` deste projeto.
const APP_URL = process.env.APP_URL || "http://localhost:8080";

const NotifyInput = z.object({
  saleId: z.string().uuid(),
  status: z.string(),
  motivo: z.string().nullable().optional(),
});

type UserRoleRow = {
  user_id: string;
  role: string;
  notificar_whatsapp: boolean | null;
  notificar_toda_atualizacao: boolean | null;
};

/** Normaliza pro formato que o ZionTalk exige: só dígitos com DDI, SEM "+" na frente (testado ao
 * vivo — com "+" a API retorna 500) — aceita o telefone digitado com ou sem DDI/máscara. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
}

/** Remove acento/cedilha e qualquer caractere fora do ASCII antes de mandar pro ZionTalk — testado
 * ao vivo: qualquer letra acentuada (á, ã, ç, ñ...) ou símbolo como €/° faz a API retornar 500, e
 * emoji são aceitos (201) mas chegam corrompidos ("??") no WhatsApp de verdade. `*negrito*` e
 * quebra de linha funcionam normalmente, então o texto continua estruturado mesmo só em ASCII. */
function paraWhatsapp(texto: string): string {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      // eslint-disable-next-line no-control-regex -- intencional: mantém 0x00-0x7E (ASCII), inclui \n de propósito (ver comentário acima)
      .replace(/[^\x00-\x7E]/g, "")
  );
}

// Papéis sem conceito de "dono"/equipe (jurídico, financeiro) — preferência de "a cada
// atualização" começa DESLIGADA pra eles (a opção é nova; ligada por padrão inundaria financeiro,
// que vê toda venda do sistema, com aviso de toda mudança de status desde o primeiro dia). Pra
// corretor/gestor, que só acompanham as próprias vendas/equipe, continua ligada por padrão.
function defaultTodaAtualizacao(papel: "corretor" | "gestor" | "juridico" | "financeiro"): boolean {
  return papel === "corretor" || papel === "gestor";
}

// team_leader é clone de gestor em tudo, inclusive aqui: o "papel" usado como bucket interno
// pra líder de equipe continua "gestor", mas a preferência de notificação de cada líder mora em
// user_roles sob o papel que ele de fato tem (gestor OU team_leader) — sem isso, a preferência
// salva por um team_leader nunca era encontrada e ele sempre caía no default.
function papelBate(roleReal: string, papelBucket: string): boolean {
  if (papelBucket === "gestor") return roleReal === "gestor" || roleReal === "team_leader";
  return roleReal === papelBucket;
}

/**
 * Avisa da mudança de status de uma venda nos dois canais — sino interno (tabela `notifications`)
 * e WhatsApp (ZionTalk) — a partir do MESMO cálculo de destinatário, pra não ter um casal de regras
 * divergentes (o que causava, por exemplo, o sino do gestor nunca chegar quando o corretor envia
 * pra revisão: RLS de `notifications` só deixa um usuário notificar outro se ele mesmo já for
 * gestor/jurídico/financeiro/admin — um corretor comum não passava, e o erro era ignorado em
 * silêncio). Roda com service role (bypassa RLS) e nunca lança erro pra quem chamou: falha de
 * rede/API externa não pode travar a troca de status.
 *
 * Dois grupos de destinatário, cada um com preferência própria (ambas em user_roles, por papel):
 * - "Sua vez": só quem for o papel responsável pelo status atual (proximoResponsavelRoles — mesma
 *   regra do badge "Sua vez" na lista de vendas). corretor = o próprio corretor da venda; gestor =
 *   só o(s) líder(es) da equipe do corretor; juridico/financeiro = todo mundo com esse papel (sem
 *   hierarquia de equipe). No sino, "sua vez" SEMPRE notifica — só o envio por WhatsApp respeita
 *   notificar_whatsapp.
 * - "Toda atualização" (notificar_toda_atualizacao, vale pros dois canais igualmente): corretor e
 *   o(s) líder(es) da equipe dele recebem em qualquer troca de status; jurídico recebe a partir do
 *   momento em que a venda chega nele (chegouAoJuridico); financeiro recebe sempre, já que enxerga
 *   toda venda do sistema.
 * Quem se qualifica nos dois grupos ao mesmo tempo recebe só a mensagem de "sua vez" (mais
 * específica), não as duas. Usuário desativado (profiles.ativo = false) nunca recebe WhatsApp;
 * quem executou a ação nunca é notificado de si mesmo.
 */
export const notifySaleStatusChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => NotifyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (await avisosSuprimidosNoContexto(supabase)) return { notified: 0, sent: 0 };

    const { data: sale } = await supabase
      .from("sales")
      .select(
        "id, corretor_id, corretor_captador_id, corretor_vendedor_id, imovel_id, codigo_interno, modalidade, imovel_endereco, valor_negociado",
      )
      .eq("id", data.saleId)
      .maybeSingle();
    if (!sale) return { notified: 0, sent: 0 };

    // team_members/user_roles de terceiros não são visíveis via RLS pro corretor comum (só se
    // enxerga a si mesmo/seu próprio líder), e o insert em `notifications` pra outro usuário também
    // exige papel elevado — o service role resolve os dois casos aqui.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Multiempresa: service_role ignora RLS, então todo acesso abaixo é filtrado pela agência da
    // própria venda (lida no servidor). Destinatários de outra agência nunca entram.
    const { saleOrg, leaderIdsForCorretor, profilesInOrg, roleUserIds, roleRowsInOrg, keepOrgMembers } =
      await import("@/lib/sale-notifications.server");
    const admin = supabaseAdmin as unknown as OrgAdminClient;
    const orgId = await saleOrg(admin, sale.id);
    if (!orgId) return { notified: 0, sent: 0 };

    // Avisos "de corretor" e liderança seguem os PARTICIPANTES da venda, não quem a cadastrou
    // (decisão de Denis, 28/09/2026). Criador sem participação não recebe aviso de corretor.
    // Líder auxiliar ("braço direito") soma à lista; tudo escopado à agência da venda.
    const { responsaveis, liderIds } = await responsaveisELideresNaAgencia(
      admin,
      orgId,
      sale,
      leaderIdsForCorretor,
    );

    // Nome do corretor e do(s) gestor(es)/lider(es) envolvidos na venda, pra aparecer nas
    // notificações (sino e WhatsApp) — sem isso quem recebe o aviso não sabe de qual corretor/time
    // se trata sem abrir o link.
    const envolvidosIds = Array.from(
      new Set([...responsaveis, ...liderIds].filter((id): id is string => !!id)),
    );
    const envolvidosProfiles = await profilesInOrg<{ id: string; nome: string | null }>(
      admin,
      orgId,
      envolvidosIds,
      "id, nome",
    );
    const nomeById = new Map(envolvidosProfiles.map((p) => [p.id, p.nome]));
    const corretorNome =
      responsaveis
        .map((id) => nomeById.get(id))
        .filter((n): n is string => !!n)
        .join(", ") || null;
    const gestorNomes = liderIds
      .map((id) => nomeById.get(id))
      .filter((n): n is string => !!n)
      .join(", ");

    const status = data.status as SaleStatus;

    // "Sua vez" — proximoResponsavelRoles nunca retorna mais de um papel por status (conferido em status.ts).
    const roleNext = proximoResponsavelRoles(status)[0];
    const proximoIds = new Set<string>();
    if (roleNext === "corretor") {
      for (const r of responsaveis) proximoIds.add(r);
    } else if (roleNext === "gestor") {
      for (const l of liderIds) proximoIds.add(l);
    } else if (roleNext) {
      for (const id of await roleUserIds(admin, orgId, roleNext)) proximoIds.add(id);
    }

    // "Toda atualização" — corretor/gestor da equipe (como sempre), mais jurídico (só depois que a
    // venda chegou nele) e financeiro (vê tudo, sempre candidato).
    const atualizacaoPapelById = new Map<
      string,
      "corretor" | "gestor" | "juridico" | "financeiro"
    >();
    for (const r of responsaveis) atualizacaoPapelById.set(r, "corretor");
    for (const l of liderIds)
      if (!atualizacaoPapelById.has(l)) atualizacaoPapelById.set(l, "gestor");
    if (chegouAoJuridico(status, sale.modalidade)) {
      for (const id of await roleUserIds(admin, orgId, "juridico"))
        if (!atualizacaoPapelById.has(id)) atualizacaoPapelById.set(id, "juridico");
    }
    for (const id of await roleUserIds(admin, orgId, "financeiro"))
      if (!atualizacaoPapelById.has(id)) atualizacaoPapelById.set(id, "financeiro");

    proximoIds.delete(userId); // quem fez a ação não precisa ser avisado de si mesmo
    atualizacaoPapelById.delete(userId);

    // Defesa extra: descarta qualquer candidato que não seja perfil da agência da venda.
    const membros = await keepOrgMembers(admin, orgId, [
      ...proximoIds,
      ...atualizacaoPapelById.keys(),
    ]);
    for (const id of Array.from(proximoIds)) if (!membros.has(id)) proximoIds.delete(id);
    for (const id of Array.from(atualizacaoPapelById.keys()))
      if (!membros.has(id)) atualizacaoPapelById.delete(id);

    const candidateIds = Array.from(new Set([...proximoIds, ...atualizacaoPapelById.keys()]));
    if (candidateIds.length === 0) return { notified: 0, sent: 0 };

    const rolesRows = await roleRowsInOrg<UserRoleRow>(admin, orgId, candidateIds);

    const label = sale.imovel_id || sale.codigo_interno || `venda #${sale.id.slice(0, 8)}`;
    const statusLabel = STATUS_LABEL[status] ?? data.status;
    const link = `${APP_URL}/vendas/${sale.id}`;
    const motivoLinha = data.motivo ? `Motivo: ${data.motivo}\n` : "";
    // Bairro/condomínio não são campos próprios da venda — quando preenchidos, moram dentro do
    // texto livre de "Endereço do imóvel" (imovel_endereco), então é ele que aparece aqui.
    const enderecoLinha = sale.imovel_endereco ? `Endereco: ${sale.imovel_endereco}\n` : "";
    const valorLinha =
      sale.valor_negociado != null
        ? `Valor: R$ ${Number(sale.valor_negociado).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}\n`
        : "";
    const envolvidosLinha =
      enderecoLinha +
      valorLinha +
      (corretorNome ? `Corretor: ${corretorNome}\n` : "") +
      (gestorNomes ? `Gestor: ${gestorNomes}\n` : "");
    const envolvidosPartes: string[] = [];
    if (corretorNome) envolvidosPartes.push(`Corretor: ${corretorNome}`);
    if (gestorNomes) envolvidosPartes.push(`Gestor: ${gestorNomes}`);
    const envolvidosInApp = envolvidosPartes.length ? ` • ${envolvidosPartes.join(" • ")}` : "";

    const textoSuaVezWpp = `*É a sua vez de agir!*\n\nVenda: ${label}\n${envolvidosLinha}Status: ${statusLabel}\n${motivoLinha}\nAcesse: ${link}`;
    const textoAtualizacaoWpp = `*Atualização na venda*\n\nVenda: ${label}\n${envolvidosLinha}Novo status: ${statusLabel}\n${motivoLinha}\nAcesse: ${link}`;

    const inAppPorUsuario = new Map<string, { titulo: string; mensagem: string | null }>();
    const whatsappPorUsuario = new Map<string, string>();

    for (const id of proximoIds) {
      // "Sua vez" no sino sempre notifica — o toggle de preferência é só do WhatsApp.
      inAppPorUsuario.set(id, {
        titulo: `Sua vez de agir: ${label}`,
        mensagem: `Status: ${statusLabel}${envolvidosInApp}${data.motivo ? ` — ${data.motivo}` : ""}`,
      });
      const row = (rolesRows ?? []).find(
        (r: UserRoleRow) => r.user_id === id && roleNext && papelBate(r.role, roleNext),
      );
      if (row?.notificar_whatsapp !== false) whatsappPorUsuario.set(id, textoSuaVezWpp);
    }
    for (const [id, papel] of atualizacaoPapelById) {
      if (inAppPorUsuario.has(id)) continue; // já ganhou a msg de "sua vez", mais específica — não duplica
      const row = (rolesRows ?? []).find(
        (r: UserRoleRow) => r.user_id === id && papelBate(r.role, papel),
      );
      const quer = row ? row.notificar_toda_atualizacao : defaultTodaAtualizacao(papel);
      if (!quer) continue;
      inAppPorUsuario.set(id, {
        titulo: `Atualização na venda: ${label}`,
        mensagem: `Novo status: ${statusLabel}${envolvidosInApp}${data.motivo ? ` — ${data.motivo}` : ""}`,
      });
      whatsappPorUsuario.set(id, textoAtualizacaoWpp);
    }

    if (inAppPorUsuario.size > 0) {
      await admin.from("notifications").insert(
        Array.from(inAppPorUsuario, ([user_id, { titulo, mensagem }]) => ({
          organization_id: orgId,
          user_id,
          sale_id: sale.id,
          tipo: "status_change",
          titulo,
          mensagem,
        })),
      );
    }

    let sent = 0;
    let falhas = 0;
    // Status HTTP + corpo (ou mensagem de exceção) de cada falha, truncado — sem isso o
    // `activity_logs` só mostrava a contagem, e diagnosticar uma chave revogada/expirada ou API
    // fora do ar exigia reproduzir a chamada manualmente. Cap em 10 pra não inchar o payload
    // quando muita gente falha no mesmo evento.
    const erros: { status: number | null; corpo: string }[] = [];
    const apiKey = process.env.ZIONTALK_API_KEY;
    if (apiKey && whatsappPorUsuario.size > 0) {
      const profiles = await profilesInOrg<{
        id: string;
        telefone: string | null;
        ativo: boolean | null;
      }>(admin, orgId, Array.from(whatsappPorUsuario.keys()), "id, telefone, ativo");

      for (const p of profiles) {
        if (p.ativo === false) continue;
        const phone = normalizePhone(p.telefone);
        if (!phone) continue;
        const texto = whatsappPorUsuario.get(p.id);
        if (!texto) continue;
        try {
          const res = await fetch(ZIONTALK_URL, {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${apiKey}:`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ msg: paraWhatsapp(texto), mobile_phone: phone }).toString(),
            signal: AbortSignal.timeout(ZIONTALK_TIMEOUT_MS),
          });
          if (res.status === 201) sent++;
          else {
            falhas++;
            if (erros.length < 10) {
              const corpo = await res.text().catch(() => "");
              erros.push({ status: res.status, corpo: erroSemDadosPessoais(corpo) });
            }
          }
        } catch (e) {
          falhas++; // falha no envio (número inválido, API fora do ar, timeout) não deve travar a troca de status
          if (erros.length < 10) {
            const timeout = e instanceof Error && e.name === "TimeoutError";
            erros.push({
              status: null,
              corpo: timeout
                ? `timeout ${ZIONTALK_TIMEOUT_MS / 1000}s`
                : erroSemDadosPessoais(e instanceof Error ? e.message : String(e)),
            });
          }
        }
      }
    }

    await admin.from("activity_logs").insert({
      organization_id: orgId,
      autor_id: userId,
      sale_id: sale.id,
      acao: "whatsapp_notification_result",
      payload: {
        status: data.status,
        enviados: sent,
        falhas,
        ignorados: whatsappPorUsuario.size - sent - falhas,
        notificados_interno: inAppPorUsuario.size,
        ...(erros.length > 0 ? { erros } : {}),
      },
    });

    return { notified: inAppPorUsuario.size, sent };
  });

const NotifyCommentInput = z.object({
  saleId: z.string().uuid(),
  commentId: z.string().uuid(),
  texto: z.string().min(1).max(5000),
});

/** Notifica somente quem está com a próxima ação da venda, sem WhatsApp e sem alterar o fluxo de status. */
export const notifySaleComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => NotifyCommentInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (await avisosSuprimidosNoContexto(supabase)) return { notified: 0 };
    const [{ data: comment }, { data: sale }] = await Promise.all([
      supabase
        .from("sale_comments")
        .select("id, sale_id, autor_id, texto")
        .eq("id", data.commentId)
        .eq("sale_id", data.saleId)
        .maybeSingle(),
      supabase
        .from("sales")
        .select(
          "id, corretor_id, corretor_captador_id, corretor_vendedor_id, modalidade, status, imovel_id, codigo_interno",
        )
        .eq("id", data.saleId)
        .maybeSingle(),
    ]);
    if (!comment || !sale || comment.autor_id !== userId) return { notified: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { saleOrg, leaderIdsForCorretor, roleUserIds, keepOrgMembers } = await import(
      "@/lib/sale-notifications.server"
    );
    const admin = supabaseAdmin as unknown as OrgAdminClient;
    const orgId = await saleOrg(admin, sale.id);
    if (!orgId) return { notified: 0 };
    // Mesmo critério do aviso de etapa: participantes, não quem cadastrou.
    const { responsaveis, liderIds } = await responsaveisELideresNaAgencia(
      admin,
      orgId,
      sale,
      leaderIdsForCorretor,
    );

    const roleNext = proximoResponsavelRoles(sale.status as SaleStatus)[0];
    const recipientIds = new Set<string>();
    if (roleNext === "corretor") responsaveis.forEach((id) => recipientIds.add(id));
    else if (roleNext === "gestor") liderIds.forEach((id) => recipientIds.add(id));
    else if (roleNext) {
      (await roleUserIds(admin, orgId, roleNext)).forEach((id) => recipientIds.add(id));
    }
    recipientIds.delete(userId);
    const membros = await keepOrgMembers(admin, orgId, recipientIds);
    for (const id of Array.from(recipientIds)) if (!membros.has(id)) recipientIds.delete(id);
    if (recipientIds.size === 0) return { notified: 0 };

    const label = sale.imovel_id || sale.codigo_interno || `venda #${sale.id.slice(0, 8)}`;
    const { data: existingRecipients } = await admin
      .from("sale_comment_recipients")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("comment_id", comment.id);
    if (existingRecipients && existingRecipients.length > 0) {
      return { notified: existingRecipients.length };
    }
    const recipients = Array.from(recipientIds).map((user_id) => ({
      organization_id: orgId,
      comment_id: comment.id,
      sale_id: sale.id,
      user_id,
    }));
    const { error: recipientError } = await admin
      .from("sale_comment_recipients")
      .upsert(recipients, { onConflict: "comment_id,user_id", ignoreDuplicates: true });
    if (recipientError) return { notified: 0 };

    const { error: notificationError } = await admin.from("notifications").insert(
      Array.from(recipientIds, (user_id) => ({
        organization_id: orgId,
        user_id,
        sale_id: sale.id,
        tipo: "sale_comment",
        titulo: `Novo comentário na venda: ${label}`,
        mensagem: data.texto.slice(0, 240),
      })),
    );
    if (notificationError) {
      await admin
        .from("sale_comment_recipients")
        .delete()
        .eq("organization_id", orgId)
        .eq("comment_id", comment.id)
        .in("user_id", Array.from(recipientIds));
      return { notified: 0 };
    }
    return { notified: recipientIds.size };
  });
