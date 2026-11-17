import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-[12px] border-[1.5px] border-input bg-white px-3.5 py-2.5 text-base transition-[border-color] outline-none placeholder:text-muted-foreground hover:border-ink-soft focus-visible:border-cobalt focus-visible:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-2 aria-invalid:outline-destructive/30 md:text-[15px] dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
