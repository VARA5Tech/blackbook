import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "@/db";
import { UnauthenticatedError } from "@/auth/session";
import { searchClients } from "@/services/client-service";
import { createFirstAdmin, needsSetup } from "@/services/setup-service";
import { DomainError } from "@/services/client-service";
import { actingAs, resetData } from "./helpers";

/**
 * First-run setup. The only path that creates an account without one already
 * existing, so its gate matters more than most.
 */
describe("first-run setup", () => {
  beforeEach(async () => {
    await resetData();
    // These tests are about the empty-instance case, so the staff fixtures go.
    await sql.unsafe("truncate table app_user restart identity cascade");
    actingAs(null);
  });

  it("is open while the instance has no accounts", async () => {
    expect(await needsSetup()).toBe(true);
  });

  it("creates an administrator without anybody being signed in", async () => {
    await createFirstAdmin({
      name: "First Admin",
      email: "First.Admin@vara5.com",
      password: "a-sufficiently-long-password",
    });

    const [row] = await sql.unsafe(
      "select email, role from app_user limit 1",
    );
    expect(row.role).toBe("admin");
    // Stored lower-case, so sign-in is not case-sensitive.
    expect(row.email).toBe("first.admin@vara5.com");
  });

  it("gives that administrator a working credential", async () => {
    await createFirstAdmin({
      name: "First Admin",
      email: "first.admin@vara5.com",
      password: "a-sufficiently-long-password",
    });

    const rows = await sql.unsafe(
      "select password from app_account where provider_id = 'credential'",
    );
    expect(rows).toHaveLength(1);
    // Better Auth's own hash, not something a hand-written INSERT could make.
    expect(String(rows[0].password).length).toBeGreaterThan(20);
  });

  it("closes permanently once any account exists", async () => {
    await createFirstAdmin({
      name: "First Admin",
      email: "first.admin@vara5.com",
      password: "a-sufficiently-long-password",
    });

    expect(await needsSetup()).toBe(false);
    await expect(
      createFirstAdmin({
        name: "Second Admin",
        email: "second@vara5.com",
        password: "a-sufficiently-long-password",
      }),
    ).rejects.toThrow(DomainError);
  });

  it("rejects a short password", async () => {
    await expect(
      createFirstAdmin({
        name: "First Admin",
        email: "first.admin@vara5.com",
        password: "short",
      }),
    ).rejects.toThrow();
    expect(await needsSetup()).toBe(true);
  });

  it("rejects an invalid email", async () => {
    await expect(
      createFirstAdmin({
        name: "First Admin",
        email: "not-an-email",
        password: "a-sufficiently-long-password",
      }),
    ).rejects.toThrow();
    expect(await needsSetup()).toBe(true);
  });

  it("does not grant access to anything else", async () => {
    await createFirstAdmin({
      name: "First Admin",
      email: "first.admin@vara5.com",
      password: "a-sufficiently-long-password",
    });

    // Creating the account signs nobody in.
    await expect(searchClients({})).rejects.toThrow(UnauthenticatedError);
  });
});
