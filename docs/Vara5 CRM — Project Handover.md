# Vara5 CRM — Project Handover

## 1. What we are building

We are building **Vara5's own production CRM / Client 360 platform** for a luxury travel agency.

This is a real production system intended to become Vara5's standardized way of storing, viewing and managing client information.

The core objective is:

> Give any Vara5 team member a complete understanding of a client and their household within seconds, so they can provide highly personalized service.

This is **not a generic sales CRM** centered around leads, opportunities and pipelines.

The center of the system is the **client**.

Conceptually:

```text
                         CLIENT
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
      Household        Preferences        Milestones
          │                 │                  │
          └─────────────────┼──────────────────┘
                            │
                       Interactions
                            │
                           Tasks
                            │
                       Client DNA
```

The most important UX is the **Client 360 profile**.

---

# 2. Important separation

There is another experimental AI/customer-preference extraction project at Vara5.

**Ignore it completely.**

It has no architectural relationship to this CRM project.

Do not reuse its claims/concepts/profile-state architecture or make assumptions based on it.

This CRM is a separate production project with a standardized, concrete data model.

---

# 3. Delivery timeline

Today is Friday, September 11, 2026.

Target:

**Friday/night:** functional V1  
**Saturday:** testing, fixes and refinement  
**Sunday:** deliverable CRM V1

However, Sunday is **not the end of the project**.

After the initial deliverable, expect approximately **6–10 weeks of continued development**. This may become a major proprietary Vara5 internal platform with deeply customized UX, workflows, integrations and AI.

Therefore:

- move extremely fast now;
- but do not create throwaway architecture;
- make reasonable production-grade architectural decisions from day one;
- don't overengineer infrastructure that is not yet needed.

---

# 4. Build philosophy

We are building **Vara5's own application**, not deploying/customizing a generic CRM product.

Likely core stack:

```text
Next.js
TypeScript
PostgreSQL / Supabase
Zod
shadcn/ui
TanStack Table where useful
React Hook Form where useful
```

Use Supabase where it provides useful commodity infrastructure such as PostgreSQL, auth, storage, backups, etc., subject to final implementation decisions.

Keep the initial architecture simple. A separate NestJS backend or microservices are not required merely for architectural purity.

Next.js can initially contain:

```text
UI
API/server actions
business/application services
authorization
validation
AI endpoints/tools
```

PostgreSQL remains the source of truth.

---

# 5. Open-source/reuse philosophy

**Do not reinvent solved commodity infrastructure.**

AI coding makes custom application development fast, but we should still reuse mature open-source components and proven patterns where appropriate.

Examples:

```text
Auth
UI primitives
forms
tables
date/calendar components
command palette
file uploads
background jobs
email infrastructure
validation
etc.
```

Prefer well-maintained, permissively licensed components/libraries where appropriate.

We are **not** trying to write every primitive ourselves to claim the CRM is custom.

Vara5 should own the things that actually differentiate Vara5:

```text
Product architecture
Data/domain model
Business rules
Client 360 experience
Household experience
Travel/lifestyle preference UX
Milestones
Ops workflows
AI capabilities
Brand/design
Integrations
APIs
```

---

# 6. Twenty CRM's role

Twenty CRM is our **primary CRM reference implementation**, NOT our application foundation.

Repository:

https://github.com/twentyhq/twenty

Do NOT fork Twenty and attempt to maintain a deeply modified Twenty distribution.

Instead, use Twenty selectively as a reference when solving generic CRM problems such as:

```text
record/profile page UX
activity timeline
search
filtering
saved views
relation selectors
tables
tasks
permissions UX
command palette
record relationships
import flows
AI/CRM interaction patterns
navigation
```

Workflow:

```text
Need CRM capability
        ↓
Study how Twenty / mature software solves it
        ↓
Understand the pattern
        ↓
Check whether a suitable permissive OSS
library already provides the primitive
        ↓
YES → use/customize it
NO  → implement Vara5's version
        ↓
Keep implementation appropriate to Vara5
```

Do not blindly copy source code.

Twenty is largely AGPL/commercially licensed, so source/license boundaries matter if copying implementation code into proprietary software.

We can freely learn from architectural/design ideas, and use appropriately licensed components/libraries.

Do not spend time evaluating Odoo, SuiteCRM, EspoCRM and dozens of other CRMs unless Twenty genuinely fails to provide a useful reference for a particular problem.

