import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Standard shadcn-style `cn` helper. The registry components in
 * ~/Projects/file-next/registry/components/file-next/ import
 * `{ cn } from "@/lib/cn"` — this file resolves that alias via
 * the tsconfig paths.
 */
export function cn(...inputs: ReadonlyArray<ClassValue>): string {
  return twMerge(clsx(inputs));
}
