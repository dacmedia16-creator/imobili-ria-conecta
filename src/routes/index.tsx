import { createFileRoute, Link } from "@tanstack/react-router";
import { MaxHubLogo } from "@/components/MaxHubAuthShell";
import { HubWheel, type WheelId, type WheelItem } from "@/components/HubWheel";

// O Hub fica visível mesmo pra quem já está logado no ADM -- antes, qualquer sessão ativa era
// redirecionada direto pro /dashboard, sem chance de escolher outro sistema. O resto do app (login,
// troca de senha, etc.) que dependia de "/" encaminhar pro dashboard agora aponta direto pra
// "/dashboard", pra não perder esse comportamento em nenhum desses fluxos.
const IS_HOMOLOG = import.meta.env.VITE_HOMOLOG_ONLY === "true";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [{ title: IS_HOMOLOG ? "ADM MAX — Homologação" : "MAX Hub — Todos os sistemas MAX" }],
  }),
  component: IS_HOMOLOG ? HomologHome : FrontPage,
});

function HomologHome() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b1330] p-6 text-white">
      <div className="w-full max-w-md rounded-xl border border-white/20 bg-white/10 p-8 text-center shadow-xl">
        <h1 className="text-3xl font-bold">ADM MAX</h1>
        <p className="mt-2 text-sm text-white/70">
          Ambiente interno de homologação · dados fictícios
        </p>
        <p className="mt-6">Gestão de imobiliárias, equipes, vendas e relatórios em um só lugar.</p>
        <Link
          to="/auth"
          className="mt-8 inline-block rounded-md bg-white px-6 py-3 font-semibold text-[#0b1330] hover:bg-white/90"
        >
          Acessar demonstração
        </Link>
      </div>
    </main>
  );
}

/** Cada card abre o sistema externo correspondente numa aba nova.
 * Sem `href` = sistema ainda não tem endereço definido, aparece marcado "Em breve". */
type CardColor = "navy" | "blue" | "red";
type ServiceCard = {
  id: string;
  title: string;
  lines: [string, string];
  icon: string;
  color: CardColor;
  href?: string;
  pos: { left: string; top: string; width: string; height: string };
  delay: string;
};

const CARDS: ServiceCard[] = [
  {
    id: "adm",
    title: "Sistema ADM MAX",
    lines: ["Gestão administrativa", "Subir Contratos"],
    icon: "/hub/adm.png",
    color: "navy",
    href: "https://conta.somosmaxhub.com.br/login?app=adm-max",
    pos: { left: "11%", top: "30.7%", width: "23.8%", height: "10.6%" },
    delay: "0s",
  },
  {
    id: "estudo",
    title: "Estudo de Mercado MAX",
    lines: ["Análise estratégica", "de mercado"],
    icon: "/hub/estudo.png",
    color: "blue",
    href: "https://conta.somosmaxhub.com.br/login?app=estudo-mercado-max",
    pos: { left: "7.7%", top: "48.1%", width: "27.5%", height: "10.6%" },
    delay: "0.35s",
  },
  {
    id: "academia",
    title: "Academia MAX",
    lines: ["Treinamento e", "desenvolvimento"],
    icon: "/hub/academia.png",
    color: "blue",
    pos: { left: "9.7%", top: "65.1%", width: "25.8%", height: "10.6%" },
    delay: "0.7s",
  },
  {
    id: "60dias",
    title: "60 Dias MAX",
    lines: ["Acompanhamento e", "performance inicial"],
    icon: "/hub/60dias.png",
    color: "red",
    pos: { left: "65.2%", top: "30.7%", width: "23.2%", height: "10.6%" },
    delay: "1.05s",
  },
  {
    id: "recruta",
    title: "Recruta MAX",
    lines: ["Captação e seleção", "de talentos"],
    icon: "/hub/recruta.png",
    color: "blue",
    pos: { left: "67%", top: "48.1%", width: "21.7%", height: "10.6%" },
    delay: "1.4s",
  },
  {
    id: "locacao",
    title: "Locação MAX",
    lines: ["Gestão do setor", "de locação"],
    icon: "/hub/locacao.png",
    color: "blue",
    pos: { left: "65.2%", top: "65.1%", width: "23.2%", height: "10.6%" },
    delay: "1.75s",
  },
  {
    id: "visita",
    title: "Visita MAX",
    lines: ["Registro e proteção", "de visitas"],
    icon: "/hub/visita.png",
    color: "blue",
    href: "https://conta.somosmaxhub.com.br/login?app=visita-max",
    pos: { left: "39%", top: "75.1%", width: "22.3%", height: "11.6%" },
    delay: "2.1s",
  },
  {
    id: "especialistas",
    title: "Ache um especialista",
    lines: ["Encontre corretores", "por região"],
    icon: "/hub/especialistas.svg",
    color: "red",
    href: "/especialistas",
    pos: { left: "67%", top: "78.2%", width: "23.2%", height: "10.6%" },
    delay: "2.45s",
  },
];

