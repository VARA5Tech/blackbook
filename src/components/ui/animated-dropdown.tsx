"use client"

/**
 * Animated dropdown of links.
 *
 * Adapted from emerald-ui's Animated Dropdown (MIT, https://emerald-ui.com) to
 * this codebase: the project's Button and `cn`, semantic colour tokens instead
 * of slate and zinc, `next/link` for client-side navigation, optional lucide
 * icons and descriptions per item, Escape to close, and no movement for anyone
 * who has asked their system to reduce motion.
 */
import * as React from "react"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ChevronDown, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type AnimatedDropdownItem = {
  label: string
  href: string
  icon?: LucideIcon
  description?: string
}

type AnimatedDropdownProps = {
  items: AnimatedDropdownItem[]
  label: string
  icon?: LucideIcon
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end"
  variant?: React.ComponentProps<typeof Button>["variant"]
  className?: string
  triggerClassName?: string
}

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onOutside: () => void,
  active: boolean,
) {
  const handler = React.useRef(onOutside)
  React.useEffect(() => {
    handler.current = onOutside
  })

  React.useEffect(() => {
    if (!active) return
    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler.current()
      }
    }
    document.addEventListener("mousedown", handle)
    return () => document.removeEventListener("mousedown", handle)
  }, [ref, active])
}

export function AnimatedDropdown({
  items,
  label,
  icon: TriggerIcon,
  align = "start",
  variant = "outline",
  className,
  triggerClassName,
}: AnimatedDropdownProps) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const menuId = React.useId()
  const reduceMotion = useReducedMotion()

  useClickOutside(rootRef, () => setOpen(false), open)

  React.useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  return (
    <div
      ref={rootRef}
      data-state={open ? "open" : "closed"}
      className={cn("relative block w-full", className)}
    >
      <Button
        type="button"
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn("w-full justify-between", triggerClassName)}
      >
        <span className="flex items-center gap-2">
          {TriggerIcon ? <TriggerIcon /> : null}
          {label}
        </span>
        <motion.span
          className="flex"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeOut" }}
        >
          <ChevronDown className="text-muted-foreground" />
        </motion.span>
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className={cn(
              // Exactly the trigger's width, open or closed.
              "absolute top-[calc(100%+0.375rem)] z-50 w-full overflow-hidden",
              "rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
              align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            )}
          >
            <motion.ul
              initial="hidden"
              animate="visible"
              variants={{
                visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.03 } },
              }}
            >
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <motion.li
                    key={item.href}
                    role="none"
                    variants={{
                      hidden: { opacity: 0, x: reduceMotion ? 0 : -8 },
                      visible: { opacity: 1, x: 0 },
                    }}
                  >
                    <Link
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                    >
                      {Icon ? (
                        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      ) : null}
                      <span className="min-w-0">
                        <span className="block font-medium">{item.label}</span>
                        {item.description ? (
                          <span className="block text-xs text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </motion.li>
                )
              })}
            </motion.ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
