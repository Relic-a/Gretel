/** Initials stay stable across the picker and profile management. */
export function profileInitials(name?: string) {
  return name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "G";
}