/** Itens da roda: mesmos sistemas e mesmos destinos dos cartões (fonte única = CARDS). */
const WHEEL_ITEMS: WheelItem[] = CARDS.map((c) => ({
  id: c.id as WheelId,
  title: c.title,
  href: c.href,
}));

const ADM_MAX_LOGIN_URL =
  "https://conta.somosmaxhub.com.br/login?app=adm-max&return_to=%2Freservas-salas";

function CardIcon({ card }: { card: ServiceCard }) {
  return (
    <span className={`icon-wrap ${card.color}`}>
      <span className="icon-ping" style={{ animationDelay: card.delay }} />
      <span className="icon">
        <img src={card.icon} alt={card.title} style={{ animationDelay: card.delay }} />
      </span>
    </span>
  );
}

function SingleLoginBanner() {
  return (
    <div
      className="single-login-banner"
      role="status"
      aria-label="Login Único da Conta MAX disponível"
    >
      <span className="single-login-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="10" width="18" height="11" rx="3" />
          <path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" />
          <circle cx="12" cy="15.5" r="1.25" />
        </svg>
      </span>
      <span className="single-login-copy">
        <b>Novidade no Ecossistema MAX</b>
        <strong>Uma conta. Todos os sistemas MAX.</strong>
        <span>
          Com o Login Único, você entra uma vez com o Google e acessa os sistemas liberados para
          você.
        </span>
      </span>
      <span className="single-login-actions">
        <a href="https://conta.somosmaxhub.com.br/logout" className="single-login-switch">
          Trocar conta
        </a>
        <a href="https://conta.somosmaxhub.com.br/logout" className="single-login-status">
          <span aria-hidden="true" /> Sair da Conta MAX
        </a>
      </span>
    </div>
  );
}

