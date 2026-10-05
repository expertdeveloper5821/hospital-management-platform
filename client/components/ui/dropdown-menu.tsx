"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/* =========================================================
   Dropdown Context
========================================================= */

interface DropdownMenuContextType {
  close: () => void;
}

const DropdownMenuContext = createContext<DropdownMenuContextType | null>(null);

/* =========================================================
   Dropdown Menu
========================================================= */

interface DropdownMenuProps {
  label: string;
  children: React.ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
}

export function DropdownMenu({
  label,
  children,
  triggerClassName,
  menuClassName,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);

  /* ---------------------------------------------------------
     Mount
  --------------------------------------------------------- */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* ---------------------------------------------------------
     Position dropdown
  --------------------------------------------------------- */

  const place = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();

    if (!rect) return;

    const width = 176;
    const height = 180;

    const left = Math.max(
      8,
      Math.min(rect.left, window.innerWidth - width - 8),
    );

    const below = rect.bottom + 6;

    const top =
      below + height > window.innerHeight
        ? Math.max(8, rect.top - height - 6)
        : below;

    setPosition({
      top,
      left,
    });
  }, []);

  /* ---------------------------------------------------------
     Toggle dropdown
  --------------------------------------------------------- */

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    place();
    setOpen(true);
  }

  /* ---------------------------------------------------------
     Outside click / Escape / Scroll
  --------------------------------------------------------- */

  useEffect(() => {
    if (!open) return;

    function handleClick(e: MouseEvent) {
      const target = e.target as Node;

      // Don't close when clicking trigger
      if (triggerRef.current?.contains(target)) {
        return;
      }

      // Don't close when clicking inside dropdown
      const element = e.target as HTMLElement;

      if (element.closest("[data-dropdown-menu-content]")) {
        return;
      }

      setOpen(false);
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    function handleScroll() {
      setOpen(false);
    }

    document.addEventListener("click", handleClick);

    document.addEventListener("keydown", handleKey);

    window.addEventListener("scroll", handleScroll, true);

    window.addEventListener("resize", place);

    return () => {
      document.removeEventListener("click", handleClick);

      document.removeEventListener("keydown", handleKey);

      window.removeEventListener("scroll", handleScroll, true);

      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  /* ---------------------------------------------------------
     Close dropdown
  --------------------------------------------------------- */

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  /* ---------------------------------------------------------
     UI
  --------------------------------------------------------- */

  return (
    <>
      {/* Trigger Button */}

      <button
        type="button"
        ref={triggerRef}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center justify-center rounded-md transition-colors",
          "hover:bg-muted",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          triggerClassName,
        )}
      >
        {/* Three dots icon */}

        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="5" r="1" />

          <circle cx="12" cy="12" r="1" />

          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>

      {/* Dropdown */}

      {open &&
        mounted &&
        position &&
        createPortal(
          <DropdownMenuContext.Provider value={{ close }}>
            <div
              role="menu"
              data-dropdown-menu-content=""
              style={{
                top: position.top,
                left: position.left,
              }}
              className={cn(
                "fixed z-[9999]",
                "w-44 min-w-max",
                "rounded-md border",
                "bg-background",
                "py-1",
                "shadow-lg",
                "animate-in fade-in-0 zoom-in-95",
                menuClassName,
              )}
            >
              {children}
            </div>
          </DropdownMenuContext.Provider>,
          document.body,
        )}
    </>
  );
}

/* =========================================================
   Dropdown Menu Item
========================================================= */

interface DropdownMenuItemProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> {
  icon?: React.ComponentType<{
    className?: string;
  }>;

  destructive?: boolean;

  className?: string;
}

export function DropdownMenuItem({
  icon: Icon,
  destructive,
  className,
  onClick,
  ...rest
}: DropdownMenuItemProps) {
  const menu = useContext(DropdownMenuContext);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    /*
      IMPORTANT:

      First run the actual user's onClick
      such as:

      onEditRole(user)
      onEditEmail(user)
      onDeactivate(user)

      Then close the dropdown.
    */

    onClick?.(e);

    // Close dropdown after action
    if (!e.currentTarget.closest("[data-keep-open]")) {
      menu?.close();
    }
  }

  return (
    <button
      type="button"
      role="menuitem"
      data-dropdown-menu-item=""
      onClick={handleClick}
      disabled={rest.disabled}
      className={cn(
        "flex w-full items-center gap-2",
        "px-3 py-2",
        "text-left text-sm",
        "outline-none",
        "transition-colors",

        "hover:bg-muted",

        "focus:bg-muted",

        "disabled:pointer-events-none",
        "disabled:opacity-50",

        destructive
          ? "text-destructive hover:text-destructive"
          : "text-foreground",

        className,
      )}
      {...rest}
    >
      {/* Icon */}

      {Icon && (
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            destructive ? "text-destructive" : "text-muted-foreground",
          )}
        />
      )}

      {/* Text */}

      <span className="min-w-0 flex-1 truncate">{rest.children}</span>
    </button>
  );
}

/* =========================================================
   Dropdown Separator
========================================================= */

export function DropdownMenuSeparator() {
  return <div className="my-1 border-t" role="separator" />;
}
