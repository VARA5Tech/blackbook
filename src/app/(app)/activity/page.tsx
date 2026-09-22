import type { Metadata } from "next";
import { ActivityTable } from "@/components/activity/activity-table";
import { PageHeader } from "@/components/page-header";
import { listActivity, listActivityAuthors } from "@/services/activity-service";

export const metadata: Metadata = { title: "Activity" };

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = Number.parseInt(one(params.page) ?? "1", 10);

  const [result, authors] = await Promise.all([
    listActivity({
      q: one(params.q),
      action: one(params.action),
      record: one(params.record),
      by: one(params.by),
      period: one(params.period),
      page: Number.isFinite(page) ? page : 1,
    }),
    listActivityAuthors(),
  ]);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every change to a client or household: who made it, when, and exactly what changed."
      />
      <ActivityTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        lookups={result.lookups}
        authors={authors}
      />
    </>
  );
}