function FrontPage() {
  return (
    <div className="hubpage">
      <style>{`
        .hubpage {
          /* Paleta da página MAX HUB (somosmaxhub.com.br), igual ao login novo (PR #139). */
          --navy: #0b1b33;
          --navy-800: #14305a;
          --red: #dc1c2e;
          --red-dark: #c41626;
          --red-soft: #f04a59;
          --blue-line: #8fb4e8;
          --gray: #a9b8cf;
          --gold: #e3c682;
          --card-bg: rgba(7, 19, 37, 0.72);
          position: relative; isolation: isolate; overflow-x: hidden;
          min-height: 100vh;
          background: var(--navy);
          font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
          color: #fff;
          padding-bottom: env(safe-area-inset-bottom);
        }
        @font-face {
          font-family: "Barlow Condensed";
          font-weight: 800;
          font-style: normal;
          font-display: swap;
          src: url(/fonts/barlow-condensed-800.woff2) format("woff2");
        }
        @font-face {
          font-family: "Barlow Condensed";
          font-weight: 600;
          font-style: normal;
          font-display: swap;
          src: url(/fonts/barlow-condensed-600.woff2) format("woff2");
        }
        .hubpage .display { font-family: "Barlow Condensed", "Segoe UI", system-ui, sans-serif; font-weight: 800; }
        .hubpage .hub-bg { position: absolute; inset: 0; z-index: -1; pointer-events: none; }
        .hubpage .hub-glow { position: absolute; inset: 0; z-index: -1; pointer-events: none;
          background: radial-gradient(720px circle at 72% 18%, rgb(42 79 134 / 0.45), transparent 60%); }
        .hubpage a:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
        .hubpage .brand { display: inline-flex; align-items: center; text-decoration: none; }
        .hubpage .eyebrow {
          display: inline-flex; align-items: center; gap: 10px; margin: 0;
          font-size: 11px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gray);
        }
        .hubpage .eyebrow::before { content: ""; width: 24px; height: 1px; background: var(--red); }
        .hubpage .htitle {
          font-family: "Sora", ui-sans-serif, system-ui, sans-serif; font-weight: 800;
          letter-spacing: -0.04em; line-height: 1; color: #fff;
        }
        .hubpage .htitle a { color: inherit; text-decoration: none; }
        .hubpage .htitle .sky { color: var(--blue-line); }
        .hubpage .htitle .dot { color: var(--red); }

        /* ---------- ícones e animações (compartilhados entre poster e lista mobile) ---------- */
        .hubpage .icon-wrap { position: relative; flex: none; width: 26%; aspect-ratio: 1; }
        .hubpage .icon-wrap.navy { --c1: #2a4f86; --c2: #14305a; }
        .hubpage .icon-wrap.blue { --c1: #8fb4e8; --c2: #2a4f86; }
        .hubpage .icon-wrap.red { --c1: var(--red-soft); --c2: var(--red-dark); }
        .hubpage .icon-ping {
          position: absolute; inset: 0; border-radius: 999px;
          background: linear-gradient(160deg, var(--c1), var(--c2));
          animation: hubIconPing 2.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
        }
        .hubpage .icon {
          position: absolute; inset: 0; border-radius: 999px; background: #fff;
          box-shadow: 0 0 0 1px rgba(143, 180, 232, 0.35), 0 6px 16px -6px rgba(0, 0, 0, 0.6);
          display: flex; align-items: center; justify-content: center;
          overflow: hidden; padding: 12%;
        }
        .hubpage .icon img {
          width: 100%; height: 100%; object-fit: contain;
          animation: hubIconSway 3.6s ease-in-out infinite;
          transform-origin: 50% 65%;
        }
        .hubpage .card:hover .icon img, .hubpage .mcard:hover .icon img {
          animation-play-state: paused;
          transform: scale(1.14) rotate(-6deg);
          transition: transform 0.25s ease;
        }
        @keyframes hubIconPing {
          0% { transform: scale(1); opacity: 0.5; }
          75%, 100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes hubIconSway {
          0%, 100% { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(-6deg) scale(1.05); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hubpage .icon-ping, .hubpage .icon img { animation: none; }
        }
        .hubpage .soon-badge {
          position: absolute; right: 10px; top: -9px;
          background: var(--navy); border: 1px solid rgba(227, 198, 130, 0.45);
          color: var(--gold); font-size: 0.62rem; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase;
          padding: 2px 10px; border-radius: 999px;
        }
        .hubpage .access-badge {
          position: absolute; right: 10px; top: -9px;
          background: var(--red);
          color: #fff; font-size: 0.62rem; font-weight: 700;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 3px 11px; border-radius: 999px;
          box-shadow: 0 8px 22px -8px rgba(220, 28, 46, 0.75);
          transition: background 0.2s ease;
        }
        .hubpage .card.soon, .hubpage .mcard.soon { cursor: default; border-color: rgba(255, 255, 255, 0.06); background: rgba(7, 19, 37, 0.35); }
        .hubpage .card.soon .icon-wrap, .hubpage .mcard.soon .icon-wrap { opacity: 0.6; filter: grayscale(0.5); }
        .hubpage .card.soon h3, .hubpage .mcard.soon h3 { color: rgba(255, 255, 255, 0.8); }
        .hubpage .card.soon p, .hubpage .mcard.soon p { color: rgba(255, 255, 255, 0.7); }
        .hubpage a:hover .access-badge { background: var(--red-dark); }
        .hubpage .card.soon .icon-ping, .hubpage .card.soon .icon img,
        .hubpage .mcard.soon .icon-ping, .hubpage .mcard.soon .icon img { animation: none; }
        .hubpage .card.soon:hover .icon img, .hubpage .mcard.soon:hover .icon img { transform: none; }

        /* ---------- poster (tablet/desktop, >=860px) ---------- */
        .hubpage .stage { display: none; }
        @media (min-width: 860px) {
          .hubpage .stage { display: block; max-width: 1680px; margin: 0 auto; padding: clamp(1rem, 3vw, 2.5rem); overflow-x: auto; }
        }
        .hubpage .canvas {
          position: relative;
          width: 100%;
          min-width: 800px;
          aspect-ratio: 1680 / 945;
          border-radius: 18px;
          overflow: hidden;
          background: radial-gradient(120% 140% at 78% -10%, rgb(42 79 134 / 0.35) 0%, rgba(7, 19, 37, 0.6) 60%);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.8);
        }
        .hubpage .dotgrid {
          position: absolute; left: 0; bottom: 0; width: 15%; height: 30%;
          background-image: radial-gradient(circle, rgba(143, 180, 232, 0.35) 1.4px, transparent 1.4px);
          background-size: 20px 20px;
          -webkit-mask-image: linear-gradient(115deg, black 20%, transparent 75%);
          mask-image: linear-gradient(115deg, black 20%, transparent 75%);
          opacity: 0.8;
        }
        .hubpage .corner-navy {
          position: absolute; right: 0; bottom: 0; width: 36%; height: 26%;
          background: var(--navy-800); clip-path: polygon(100% 20%, 100% 100%, 32% 100%);
        }
        .hubpage .corner-seam {
          position: absolute; right: 0; bottom: 0; width: 30%; height: 20%;
          background: var(--red-soft); clip-path: polygon(100% 30%, 100% 100%, 42% 100%);
        }
        .hubpage .corner-red {
          position: absolute; right: 0; bottom: 0; width: 27.5%; height: 18%;
          background: linear-gradient(100deg, var(--red), var(--red-dark));
          clip-path: polygon(100% 32%, 100% 100%, 45% 100%);
        }
        .hubpage .logo { position: absolute; left: 39%; top: 1.6%; width: 21%; display: block; }
        .hubpage .logo img { width: 100%; height: auto; display: block; transition: transform 0.15s ease, opacity 0.15s ease; }
        .hubpage .logo:hover img { transform: translateY(-1px); opacity: 0.85; }
        .hubpage .titleblock { position: absolute; left: 3.4%; top: 6%; width: 48%; }
        .hubpage .titleblock h1 { margin: 0.9rem 0 0; font-size: clamp(2.2rem, 5vw, 5rem); }
        .hubpage .titleblock h1 a, .hubpage .mhero h1 a { text-decoration: none; }
        .hubpage .titleblock p:not(.eyebrow) { margin: 0.7rem 0 0; font-size: clamp(0.7rem, 1.15vw, 1.3rem); color: var(--gray); font-weight: 400; }
        .hubpage .reservation-link {
          position: absolute; right: 3.4%; top: 15.5%; z-index: 4;
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          width: 17%; min-width: 154px; max-width: 188px; height: 46px;
          border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 999px;
          background: rgba(7, 19, 37, 0.55); color: rgba(255, 255, 255, 0.9);
          font-size: clamp(0.68rem, 0.88vw, 0.9rem); font-weight: 600;
          text-decoration: none; transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
        }
        .hubpage .reservation-link:hover,
        .hubpage .reservation-link:focus-visible {
          border-color: rgba(255, 255, 255, 0.4); color: #fff;
          transform: translateY(-1px);
        }
        .hubpage .reservation-link svg { width: 22px; height: 22px; flex: none; fill: none; stroke: var(--blue-line); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .reservation-link svg .accent { stroke: var(--red); }
        /* Roda do MAX HUB no centro do poster (44% da altura; 945/1680 converte para largura). */
        .hubpage .hub { position: absolute; left: 36.5%; top: 25%; width: 24.75%; z-index: 2; }
        .hubpage .card {
          position: absolute; display: flex; align-items: center; gap: 3.2%;
          background: var(--card-bg); border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.7);
          padding: 0 3.4%; transition: border-color 0.3s ease;
        }
        .hubpage a:hover .card { border-color: rgba(220, 28, 46, 0.5); }
        .hubpage .txt h3 { margin: 0; color: #fff; font-family: "Sora", ui-sans-serif, sans-serif; font-weight: 600; letter-spacing: -0.01em; font-size: clamp(0.58rem, 1.18vw, 1.12rem); line-height: 1.15; white-space: nowrap; }
        .hubpage .txt p { margin: 0.2em 0 0; color: var(--gray); font-weight: 400; font-size: clamp(0.52rem, 1.05vw, 1rem); line-height: 1.22; }
        .hubpage .footbar { position: absolute; left: 3.4%; bottom: 9%; display: flex; align-items: center; gap: 1.1%; }
        .hubpage .footbar .fico { width: 3.9%; aspect-ratio: 1; border-radius: 22%; background: var(--red); display: flex; align-items: center; justify-content: center; }
        .hubpage .footbar .fico svg { width: 55%; height: 55%; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .footbar .fdiv { width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.2); }
        .hubpage .footbar p { margin: 0; color: rgba(255, 255, 255, 0.85); font-weight: 500; font-size: clamp(0.6rem, 1.15vw, 1.15rem); }
        .hubpage a.card-link { text-decoration: none; }

        .hubpage .single-login-banner {
          display: flex; align-items: center; gap: 16px;
          color: #fff; text-decoration: none;
          background:
            radial-gradient(420px circle at 85% 0%, rgba(220, 28, 46, 0.18), transparent 60%),
            #14305a;
          border: 1px solid rgba(143, 180, 232, 0.35);
          border-radius: 24px; padding: 16px 20px;
          box-shadow: 0 30px 80px -30px rgba(42, 79, 134, 0.9);
          cursor: default;
        }
        .hubpage .single-login-icon {
          display: grid; place-items: center; flex: none;
          width: 50px; height: 50px; border-radius: 15px;
          background: var(--red);
          box-shadow: 0 10px 30px -8px rgba(220, 28, 46, 0.7);
        }
        .hubpage .single-login-icon svg { width: 26px; height: 26px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .single-login-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; }
        .hubpage .single-login-copy b {
          color: var(--gray); font-size: 0.68rem; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase;
        }
        .hubpage .single-login-copy strong { margin-top: 4px; font-family: "Sora", ui-sans-serif, sans-serif; font-weight: 700; letter-spacing: -0.02em; font-size: 1.1rem; line-height: 1.2; }
        .hubpage .single-login-copy > span { margin-top: 3px; color: rgba(255, 255, 255, 0.78); font-size: 0.8rem; }
        .hubpage .single-login-status {
          display: inline-flex; align-items: center; gap: 7px;
          flex: none; border-radius: 999px; background: var(--red); color: #fff;
          padding: 10px 18px; font-size: 0.78rem; font-weight: 600; white-space: nowrap;
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        .hubpage .single-login-status:hover {
          background: var(--red-dark); box-shadow: 0 10px 40px -8px rgba(220, 28, 46, 0.7);
        }
        .hubpage .single-login-actions {
          display: flex; flex: none; align-items: center; gap: 8px;
        }
        .hubpage .single-login-actions a { text-decoration: none; }
        .hubpage .single-login-switch {
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 999px;
          color: rgba(255, 255, 255, 0.85); font-size: 0.78rem; font-weight: 600; padding: 10px 16px;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .hubpage .single-login-switch:hover,
        .hubpage .single-login-switch:focus-visible {
          border-color: rgba(255, 255, 255, 0.4); color: #fff;
        }
        .hubpage .single-login-status > span {
          width: 8px; height: 8px; border-radius: 999px; background: #6ee7a8;
          box-shadow: 0 0 0 4px rgba(110, 231, 168, 0.14);
        }
        .hubpage .stage > .single-login-banner { max-width: 1120px; margin: 0 auto 20px; }
        .hubpage .topbar { display: none; }
        @media (min-width: 860px) { .hubpage .topbar { max-width: 1680px; margin: 0 auto; height: 64px; display: flex; align-items: center; padding: 0 clamp(1rem, 3vw, 2.5rem); } }

        /* ---------- lista mobile (<860px) ---------- */
        .hubpage .mobile-stage { display: block; max-width: 560px; margin: 0 auto; padding: 0 18px 32px; }
        @media (min-width: 860px) { .hubpage .mobile-stage { display: none; } }

        .hubpage .mheader {
          position: relative; min-height: 34px; display: flex; align-items: center; justify-content: flex-start;
          padding-top: max(18px, env(safe-area-inset-top));
        }
        .hubpage .mlogo { height: 38px; width: auto; display: block; margin: 0 auto; transition: opacity 0.15s ease; }
        .hubpage .mheader a:active .mlogo { opacity: 0.7; }
        .hubpage .mobile-reservation-link {
          position: absolute; right: 0; top: max(16px, env(safe-area-inset-top));
          display: inline-flex; align-items: center; gap: 5px;
          border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 999px;
          background: rgba(7, 19, 37, 0.55); color: rgba(255, 255, 255, 0.9);
          padding: 7px 11px; font-size: 0.7rem; font-weight: 600; text-decoration: none;
        }
        .hubpage .mobile-reservation-link svg { width: 16px; height: 16px; fill: none; stroke: var(--blue-line); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .mobile-reservation-link svg .accent { stroke: var(--red); }
        .hubpage .mhero { margin-top: 40px; text-align: left; }
        .hubpage .mhero h1 { margin: 0.8rem 0 0; font-size: 3rem; }
        .hubpage .mhero p:not(.eyebrow) { margin: 0.6rem 0 0; color: var(--gray); font-size: 0.95rem; }

        .hubpage .mobile-stage .single-login-banner {
          margin-top: 20px; align-items: flex-start; flex-wrap: wrap; gap: 11px; padding: 14px;
        }
        .hubpage .mobile-stage .single-login-icon { width: 44px; height: 44px; border-radius: 13px; }
        .hubpage .mobile-stage .single-login-copy { min-width: calc(100% - 58px); }
        .hubpage .mobile-stage .single-login-copy strong { font-size: 1rem; }
        .hubpage .mobile-stage .single-login-copy > span { font-size: 0.76rem; line-height: 1.3; }
        .hubpage .mobile-stage .single-login-actions { width: 100%; }
        .hubpage .mobile-stage .single-login-actions a { flex: 1; }
        .hubpage .mobile-stage .single-login-status { justify-content: center; padding: 9px 12px; }

        .hubpage .mhub { position: relative; width: 100%; max-width: 420px; margin: 22px auto 0; padding: 0 2px; }
        .hubpage .mhub-hint { margin: 6px 0 0; text-align: center; color: var(--gray); font-size: 0.78rem; }

        .hubpage .mlist { display: flex; flex-direction: column; gap: 12px; margin-top: 26px; }
        .hubpage .mcard {
          position: relative; display: flex; align-items: center; gap: 14px;
          background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px; padding: 14px 16px;
          text-decoration: none; color: inherit; transition: border-color 0.3s ease;
        }
        .hubpage .mcard .icon-wrap { width: 50px; height: 50px; }
        .hubpage a.mcard:hover, .hubpage a.mcard:active { border-color: rgba(220, 28, 46, 0.5); }
        .hubpage .mcard h3 { margin: 0; color: #fff; font-family: "Sora", ui-sans-serif, sans-serif; font-weight: 600; letter-spacing: -0.01em; font-size: 0.98rem; }
        .hubpage .mcard p { margin: 0.15em 0 0; color: var(--gray); font-weight: 400; font-size: 0.8rem; line-height: 1.25; }

        .hubpage .mfoot {
          display: flex; align-items: flex-start; gap: 12px;
          margin-top: 28px; padding-top: 18px; border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .hubpage .mfoot .fico {
          width: 34px; height: 34px; border-radius: 22%; background: var(--red);
          display: flex; align-items: center; justify-content: center; flex: none;
        }
        .hubpage .mfoot .fico svg { width: 55%; height: 55%; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .mfoot p { margin: 0; color: rgba(255, 255, 255, 0.85); font-weight: 500; font-size: 0.85rem; line-height: 1.3; }
      `}</style>

      <div className="hub-bg maxhub-grid-lines" aria-hidden="true" />
      <div className="hub-glow" aria-hidden="true" />
      <div className="hub-bg maxhub-grain" aria-hidden="true" />

      {/* ---------- poster (tablet/desktop) ---------- */}
      <div className="topbar">
        <Link to="/auth" className="brand" aria-label="MAX Hub — entrar no portal">
          <MaxHubLogo />
        </Link>
      </div>
      <div className="stage">
        <SingleLoginBanner />
        <div className="canvas">
          <div className="dotgrid" />
          <div className="corner-navy" />
          <div className="corner-seam" />
          <div className="corner-red" />

          <div className="titleblock">
            <p className="eyebrow">Plataforma integrada</p>
            <h1 className="htitle">
              <Link to="/auth" aria-label="MAX Hub — entrar no portal">
                MAX <span className="sky">Hub</span>
                <span className="dot">.</span>
              </Link>
            </h1>
            <p>Todos os sistemas MAX em um só lugar</p>
          </div>

          <a
            href={ADM_MAX_LOGIN_URL}
            className="reservation-link"
            aria-label="Abrir reserva de sala"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="17" rx="3" />
              <path d="M3 9h18M8 2v4M16 2v4" />
              <circle className="accent" cx="8" cy="14" r="1" />
              <circle cx="13" cy="14" r="1" />
              <circle cx="8" cy="18" r="1" />
              <circle cx="13" cy="18" r="1" />
            </svg>
            <span>Reserva de Sala</span>
          </a>

          <div className="hub">
            <HubWheel items={WHEEL_ITEMS} />
          </div>

          {CARDS.map((c) =>
            c.href ? (
              <a
                key={c.id}
                className="card-link"
                href={c.href}
                {...(c.href.startsWith("/")
                  ? {}
                  : { target: "_blank", rel: "noopener noreferrer" })}
              >
                <div className="card" style={c.pos}>
                  <span className="access-badge">Acessar →</span>
                  <CardIcon card={c} />
                  <span className="txt">
                    <h3>{c.title}</h3>
                    <p>
                      {c.lines[0]}
                      <br />
                      {c.lines[1]}
                    </p>
                  </span>
                </div>
              </a>
            ) : (
              <div key={c.id} className="card-link">
                <div className="card soon" style={c.pos}>
                  <span className="soon-badge">Em breve</span>
                  <CardIcon card={c} />
                  <span className="txt">
                    <h3>{c.title}</h3>
                    <p>
                      {c.lines[0]}
                      <br />
                      {c.lines[1]}
                    </p>
                  </span>
                </div>
              </div>
            ),
          )}

          <div className="footbar">
            <span className="fico">
              <svg viewBox="0 0 24 24">
                <path d="M3 18 9 11l4 3 8-9" />
                <path d="M15 4h6v6" />
              </svg>
            </span>
            <span className="fdiv" />
            <p>Soluções integradas para gestão, recrutamento, capacitação e crescimento.</p>
          </div>
        </div>
      </div>

      {/* ---------- lista mobile ---------- */}
      <div className="mobile-stage">
        <div className="mheader">
          <Link to="/auth" className="brand" aria-label="MAX Hub — entrar no portal">
            <MaxHubLogo />
          </Link>
          <a
            href={ADM_MAX_LOGIN_URL}
            className="mobile-reservation-link"
            aria-label="Abrir reserva de sala"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="17" rx="3" />
              <path d="M3 9h18M8 2v4M16 2v4" />
              <circle className="accent" cx="8" cy="14" r="1" />
              <circle cx="13" cy="14" r="1" />
              <circle cx="8" cy="18" r="1" />
              <circle cx="13" cy="18" r="1" />
            </svg>
            <span>Reserva de Sala</span>
          </a>
        </div>

        <div className="mhero">
          <p className="eyebrow">Plataforma integrada</p>
          <h1 className="htitle">
            <Link to="/auth" aria-label="MAX Hub — entrar no portal">
              MAX <span className="sky">Hub</span>
              <span className="dot">.</span>
            </Link>
          </h1>
          <p>Todos os sistemas MAX em um só lugar</p>
        </div>

        <SingleLoginBanner />

        <div className="mhub">
          <HubWheel items={WHEEL_ITEMS} />
        </div>
        <p className="mhub-hint">Toque num sistema da roda ou escolha na lista abaixo.</p>

        <div className="mlist">
          {CARDS.map((c) =>
            c.href ? (
              <a
                key={c.id}
                className="mcard"
                href={c.href}
                {...(c.href.startsWith("/")
                  ? {}
                  : { target: "_blank", rel: "noopener noreferrer" })}
              >
                <span className="access-badge">Acessar →</span>
                <CardIcon card={c} />
                <span className="txt">
                  <h3>{c.title}</h3>
                  <p>
                    {c.lines[0]} {c.lines[1]}
                  </p>
                </span>
              </a>
            ) : (
              <div key={c.id} className="mcard soon">
                <span className="soon-badge">Em breve</span>
                <CardIcon card={c} />
                <span className="txt">
                  <h3>{c.title}</h3>
                  <p>
                    {c.lines[0]} {c.lines[1]}
                  </p>
                </span>
              </div>
            ),
          )}
        </div>

        <div className="mfoot">
          <span className="fico">
            <svg viewBox="0 0 24 24">
              <path d="M3 18 9 11l4 3 8-9" />
              <path d="M15 4h6v6" />
            </svg>
          </span>
          <p>Soluções integradas para gestão, recrutamento, capacitação e crescimento.</p>
        </div>
      </div>

      <p className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-white/60">
        Acesso apenas por convite. Peça acesso ao administrador ou ao seu gestor. ©{" "}
        {new Date().getFullYear()} MAX Hub
      </p>
    </div>
  );
}
