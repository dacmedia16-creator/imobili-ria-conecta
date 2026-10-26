// Tour guiado de primeiro acesso (card t_2e09bc40). Usa driver.js (MIT, sem dependências), carregado
// só quando o tour vai abrir. Abre sozinho uma única vez por pessoa (escolha gravada no banco); depois,
// só pelo botão "Ver tour de novo" dos Guias de Ajuda.
import { useCallback, useEffect, useRef } from "react";
import type { NavGroup } from "@/lib/menu-lateral";
import {
  TOUR_EVENTO_INICIAR,
  montarPassosTour,
  statusDoEncerramento,
  type PassoTour,
} from "@/lib/tour-primeiro-acesso";
import { gravarTour, tourJaVisto } from "@/lib/tour-primeiro-acesso-db";

const CELULAR = "(max-width: 767px)"; // mesmo corte do md: do Tailwind (barra lateral escondida).
let pedidoPendente = false;

/** Fica só com passos cujo elemento existe e aparece na tela agora (ou balões sem elemento). */
function passosPresentes(passos: PassoTour[]): PassoTour[] {
  return passos.filter((p) => {
    if (!p.seletor) return true;
    const el = document.querySelector(p.seletor);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

export function TourPrimeiroAcesso({
  userId,
  groups,
  pronto,
  podeGravar,
}: {
  userId: string | undefined;
  groups: NavGroup[];
  /** Papéis e módulos já carregados (o menu está completo). */
  pronto: boolean;
  /** false em "Ver como" e no acesso da plataforma: não abre sozinho e não grava. */
  podeGravar: boolean;
}) {
  const ativo = useRef(false);
  const verificado = useRef<string | null>(null);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const iniciar = useCallback(
    async (gravar: boolean) => {
      if (ativo.current || !userId) return;
      const celular = window.matchMedia(CELULAR).matches;
      const passos = passosPresentes(montarPassosTour(groupsRef.current, { celular }));
      if (passos.length === 0) return;
      ativo.current = true;
      const { driver } = await import("driver.js");
      await import("driver.js/dist/driver.css");
      let ultimoPasso = 0;
      const d = driver({
        steps: passos.map((p) => ({
          element: p.seletor,
          popover: {
            title: p.titulo,
            description: p.texto,
            side: celular ? "bottom" : "right",
            align: "start",
          },
        })),
        showProgress: true,
        progressText: "{{current}} de {{total}}",
        nextBtnText: "Próximo",
        prevBtnText: "Voltar",
        doneBtnText: "Concluir",
        closeBtnLabel: "Pular tour",
        popoverClass: "tour-adm-max",
        overlayClickBehavior: "none", // clique fora não fecha sem querer; fecha pelo X, "Pular tour" ou Esc
        skipMissingElement: true, // elemento sumiu no meio do tour: pula o passo
        stagePadding: 6,
        smoothScroll: true,
        onHighlighted: (_el, _step, o) => {
          ultimoPasso = o.index ?? ultimoPasso;
        },
        onPopoverRender: (popover) => {
          popover.closeButton.title = "Pular tour";
          const pular = document.createElement("button");
          pular.type = "button";
          pular.className = "tour-adm-max-pular";
          pular.textContent = "Pular tour";
          pular.addEventListener("click", () => popover.closeButton.click());
          popover.footer.insertBefore(pular, popover.footer.firstChild);
        },
        onDestroyed: (_el, _step, o) => {
          ativo.current = false;
          const status = statusDoEncerramento(o.reason);
          if (gravar && status) void gravarTour(userId, status, (o.index ?? ultimoPasso) + 1);
        },
      });
      d.drive();
    },
    [userId],
  );

  // Abre sozinho na primeira vez (uma checagem por usuário por carregamento da página).
  useEffect(() => {
    if (!pronto || !podeGravar || !userId || verificado.current === userId) return;
    verificado.current = userId;
    let vivo = true;
    const t = window.setTimeout(async () => {
      const visto = await tourJaVisto(userId).catch(() => true);
      if (vivo && !visto) void iniciar(true);
    }, 900);
    return () => {
      vivo = false;
      window.clearTimeout(t);
      verificado.current = null;
    };
  }, [pronto, podeGravar, userId, iniciar]);

  // "Ver tour de novo" (Guias de Ajuda). Clique antes de o menu terminar de carregar (papéis e
  // módulos) fica pendente e abre assim que estiver pronto, para não montar passos pela metade.
  // O pedido fica no módulo (não em ref): a casca pode ser remontada enquanto carrega.
  useEffect(() => {
    const abrir = () => {
      if (pronto) void iniciar(podeGravar);
      else pedidoPendente = true;
    };
    window.addEventListener(TOUR_EVENTO_INICIAR, abrir);
    return () => window.removeEventListener(TOUR_EVENTO_INICIAR, abrir);
  }, [iniciar, podeGravar, pronto]);
  useEffect(() => {
    if (!pronto || !pedidoPendente) return;
    pedidoPendente = false;
    // Espera a barra lateral desenhar os itens recém-liberados antes de procurar os elementos.
    const t = window.setTimeout(() => void iniciar(podeGravar), 300);
    return () => window.clearTimeout(t);
  }, [pronto, iniciar, podeGravar]);

  return null;
}
