"use client";

import {
  AtSign,
  Cake,
  Contact,
  Flag,
  Home,
  MapPin,
  MessageCircle,
  NotebookPen,
  Phone,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { updateClientAction } from "@/actions/client-actions";
import { InlineField } from "@/components/inline-field";
import { Section } from "@/components/page-header";
import { GENDERS, GENDER_LABELS } from "@/domain/customers";
import { formatDate } from "@/lib/format";
import type { Client360 } from "@/repositories/customer-repository";

/**
 * The client's own facts, each one editable where it sits. The editing itself
 * is `InlineField`; this decides which facts, in what order, and how each one
 * is saved: through `updateClientAction`, the same path as the full edit form.
 */

type Customer = Client360["customer"];
type Household = Client360["household"];

const PHONE_HINT = "+91 98100 11223";

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  ...GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] })),
];

/** "IN" reads as "India". A value that is not a two-letter code stays as typed. */
function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    const name = new Intl.DisplayNames(["en-GB"], { type: "region" }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? `${name} (${code.toUpperCase()})` : code;
  } catch {
    return code;
  }
}

export function ClientDetails({
  customer,
  household,
  canEdit,
}: {
  customer: Customer;
  household: Household;
  canEdit: boolean;
}) {
  const assistantFromHousehold =
    !customer.eaName && !customer.eaPhone && !customer.eaEmail && household &&
    (household.eaName || household.eaPhone || household.eaEmail)
      ? household
      : null;

  const common = {
    canEdit,
    save: (field: string, value: string) => updateClientAction({ id: customer.id, [field]: value }),
  };

  return (
    <div className="space-y-6">
      <Section
        title="Contact and identity"
        icon={Contact}
        action={
          <span className="text-xs text-muted-foreground">
            Updated {formatDate(customer.profileUpdatedAt)}
          </span>
        }
        flush
      >
        <dl className="divide-y divide-border">
          <InlineField {...common} field="mobile" label="Mobile" icon={Phone}
            value={customer.mobile} editor={{ kind: "text", inputMode: "tel", placeholder: PHONE_HINT }} tabular />
          <InlineField {...common} field="whatsapp" label="WhatsApp" icon={MessageCircle}
            value={customer.whatsapp} editor={{ kind: "text", inputMode: "tel", placeholder: PHONE_HINT }} tabular />
          <InlineField {...common} field="email" label="Email" icon={AtSign}
            value={customer.email} editor={{ kind: "text", inputMode: "email", placeholder: "name@example.com" }} />
          <InlineField {...common} field="dateOfBirth" label="Date of birth" icon={Cake}
            value={customer.dateOfBirth} display={(v) => formatDate(v)} editor={{ kind: "date" }} tabular />
          <InlineField {...common} field="gender" label="Gender" icon={UserRound}
            value={customer.gender}
            display={(v) => GENDER_LABELS[v as keyof typeof GENDER_LABELS] ?? v}
            editor={{ kind: "select", options: GENDER_OPTIONS }} />
          <InlineField {...common} field="nationality" label="Nationality" icon={Flag}
            value={customer.nationality} display={countryName}
            editor={{ kind: "text", placeholder: "IN, GB, AE…" }} />
          <InlineField {...common} field="city" label="City" icon={MapPin}
            value={customer.city} editor={{ kind: "text", placeholder: "New Delhi" }} />
          <InlineField {...common} field="address" label="Address" icon={Home}
            value={customer.address} editor={{ kind: "textarea" }} multiline />
          <InlineField {...common} field="remarks" label="Remarks" icon={NotebookPen}
            value={customer.remarks}
            editor={{ kind: "textarea", placeholder: "Anything that belongs on the client but nowhere else" }}
            multiline />
        </dl>
      </Section>

      <Section title="Executive assistant" icon={Users} flush>
        {assistantFromHousehold ? (
          <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            Shown from the household:{" "}
            <span className="text-foreground">{assistantFromHousehold.eaName ?? "assistant"}</span>
            {household ? (
              <>
                {" "}·{" "}
                <Link href={`/households/${household.id}`} className="underline underline-offset-2 hover:text-foreground">
                  {household.name}
                </Link>
              </>
            ) : null}
            . Fill these in to give this client their own.
          </p>
        ) : null}
        <dl className="divide-y divide-border">
          <InlineField {...common} field="eaName" label="Name" icon={UserRound}
            value={customer.eaName} editor={{ kind: "text", placeholder: "Full name" }} />
          <InlineField {...common} field="eaPhone" label="Phone" icon={Phone}
            value={customer.eaPhone} editor={{ kind: "text", inputMode: "tel", placeholder: PHONE_HINT }} tabular />
          <InlineField {...common} field="eaEmail" label="Email" icon={AtSign}
            value={customer.eaEmail} editor={{ kind: "text", inputMode: "email", placeholder: "name@example.com" }} />
          <InlineField {...common} field="eaNotes" label="Notes" icon={NotebookPen}
            value={customer.eaNotes} editor={{ kind: "textarea", placeholder: "How and when to reach them" }} multiline />
        </dl>
      </Section>
    </div>
  );
}
