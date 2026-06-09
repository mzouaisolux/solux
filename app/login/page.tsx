import { login } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <div className="po-premium min-h-screen grid place-items-center p-6">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 bg-white p-6 rounded-lg border shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">SOLUX — Sign in</h1>
          <p className="text-sm text-neutral-500">Quotation tool</p>
        </div>
        <label className="block">
          <span className="text-sm font-medium">Email</span>
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            required
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        {searchParams.error && (
          <p className="text-sm text-red-600">{searchParams.error}</p>
        )}
        <button className="w-full rounded bg-solux px-3 py-2 text-white font-medium hover:bg-solux-dark">
          Sign in
        </button>
      </form>
    </div>
  );
}
