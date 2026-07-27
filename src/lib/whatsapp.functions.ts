import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { proximoResponsavelRoles, STATUS_LABEL, type SaleStatus } from "@/lib/status";

const ZIONTALK_URL = "https://app.ziontalk.com/api/send_message/";

const NotifyInput = z.object({
  saleId: z.string().uuid(),
  status: z.string(),
  titulo: z.string(),
  mensagem: z.string().nullable().optional(),
});

/** Normaliza pro formato que o ZionTalk exige: só dígitos com DDI, SEM "+" na frente (testado ao
 * vivo — com "+" a API retorna 500) — aceita o telefone digitado com ou sem DDI/máscara. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
}

/**
 * Avisa por WhatsApp (ZionTalk) toda vez que o status de uma venda muda. Roda ao lado da
 * notificação interna já existente (sale_status_history/notifications), sem travar a troca de
 * status: se a chave não estiver configurada, o telefone não estiver cadastrado, ou a API externa
 * falhar, a função só deixa de contar aquele envio — nunca lança erro pra quem chamou.
 *
 * Dois grupos de destinatário, cada um com preferência própria (ambas em user_roles, por papel):
 * - "Sua vez" (notificar_whatsapp): só quem for o papel responsável pelo status atual
 *   (proximoResponsavelRoles — mesma regra do badge "Sua vez" na lista de vendas). Papel →
 *   destinatário: corretor = o próprio corretor da venda; gestor = só o(s) líder(es) da equipe do
 *   corretor (não todo mundo com papel gestor); juridico/financeiro = todo mundo com esse papel
 *   (não há hierarquia de equipe pra esses papéis).
 * - "Toda atualização" (notificar_toda_atualizacao): o corretor da venda e o(s) líder(es) da
 *   equipe dele recebem em QUALQUER troca de status, mesmo quando não for a vez deles agir. Só
 *   existe pra esses dois papéis.
 * Quem se qualifica nos dois grupos ao mesmo tempo recebe só a mensagem de "sua vez" (mais
 * específica), não as duas. Usuário desativado (profiles.ativo = false) nunca recebe.
 */
export const notifySaleStatusChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NotifyInput.parse(input))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.ZIONTALK_API_KEY;
    if (!apiKey) return { sent: 0, skipped: "ZIONTALK_API_KEY não configurada" };

    const { supabase, userId } = context;

    const { data: sale } = await supabase
      .from("sales")
      .select("id, corretor_id, imovel_id, codigo_interno")
      .eq("id", data.saleId)
      .maybeSingle();
    if (!sale) return { sent: 0 };

    // team_members/user_roles de terceiros não são visíveis via RLS pro corretor comum (só se
    // enxerga a si mesmo/seu próprio líder) — o service role resolve isso aqui, igual já é feito
    // em team.functions.ts pro mesmo tipo de lookup.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tm } = await supabaseAdmin.from("team_members").select("team_id").eq("membro_id", sale.corretor_id);
    const teamIds = Array.from(new Set((tm ?? []).map((t: any) => t.team_id)));
    let liderIds: string[] = [];
    if (teamIds.length) {
      const { data: teams } = await supabaseAdmin.from("teams").select("lider_id").in("id", teamIds);
      liderIds = Array.from(new Set((teams ?? []).map((t: any) => t.lider_id).filter(Boolean)));
    }

    // proximoResponsavelRoles nunca retorna mais de um papel por status (conferido em status.ts).
    const roleNext = proximoResponsavelRoles(data.status as SaleStatus)[0];
    const proximoIds = new Set<string>();
    if (roleNext === "corretor") {
      if (sale.corretor_id) proximoIds.add(sale.corretor_id);
    } else if (roleNext === "gestor") {
      for (const l of liderIds) proximoIds.add(l);
    } else if (roleNext) {
      const { data: users } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", roleNext);
      for (const u of users ?? []) proximoIds.add(u.user_id);
    }

    const atualizacaoRoleById = new Map<string, "corretor" | "gestor">();
    if (sale.corretor_id) atualizacaoRoleById.set(sale.corretor_id, "corretor");
    for (const l of liderIds) if (!atualizacaoRoleById.has(l)) atualizacaoRoleById.set(l, "gestor");

    proximoIds.delete(userId); // quem fez a ação não precisa ser avisado de si mesmo
    atualizacaoRoleById.delete(userId);

    const candidateIds = Array.from(new Set([...proximoIds, ...atualizacaoRoleById.keys()]));
    if (candidateIds.length === 0) return { sent: 0 };

    const { data: rolesRows } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role, notificar_whatsapp, notificar_toda_atualizacao")
      .in("user_id", candidateIds);

    const label = sale.imovel_id || sale.codigo_interno || `venda #${sale.id.slice(0, 8)}`;
    const textoSuaVez = `${data.titulo}\nVenda: ${label}${data.mensagem ? `\n${data.mensagem}` : ""}`;
    const statusLabel = STATUS_LABEL[data.status as SaleStatus] ?? data.status;
    const textoAtualizacao = `Atualização na venda: ${statusLabel}\nVenda: ${label}${data.mensagem ? `\n${data.mensagem}` : ""}`;

    const mensagemPorUsuario = new Map<string, string>();
    for (const id of proximoIds) {
      const row = (rolesRows ?? []).find((r: any) => r.user_id === id && r.role === roleNext);
      if (row?.notificar_whatsapp !== false) mensagemPorUsuario.set(id, textoSuaVez);
    }
    for (const [id, papel] of atualizacaoRoleById) {
      if (mensagemPorUsuario.has(id)) continue; // já recebe a mensagem "sua vez" — não duplica
      const row = (rolesRows ?? []).find((r: any) => r.user_id === id && r.role === papel);
      if (row?.notificar_toda_atualizacao !== false) mensagemPorUsuario.set(id, textoAtualizacao);
    }

    if (mensagemPorUsuario.size === 0) return { sent: 0 };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, telefone, ativo")
      .in("id", Array.from(mensagemPorUsuario.keys()));

    let sent = 0;
    for (const p of profiles ?? []) {
      if (p.ativo === false) continue;
      const phone = normalizePhone(p.telefone);
      if (!phone) continue;
      const texto = mensagemPorUsuario.get(p.id);
      if (!texto) continue;
      try {
        const res = await fetch(ZIONTALK_URL, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${apiKey}:`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ msg: texto, mobile_phone: phone }).toString(),
        });
        if (res.status === 201) sent++;
      } catch {
        // falha no envio (número inválido, API fora do ar) não deve travar a troca de status
      }
    }
    return { sent };
  });