We deliberately want to avoid platform-shopping.

---

# 7. Architecture principle

Even if the initial application lives in one Next.js repository, **separate UI from business logic**.

Avoid:

```text
React component
      ↓
direct arbitrary database mutations
```

Prefer:

```text
UI
 ↓
application/business service
 ↓
authorization
 ↓
validation
 ↓
business rules
 ↓
repository/query layer
 ↓
PostgreSQL
```

Organize roughly around domains:

```text
src/

  app/
    clients/
    households/
    milestones/
    interactions/

  components/

  domain/
    customers/
    households/
    milestones/
    interactions/

  services/
    client-service.ts
    household-service.ts
    milestone-service.ts
    interaction-service.ts

  repositories/
    customer-repository.ts
    household-repository.ts
    milestone-repository.ts

  ai/
    tools/
    prompts/

  auth/

  db/
```

Exact folder structure can evolve; the principle matters more than these exact names.

Important business operations should become explicit functions/services, for example:

```text
createCustomer()
updateCustomer()
createHousehold()
addHouseholdMember()
removeHouseholdMember()
updateClientPreferences()
createMilestone()
recordInteraction()
getClient360()
searchClients()
```

This allows the same business layer to eventually serve:

```text
Web UI
AI
automations
integrations
mobile UI
external/internal APIs
```

---

# 8. Required production domain

## Customer Master

Each individual customer has a unique Customer ID.

Required information includes:

```text
Unique Customer ID
Household ID
First Name
Last Name
Preferred Name
Mobile Number
WhatsApp Number
Email
Date of Birth
Gender
Nationality
City
Address
Google Pin / Location
Primary Relationship Manager
Customer Since
Client Status — Active / Inactive
```

IDs should be generated systematically, e.g.:

```text
CUST-00125
```

---

# 9. Household

A **Household is a separate first-class entity from Customer**.

Example:

```text
HH-00125
│
├── CUST-00125 — Rishabh
├── CUST-00126 — Spouse
├── CUST-00127 — Child 1
└── CUST-00128 — Child 2
```

Required household information:

```text
Household ID
Primary Client
Household Name
Household City
Family Members
Family Travel Pattern
Household Notes
```

Family Travel Pattern should support:

```text
Couple
Family
Multi-generational
```

The CRM must support viewing the family collectively while retaining each individual's own profile/preferences.

Model relationships properly rather than treating household as arbitrary text.

---

# 10. Milestones

Important dates need to support proactive concierge engagement.

Examples:

```text
Birthday
Wedding Anniversary
Spouse Birthday
Children's Birthdays
Other Important Dates
Preferred celebration style / notes
```

Milestones should be searchable and capable of generating future reminders/alerts.

Prefer a reusable milestone entity rather than hardcoding `child1Birthday`, `child2Birthday`, etc.

Conceptually:

```text
Milestone

id
customer_id / household_id
type
title
date
notes
celebration_style
reminder configuration
status
```

A client/household should be able to have an arbitrary number of milestones.

---

# 11. Travel Preferences

## Destinations

```text
Favourite Destinations
Wishlist Destinations
Destinations to Avoid
Preferred Travel Seasons
```

## Travel Style — multi-select

```text
Luxury
Adventure
Wellness
Beach
Safari
Culture
Gastronomy
Shopping
Ski
Family
Romantic
Art & Design
Sports / Events
```

## Travel Behaviour

```text
Typical Trip Duration
Typical Travelling Party
Approx. Travel Frequency
Typical Budget Range
Preferred Booking Lead Time
```

This is a standardized production CRM, so prioritize clear structured fields/enums/multi-selects where appropriate rather than attempting an experimental dynamic preference system.

---

# 12. Hotel Preferences

Capture:

```text
Preferred Hotel Brands
Preferred Hotels
Hotel Brands / Properties to Avoid
Preferred Room Type
Room / Bed Preferences
View Preference
Other Hotel Preferences
```

---

# 13. Flight Preferences

Capture:

```text
Preferred Airlines
Airline Loyalty Programmes
Preferred Cabin
Seat Preference
Direct Flight Preference
Flight Timing Preference
Other Flight Preferences
```

---

# 14. Dining

Capture:

