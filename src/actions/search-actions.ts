"use server";

import { displayName } from "@/domain/customers";
import { searchClients } from "@/services/client-service";
import { listHouseholds } from "@/services/household-service";

export type QuickResult = {
  kind: "client" | "household";
  id: string;
  ref: string;
  title: string;
  subtitle: string | null;
};

/**
 * Backs the command palette. Deliberately thin: it calls the same service the
 * clients list uses, so ranking never diverges between the two surfaces.
 */
export async function quickSearch(term: string): Promise<QuickResult[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];

  const [clients, households] = await Promise.all([
    searchClients({ q: trimmed, limit: 8 }),
    listHouseholds(trimmed),
  ]);

  const clientResults: QuickResult[] = clients.rows.map((row) => ({
    kind: "client",
    id: row.id,
    ref: row.ref,
    title: displayName(row),
    subtitle: [row.ref, row.city, row.mobile].filter(Boolean).join(" · "),
  }));

  const householdResults: QuickResult[] = households.slice(0, 5).map((row) => ({
    kind: "household",
    id: row.id,
    ref: row.ref,
    title: row.name,
    subtitle: [row.ref, row.city, `${row.memberCount} members`]
      .filter(Boolean)
      .join(" · "),
  }));

  return [...clientResults, ...householdResults];
}
