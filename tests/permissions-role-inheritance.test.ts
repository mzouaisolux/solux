/**
 * Locks the ranking policy: super_admin ⊇ admin.
 *
 * rolesForCapabilityLoad(role) returns the roles whose role_permissions grants
 * make up a role's effective set. super_admin outranks admin and must always
 * pull admin's grants too, so a capability seeded only for admin is never
 * invisible to a super-admin. Every other role stands on its own rows.
 *
 * Pure (no DB / server imports) so it runs under the node test runner.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rolesForCapabilityLoad, type Role } from "../lib/types.ts";

test("super_admin has every admin grant (union of both roles)", () => {
  const roles = rolesForCapabilityLoad("super_admin");
  assert.ok(roles.includes("super_admin"), "must include its own grants");
  assert.ok(roles.includes("admin"), "must include every admin grant");
  assert.equal(roles.length, 2, "super_admin loads exactly super_admin + admin");
});

test("every non-super_admin role stands on its own rows", () => {
  const standalone: Role[] = [
    "admin",
    "sales",
    "task_list_manager",
    "operations",
    "finance",
    "sales_director",
  ];
  for (const r of standalone) {
    assert.deepEqual(
      rolesForCapabilityLoad(r),
      [r],
      `${r} must load only its own grants`
    );
  }
});

test("admin does NOT pick up super_admin-only grants (ranking is one-directional)", () => {
  assert.ok(
    !rolesForCapabilityLoad("admin").includes("super_admin"),
    "admin ranks below super_admin and must not gain its exclusive grants"
  );
});
