import { ChartLine, GraduationCap, KeyRound, UserRound, UserSearch } from "lucide-react";
import { useId } from "react";

/**
 * "Roda" de sistemas do MAX HUB: hexágono central + 8 nós em volta.
 * Portada de projetos/site-ecossistema-remax/app/src/components/HubDiagram.tsx (página
 * somosmaxhub.com.br): mesma geometria (raio 38%, nós a cada 45° a partir do topo), mesmos
 * ícones, cores, órbita lenta e pulso nas linhas. Aqui cada nó de sistema ativo é um link
 * para o mesmo destino do cartão correspondente; "em breve" fica apagado e sem link.
 */
export type WheelId =
  "adm" | "estudo" | "visita" | "especialistas" | "academia" | "60dias" | "recruta" | "locacao";

export type WheelItem = { id: WheelId; title: string; href?: string };

// Ordem igual à da página MAX HUB (sentido horário a partir do topo).
const ORDER: { id: WheelId; short: string }[] = [
  { id: "adm", short: "ADM MAX" },
  { id: "estudo", short: "Estudo de Mercado" },
  { id: "visita", short: "Visita MAX" },
  { id: "especialistas", short: "Especialistas" },
  { id: "academia", short: "Academia" },
  { id: "60dias", short: "60 Dias" },
  { id: "recruta", short: "Recruta" },
  { id: "locacao", short: "Locação" },
];

const R = 38; // raio dos nós em % do quadro

