import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// « CANDICE MAISSA » -> « Candice Maissa »
export function titleCase(s: string | null | undefined) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase());
}

export function initials(name: string | null | undefined) {
  return String(name ?? "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
