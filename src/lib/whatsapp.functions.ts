import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { proximoResponsavelRoles, type SaleStatus } from "@/lib/status";

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
 * Avisa por WhatsApp (ZionTalk) quem for o próximo responsável por uma venda, toda vez que o
 * status muda — mesma regra de proximoResponsavelRoles() usada pro badge "Sua vez" na lista de
 * vendas. Roda ao lado da notificação interna já existente (sale_status_history/notifications),
 * sem travar a troca de status: se a chave não estiver configurada, o telefone não estiver
 * cadastrado, ou a API externa falhar, a função só deixa de contar aquele envio — nunca lança erro
 * pra quem chamou.
 *
 * Papel → destinatário:
 * - corretor: o próprio corretor da venda.
 * - gestor: só o(s) líder(es) da equipe do corretor (não todo mundo com papel gestor).
 * - juridico/financeiro: todo mundo com esse papel (não há hierarquia de equipe pra esses papéis).
 * Usuário desativado (profiles.ativo = false) nunca recebe.
 */
export const notifyProximoResponsavelWhatsapp = createServerFn({ method: "POST" })
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

    // proximoResponsavelRoles nunca retorna mais de um papel por status (conferido em status.ts) —
    // isso simplifica a filtragem por notificar_whatsapp abaixo, que é por (user_id, role).
    const role = proximoResponsavelRoles(data.status as SaleStatus)[0];
    if (!role) return { sent: 0 };

    // team_members/user_roles de terceiros não são visíveis via RLS pro corretor comum (só se
    // enxerga a si mesmo/seu próprio líder) — o service role resolve isso aqui, igual já é feito
    // em team.functions.ts pro mesmo tipo de lookup.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const userIds = new Set<string>();
    if (role === "corretor") {
      if (sale.corretor_id) userIds.add(sale.corretor_id);
    } else if (role === "gestor") {
      const { data: tm } = await supabaseAdmin.from("team_members").select("team_id").eq("membro_id", sale.corretor_id);
      const teamIds = Array.from(new Set((tm ?? []).map((t: any) => t.team_id)));
      if (teamIds.length) {
        const { data: teams } = await supabaseAdmin.from("teams").select("lider_id").in("id", teamIds);
        for (const t of teams ?? []) if (t.lider_id) userIds.add(t.lider_id);
      }
    } else {
      const { data: users } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", role);
      for (const u of users ?? []) userIds.add(u.user_id);
    }
    userIds.delete(userId); // quem fez a ação não precisa ser avisado de si mesmo

    if (userIds.size === 0) return { sent: 0 };

    // Só quem deixou notificar_whatsapp=true (default) pro papel específico que está sendo
    // notificado recebe — permite Denis (que acumula todos os papéis) desligar por função.
    const { data: optedIn } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", role)
      .eq("notificar_whatsapp", true)
      .in("user_id", Array.from(userIds));
    const optedInIds = new Set((optedIn ?? []).map((u: any) => u.user_id));
    for (const id of userIds) if (!optedInIds.has(id)) userIds.delete(id);

    if (userIds.size === 0) return { sent: 0 };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, telefone, ativo")
      .in("id", Array.from(userIds));

    const label = sale.imovel_id || sale.codigo_interno || `venda #${sale.id.slice(0, 8)}`;
    const texto = `${data.titulo}\nVenda: ${label}${data.mensagem ? `\n${data.mensagem}` : ""}`;

    let sent = 0;
    for (const p of profiles ?? []) {
      if (p.ativo === false) continue;
      const phone = normalizePhone(p.telefone);
      if (!phone) continue;
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