function hexPoints(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

function WheelIcon({ id }: { id: WheelId }) {
  const text = (t: string) => <span className={`hw-txt${t.length > 2 ? " long" : ""}`}>{t}</span>;
  switch (id) {
    case "adm":
      return text("ADM");
    case "60dias":
      return text("60");
    case "visita":
      return text("VM");
    case "estudo":
      return <ChartLine strokeWidth={1.6} aria-hidden />;
    case "especialistas":
      return <UserSearch strokeWidth={1.6} aria-hidden />;
    case "academia":
      return <GraduationCap strokeWidth={1.6} aria-hidden />;
    case "recruta":
      return <UserRound strokeWidth={1.6} aria-hidden />;
    case "locacao":
      return <KeyRound strokeWidth={1.6} aria-hidden />;
  }
}

const CSS = `
.hubwheel { position: relative; width: 100%; aspect-ratio: 1; container-type: inline-size; }
.hubwheel > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hubwheel .hw-orbit { animation: hwOrbit 90s linear infinite; transform-origin: center; transform-box: fill-box; }
.hubwheel .hw-pulse { stroke-dasharray: 18 202; animation: hwDash 3.2s linear infinite; }
@keyframes hwOrbit { to { transform: rotate(360deg); } }
@keyframes hwDash { to { stroke-dashoffset: -220; } }
.hubwheel .hw-center {
  pointer-events: none; position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
}
.hubwheel .hw-center .hw-name {
  font-family: "Sora", ui-sans-serif, system-ui, sans-serif; font-weight: 800; letter-spacing: -0.02em;
  line-height: 1; color: #fff; font-size: 7.2cqw;
}
.hubwheel .hw-center .hw-name span { color: #8fb4e8; }
.hubwheel .hw-center .hw-bar { display: block; width: 7cqw; height: 2px; margin-top: 1.6cqw; background: #dc1c2e; }
.hubwheel .hw-center .hw-cap {
  margin-top: 1.6cqw; font-size: max(8px, 2.5cqw); font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; color: #a9b8cf; white-space: nowrap;
}
.hubwheel .hw-node {
  position: absolute; width: 14%; height: 14%; transform: translate(-50%, -50%);
  display: grid; place-items: center; border-radius: 999px; border: 1.5px solid;
  text-decoration: none; transition: border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease, color 0.3s ease;
}
.hubwheel .hw-node svg { width: 46%; height: 46%; }
.hubwheel .hw-txt {
  font-family: "Barlow Condensed", "Sora", ui-sans-serif, sans-serif; font-weight: 800;
  letter-spacing: -0.01em; line-height: 1; font-size: 5.4cqw;
}
.hubwheel .hw-txt.long { font-size: 4.3cqw; }
.hubwheel a.hw-node { border-color: rgba(220, 28, 46, 0.6); background: #071325; color: #f04a59; cursor: pointer; }
.hubwheel a.hw-node:hover, .hubwheel a.hw-node:focus-visible, .hubwheel a.hw-node:active {
  border-color: #dc1c2e; background: #dc1c2e; color: #fff;
  box-shadow: 0 0 0 6px rgba(220, 28, 46, 0.15), 0 0 30px rgba(220, 28, 46, 0.45);
}
.hubwheel a.hw-node:focus-visible { outline: 2px solid #e3c682; outline-offset: 3px; }
.hubwheel .hw-node.soon { border-color: rgba(255, 255, 255, 0.2); background: #0d1f3b; color: rgba(255, 255, 255, 0.55); cursor: default; }
.hubwheel .hw-label {
  pointer-events: none; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
  margin-top: 4px; padding: 1px 6px; border-radius: 6px; background: rgba(7, 19, 37, 0.85);
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif; font-weight: 600; line-height: 1.2;
  font-size: clamp(10.5px, 3.1cqw, 13px); color: #e6eefb; text-align: center;
  width: max-content; max-width: 26cqw;
}
.hubwheel .hw-node.soon .hw-label { color: rgba(255, 255, 255, 0.72); }
.hubwheel .hw-label small {
  display: block; font-size: 0.78em; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: #e3c682;
}
@media (prefers-reduced-motion: reduce) {
  .hubwheel .hw-orbit, .hubwheel .hw-pulse { animation: none; }
  .hubwheel .hw-pulse { display: none; }
}
`;

export function HubWheel({ items, className = "" }: { items: WheelItem[]; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const byId = new Map(items.map((i) => [i.id, i]));
  const nodes = ORDER.filter((o) => byId.has(o.id)).map((o) => {
    const i = ORDER.indexOf(o);
    const a = (-90 + i * 45) * (Math.PI / 180);
    const item = byId.get(o.id)!;
    return { ...o, ...item, x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a), i };
  });

  return (
    <nav className={`hubwheel ${className}`} aria-label="Atalhos dos sistemas MAX">
      <style>{CSS}</style>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <radialGradient id={`halo-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2a4f86" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0b1b33" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`hexfill-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#14305a" />
            <stop offset="100%" stopColor="#071325" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="30" fill={`url(#halo-${uid})`} />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="rgb(255 255 255 / 0.08)"
          strokeWidth="0.25"
        />
        <g className="hw-orbit">
          <circle
            cx="50"
            cy="50"
            r={R + 6}
            fill="none"
            stroke="rgb(143 180 232 / 0.18)"
            strokeWidth="0.2"
            strokeDasharray="0.6 2.4"
          />
        </g>
        {nodes.map((n) => (
          <g key={n.id}>
            <line
              x1="50"
              y1="50"
              x2={n.x}
              y2={n.y}
              stroke="rgb(255 255 255 / 0.12)"
              strokeWidth="0.2"
            />
            {n.href && (
              <line
                x1="50"
                y1="50"
                x2={n.x}
                y2={n.y}
                pathLength={220}
                className="hw-pulse"
                style={{ animationDelay: `${n.i * 0.37}s` }}
                stroke="#f04a59"
                strokeWidth="0.45"
                strokeLinecap="round"
              />
            )}
          </g>
        ))}
        <polygon
          points={hexPoints(50, 50, 16)}
          fill={`url(#hexfill-${uid})`}
          stroke="rgb(143 180 232 / 0.35)"
          strokeWidth="0.3"
        />
        <polygon
          points={hexPoints(50, 50, 18)}
          fill="none"
          stroke="rgb(255 255 255 / 0.07)"
          strokeWidth="0.2"
        />
      </svg>

      <div className="hw-center" aria-hidden="true">
        <span className="hw-name">
          MAX <span>HUB</span>
        </span>
        <span className="hw-bar" />
        <span className="hw-cap">Plataforma integrada</span>
      </div>

      {nodes.map((n) => {
        const style = { left: `${n.x}%`, top: `${n.y}%` };
        if (!n.href) {
          return (
            <span
              key={n.id}
              className="hw-node soon"
              style={style}
              role="img"
              aria-label={`${n.title} (em breve)`}
              data-wheel={n.id}
            >
              <WheelIcon id={n.id} />
              <span className="hw-label" aria-hidden="true">
                {n.short}
                <small>Em breve</small>
              </span>
            </span>
          );
        }
        const external = !n.href.startsWith("/");
        return (
          <a
            key={n.id}
            className="hw-node"
            style={style}
            href={n.href}
            aria-label={`Abrir ${n.title}`}
            data-wheel={n.id}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          >
            <WheelIcon id={n.id} />
            <span className="hw-label" aria-hidden="true">
              {n.short}
            </span>
          </a>
        );
      })}
    </nav>
  );
}
