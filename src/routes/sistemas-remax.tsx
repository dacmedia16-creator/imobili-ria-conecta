import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SISTEMAS_REMAX } from "@/lib/sistemas-remax";

// /sistemas-remax: atalhos para os sistemas da rede REMAX Brasil (t_06bb81c4, maquete t_02354225).
// Mesma regra de acesso do hub "/": página pública (os sistemas têm login próprio) e, no ambiente de
// homologação, não aparece (vai para /auth, como as demais páginas públicas).
export const Route = createFileRoute("/sistemas-remax")({
  ssr: false,
  beforeLoad: () => {
    if (import.meta.env.VITE_HOMOLOG_ONLY === "true") throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [{ title: "Sistemas REMAX Brasil — UniHub" }],
  }),
  component: SistemasRemaxPage,
});

function SistemasRemaxPage() {
  return (
    <div className="srpage">
      <style>{`
        .srpage {
          --navy: #0b1b33;
          --red: #dc1c2e;
          --red-dark: #c41626;
          --blue-line: #8fb4e8;
          --gray: #a9b8cf;
          --gold: #e3c682;
          --card-bg: rgba(7, 19, 37, 0.72);
          position: relative; isolation: isolate; overflow-x: hidden;
          min-height: 100vh; background: var(--navy); color: #fff;
          font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
          padding-bottom: env(safe-area-inset-bottom);
        }
        .srpage .sr-glow { position: absolute; inset: 0; z-index: -1; pointer-events: none;
          background: radial-gradient(720px circle at 72% 18%, rgb(42 79 134 / 0.45), transparent 60%); }
        .srpage a:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
        .srpage .sr-wrap { max-width: 1180px; margin: 0 auto; padding: 28px clamp(18px, 3vw, 40px) 48px; }
        .srpage .sr-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .srpage .eyebrow {
          display: inline-flex; align-items: center; gap: 10px; margin: 0;
          font-size: 11px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gray);
        }
        .srpage .eyebrow::before { content: ""; width: 24px; height: 1px; background: var(--red); }
        .srpage .htitle {
          font-family: "Sora", ui-sans-serif, system-ui, sans-serif; font-weight: 800;
          letter-spacing: -0.04em; line-height: 1; margin: 0.8rem 0 0; font-size: clamp(2.2rem, 5vw, 4.2rem);
        }
        .srpage .htitle .sky { color: var(--blue-line); }
        .srpage .htitle .dot { color: var(--red); }
        .srpage .sub { color: var(--gray); margin: 0.6rem 0 0; font-size: clamp(0.95rem, 1.2vw, 1.2rem); }
        .srpage .sr-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .srpage .pill {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          height: 46px; padding: 0 20px; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 999px;
          background: rgba(7, 19, 37, 0.55); color: rgba(255, 255, 255, 0.9);
          font-size: 0.9rem; font-weight: 600; text-decoration: none; white-space: nowrap;
          transition: border-color 0.15s ease, transform 0.15s ease;
        }
        .srpage .pill:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; transform: translateY(-1px); }
        .srpage .pill svg { width: 22px; height: 22px; fill: none; stroke: var(--blue-line); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
        /* Colunas de largura fixa e igual (minmax(0,1fr)): o card não cresce com o texto (REMARKT). */
        .srpage .sr-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px; margin-top: 44px; }
        @media (max-width: 1000px) { .srpage .sr-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        .srpage .sr-card {
          position: relative; display: flex; align-items: center; gap: 16px; min-width: 0;
          background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 999px;
          padding: 18px 26px; text-decoration: none; color: inherit;
          box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.7); transition: border-color 0.3s ease;
        }
        .srpage .sr-card:hover { border-color: rgba(220, 28, 46, 0.5); }
        .srpage .sr-ico {
          flex: none; width: 58px; height: 58px; border-radius: 999px; background: #fff;
          display: grid; place-items: center; color: var(--navy);
          font-family: "Sora", ui-sans-serif, sans-serif; font-weight: 800; font-size: 15px;
          box-shadow: 0 0 0 1px rgba(143, 180, 232, 0.35); overflow: hidden;
        }
        /* Logos oficiais (t_48434b4a): mesma caixa para todos, centralizados, sem distorcer. */
        .srpage .sr-ico img { width: 72%; height: 72%; object-fit: contain; display: block; }
        .srpage .sr-txt { min-width: 0; }
        .srpage .sr-card h3 { margin: 0; font-family: "Sora", ui-sans-serif, sans-serif; font-weight: 600; font-size: 1.12rem;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srpage .sr-card p { margin: 0.2em 0 0; color: var(--gray); font-size: 0.92rem; }
        .srpage .access-badge {
          position: absolute; right: 22px; top: -10px; background: var(--red); color: #fff;
          font-size: 0.66rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          padding: 3px 12px; border-radius: 999px; box-shadow: 0 8px 22px -8px rgba(220, 28, 46, 0.75);
          transition: background 0.2s ease;
        }
        .srpage .sr-card:hover .access-badge { background: var(--red-dark); }
        .srpage .sr-foot {
          display: flex; align-items: center; gap: 12px; margin-top: 44px; padding-top: 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.85); font-size: 0.9rem;
        }
        .srpage .sr-foot .fico { width: 34px; height: 34px; border-radius: 22%; background: var(--red); flex: none;
          display: flex; align-items: center; justify-content: center; }
        .srpage .sr-foot .fico svg { width: 55%; height: 55%; stroke: #fff; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
        @media (max-width: 600px) {
          .srpage .sr-wrap { padding: max(18px, env(safe-area-inset-top)) 18px 32px; }
          .srpage .sr-actions { width: 100%; }
          .srpage .pill { height: 40px; font-size: 0.8rem; padding: 0 14px; }
          .srpage .sr-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 30px; }
          .srpage .sr-card { border-radius: 20px; padding: 14px 16px; }
          .srpage .sr-ico { width: 48px; height: 48px; font-size: 13px; }
          .srpage .access-badge { right: 14px; }
        }
      `}</style>
      <div className="sr-glow" aria-hidden="true" />

      <div className="sr-wrap">
        <div className="sr-top">
          <div>
            <p className="eyebrow">Plataforma integrada</p>
            <h1 className="htitle">
              Sistemas <span className="sky">REMAX</span> Brasil<span className="dot">.</span>
            </h1>
            <p className="sub">Acesso rápido aos sistemas da rede REMAX Brasil</p>
          </div>
          <div className="sr-actions">
            <Link to="/" className="pill">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              <span>Voltar ao UniHub</span>
            </Link>
          </div>
        </div>

        <div className="sr-grid">
          {SISTEMAS_REMAX.map((s) => (
            <a
              key={s.id}
              className="sr-card"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Acessar ${s.nome} (abre em nova aba)`}
            >
              <span className="access-badge">Acessar →</span>
              {s.logo ? (
                <span
                  className="sr-ico"
                  style={s.logoFundo ? { background: s.logoFundo } : undefined}
                >
                  <img
                    src={s.logo}
                    alt={s.nome}
                    width={58}
                    height={58}
                    loading="lazy"
                    decoding="async"
                  />
                </span>
              ) : (
                <span className="sr-ico" aria-hidden="true">
                  {s.sigla}
                </span>
              )}
              <span className="sr-txt">
                <h3>{s.nome}</h3>
                {s.descricao ? <p>{s.descricao}</p> : null}
              </span>
            </a>
          ))}
        </div>

        <div className="sr-foot">
          <span className="fico" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M14 4h6v6" />
              <path d="M20 4 11 13" />
              <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </span>
          Cada sistema abre em uma nova aba, com o login próprio dele.
        </div>
      </div>
    </div>
  );
}
