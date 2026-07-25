import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Heights are deliberately dense for pointer devices. On a touch primary
      // pointer they grow to ~44px: an audit at 390px found every control
      // between 28px and 32px tall, well under the 44/48px platform guidance
      // (and the icon buttons were near WCAG 2.2 AA 2.5.8's 24px floor).
      size: {
        default:
          "h-8 pointer-coarse:h-11 gap-1.5 px-2.5 pointer-coarse:px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 pointer-coarse:h-9 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 pointer-coarse:h-10 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 pointer-coarse:px-3.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 pointer-coarse:h-12 gap-1.5 px-2.5 pointer-coarse:px-5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 pointer-coarse:size-11",
        "icon-xs":
          "size-6 pointer-coarse:size-9 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 pointer-coarse:size-10 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 pointer-coarse:size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

/** A `render` target carrying an href is navigation, not an action. */
function isLinkElement(
  render: unknown,
): render is React.ReactElement<{ className?: string }> {
  return (
    React.isValidElement(render) &&
    typeof render.props === "object" &&
    render.props !== null &&
    "href" in render.props
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const classes = cn(buttonVariants({ variant, size, className }))

  // Base UI's Button stamps role="button" on whatever it renders once
  // nativeButton={false}, so every `<Button render={<Link/>}>` in the app was
  // announced as a button rather than a link — losing the "this navigates"
  // affordance, dropping the control out of the screen reader's links list, and
  // promising Space-key activation that an anchor does not provide.
  // Style the anchor directly instead; it is already interactive.
  if (isLinkElement(render)) {
    return React.cloneElement(render, {
      ...props,
      "data-slot": "button",
      className: cn(classes, render.props.className),
    } as React.HTMLAttributes<HTMLElement>)
  }

  return (
    <ButtonPrimitive
      data-slot="button"
      // A non-button, non-link render target (e.g. a <div>) still needs Base UI
      // to supply button semantics and keyboard handling.
      nativeButton={render ? false : undefined}
      render={render}
      className={classes}
      {...props}
    />
  )
}

export { Button, buttonVariants }
