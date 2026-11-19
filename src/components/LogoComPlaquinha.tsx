import type { ImgHTMLAttributes } from "react";
import { useLogoTom } from "@/hooks/use-logo-tom";
import { plaquinhaDoLogo } from "@/lib/logo-tom";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "className"> & {
  src: string;
  /** Cor do fundo onde o logo aparece: "escuro" (menu azul-marinho) ou "claro" (card branco). */
  fundo: "escuro" | "claro";
  /** Classes da imagem (tamanho, object-contain...). */
  className?: string;
  /** Classes extras da plaquinha (respiro, cantos), quando ela aparece. */
  plaquinhaClassName?: string;
};

/**
 * Logo que nunca some no fundo (t_331aa14e): mede se a imagem é clara ou escura e, quando o contraste com o
 * fundo é ruim, põe uma plaquinha discreta atrás (clara no fundo escuro; escura no fundo claro). Se a medição
 * falhar no fundo escuro, usa a plaquinha clara por segurança. Enquanto mede, a imagem fica invisível por um
 * instante para não piscar a plaquinha.
 */
export function LogoComPlaquinha({
  src,
  fundo,
  className = "",
  plaquinhaClassName = "",
  alt,
  ...rest
}: Props) {
  const tom = useLogoTom(src);
  const medindo = tom === undefined;
  const plaquinha = medindo ? null : plaquinhaDoLogo(fundo, tom);
  const fundoPlaquinha =
    plaquinha === "clara"
      ? "bg-white/95 shadow-sm"
      : plaquinha === "escura"
        ? "bg-slate-800 shadow-sm"
        : "";
  return (
    <span
      data-logo-plaquinha={plaquinha ?? "nenhuma"}
      className={`inline-flex shrink-0 items-center justify-center transition-colors ${
        plaquinha ? `rounded-md ${fundoPlaquinha} ${plaquinhaClassName}` : ""
      }`}
    >
      <img
        src={src}
        alt={alt}
        {...rest}
        className={`${className} transition-opacity duration-150 ${medindo ? "opacity-0" : "opacity-100"}`}
      />
    </span>
  );
}
