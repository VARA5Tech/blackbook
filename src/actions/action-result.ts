import { ZodError } from "zod";
import { logger } from "@/lib/logger";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import { DomainError } from "@/services/client-service";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/**
 * Single translation point from thrown domain errors to something a form can
 * render. Server actions never leak stack traces or database messages to the
 * browser; anything unrecognised becomes a generic failure and is logged.
 */
export async function run<T>(
  operation: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return {
        ok: false,
        error: "Please correct the highlighted fields.",
        fieldErrors,
      };
    }

    if (error instanceof DomainError) {
      return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
    }

    if (error instanceof ForbiddenError) {
      return { ok: false, error: "You do not have access to do that." };
    }

    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: "Your session expired. Sign in again." };
    }

    // Unrecognised: the browser gets a generic message, the operator gets the
    // detail in the container log.
    logger.error("action.failed", error);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}
