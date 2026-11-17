import { isValidElement } from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Pill buttons: the look lives in globals.css (.btn and its tone classes,
// shared with the cta() helper in components/brand). Variants pick a tone;
// sizes keep their old names. Small sizes keep a 44px hit area.
const HIT = "after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"

const buttonVariants = cva(
  "group/button btn min-h-0 shrink-0 gap-1.5 text-sm outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:outline-2 aria-invalid:outline-destructive aria-invalid:outline-offset-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-sun",
        sun: "btn-sun",
        ink: "btn-ink",
        cobalt: "btn-cobalt",
        outline: "btn-outline aria-expanded:bg-ink/5",
        "outline-light": "btn-outline-light",
        secondary: "btn-white aria-expanded:bg-cobalt-wash",
        ghost: "btn-ghost aria-expanded:bg-ink/5",
        destructive: "btn-danger",
        link: "h-auto! min-h-0! px-0! font-bold text-cobalt underline-offset-4 shadow-none! bg-transparent! hover:underline hover:translate-y-0! [--b-fg:var(--cobalt)]",
      },
      size: {
        default:
          "h-11 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: `h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3 ${HIT}`,
        sm: `h-9 gap-1 px-3.5 text-[0.8125rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5 ${HIT}`,
        lg: "h-13 gap-2 px-7 text-base has-data-[icon=inline-end]:pr-6 has-data-[icon=inline-start]:pl-6",
        icon: "size-11 px-0",
        "icon-xs": `size-7 px-0 [&_svg:not([class*='size-'])]:size-3 ${HIT}`,
        "icon-sm": `size-9 px-0 ${HIT}`,
        "icon-lg": "size-12 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  // A `render` that is not a <button> (e.g. a Link) is not a native button;
  // telling Base UI so keeps its semantics right and silences its warning.
  const render = props.render
  const isNative =
    nativeButton ??
    (render == null || (isValidElement(render) && render.type === "button"))
  return (
    <ButtonPrimitive
      data-slot="button"
      nativeButton={isNative}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
