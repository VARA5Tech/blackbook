"use server";

import {
  createFirstAdmin,
  type FirstAdminInput,
} from "@/services/setup-service";
import { run } from "./action-result";

export async function createFirstAdminAction(input: FirstAdminInput) {
  const result = await run(() => createFirstAdmin(input));
  return result.ok ? { ok: true as const, data: undefined } : result;
}
