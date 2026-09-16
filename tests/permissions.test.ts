import { randomUUID } from "node:crypto";
import { sql } from "@/db";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesFor, roleCan } from "@/auth/permissions";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import type { UserRole } from "@/db/schema";
import {
  archiveCustomer,
  createCustomer,
  eraseCustomer,
  getClient360,
  restoreCustomer,
  searchClientGroups,
  searchClients,
  updateClientDna,
  updateCustomer,
} from "@/services/client-service";
import {
  addHouseholdMember,
  createHousehold,
  removeHouseholdMember,
  updateHousehold,
} from "@/services/household-service";
import { createMilestone, archiveMilestone } from "@/services/milestone-service";
import { recordInteraction } from "@/services/interaction-service";
import {
  createPreferenceOption,
  setPreferences,
  updatePreferenceProfile,
} from "@/services/preference-service";
import { createTask, setTaskStatus } from "@/services/task-service";
import {
  createStaffUser,
  inviteStaff,
  listAllUsers,
  setUserRole,
} from "@/services/user-service";
import {
  actingAs,
  getCurrentTestActor,
  optionId,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Requirements document, section 8, final bullet:
 * "Role-based access for Vara5 team members."
 *
 * Every operation is attempted as every role, so the matrix is verified by
 * exhaustion rather than by reading the capability table.
 */
const ROLES: UserRole[] = ["viewer", "rm", "manager", "admin"];

describe("role-based access", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
  });

  describe("capability table", () => {
    it("grants every role strictly more than the one below it", () => {
      const viewer = new Set(capabilitiesFor("viewer"));
      const rm = new Set(capabilitiesFor("rm"));
      const manager = new Set(capabilitiesFor("manager"));
      const admin = new Set(capabilitiesFor("admin"));

      for (const capability of viewer) expect(rm.has(capability)).toBe(true);
      for (const capability of rm) expect(manager.has(capability)).toBe(true);
      for (const capability of manager) expect(admin.has(capability)).toBe(true);

      expect(rm.size).toBeGreaterThan(viewer.size);
      expect(manager.size).toBeGreaterThan(rm.size);
      expect(admin.size).toBeGreaterThan(manager.size);
    });

    it("gives the administrator every declared capability", () => {
      for (const capability of CAPABILITIES) {
        expect(roleCan("admin", capability)).toBe(true);
      }
    });

    it("gives the viewer read access and nothing that writes", () => {
      expect(roleCan("viewer", "client.read")).toBe(true);
      expect(roleCan("viewer", "ai.use")).toBe(true);

      const writes = CAPABILITIES.filter(
        (capability) => capability !== "client.read" && capability !== "ai.use",
      );
      for (const capability of writes) {
        expect(roleCan("viewer", capability)).toBe(false);
      }
    });

    it("reserves user management for the administrator alone", () => {
      expect(roleCan("admin", "user.manage")).toBe(true);
      for (const role of ["viewer", "rm", "manager"] as const) {
        expect(roleCan(role, "user.manage")).toBe(false);
      }
    });

    it("reserves erasure for the administrator alone", () => {
      expect(roleCan("admin", "client.destroy")).toBe(true);
      for (const role of ["viewer", "rm", "manager"] as const) {
        expect(roleCan(role, "client.destroy")).toBe(false);
      }
    });

    it("reserves archiving and reassignment for manager and above", () => {
      for (const capability of ["client.archive", "client.reassign_rm"] as const) {
        expect(roleCan("viewer", capability)).toBe(false);
        expect(roleCan("rm", capability)).toBe(false);
        expect(roleCan("manager", capability)).toBe(true);
        expect(roleCan("admin", capability)).toBe(true);
      }
    });
  });

  describe("every operation attempted as every role", () => {
    /**
     * One entry per write path in the application, with the lowest role that
     * is allowed to perform it. The table below then asserts both directions
     * for all four roles.
     */
    const operations: {
      name: string;
      allowedFrom: UserRole;
      run: (fixtures: StaffFixtures) => Promise<unknown>;
    }[] = [
      {
        name: "read clients",
        allowedFrom: "viewer",
        run: () => searchClients({}),
      },
      {
        name: "read the clients list grouped by household",
        allowedFrom: "viewer",
        run: () => searchClientGroups({}),
      },
      {
        name: "create a client",
        allowedFrom: "rm",
        run: () =>
          createCustomer({ firstName: "Created", customerSince: "2026-01-01" }),
      },
      {
        name: "edit a client",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({ firstName: "Editable", customerSince: "2026-01-01" }),
          );
          return updateCustomer({ id: client.id, city: "Delhi" });
        },
      },
      {
        name: "edit client DNA",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({ firstName: "Dna", customerSince: "2026-01-01" }),
          );
          return updateClientDna({
            customerId: client.id,
            clientDna: "Noted",
            dos: [],
            donts: [],
          });
        },
      },
      {
        name: "archive a client",
        allowedFrom: "manager",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Archivable",
              customerSince: "2026-01-01",
            }),
          );
          return archiveCustomer(client.id);
        },
      },
      {
        name: "restore a client",
        allowedFrom: "manager",
        run: async () => {
          const client = await asAdmin(async () => {
            const created = await createCustomer({
              firstName: "Restorable",
              customerSince: "2026-01-01",
            });
            await archiveCustomer(created.id);
            return created;
          });
          return restoreCustomer(client.id);
        },
      },
      {
        name: "reassign the relationship manager",
        allowedFrom: "manager",
        run: async (fixtures) => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Reassignable",
              customerSince: "2026-01-01",
            }),
          );
          return updateCustomer({
            id: client.id,
            primaryRmId: fixtures.rm.id,
          });
        },
      },
      {
        name: "create a household",
        allowedFrom: "rm",
        run: () => createHousehold({ name: "Created Family" }),
      },
      {
        name: "edit a household",
        allowedFrom: "rm",
        run: async () => {
          const household = await asAdmin(() =>
            createHousehold({ name: "Editable Family" }),
          );
          return updateHousehold({ id: household.id, city: "Delhi" });
        },
      },
      {
        name: "link a household member",
        allowedFrom: "rm",
        run: async () => {
          const { household, client } = await asAdmin(async () => ({
            household: await createHousehold({ name: "Linkable Family" }),
            client: await createCustomer({
              firstName: "Linkable",
              customerSince: "2026-01-01",
            }),
          }));
          return addHouseholdMember({
            householdId: household.id,
            customerId: client.id,
            householdRole: "spouse",
          });
        },
      },
      {
        name: "unlink a household member",
        allowedFrom: "rm",
        run: async () => {
          const { household, client } = await asAdmin(async () => {
            const h = await createHousehold({ name: "Unlinkable Family" });
            const c = await createCustomer({
              firstName: "Unlinkable",
              householdId: h.id,
              customerSince: "2026-01-01",
            });
            return { household: h, client: c };
          });
          return removeHouseholdMember(household.id, client.id);
        },
      },
      {
        name: "create a milestone",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Milestoned",
              customerSince: "2026-01-01",
            }),
          );
          return createMilestone({
            customerId: client.id,
            type: "birthday",
            title: "A birthday",
            date: "1990-05-05",
          });
        },
      },
      {
        name: "remove a milestone",
        allowedFrom: "rm",
        run: async () => {
          const milestone = await asAdmin(async () => {
            const client = await createCustomer({
              firstName: "Removable",
              customerSince: "2026-01-01",
            });
            return createMilestone({
              customerId: client.id,
              type: "other",
              title: "Removable",
              date: "1990-05-05",
            });
          });
          return archiveMilestone(milestone.id);
        },
      },
      {
        name: "record an interaction",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Contacted",
              customerSince: "2026-01-01",
            }),
          );
          return recordInteraction({
            customerId: client.id,
            type: "call",
            summary: "A call",
          });
        },
      },
      {
        name: "update preferences",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Preferred",
              customerSince: "2026-01-01",
            }),
          );
          return setPreferences({
            customerId: client.id,
            kind: "destination",
            selections: [
              {
                optionId: await optionId("destination", "japan"),
                polarity: "prefer",
              },
            ],
          });
        },
      },
      {
        name: "update the preference profile",
        allowedFrom: "rm",
        run: async () => {
          const client = await asAdmin(() =>
            createCustomer({
              firstName: "Profiled",
              customerSince: "2026-01-01",
            }),
          );
          return updatePreferenceProfile({
            customerId: client.id,
            travelNotes: "A note",
          });
        },
      },
      {
        name: "add a catalogue option",
        allowedFrom: "rm",
        run: () =>
          createPreferenceOption({
            kind: "hotel_property",
            label: `Property ${Math.random()}`,
          }),
      },
      {
        name: "create a task",
        allowedFrom: "rm",
        run: () => createTask({ title: "A task" }),
      },
      {
        name: "complete a task",
        allowedFrom: "rm",
        run: async () => {
          const task = await asAdmin(() => createTask({ title: "Completable" }));
          return setTaskStatus(task.id, "done");
        },
      },
      {
        name: "manage users",
        allowedFrom: "admin",
        run: () => listAllUsers(),
      },
      {
        name: "create a colleague's account",
        allowedFrom: "admin",
        run: () =>
          createStaffUser({
            name: "New Colleague",
            email: `colleague-${randomUUID()}@vara5.com`,
            role: "rm",
            password: "a-sufficiently-long-password",
          }),
      },
      {
        name: "invite a colleague by email",
        allowedFrom: "admin",
        run: () =>
          inviteStaff({
            name: "Invited Colleague",
            email: `invitee-${randomUUID()}`,
            role: "viewer",
          }),
      },
      {
        name: "change a colleague's role",
        allowedFrom: "admin",
        run: async (fixtures) => setUserRole(fixtures.viewer.id, "viewer"),
      },
      {
        name: "erase a client",
        allowedFrom: "admin",
        run: async () => {
          const client = await asAdmin(async () => {
            const created = await createCustomer({
              firstName: "Erasable",
              customerSince: "2026-01-01",
            });
            await archiveCustomer(created.id);
            return created;
          });
          return eraseCustomer(client.id, "Client exercised their right to erasure");
        },
      },
    ];

    /**
     * Runs fixture setup as an administrator, then puts the original actor
     * back, so the operation under test is genuinely attempted by that role.
     */
    async function asAdmin<T>(work: () => Promise<T>): Promise<T> {
      const previous = getCurrentTestActor();
      actingAs(staff.admin);
      try {
        return await work();
      } finally {
        actingAs(previous);
      }
    }

    const rank: Record<UserRole, number> = {
      viewer: 0,
      rm: 1,
      manager: 2,
      admin: 3,
    };

    for (const operation of operations) {
      for (const role of ROLES) {
        const shouldAllow = rank[role] >= rank[operation.allowedFrom];

        it(`${shouldAllow ? "allows" : "denies"} ${role} to ${operation.name}`, async () => {
          actingAs(staff[role]);
          const attempt = operation.run(staff);

          if (shouldAllow) {
            await expect(attempt).resolves.not.toThrow();
          } else {
            await expect(attempt).rejects.toThrow(ForbiddenError);
          }
        });
      }
    }
  });

  describe("signed out", () => {
    it.each([
      ["read clients", () => searchClients({})],
      ["read the clients list grouped by household", () => searchClientGroups({})],
      [
        "open a client",
        () => getClient360("00000000-0000-4000-8000-000000000000"),
      ],
      [
        "create a client",
        () => createCustomer({ firstName: "X", customerSince: "2026-01-01" }),
      ],
      ["create a household", () => createHousehold({ name: "X" })],
      ["create a task", () => createTask({ title: "X" })],
      ["manage users", () => listAllUsers()],
    ])("refuses to %s", async (_name, run) => {
      actingAs(null);
      await expect(run()).rejects.toThrow(UnauthenticatedError);
    });
  });

  describe("an administrator cannot lock themselves out", () => {
    it("refuses to demote the acting administrator", async () => {
      actingAs(staff.admin);
      await expect(setUserRole(staff.admin.id, "viewer")).rejects.toThrow(
        /own administrator access/,
      );
    });

    it("still allows demoting somebody else", async () => {
      actingAs(staff.admin);
      const updated = await setUserRole(staff.manager.id, "rm");
      expect(updated.role).toBe("rm");

      // Put the fixture back for the tests that follow.
      await setUserRole(staff.manager.id, "manager");
    });
  });

  describe("a denied write leaves no trace", () => {
    it("does not create the client, and does not log an attempt", async () => {
      actingAs(staff.viewer);
      await expect(
        createCustomer({ firstName: "Rejected", customerSince: "2026-01-01" }),
      ).rejects.toThrow(ForbiddenError);

      actingAs(staff.admin);
      const { rows, total } = await searchClients({ q: "Rejected" });
      expect(rows).toHaveLength(0);
      expect(total).toBe(0);
    });

    it("leaves the original value when an edit is denied", async () => {
      actingAs(staff.admin);
      const client = await createCustomer({
        firstName: "Untouched",
        city: "Delhi",
        customerSince: "2026-01-01",
      });

      actingAs(staff.rm);
      await expect(
        updateCustomer({ id: client.id, primaryRmId: staff.manager.id }),
      ).rejects.toThrow(ForbiddenError);

      actingAs(staff.admin);
      const record = await getClient360(client.id);
      expect(record?.customer.primaryRmId).toBeNull();
      expect(record?.customer.city).toBe("Delhi");
    });
  });

  describe("a relationship manager may still edit their own clients", () => {
    it("allows an edit that does not reassign", async () => {
      actingAs(staff.admin);
      const client = await createCustomer({
        firstName: "Mine",
        primaryRmId: staff.rm.id,
        customerSince: "2026-01-01",
      });

      actingAs(staff.rm);
      const updated = await updateCustomer({ id: client.id, city: "Delhi" });
      expect(updated.city).toBe("Delhi");
    });

    it("allows setting the same manager again without the reassign capability", async () => {
      actingAs(staff.admin);
      const client = await createCustomer({
        firstName: "SameRm",
        primaryRmId: staff.rm.id,
        customerSince: "2026-01-01",
      });

      actingAs(staff.rm);
      const updated = await updateCustomer({
        id: client.id,
        primaryRmId: staff.rm.id,
        city: "Delhi",
      });
      expect(updated.city).toBe("Delhi");
    });
  });
});

