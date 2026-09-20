import "server-only";
import { requireCapability } from "@/auth/session";
import { getModel } from "@/ai/model";
import { displayName, executiveAssistantFor } from "@/domain/customers";
import { getClient360 } from "@/services/client-service";
import { KIND_LABELS, POLARITY_LABELS, scalarLabel } from "@/domain/preferences";
import { daysSince, formatDate, humanise } from "@/lib/format";
import { DomainError } from "@/services/client-service";

const SYSTEM_PROMPT = `You are the briefing assistant inside Blackbook, Vara5's internal CRM. Vara5 is a luxury travel agency; the reader is a Vara5 employee about to speak to this client.

Write a short operational briefing from the CRM record you are given.

Rules:
- Use ONLY facts present in the record. Never invent a preference, a date, a trip or a name.
- Open with 5 to 9 short bullet points, each one line, most useful first.
- Then a blank line, then a line reading exactly "Suggested next action:" followed by one sentence.
- The bullets are facts from the record. The suggested action is your inference and is the only place you may go beyond the record.
- If something important is missing from the record (no recorded preferences, never contacted), say so plainly in a bullet rather than guessing.
- No greeting, no sign-off, no markdown headings, no bold.
- British English. Plain sentences. No adjectives that the record does not support.`;

/**
 * Builds the model's view of a client.
 *
 * The model reads this rendered text, never the database. Every value here has
 * already passed the read authorization check in getClient360, so the briefing
 * can never reveal a record the signed-in user could not open themselves.
 */
function renderRecord(record: NonNullable<Awaited<ReturnType<typeof getClient360>>>) {
  const { customer, household, rm, profile } = record;
  const lines: string[] = [];

  lines.push(`Client: ${displayName(customer)} (${customer.ref})`);
  if (customer.city) lines.push(`City: ${customer.city}`);
  lines.push(`Client since: ${formatDate(customer.customerSince)}`);
  lines.push(`Status: ${customer.status}`);
  if (rm?.name) lines.push(`Relationship manager: ${rm.name}`);

  // The fact of going through an assistant, and their name and notes. Never
  // their phone or email: the model has no use for contact details, and the
  // client's own are not sent either.
  const assistant = executiveAssistantFor(customer, household);
  if (assistant) {
    lines.push(
      `Reached through ${assistant.fromHousehold ? "the household's" : "their"} executive assistant: ${assistant.name ?? "name not recorded"}${assistant.notes ? ` (${assistant.notes})` : ""}`,
    );
  }

  const since = daysSince(customer.lastInteractionAt);
  lines.push(
    customer.lastInteractionAt
      ? `Last contacted: ${since} days ago (${formatDate(customer.lastInteractionAt)})`
      : "Last contacted: never recorded",
  );

  if (household) {
    lines.push(`Household: ${household.name} (${household.ref})`);
    if (household.travelPattern)
      lines.push(`Family travel pattern: ${humanise(household.travelPattern)}`);
    if (record.householdMembers.length > 0) {
      lines.push(
        `Household members: ${record.householdMembers
          .map(
            (member) =>
              `${displayName(member)}${member.householdRole ? ` (${humanise(member.householdRole)})` : ""}`,
          )
          .join(", ")}`,
      );
    }
  }

  if (customer.clientDna) {
    lines.push("", `Client DNA: ${customer.clientDna}`);
  }

  if (customer.dos.length > 0) lines.push(`DO: ${customer.dos.join("; ")}`);
  if (customer.donts.length > 0)
    lines.push(`DON'T: ${customer.donts.join("; ")}`);

  if (record.preferences.length > 0) {
    lines.push("", "Preferences:");
    const byKind = new Map<string, typeof record.preferences>();
    for (const preference of record.preferences) {
      const list = byKind.get(preference.kind) ?? [];
      list.push(preference);
      byKind.set(preference.kind, list);
    }
    for (const [kind, rows] of byKind) {
      const rendered = rows
        .map(
          (row) =>
            `${POLARITY_LABELS[row.polarity].toLowerCase()} ${row.label}${row.note ? ` (${row.note})` : ""}`,
        )
        .join(", ");
      lines.push(
        `- ${KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind}: ${rendered}`,
      );
    }
  } else {
    lines.push("", "Preferences: none recorded.");
  }

  if (profile) {
    const scalars = [
      ["Typical party", profile.travelParty],
      ["Travel frequency", profile.travelFrequency],
      ["Budget range", profile.travelBudgetRange],
      ["Booking lead time", profile.travelBookingLeadTime],
      ["Typical trip nights", profile.travelTypicalTripNights],
      ["Preferred cabin", profile.flightCabin],
      ["Direct flights", profile.flightDirectPreference],
      ["Dietary", profile.diningDietary],
      ["Fine dining", profile.diningFineDining],
      ["Experience style", profile.lifestyleExperienceStyle],
    ].filter(([, value]) => value !== null && value !== undefined);

    if (scalars.length > 0) {
      lines.push("", "Travel profile:");
      for (const [label, value] of scalars) {
        // The reader-facing label, not the stored enum. Passing "25l_50l"
        // through meant the model repeated it verbatim in the briefing.
        lines.push(`- ${label}: ${scalarLabel(String(value))}`);
      }
    }

    for (const [label, value] of [
      ["Travel notes", profile.travelNotes],
      ["Hotel notes", profile.hotelNotes],
      ["Flight notes", profile.flightNotes],
      ["Dining notes", profile.diningNotes],
      ["Lifestyle notes", profile.lifestyleNotes],
    ] as const) {
      if (value) lines.push(`${label}: ${value}`);
    }
  }

  if (record.milestones.length > 0) {
    lines.push("", "Milestones:");
    for (const milestone of record.milestones) {
      lines.push(
        `- ${milestone.title}: ${formatDate(milestone.date)}${milestone.celebrationStyle ? ` (${milestone.celebrationStyle})` : ""}`,
      );
    }
  }

  if (record.interactions.length > 0) {
    lines.push("", "Recent interactions:");
    for (const interaction of record.interactions.slice(0, 6)) {
      lines.push(
        `- ${formatDate(interaction.occurredAt)} ${interaction.type}: ${interaction.summary}${interaction.details ? ` — ${interaction.details}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

/** Prepares the model call for the Brief Me button. Streaming is done by the route. */
export async function prepareClientBrief(customerId: string) {
  await requireCapability("ai.use");

  const record = await getClient360(customerId);
  if (!record) throw new DomainError("Client not found");

  return {
    model: getModel(),
    system: SYSTEM_PROMPT,
    prompt: `CRM record:\n\n${renderRecord(record)}\n\nWrite the briefing.`,
  };
}
