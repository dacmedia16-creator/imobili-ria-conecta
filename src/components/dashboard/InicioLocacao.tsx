import { useEffect, useState } from "react";
import { CalendarDays, KeyRound, LayoutDashboard, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL } from "@/lib/auth";
import { PageHeader } from "@/components/visual/base";
import { BentoCard, BentoGrid } from "@/components/magicui/bento-grid";
import { BannerInicio } from "@/components/dashboard/BannerInicio";
import { locacaoEnabled } from "@/lib/locacao-db";
import { roomReservationEnabled } from "@/lib/room-reservation-module";
import { achievementsEnabled } from "@/lib/mural-module";

/**
 * Início de quem é só Locação (t_1fe07126): sem números de venda; atalhos para Locação, Reserva de salas
 * e Mural de Conquistas, cada um só com o módulo ligado na imobiliária (mesma regra do menu).
 */
export function InicioLocacao() {
  const { user, roles } = useAuth();
  const [nome, setNome] = useState<string | null>(null);
  const [mods, setMods] = useState({ locacao: false, salas: false, mural: false });

  useEffect(() => {
    let vivo = true;
    Promise.all([locacaoEnabled(), roomReservationEnabled(), achievementsEnabled()]).then(
      ([locacao, salas, mural]) => {
        if (vivo) setMods({ locacao, salas, mural });
      },
    );
    if (user)
      supabase
        .from("profiles")
        .select("nome")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (vivo) setNome(data?.nome ?? null);
        });
    return () => {
      vivo = false;
    };
  }, [user]);

  const atalhos = [mods.locacao, mods.salas, mods.mural].filter(Boolean).length;
  return (
    <div className="space-y-6">
      <BannerInicio />
      <PageHeader
        icon={LayoutDashboard}
        title={`Olá, ${nome || user?.email?.split("@")[0] || ""}`}
        description={`Perfis: ${roles.map((r) => ROLE_LABEL[r]).join(", ") || "—"}`}
      />
      {atalhos > 0 && (
        <section aria-label="Atalhos">
          <BentoGrid count={atalhos}>
            {mods.locacao && (
              <BentoCard
                name="Locação"
                description="Esteira das locações, do início às chaves"
                Icon={KeyRound}
                to="/locacoes"
              />
            )}
            {mods.salas && (
              <BentoCard
                name="Reserva de salas"
                description="Reserve uma sala da imobiliária"
                Icon={CalendarDays}
                to="/reservas-salas"
              />
            )}
            {mods.mural && (
              <BentoCard
                name="Mural de Conquistas"
                description="As conquistas da equipe"
                Icon={Trophy}
                to="/mural-conquistas"
              />
            )}
          </BentoGrid>
        </section>
      )}
    </div>
  );
}
