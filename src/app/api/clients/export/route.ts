import type { NextRequest } from "next/server";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import type { ClientStatus } from "@/domain/customers";
import { toCsv } from "@/domain/shared";
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
    const { columns, rows } = await exportClients({
      q: one(params, "q"),
      status: one(params, "status") as ClientStatus | undefined,
      rmId: one(params, "rm"),
      city: one(params, "city"),
      prefers: params.getAll("prefers"),
      avoids: params.getAll("avoids"),
      notContactedInDays: params.get("stale") ? Number(params.get("stale")) : undefined,
      includeArchived: params.get("archived") === "1",
      // The repository caps the export itself; these satisfy the shared
      // search schema and are not what decides how much comes back.
      limit: 1,
      offset: 0,
    });

    // The service decides the columns, because it is the only place that knows
    // every field a client carries. The route's job is the file, not the shape.
    const csv = toCsv(columns, rows);

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
