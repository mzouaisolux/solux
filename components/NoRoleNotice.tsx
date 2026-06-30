import { logout } from "@/app/login/actions";

/**
 * Shown by the (app) layout when a user is authenticated but has NO role
 * (no `user_roles` row). Previously such accounts silently fell through to a
 * degraded default shell — every page empty or denied, with no explanation
 * (audit F2/S1.5). This makes the misconfiguration explicit and actionable.
 */
export default function NoRoleNotice({ email }: { email: string | null }) {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-neutral-50">
      <div className="w-full max-w-md rounded-xl border border-amber-300 bg-amber-50 p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Account not configured
        </div>
        <h1 className="mt-2 text-lg font-semibold text-amber-900">
          Your account has no role yet
        </h1>
        <p className="mt-3 text-sm text-amber-900 leading-relaxed">
          {email ? (
            <>
              <b>{email}</b> is signed in
            </>
          ) : (
            "You're signed in"
          )}{" "}
          but no role has been assigned, so there&apos;s nothing to access yet.
          Ask an administrator to assign your role in <b>/admin/users</b>, then
          reload this page.
        </p>
        <form action={logout} className="mt-5">
          <button className="rounded-md bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
