import { useEffect, useMemo, useState } from "react";
import type { AgencyProfile } from "@/lib/agency-profile";
import {
  listSiteListings,
  marcarLocalInvalida,
  splitSiteListings,
  type SiteListing,
} from "@/lib/mapa-anuncios-site";

/**
 * Camada "Site RE/MAX · venda" compartilhada pelo Painel de exclusividades e pelo Mapa de captações
 * (t_17cb27a7): mesma RPC (mapa_anuncios_site), mesma separação sem duplicar.
 * Carrega uma vez, depois que o perfil da imobiliária chega. Se a imobiliária desligou a opção
 * (mapa_site_enabled = false), nem chama — o banco também devolveria vazio.
 * Falha aqui não derruba a tela: só a camada fica indisponível.
 * Coordenada inválida vinda do site (0/0, fora do Brasil, longe da cidade) não vira pino: o anúncio
 * solto sai de `soltos` e é contado em `foraDoMapa` (t_9f374e4d).
 */
export function useSiteListings(agency: AgencyProfile | null) {
  const [site, setSite] = useState<SiteListing[]>([]);
  const [erro, setErro] = useState(false);
  const habilitado = !!agency && agency.mapa_site_enabled !== false;

  useEffect(() => {
    if (!habilitado) return;
    let cancelado = false;
    listSiteListings()
      .then((l) => !cancelado && setSite(marcarLocalInvalida(l)))
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, [habilitado]);

  const { soltos, porCaptacao, foraDoMapa } = useMemo(() => splitSiteListings(site), [site]);
  return { site, erro, soltos, porCaptacao, foraDoMapa };
}
