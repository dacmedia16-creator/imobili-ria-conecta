import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  chegouAoJuridico,
  proximoResponsavelRoles,
  STATUS_LABEL,
  type SaleStatus,
} from "@/lib/status";

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";
// Sem APP_URL configurado (dev local), cai no endereço padrão do `npm run dev` deste projeto.
const APP_URL = process.env.APP_URL || "http://localhost:8080";

const NotifyInput = z.object({
  saleId: z.string().uuid(),
  status: z.string(),
  motivo: z.string().nullable().optional(),
});

type TeamMemberRow = { team_id: string };
type TeamRow = { lider_id: string | null };
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
  .inputValidator((input: unknown) => NotifyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: sale } = await supabase
      .from("sales")
      .select("id, corretor_id, imovel_id, codigo_interno, modalidade")
      .eq("id", data.saleId)
      .maybeSingle();
    if (!sale) return { notified: 0, sent: 0 };

    // team_members/user_roles de terceiros não são visíveis via RLS pro corretor comum (só se
    // enxerga a si mesmo/seu próprio líder), e o insert em `notifications` pra outro usuário também
    // exige papel elevado — o service role resolve os dois casos aqui.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tm } = await supabaseAdmin
      .from("team_members")
      .select("team_id")
      .eq("membro_id", sale.corretor_id);
    const teamIds = Array.from(new Set((tm ?? []).map((t: TeamMemberRow) => t.team_id)));
    let liderIds: string[] = [];
    if (teamIds.length) {
      // Líder auxiliar ("braço direito") recebe os mesmos avisos que o líder principal, escopado
      // à(s) mesma(s) equipe(s) — team_co_leaders soma à lista, não substitui.
      const [{ data: teams }, { data: coLeaders }] = await Promise.all([
        supabaseAdmin.from("teams").select("lider_id").in("id", teamIds),
        supabaseAdmin.from("team_co_leaders").select("user_id").in("team_id", teamIds),
      ]);
      liderIds = Array.from(
        new Set([
          ...(teams ?? []).map((t: TeamRow) => t.lider_id).filter((id): id is string => !!id),
          ...(coLeaders ?? []).map((c: { user_id: string }) => c.user_id),
        ]),
      );
    }

    const status = data.status as SaleStatus;

    // "Sua vez" — proximoResponsavelRoles nunca retorna mais de um papel por status (conferido em status.ts).
    const roleNext = proximoResponsavelRoles(status)[0];
    const proximoIds = new Set<string>();
    if (roleNext === "corretor") {
      if (sale.corretor_id) proximoIds.add(sale.corretor_id);
    } else if (roleNext === "gestor") {
      for (const l of liderIds) proximoIds.add(l);
    } else if (roleNext) {
      const { data: users } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", roleNext);
      for (const u of users ?? []) proximoIds.add(u.user_id);
    }

    // "Toda atualização" — corretor/gestor da equipe (como sempre), mais jurídico (só depois que a
    // venda chegou nele) e financeiro (vê tudo, sempre candidato).
    const atualizacaoPapelById = new Map<
      string,
      "corretor" | "gestor" | "juridico" | "financeiro"
    >();
    if (sale.corretor_id) atualizacaoPapelById.set(sale.corretor_id, "corretor");
    for (const l of liderIds)
      if (!atualizacaoPapelById.has(l)) atualizacaoPapelById.set(l, "gestor");
    if (chegouAoJuridico(status, sale.modalidade)) {
      const { data: juridicoUsers } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "juridico");
      for (const u of juridicoUsers ?? [])
        if (!atualizacaoPapelById.has(u.user_id)) atualizacaoPapelById.set(u.user_id, "juridico");
    }
    const { data: financeiroUsers } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "financeiro");
    for (const u of financeiroUsers ?? [])
      if (!atualizacaoPapelById.has(u.user_id)) atualizacaoPapelById.set(u.user_id, "financeiro");

    proximoIds.delete(userId); // quem fez a ação não precisa ser avisado de si mesmo
    atualizacaoPapelById.delete(userId);

    const candidateIds = Array.from(new Set([...proximoIds, ...atualizacaoPapelById.keys()]));
    if (candidateIds.length === 0) return { notified: 0, sent: 0 };

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, notificar_whatsapp, notificar_toda_atualizacao")
      .in("user_id", candidateIds);

    const label = sale.imovel_id || sale.codigo_interno || `venda #${sale.id.slice(0, 8)}`;
    const statusLabel = STATUS_LABEL[status] ?? data.status;
    const link = `${APP_URL}/vendas/${sale.id}`;
    const motivoLinha = data.motivo ? `Motivo: ${data.motivo}\n` : "";

    const textoSuaVezWpp = `*É a sua vez de agir!*\n\nVenda: ${label}\nStatus: ${statusLabel}\n${motivoLinha}\nAcesse: ${link}`;
    const textoAtualizacaoWpp = `*Atualização na venda*\n\nVenda: ${label}\nNovo status: ${statusLabel}\n${motivoLinha}\nAcesse: ${link}`;

    const inAppPorUsuario = new Map<string, { titulo: string; mensagem: string | null }>();
    const whatsappPorUsuario = new Map<string, string>();

    for (const id of proximoIds) {
      // "Sua vez" no sino sempre notifica — o toggle de preferência é só do WhatsApp.
      inAppPorUsuario.set(id, {
        titulo: `Sua vez de agir: ${label}`,
        mensagem: `Status: ${statusLabel}${data.motivo ? ` — ${data.motivo}` : ""}`,
      });
      const row = (rolesRows ?? []).find(
        (r: UserRoleRow) => r.user_id === id && roleNext && papelBate(r.role, roleNext),
      );
      if (row?.notificar_whatsapp !== false) whatsappPorUsuario.set(id, textoSuaVezWpp);
    }
    for (const [id, papel] of atualizacaoPapelById) {
      if (inAppPorUsuario.has(id)) continue; // já ganhou a msg de "sua vez", mais específica — não duplica
      const row = (rolesRows ?? []).find((r: UserRoleRow) => r.user_id === id && papelBate(r.role, papel));
      const quer = row ? row.notificar_toda_atualizacao : defaultTodaAtualizacao(papel);
      if (!quer) continue;
      inAppPorUsuario.set(id, {
        titulo: `Atualização na venda: ${label}`,
        mensagem: `Novo status: ${statusLabel}${data.motivo ? ` — ${data.motivo}` : ""}`,
      });
      whatsappPorUsuario.set(id, textoAtualizacaoWpp);
    }

    if (inAppPorUsuario.size > 0) {
      await supabaseAdmin.from("notifications").insert(
        Array.from(inAppPorUsuario, ([user_id, { titulo, mensagem }]) => ({
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
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, telefone, ativo")
        .in("id", Array.from(whatsappPorUsuario.keys()));

      for (const p of profiles ?? []) {
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
          });
          if (res.status === 201) sent++;
          else {
            falhas++;
            if (erros.length < 10) {
              const corpo = await res.text().catch(() => "");
              erros.push({ status: res.status, corpo: corpo.slice(0, 200) });
            }
          }
        } catch (e) {
          falhas++; // falha no envio (número inválido, API fora do ar) não deve travar a troca de status
          if (erros.length < 10) {
            erros.push({
              status: null,
              corpo: (e instanceof Error ? e.message : String(e)).slice(0, 200),
            });
          }
        }
      }
    }

    await supabaseAdmin.from("activity_logs").insert({
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