```text
Dietary Preference
Allergies / Restrictions
Favourite Cuisines
Favourite Restaurants
Fine Dining Preference
Bar / Wine Preferences
Dining Preferences / Notes
```

---

# 15. Lifestyle & Experiences

Capture:

```text
Interests
Favourite Activities
Preferred Experience Style
Shopping / Luxury Brand Preferences
Other Lifestyle Preferences
```

---

# 16. Client DNA / Know Me

This deserves significant visual importance in the Client 360 UI.

It is a free-text area for important nuances that don't fit structured fields.

Examples:

```text
Doesn't like large resorts.
Always prefers boutique properties.
Loves Japanese food.
Prefers aisle seat on long-haul flights.
Anniversary trips should feel intimate, not commercial.
```

Also provide two clearly separate fields/areas:

```text
DO
DON'T
```

for important preferences and deal-breakers.

Possible UI:

```text
┌──────────────────────────────────────────────┐
│ CLIENT DNA                                   │
│                                              │
│ Appreciates intimate properties and highly  │
│ personalised service. Anniversary trips     │
│ should feel private rather than commercial. │
└──────────────────────────────────────────────┘

DO                         DON'T
──────────────────         ─────────────────
Boutique hotels            Large resorts
Direct flights             Early departures
Personal service           Tourist-trap dining
```

---

# 17. Basic CRM capabilities required for Sunday

The system must support:

```text
Search by:
- Customer Name
- Customer ID
- Household ID
- Mobile

Search/filter by key preferences

Link multiple customers to one Household

View individual Client profile

View Household profile

Edit/update preferences

Record date of last profile update

Record Last Interaction

Basic activity/history timeline

Milestone reminders

Role-based access for Vara5 team members
```

These are part of V1, not future wishlist items.

---

# 18. UX direction

Do not blindly recreate Salesforce.

This is a luxury-travel operations CRM.

Primary navigation could roughly be:

```text
VARA5

Search

Home
Clients
Households
Milestones
Tasks
Activity

──────────────

Ask Vara5
```

The exact design is open for improvement.

The guiding principle:

> An ops employee should understand what's important without navigating through a generic sales CRM.

---

# 19. Client 360 is the hero screen

This deserves the most design attention.

Conceptually:

```text
← Clients

RS   RISHABH SHARMA                         ACTIVE

     Delhi · Client since 2021
     Relationship Manager: Priya

     +91 ...
     rishabh@...
     WhatsApp

────────────────────────────────────────────────

[ OVERVIEW ] [ TRAVEL ] [ HOTELS & AIR ]
[ DINING ]   [ HOUSEHOLD ] [ ACTIVITY ]

────────────────────────────────────────────────

CLIENT DNA

Prefers quieter, intimate properties with
personal service...

DO                         DON'T
Boutique properties        Large resorts
Direct flights             Early flights


HOUSEHOLD

Sharma Family
├── Rishabh
├── Neha
└── Aarav


UPCOMING

Anniversary
October 11 · 30 days


RECENT ACTIVITY

Sep 10
Hotel preferences updated

Sep 07
Client interaction

Aug 24
Profile updated
```

This is illustrative, not a rigid wireframe.

Improve it where appropriate.

The success criterion is:

> A Vara5 employee opens a client and understands that person in seconds.

---

# 20. Home/Ops dashboard

Keep this operational rather than filling it with meaningless charts.

Useful information might include:

```text
Upcoming birthdays
Upcoming anniversaries
Clients needing follow-up
Incomplete profiles
Recent clients
Tasks
Recent activity
```

Example:

```text
Good morning

TODAY

2 birthdays coming up
1 anniversary in 7 days
8 clients need follow-up
3 profiles incomplete

UPCOMING MILESTONES

Sep 14   Rahul Sharma     Anniversary
Sep 17   Ananya Mehta     Birthday
Sep 21   Kapoor Family    Anniversary
```

---

# 21. AI philosophy

The CRM should become **AI-powered**, but AI must solve operational problems rather than being decorative.

Do not make the application architecture dependent on one model/provider.

AI should access the application through controlled tools/business services, NOT raw unrestricted database access.

Prefer:

```text
AI
 │
 ├── getClient()
 ├── searchClients()
 ├── getHousehold()
 ├── getUpcomingMilestones()
 └── proposeProfileUpdate()
             │
             ▼
        human review
             │
             ▼
      business service
             │
             ▼
         database
```

