import { streamText } from "ai";
import { z } from "zod";
import { AiNotConfiguredError } from "@/ai/model";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import { logger } from "@/lib/logger";
import { prepareClientBrief } from "@/services/ai-brief-service";
import { DomainError } from "@/services/client-service";

const bodySchema = z.object({ customerId: z.uuid() });

export async function POST(request: Request) {
  try {
    const { customerId } = bodySchema.parse(await request.json());
    const { model, system, prompt } = await prepareClientBrief(customerId);

    const result = streamText({
      model,
      system,
      prompt,
      temperature: 0.2,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: "Sign in again." }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return Response.json({ error: "Not permitted." }, { status: 403 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: 404 });
    }

    logger.error("ai.brief_failed", error);
    return Response.json({ error: "Could not generate a brief." }, { status: 500 });
  }
}
