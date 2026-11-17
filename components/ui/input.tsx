import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 py-1 text-base transition-[border-color,background-color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-2 aria-invalid:outline-destructive/30 md:text-[15px] dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

/**
 * The field look as a class string, for native <select>s and bare <input>s
 * that can't use <Input/> (44px tall, 12px corners, 1.5px grey edge, cobalt
 * focus). The name is historical.
 */
const PIXEL_FIELD =
  "h-11 w-full min-w-0 rounded-[12px] border-[1.5px] border-input bg-white px-3.5 py-1 text-base outline-none transition-[border-color] placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt md:text-[15px]"

export { Input, PIXEL_FIELD }