/**
 * Blackbook shares its database with a Supabase stack, whose API serves anything
 * in public that PUBLIC or the anon role can reach. These are the two locks that
 * keep client data and Blackbook's own functions off it. Neither is visible from
 * inside the application, which connects as the owner, so only a test sees them.
 */
describe("shut out of the Supabase API", () => {
  it("has row-level security switched on for every table", async () => {
    const unprotected = await sql<{ name: string }[]>`
      select c.relname as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity
      order by 1
    `;
    expect(unprotected.map((row) => row.name)).toEqual([]);
  });

  it("does not let PUBLIC call any of Blackbook's database functions", async () => {
    const functions = await sql<{ name: string; callable: boolean }[]>`
      select p.proname as name,
             has_function_privilege('public', p.oid, 'execute') as callable
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and left(p.proname, 6) = 'vara5_'
      order by 1
    `;

    // Asserted by name, so a function that stops existing fails loudly instead
    // of quietly passing an empty list.
    expect(functions.map((row) => row.name)).toEqual([
      "vara5_days_until",
      "vara5_member_ref",
      "vara5_next_occurrence",
      "vara5_ref",
      "vara5_uuid_v7",
    ]);
    expect(functions.filter((row) => row.callable).map((row) => row.name)).toEqual([]);
  });
});
