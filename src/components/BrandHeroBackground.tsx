/** Fundo decorativo padrão das páginas públicas (landing, login, recuperação de senha):
 * gradiente azul-marinho escuro, marca d'água do pin, linhas diagonais e o "swoosh" vermelho/azul.
 * Renderize como primeiro filho de um container `relative`; o conteúdo real vai por cima (z-10). */
export function BrandHeroBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[#060b1e]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 12% 0%, #10204a 0%, #081029 45%, #050a1c 100%)",
        }}
      />

      <img
        src="/remax-pin-watermark.png"
        alt=""
        className="absolute right-[8%] top-[14%] w-[30%] max-w-[460px] opacity-[0.05]"
      />

      <svg className="absolute left-0 top-0 h-[50%] w-[40%]" viewBox="0 0 400 400" fill="none">
        <defs>
          <linearGradient id="bhbLineGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#4d7bff" stopOpacity="0" />
            <stop offset="100%" stopColor="#6f97ff" stopOpacity="0.55" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            x1={-60 + i * 34}
            y1={420}
            x2={420 + i * 34}
            y2={-60}
            stroke="url(#bhbLineGrad)"
            strokeWidth={i === 4 ? 2 : 1.2}
          />
        ))}
        <circle cx={22} cy={100} r={2.5} fill="#9db8ff" opacity={0.9} />
      </svg>

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMaxYMax slice"
        fill="none"
      >
        <defs>
          <linearGradient id="bhbSwooshBlue" x1="0" y1="1" x2="0.9" y2="0">
            <stop offset="0%" stopColor="#0b2a7a" />
            <stop offset="55%" stopColor="#1c47c9" />
            <stop offset="100%" stopColor="#4d7bff" />
          </linearGradient>
          <filter id="bhbGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="bhbGlowSoft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
        </defs>

        <path
          d="M 760 900 C 940 878 1090 780 1205 610 C 1310 455 1380 260 1600 55"
          stroke="url(#bhbSwooshBlue)"
          strokeWidth={78}
          strokeLinecap="round"
          opacity={0.9}
          filter="url(#bhbGlowSoft)"
        />
        <path
          d="M 760 900 C 940 878 1090 780 1205 610 C 1310 455 1380 260 1600 55"
          stroke="url(#bhbSwooshBlue)"
          strokeWidth={46}
          strokeLinecap="round"
        />
        <path
          d="M 760 900 C 940 878 1090 780 1205 610 C 1310 455 1380 260 1600 55"
          stroke="#ff2b2b"
          strokeWidth={10}
          strokeLinecap="round"
          filter="url(#bhbGlow)"
          opacity={0.9}
        />
        <path
          d="M 760 900 C 940 878 1090 780 1205 610 C 1310 455 1380 260 1600 55"
          stroke="#ff3b3b"
          strokeWidth={5}
          strokeLinecap="round"
        />

        <line x1={0} y1={878} x2={1600} y2={878} stroke="#ff2b2b" strokeWidth={1.5} opacity={0.6} />
        <circle cx={760} cy={899} r={7} fill="#bcd6ff" filter="url(#bhbGlow)" />
        <circle cx={760} cy={899} r={2.5} fill="#ffffff" />
      </svg>
    </div>
  );
}
