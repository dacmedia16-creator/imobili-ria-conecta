import { createFileRoute, Link } from "@tanstack/react-router";
import { useId } from "react";

// O Hub fica visível mesmo pra quem já está logado no ADM -- antes, qualquer sessão ativa era
// redirecionada direto pro /dashboard, sem chance de escolher outro sistema. O resto do app (login,
// troca de senha, etc.) que dependia de "/" encaminhar pro dashboard agora aponta direto pra
// "/dashboard", pra não perder esse comportamento em nenhum desses fluxos.
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Hub Única Escolha — RE/MAX Imóveis" }] }),
  component: FrontPage,
});

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
  { id: "adm", title: "Sistema ADM MAX", lines: ["Gestão administrativa", "Subir Contratos"], icon: "/hub/adm.png", color: "navy", href: "https://conta-max-poc.dacmedia16.workers.dev/login?app=adm-max", pos: { left: "11%", top: "30.7%", width: "23.8%", height: "10.6%" }, delay: "0s" },
  { id: "estudo", title: "Estudo de Mercado MAX", lines: ["Análise estratégica", "de mercado"], icon: "/hub/estudo.png", color: "blue", href: "https://www.estudodemercadomax.com.br/", pos: { left: "7.7%", top: "48.1%", width: "27.5%", height: "10.6%" }, delay: "0.35s" },
  { id: "academia", title: "Academia Única MAX", lines: ["Treinamento e", "desenvolvimento"], icon: "/hub/academia.png", color: "blue", pos: { left: "9.7%", top: "65.1%", width: "25.8%", height: "10.6%" }, delay: "0.7s" },
  { id: "60dias", title: "60 Dias MAX", lines: ["Acompanhamento e", "performance inicial"], icon: "/hub/60dias.png", color: "red", pos: { left: "65.2%", top: "30.7%", width: "23.2%", height: "10.6%" }, delay: "1.05s" },
  { id: "recruta", title: "Recruta MAX", lines: ["Captação e seleção", "de talentos"], icon: "/hub/recruta.png", color: "blue", pos: { left: "67%", top: "48.1%", width: "21.7%", height: "10.6%" }, delay: "1.4s" },
  { id: "locacao", title: "Locação MAX", lines: ["Gestão do setor", "de locação"], icon: "/hub/locacao.png", color: "blue", pos: { left: "65.2%", top: "65.1%", width: "23.2%", height: "10.6%" }, delay: "1.75s" },
  { id: "visita", title: "Visita MAX", lines: ["Registro e proteção", "de visitas"], icon: "/hub/visita.png", color: "blue", href: "https://conta-max-poc.dacmedia16.workers.dev/login?app=visita-max", pos: { left: "39%", top: "75.1%", width: "22.3%", height: "11.6%" }, delay: "2.1s" },
  { id: "especialistas", title: "Ache um especialista", lines: ["Encontre corretores", "por região"], icon: "/hub/especialistas.svg", color: "red", href: "/especialistas", pos: { left: "67%", top: "78.2%", width: "23.2%", height: "10.6%" }, delay: "2.45s" },
];

function CardIcon({ card }: { card: ServiceCard }) {
  return (
    <span className={`icon-wrap ${card.color}`}>
      <span className="icon-ping" style={{ animationDelay: card.delay }} />
      <span className="icon"><img src={card.icon} alt={card.title} style={{ animationDelay: card.delay }} /></span>
    </span>
  );
}

function HubHex() {
  const gradientId = `hexFill-${useId()}`;
  return (
    <>
      <div className="hub-hex">
        <svg viewBox="0 0 200 200">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0.6" y2="1">
              <stop offset="0%" stopColor="#243867" />
              <stop offset="75%" stopColor="#0c1730" />
            </linearGradient>
          </defs>
          <path
            d="M42.474,21.588 Q52,4 72,4 L128,4 Q148,4 157.526,21.588 L190.474,82.412 Q200,100 190.474,117.588 L157.526,178.412 Q148,196 128,196 L72,196 Q52,196 42.474,178.412 L9.526,117.588 Q0,100 9.526,82.412 Z"
            fill={`url(#${gradientId})`}
            stroke="#dbe4f7"
            strokeWidth="5"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="hub-text">
        <span className="max display">MAX</span>
        <span className="hub2 display">HUB</span>
        <span className="underline" />
        <span className="caption">PLATAFORMA<br />INTEGRADA</span>
      </div>
    </>
  );
}

