import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full rounded-md border border-line bg-bg px-2 text-sm text-fg tabular-nums",
          "placeholder:text-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          className,
        )}
        {...props}
      />
    );
  },
);
