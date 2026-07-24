import { redirect } from "next/navigation";

// /permissions lands on the Action-permissions matrix by default. The
// distinct sub-paths (/actions, /teams) keep the tab highlight unambiguous.
export default function PermissionsIndex() {
  redirect("/permissions/actions");
}