function PositioningBanner() {
  return (
    <Link to="/perfil" className="positioning-banner">
      <span className="positioning-pin" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.6" />
        </svg>
      </span>
      <span className="positioning-copy">
        <b>Novo no MAX HUB</b>
        <strong>Sistema de Posicionamento</strong>
        <span>Escolha suas regiões e apareça na página pública de especialistas.</span>
      </span>
      <span className="positioning-cta">Entre agora e atualize seus dados →</span>
    </Link>
  );
}

function FrontPage() {
  return (
    <div className="hubpage">
      <style>{`
        .hubpage {
          --bg-a: #eef1f7;
          --navy: #12213f;
          --navy-2: #1c2c52;
          --red: #e5262b;
          --red-dark: #c81f2c;
          --blue-line: #4d6fe0;
          --gray: #5c6478;
          --card-bg: #ffffff;
          min-height: 100vh;
          background: #dfe4ee;
          font-family: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
          color: var(--navy);
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

        /* ---------- ícones e animações (compartilhados entre poster e lista mobile) ---------- */
        .hubpage .icon-wrap { position: relative; flex: none; width: 26%; aspect-ratio: 1; }
        .hubpage .icon-wrap.navy { --c1: #22345f; --c2: #0f1c38; }
        .hubpage .icon-wrap.blue { --c1: #4d6fe0; --c2: #2440ac; }
        .hubpage .icon-wrap.red { --c1: #ee4147; --c2: var(--red-dark); }
        .hubpage .icon-ping {
          position: absolute; inset: 0; border-radius: 999px;
          background: linear-gradient(160deg, var(--c1), var(--c2));
          animation: hubIconPing 2.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
        }
        .hubpage .icon {
          position: absolute; inset: 0; border-radius: 999px; background: #fff;
          box-shadow: 0 0 0 1px rgba(20, 30, 60, 0.06) inset, 0 4px 10px -4px rgba(20, 30, 60, 0.3);
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
          background: #fff; border: 1px solid rgba(20, 30, 60, 0.15);
          color: var(--gray); font-size: 0.62rem; font-weight: 800;
          letter-spacing: 0.08em; text-transform: uppercase;
          padding: 2px 9px; border-radius: 999px;
          box-shadow: 0 4px 10px -4px rgba(20, 30, 60, 0.25);
        }
        .hubpage .access-badge {
          position: absolute; right: 10px; top: -9px;
          background: linear-gradient(135deg, var(--blue-line), #2440ac);
          color: #fff; font-size: 0.62rem; font-weight: 800;
          letter-spacing: 0.06em; text-transform: uppercase;
          padding: 3px 10px; border-radius: 999px;
          box-shadow: 0 4px 10px -4px rgba(20, 30, 60, 0.4);
        }
        .hubpage .card.soon, .hubpage .mcard.soon { opacity: 0.62; filter: grayscale(0.4); cursor: default; }
        .hubpage .card.soon .icon-ping, .hubpage .card.soon .icon img,
        .hubpage .mcard.soon .icon-ping, .hubpage .mcard.soon .icon img { animation: none; }
        .hubpage .card.soon:hover .icon img, .hubpage .mcard.soon:hover .icon img { transform: none; }

        .hubpage .hub-hex { position: absolute; inset: 6%; }
        .hubpage .hub-hex svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 18px 30px rgba(12, 23, 48, 0.35)); }
        .hubpage .hub-text {
          position: absolute; inset: 9%; z-index: 1;
          display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
        }
        .hubpage .hub-text .max { color: #fff; font-size: clamp(1.1rem, 3.3vw, 3.2rem); line-height: 0.9; letter-spacing: 0.02em; }
        .hubpage .hub-text .hub2 { color: #5b84ff; font-size: clamp(0.9rem, 2.7vw, 2.55rem); line-height: 0.95; letter-spacing: 0.02em; margin-top: 2%; }
        .hubpage .hub-text .underline { width: 42%; height: 3px; background: var(--red); margin: 5% 0 0; position: relative; }
        .hubpage .hub-text .underline::after {
          content: ""; position: absolute; right: -2px; top: -3.5px;
          border-style: solid; border-width: 5px 0 5px 8px;
          border-color: transparent transparent transparent var(--red);
        }
        .hubpage .hub-text .caption {
          margin-top: 6%; text-align: center;
          font-size: clamp(0.5rem, 0.85vw, 0.95rem); font-weight: 700; letter-spacing: 0.14em;
          color: rgba(255, 255, 255, 0.42); line-height: 1.35; white-space: nowrap;
        }

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
          background: radial-gradient(120% 140% at 78% -10%, #f6f8fc 0%, var(--bg-a) 55%, #e6eaf3 100%);
          box-shadow: 0 30px 70px -30px rgba(20, 30, 60, 0.35);
        }
        .hubpage .dotgrid {
          position: absolute; left: 0; bottom: 0; width: 15%; height: 30%;
          background-image: radial-gradient(circle, #b9c3dd 1.6px, transparent 1.6px);
          background-size: 20px 20px;
          -webkit-mask-image: linear-gradient(115deg, black 20%, transparent 75%);
          mask-image: linear-gradient(115deg, black 20%, transparent 75%);
          opacity: 0.8;
        }
        .hubpage .corner-navy {
          position: absolute; right: 0; bottom: 0; width: 36%; height: 26%;
          background: var(--navy); clip-path: polygon(100% 20%, 100% 100%, 32% 100%);
        }
        .hubpage .corner-seam {
          position: absolute; right: 0; bottom: 0; width: 30%; height: 20%;
          background: #ff5257; clip-path: polygon(100% 30%, 100% 100%, 42% 100%);
        }
        .hubpage .corner-red {
          position: absolute; right: 0; bottom: 0; width: 27.5%; height: 18%;
          background: linear-gradient(100deg, var(--red), var(--red-dark));
          clip-path: polygon(100% 32%, 100% 100%, 45% 100%);
        }
        .hubpage .logo { position: absolute; left: 39%; top: 1.6%; width: 21%; display: block; }
        .hubpage .logo img { width: 100%; height: auto; display: block; transition: transform 0.15s ease, opacity 0.15s ease; }
        .hubpage .logo:hover img { transform: translateY(-1px); opacity: 0.85; }
        .hubpage .titleblock { position: absolute; left: 3.4%; top: 14.5%; width: 42%; }
        .hubpage .titleblock h1 { margin: 0; font-size: clamp(1.6rem, 3.6vw, 3.6rem); line-height: 0.95; letter-spacing: 0.01em; }
        .hubpage .titleblock h1 .navy { color: var(--navy); }
        .hubpage .titleblock h1 .red { color: var(--red); }
        .hubpage .titleblock p { margin: 0.5rem 0 0; font-size: clamp(0.7rem, 1.15vw, 1.35rem); color: var(--gray); font-weight: 500; }
        .hubpage .lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .hubpage .hub { position: absolute; left: 36.3%; top: 28.6%; width: 25.6%; height: 45.5%; }
        .hubpage .card {
          position: absolute; display: flex; align-items: center; gap: 3.2%;
          background: var(--card-bg); border-radius: 999px;
          box-shadow: 0 18px 34px -18px rgba(20, 30, 60, 0.28);
          padding: 0 3.4%;
        }
        .hubpage .txt h3 { margin: 0; color: var(--navy-2); font-weight: 700; font-size: clamp(0.58rem, 1.18vw, 1.12rem); line-height: 1.15; white-space: nowrap; }
        .hubpage .txt p { margin: 0.2em 0 0; color: var(--gray); font-weight: 500; font-size: clamp(0.52rem, 1.05vw, 1rem); line-height: 1.22; }
        .hubpage .footbar { position: absolute; left: 3.4%; bottom: 9%; display: flex; align-items: center; gap: 1.1%; }
        .hubpage .footbar .fico { width: 3.9%; aspect-ratio: 1; border-radius: 22%; background: var(--navy); display: flex; align-items: center; justify-content: center; }
        .hubpage .footbar .fico svg { width: 55%; height: 55%; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .footbar .fdiv { width: 2px; align-self: stretch; background: #9aa4c2; }
        .hubpage .footbar p { margin: 0; color: var(--navy-2); font-weight: 600; font-size: clamp(0.6rem, 1.15vw, 1.15rem); }
        .hubpage a.card-link { text-decoration: none; }

        .hubpage .positioning-banner {
          display: flex; align-items: center; gap: 16px;
          color: #fff; text-decoration: none;
          background: linear-gradient(115deg, #0d1b39 0%, #172e61 58%, #b71928 100%);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 18px; padding: 14px 18px;
          box-shadow: 0 18px 38px -22px rgba(10, 21, 48, 0.75);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .hubpage .positioning-banner:hover {
          transform: translateY(-2px);
          box-shadow: 0 22px 42px -22px rgba(10, 21, 48, 0.88);
        }
        .hubpage .positioning-pin {
          display: grid; place-items: center; flex: none;
          width: 50px; height: 50px; border-radius: 15px;
          background: linear-gradient(145deg, #f23d43, #c71928);
          box-shadow: 0 8px 20px -9px rgba(255, 55, 65, 0.9);
        }
        .hubpage .positioning-pin svg { width: 28px; height: 28px; stroke: #fff; stroke-width: 1.8; }
        .hubpage .positioning-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; }
        .hubpage .positioning-copy b {
          color: #ffbdc1; font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase;
        }
        .hubpage .positioning-copy strong { margin-top: 2px; font-size: 1.08rem; line-height: 1.15; }
        .hubpage .positioning-copy > span { margin-top: 3px; color: rgba(255, 255, 255, 0.75); font-size: 0.8rem; }
        .hubpage .positioning-cta {
          flex: none; border-radius: 999px; background: #fff; color: #b71928;
          padding: 10px 16px; font-size: 0.76rem; font-weight: 800; white-space: nowrap;
        }
        .hubpage .stage > .positioning-banner { max-width: 1120px; margin: 0 auto 16px; }

        /* ---------- lista mobile (<860px) ---------- */
        .hubpage .mobile-stage { display: block; max-width: 560px; margin: 0 auto; padding: 0 18px 32px; }
        @media (min-width: 860px) { .hubpage .mobile-stage { display: none; } }

        .hubpage .mheader {
          display: flex; align-items: center; justify-content: center;
          padding-top: max(18px, env(safe-area-inset-top));
        }
        .hubpage .mlogo { height: 38px; width: auto; display: block; margin: 0 auto; transition: opacity 0.15s ease; }
        .hubpage .mheader a:active .mlogo { opacity: 0.7; }
        .hubpage .mhero { margin-top: 22px; text-align: center; }
        .hubpage .mhero h1 { margin: 0; font-size: 2.15rem; line-height: 0.95; }
        .hubpage .mhero h1 .navy { color: var(--navy); }
        .hubpage .mhero h1 .red { color: var(--red); }
        .hubpage .mhero p { margin: 0.5rem 0 0; color: var(--gray); font-size: 0.9rem; }

        .hubpage .mobile-stage .positioning-banner {
          margin-top: 20px; align-items: flex-start; flex-wrap: wrap; gap: 11px; padding: 14px;
        }
        .hubpage .mobile-stage .positioning-pin { width: 44px; height: 44px; border-radius: 13px; }
        .hubpage .mobile-stage .positioning-copy { min-width: calc(100% - 58px); }
        .hubpage .mobile-stage .positioning-copy strong { font-size: 1rem; }
        .hubpage .mobile-stage .positioning-copy > span { font-size: 0.76rem; line-height: 1.3; }
        .hubpage .mobile-stage .positioning-cta { width: 100%; padding: 9px 12px; text-align: center; }

        .hubpage .mhub { position: relative; width: 172px; height: 172px; margin: 26px auto 0; }

        .hubpage .mlist { display: flex; flex-direction: column; gap: 12px; margin-top: 26px; }
        .hubpage .mcard {
          position: relative; display: flex; align-items: center; gap: 14px;
          background: #fff; border-radius: 20px; padding: 12px 16px;
          box-shadow: 0 14px 28px -18px rgba(20, 30, 60, 0.32);
          text-decoration: none; color: inherit;
        }
        .hubpage .mcard .icon-wrap { width: 50px; height: 50px; }
        .hubpage .mcard h3 { margin: 0; color: var(--navy-2); font-weight: 700; font-size: 0.95rem; }
        .hubpage .mcard p { margin: 0.15em 0 0; color: var(--gray); font-weight: 500; font-size: 0.8rem; line-height: 1.25; }

        .hubpage .mfoot {
          display: flex; align-items: flex-start; gap: 12px;
          margin-top: 28px; padding-top: 18px; border-top: 1px solid rgba(20, 30, 60, 0.08);
        }
        .hubpage .mfoot .fico {
          width: 34px; height: 34px; border-radius: 22%; background: var(--navy);
          display: flex; align-items: center; justify-content: center; flex: none;
        }
        .hubpage .mfoot .fico svg { width: 55%; height: 55%; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        .hubpage .mfoot p { margin: 0; color: var(--navy-2); font-weight: 600; font-size: 0.85rem; line-height: 1.3; }
      `}</style>

      {/* ---------- poster (tablet/desktop) ---------- */}
      <div className="stage">
        <PositioningBanner />
        <div className="canvas">
          <div className="dotgrid" />
          <div className="corner-navy" />
          <div className="corner-seam" />
          <div className="corner-red" />

          <Link to="/auth" className="logo" aria-label="Entrar no portal">
            <img src="/remax-logo-transparent.png" alt="RE/MAX Única Escolha" />
          </Link>

          <div className="titleblock">
            <h1 className="display"><span className="navy">Hub</span> <span className="red">MAX</span></h1>
            <p>Todos os sistemas da RE/MAX Única Escolha em um só lugar</p>
          </div>

          <svg className="lines" viewBox="0 0 1680 945" preserveAspectRatio="none">
            <circle cx="825" cy="485" r="215" fill="none" stroke="#c3cee8" strokeWidth="1.6" />
            <g fill="none" stroke="#4d6fe0" strokeWidth="2.6" strokeLinecap="round">
              <path d="M585,340 H700 L758,382" />
              <path d="M591,505 H660 L616,490" />
              <path d="M595,665 H700 L768,600" />
              <path d="M1095,340 H980 L900,382" />
              <path d="M1100,505 H1000 L1035,490" />
              <path d="M1095,665 H980 L882,600" />
              <path d="M842,710 V645" />
              <path d="M900,600 L980,760 H1125" />
            </g>
            <g fill="#4d6fe0">
              <circle cx="585" cy="340" r="4.5" />
              <circle cx="758" cy="382" r="4.5" />
              <circle cx="591" cy="505" r="4.5" />
              <circle cx="616" cy="490" r="4.5" />
              <circle cx="595" cy="665" r="4.5" />
              <circle cx="768" cy="600" r="4.5" />
              <circle cx="1095" cy="340" r="4.5" />
              <circle cx="900" cy="382" r="4.5" />
              <circle cx="1100" cy="505" r="4.5" />
              <circle cx="1035" cy="490" r="4.5" />
              <circle cx="1095" cy="665" r="4.5" />
              <circle cx="882" cy="600" r="4.5" />
              <circle cx="842" cy="710" r="4.5" />
              <circle cx="1125" cy="760" r="4.5" />
              <circle cx="825" cy="270" r="4.5" />
            </g>
          </svg>

          <div className="hub"><HubHex /></div>

          {CARDS.map((c) =>
            c.href ? (
              <a key={c.id} className="card-link" href={c.href} {...(c.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                <div className="card" style={c.pos}>
                  <span className="access-badge">Acessar →</span>
                  <CardIcon card={c} />
                  <span className="txt">
                    <h3>{c.title}</h3>
                    <p>{c.lines[0]}<br />{c.lines[1]}</p>
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
                    <p>{c.lines[0]}<br />{c.lines[1]}</p>
                  </span>
                </div>
              </div>
            ),
          )}

          <div className="footbar">
            <span className="fico">
              <svg viewBox="0 0 24 24"><path d="M3 18 9 11l4 3 8-9" /><path d="M15 4h6v6" /></svg>
            </span>
            <span className="fdiv" />
            <p>Soluções integradas para gestão, recrutamento, capacitação e crescimento.</p>
          </div>

        </div>
      </div>

      {/* ---------- lista mobile ---------- */}
      <div className="mobile-stage">
        <div className="mheader">
          <Link to="/auth" aria-label="Entrar no portal">
            <img className="mlogo" src="/remax-logo-transparent.png" alt="RE/MAX Única Escolha" />
          </Link>
        </div>

        <div className="mhero">
          <h1 className="display"><span className="navy">Hub</span> <span className="red">MAX</span></h1>
          <p>Todos os sistemas da RE/MAX Única Escolha em um só lugar</p>
        </div>

        <PositioningBanner />

        <div className="mhub"><HubHex /></div>

        <div className="mlist">
          {CARDS.map((c) =>
            c.href ? (
              <a key={c.id} className="mcard" href={c.href} {...(c.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                <span className="access-badge">Acessar →</span>
                <CardIcon card={c} />
                <span className="txt">
                  <h3>{c.title}</h3>
                  <p>{c.lines[0]} {c.lines[1]}</p>
                </span>
              </a>
            ) : (
              <div key={c.id} className="mcard soon">
                <span className="soon-badge">Em breve</span>
                <CardIcon card={c} />
                <span className="txt">
                  <h3>{c.title}</h3>
                  <p>{c.lines[0]} {c.lines[1]}</p>
                </span>
              </div>
            ),
          )}
        </div>

        <div className="mfoot">
          <span className="fico">
            <svg viewBox="0 0 24 24"><path d="M3 18 9 11l4 3 8-9" /><path d="M15 4h6v6" /></svg>
          </span>
          <p>Soluções integradas para gestão, recrutamento, capacitação e crescimento.</p>
        </div>
      </div>

      <p className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground">
        Acesso apenas por convite. Peça acesso ao administrador ou ao seu gestor. © {new Date().getFullYear()} RE/MAX Imóveis Única Escolha
      </p>
    </div>
  );
}