Do NOT allow an LLM to freely generate arbitrary SQL against production or silently modify customer records.

---

# 22. AI V1 — Client Brief

This is the first AI capability to build.

Button on Client 360:

```text
✨ Brief Me
```

It should transform existing structured CRM information into a concise operational briefing, e.g.:

```text
Rishabh Sharma

• Client since 2021
• Usually travels with spouse
• Luxury + gastronomy traveller
• Strong preference for boutique properties
• Avoids large resorts
• Prefers direct flights
• Anniversary: October 11
• Last contacted 41 days ago

Suggested next action:
Consider anniversary outreach this week.
```

AI must distinguish facts stored in CRM from suggestions.

---

# 23. AI V1/V1.1 — Natural-language CRM search

Useful interaction:

```text
✨ Ask Vara5

"Show clients handled by Priya whose
anniversary is next month and who like Maldives."
```

AI should translate natural language into **controlled structured filters/search**, not arbitrary SQL.

Other examples:

```text
Who likes Aman hotels?

Which clients haven't been contacted in 60 days?

Show active Delhi clients who prefer Japan.

Which households have anniversaries next month?
```

Initially make this read-only.

---

# 24. AI next feature — Smart profile update

After the core CRM is stable:

Employee writes/pastes:

```text
Spoke to Mr Sharma. They're thinking about Japan
for cherry blossom season next March. Probably
travelling with his wife. He mentioned that they
really dislike early morning flights and now prefer
suites when staying more than four nights.
```

AI proposes:

```text
Suggested updates

Wishlist Destination
+ Japan

Preferred Season
+ Spring / Cherry Blossom

Typical Travelling Party
Couple

Flight Timing Preference
Avoid early morning

Hotel Preference
Suite for stays > 4 nights

[Cancel] [Review & Save]
```

AI proposes changes.

**Human confirms before production data changes.**

Maintain an audit trail.

---

# 25. Things NOT to overbuild before Sunday

Do not jeopardize the core deliverable by attempting:

```text
WhatsApp integration
Gmail ingestion
booking engine integration
mobile apps
voice assistant
vector database/RAG infrastructure
recommendation engine
generic workflow-builder product
generic custom-object builder
complex analytics platform
automatic web research
fully autonomous data-modifying agents
microservices
Kafka
Kubernetes
```

Those can be evaluated later if justified.

---

# 26. Sunday definition of done

By Sunday, a team member should be able to:

```text
Log in
   ↓
Search "Rishabh"
   ↓
Open Client 360
   ↓
See identity/contact information
   ↓
See household/family
   ↓
See travel preferences
   ↓
See hotel + flight preferences
   ↓
See dining + lifestyle
   ↓
See Client DNA / DO / DON'T
   ↓
See milestones
   ↓
See recent activity
   ↓
Edit/update information
   ↓
Click "Brief Me"
```

Additionally:

```text
Create customer
Edit customer
Archive/deactivate customer

Create household
Link/unlink household members

Create/edit milestone
See upcoming milestone reminders

Record interaction
See activity/history

Search required identifiers
Filter key preferences

Basic role-based access
```

Target **functional coverage of the supplied V1 requirements by Sunday**.

Do not confuse that with claiming the system has already undergone months of production hardening.

---

# 27. Quality bar

Do not optimize merely for “it works.”

This is expected to evolve into a serious internal Vara5 product.

Prioritize:

```text
Clean UX
Fast navigation
Good information hierarchy
Strong typing
Database integrity
Validation
Authorization
Auditability
Maintainable domain boundaries
Useful empty/loading/error states
Responsive UI
Sensible accessibility
Migration safety
Good developer ergonomics
```

Avoid unnecessary abstraction, but don't generate a pile of tightly coupled CRUD code just because AI can produce it quickly.

---

# 28. Core decision rule while building

For every feature, ask:

```text
Is this specific to Vara5?
        │
        ├── YES
        │     Build it properly for Vara5.
        │
        └── NO
        │
        ▼
Has this generic problem already been solved well?
        │
        ├── YES → reuse a suitable proven OSS primitive/pattern
        │
        └── NO  → implement the simplest robust solution
```

Use Twenty as the primary CRM reference when useful, but don't inherit complexity merely because Twenty has it.

The final goal is **not to build a CRM framework**.

The goal is to build an excellent **Vara5 Client 360 CRM**.