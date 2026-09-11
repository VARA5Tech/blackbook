import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, UnauthenticatedError } from "@/auth/session";
import { createCustomer, searchClients } from "@/services/client-service";
import {
  actingAs,
  resetData,
  seedCatalogue,
  seedStaff,
  type StaffFixtures,
} from "./helpers";

/**
 * Proves the harness itself before the requirement suites rely on it: that the
 * actor can be switched between tests, and that a stubbed request context has
 * not accidentally disabled the real authorization checks.
 */
describe("test harness", () => {
  let staff: StaffFixtures;

  beforeAll(async () => {
    await seedCatalogue();
    staff = await seedStaff();
  });

  beforeEach(async () => {
    await resetData();
  });

  it("refuses every call when nobody is signed in", async () => {
    actingAs(null);
    await expect(searchClients({})).rejects.toThrow(UnauthenticatedError);
  });

  it("applies the real capability table, not a bypass", async () => {
    actingAs(staff.viewer);
    await expect(
      createCustomer({ firstName: "Denied", customerSince: "2026-01-01" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("switches actor between tests rather than memoising the first one", async () => {
    actingAs(staff.rm);
    const created = await createCustomer({
      firstName: "Allowed",
      customerSince: "2026-01-01",
    });
    expect(created.firstName).toBe("Allowed");

    actingAs(staff.viewer);
    await expect(
      createCustomer({ firstName: "Denied", customerSince: "2026-01-01" }),
    ).rejects.toThrow(ForbiddenError);

    actingAs(staff.admin);
    const second = await createCustomer({
      firstName: "AllowedAgain",
      customerSince: "2026-01-01",
    });
    expect(second.firstName).toBe("AllowedAgain");
  });

  it("records the acting user as the author of a write", async () => {
    actingAs(staff.rm);
    const created = await createCustomer({
      firstName: "Authored",
      customerSince: "2026-01-01",
    });
    expect(created.createdBy).toBe(staff.rm.id);
  });
});
