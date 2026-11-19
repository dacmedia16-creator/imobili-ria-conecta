import { useEffect, useState } from "react";
import { medirTomDoLogo, type LogoTom } from "@/lib/logo-tom";

/**
 * Tom (claro/escuro) do logo da URL (t_331aa14e).
 * - undefined: ainda medindo (ou sem URL);
 * - null: não deu para medir (falha de carga/CORS) — quem usa aplica o padrão seguro de plaquinhaDoLogo.
 */
export function useLogoTom(url: string | null | undefined): LogoTom | null | undefined {
  const [medido, setMedido] = useState<{ url: string; tom: LogoTom | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let vivo = true;
    medirTomDoLogo(url).then((tom) => {
      if (vivo) setMedido({ url, tom });
    });
    return () => {
      vivo = false;
    };
  }, [url]);
  return medido && medido.url === url ? medido.tom : undefined;
}
