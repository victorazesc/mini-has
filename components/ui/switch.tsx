"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default" | "lg" | "xl" | "2xl"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=sm]:h-4 data-[size=sm]:w-7 data-[size=default]:h-5 data-[size=default]:w-11 data-[size=lg]:h-6 data-[size=lg]:w-[3.75rem] data-[size=xl]:h-7 data-[size=xl]:w-[4.25rem] data-[size=2xl]:h-8 data-[size=2xl]:w-[4.75rem] dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-unchecked:border-transparent data-unchecked:bg-input/90 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform not-dark:bg-clip-padding group-data-[size=sm]/switch:h-3 group-data-[size=sm]/switch:w-4 group-data-[size=default]/switch:h-4 group-data-[size=default]/switch:w-6 group-data-[size=lg]/switch:h-5 group-data-[size=lg]/switch:w-8 group-data-[size=xl]/switch:h-6 group-data-[size=xl]/switch:w-9 group-data-[size=2xl]/switch:h-7 group-data-[size=2xl]/switch:w-10 data-checked:translate-x-[calc(100%-8px)] dark:data-checked:bg-primary-foreground data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
