import type { Metadata } from "next";
import { can, getActor } from "@/auth/session";
import { TaskBoard } from "@/components/tasks/task-board";
import { PageHeader } from "@/components/page-header";
import { listTasks } from "@/services/task-service";
import { listStaff } from "@/services/user-service";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const includeDone =
    (Array.isArray(params.done) ? params.done[0] : params.done) === "1";

  const [actor, tasks, staff] = await Promise.all([
    getActor(),
    listTasks({ includeDone }),
    listStaff(),
  ]);

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Follow-ups and to-dos, optionally tied to a client."
      />
      <TaskBoard
        tasks={tasks}
        staff={staff}
        includeDone={includeDone}
        canManage={actor ? can(actor, "task.manage") : false}
      />
    </>
  );
}
