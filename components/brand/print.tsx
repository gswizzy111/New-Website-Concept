import Image, { type StaticImageData } from "next/image";
import { cn } from "@/lib/utils";

export type PrintProps = {
  /** A real photo from /public (or a static import). Never stock or AI. */
  src: string | StaticImageData;
  alt: string;
  /** Intrinsic size, used for the aspect ratio when `aspect` is not given. */
  width?: number;
  height?: number;
  /** CSS aspect-ratio for the photo window, e.g. "701/922" or "1". */
  aspect?: string;
  /** Rotation in degrees (e.g. -9, 2.5). 0 sits square. */
  tilt?: number;
  /** "light" (default) for chalk/white sections, "dark" deepens the shadow for ink/cobalt. */
  surface?: "light" | "dark";
  /** White border width: sm 6px, md 10px, lg 14px. */
  border?: "sm" | "md" | "lg";
  /** Lifts and straightens on mouse hover. */
  lift?: boolean;
  /** Optional caption printed inside the white border, under the photo. */
  caption?: React.ReactNode;
  /** object-position for the crop, e.g. "50% 20%". Vary crops: never repeat one framing. */
  position?: string;
  /** Scales the photo inside its window, from `position`, for a closer crop (e.g. 1.5). Keep it modest: never past the photo's resolution. */
  zoom?: number;
  sizes?: string;
  priority?: boolean;
  /** Plays the float-in entrance (delay in ms). Off when omitted. */
  enterDelay?: number;
  /** "cover" (default) fills the window; "contain" shows the whole image (screenshots). */
  fit?: "cover" | "contain";
  /** Background behind a contained image, e.g. a screenshot's own dark. */
  matte?: string;
  /** Overlays inside the photo window (before/after chips). */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * A real card photo shown as a physical print: white border, 8px corners,
 * 3px inner image radius, the layered print shadow, optional tilt.
 */
export function Print({
  src,
  alt,
  width,
  height,
  aspect,
  tilt = 0,
  surface = "light",
  border = "md",
  lift = false,
  caption,
  position,
  zoom,
  sizes = "(max-width: 768px) 80vw, 480px",
  priority,
  enterDelay,
  fit = "cover",
  matte,
  children,
  className,
  style,
}: PrintProps) {
  const staticSize = typeof src === "object" ? src : null;
  const w = width ?? staticSize?.width;
  const h = height ?? staticSize?.height;
  const ratio = aspect ?? (w && h ? `${w}/${h}` : "4/5");
  return (
    <figure
      className={cn(
        "print m-0",
        border === "sm" && "print-sm",
        border === "lg" && "print-lg",
        surface === "dark" && "print-dark",
        lift && "print-lift",
        enterDelay !== undefined && "print-in",
        className
      )}
      style={{
        ["--tilt" as string]: `${tilt}deg`,
        ...(enterDelay !== undefined ? { ["--d" as string]: enterDelay } : null),
        ...style,
      }}
    >
      <div className="print-media" style={{ aspectRatio: ratio, ...(matte ? { background: matte } : null) }}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          style={{
            ...(position ? { objectPosition: position } : null),
            ...(fit === "contain" ? { objectFit: "contain" } : null),
            ...(zoom && zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: position ?? "50% 50%" } : null),
          }}
        />
        {children}
      </div>
      {caption && <figcaption className="print-caption">{caption}</figcaption>}
    </figure>
  );
}
