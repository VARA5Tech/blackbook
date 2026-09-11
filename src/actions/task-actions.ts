"use server";

import { revalidatePath } from "next/cache";
import {
  createTask,
  setTaskStatus,
  type CreateTaskInput,
  type TASK_STATUSES,
} from "@/services/task-service";
import { run } from "./action-result";

export async function createTaskAction(input: CreateTaskInput) {
  const result = await run(() => createTask(input));
  if (result.ok) revalidatePath("/tasks");
  return result.ok ? { ok: true as const, data: undefined } : result;
}

export async function setTaskStatusAction(
  id: string,
  status: (typeof TASK_STATUSES)[number],
) {
  const result = await run(() => setTaskStatus(id, status));
  if (result.ok) revalidatePath("/tasks");
  return result.ok ? { ok: true as const, data: undefined } : result;
}
