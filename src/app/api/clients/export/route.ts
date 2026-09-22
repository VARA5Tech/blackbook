import type { NextRequest } from "next/server";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import { CLIENT_STATUS_LABELS, HOUSEHOLD_ROLE_LABELS, type ClientStatus } from "@/domain/customers";
import { GENDER_LABELS } from "@/domain/customers";
import { toCsv } from "@/domain/shared";
import { formatDate } from "@/lib/format";
import { logger } from "@/lib/logger";
import { exportClients } from "@/services/client-service";

/**
 * GET /api/clients/export
 *
 * The clients list as a spreadsheet, for the people who would rather read the
 * book in Excel than on a screen. It takes exactly the parameters the list
 * takes, so the export is whatever the filters were showing rather than a
 * separate idea of the truth, and it exports every match rather than the page.
 *
 * CSV with a byte-order mark, the way Falcon exports: Excel opens it directly,
 * with accents intact, and nothing has to parse a binary format to produce it.
 *
 * `exportClients` asserts the capability, so a signed-out request gets a 401
 * and a curator without `client.read` a 403, never a file.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const one = (params: URLSearchParams, key: string) => params.get(key) ?? undefined;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  try {
    const rows = await exportClients({
      q: one(params, "q"),
      status: one(params, "status") as ClientStatus | undefined,
      rmId: one(params, "rm"),
      city: one(params, "city"),
      prefers: params.getAll("prefers"),
      avoids: params.getAll("avoids"),
      notContactedInDays: params.get("stale") ? Number(params.get("stale")) : undefined,
      includeArchived: params.get("archived") === "1",
      limit: 1,
      offset: 0,
    });

    const csv = toCsv(
      [
        "Client ID",
        "First name",
        "Last name",
        "Known as",
        "Status",
        "Mobile",
        "WhatsApp",
        "Email",
        "Date of birth",
        "Gender",
        "Nationality",
        "City",
        "Address",
        "Household",
        "Household ID",
        "Role in household",
        "Relationship manager",
        "Assistant",
        "Assistant phone",
        "Assistant email",
        "Client since",
        "Last contacted",
        "Archived",
      ],
      rows.map((row) => [
        row.ref,
        row.firstName,
        row.lastName,
        row.preferredName,
        CLIENT_STATUS_LABELS[row.status],
        row.mobile,
        row.whatsapp,
        row.email,
        row.dateOfBirth ? formatDate(row.dateOfBirth) : "",
        row.gender ? GENDER_LABELS[row.gender] : "",
        row.nationality,
        row.city,
        row.address,
        row.householdName,
        row.householdRef,
        row.householdRole ? HOUSEHOLD_ROLE_LABELS[row.householdRole] : "",
        row.managerName,
        row.eaName,
        row.eaPhone,
        row.eaEmail,
        formatDate(row.customerSince),
        // Blank rather than "never": a spreadsheet sorts and filters on blanks.
        row.lastInteractionAt ? formatDate(row.lastInteractionAt) : "",
        row.archivedAt ? "Yes" : "",
      ]),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vara5-clients-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return new Response("Sign in to export the client list.", { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return new Response("You do not have access to the client list.", { status: 403 });
    }
    logger.error("client.export_failed", error);
    return new Response("The export could not be produced.", { status: 500 });
  }
}
