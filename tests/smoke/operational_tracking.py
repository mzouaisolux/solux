"""
Operational tracking smoke test.

Verifies that the new /operations and /order-follow-up surfaces — plus the
existing /dashboard, /production/orders, and /task-lists — at minimum:

  1. Compile and serve without 500-class errors.
  2. Render their auth gate (redirect to /login) when no session cookie
     is present. The app is auth-walled so without test credentials this
     is the strongest invariant we can assert end-to-end.
  3. Return the expected login page markup on the redirect.

What this catches:
  - Missing route files / build-time crashes in new pages.
  - Broken imports of new helpers (lib/working-days, lib/operations-alerts).
  - TypeScript drift that would crash a route at request time.
  - Regression in the auth gate (a route accidentally rendering without
    a session — which would expose internal data).

What this does NOT cover (intentionally — deeper E2E needs test creds):
  - Real signed-in flows (login → validate task list → see production order).
  - Form submissions on the production order detail page.
  - Data correctness across pages.

Run via the webapp-testing skill's helper:
    python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \
        --server "npm run dev" --port 3000 \
        --timeout 90 \
        -- python3 tests/smoke/operational_tracking.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, Response


BASE_URL = "http://localhost:3000"

# Pages we expect to land on /login when accessed without a session.
AUTH_GATED_PAGES = [
    "/dashboard",
    "/operations",
    "/order-follow-up",
    "/production/orders",
    "/task-lists",
    "/clients",
]

# Pages that should render without a session (the login page itself).
PUBLIC_PAGES = ["/login"]

SCREENSHOT_DIR = Path("/tmp/solux-smoke")


def main() -> int:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Capture any console errors so we surface them in the report.
        console_errors: list[str] = []
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )

        # ----- 1. Public page (login) -----
        for path in PUBLIC_PAGES:
            url = BASE_URL + path
            print(f"→ checking public route {path}")
            response = page.goto(url, wait_until="networkidle", timeout=30_000)
            ok, msg = _check_response(response, expect_status=(200,))
            if not ok:
                failures.append(f"{path}: {msg}")
                continue
            # Should *not* redirect away.
            if not page.url.endswith(path):
                failures.append(
                    f"{path}: unexpected redirect to {page.url}"
                )
                continue
            page.screenshot(
                path=str(SCREENSHOT_DIR / f"login{path.replace('/', '_')}.png"),
                full_page=True,
            )

        # ----- 2. Auth-gated pages -----
        # Next.js dev mode lazy-compiles routes on first hit. The first
        # request to a never-compiled route can return 404 while the
        # compiler warms up. We retry once on 404 to absorb that race —
        # any 404 that persists across two requests is a real failure.
        for path in AUTH_GATED_PAGES:
            url = BASE_URL + path
            print(f"→ checking auth-gated route {path}")
            response = None
            final_status = None
            final_url_value = None
            for attempt in range(2):
                try:
                    response = page.goto(
                        url, wait_until="domcontentloaded", timeout=30_000
                    )
                except Exception as e:  # noqa: BLE001
                    if attempt == 1:
                        failures.append(f"{path}: navigation failed — {e}")
                    continue
                if response is None:
                    continue
                final_status = response.status
                final_url_value = page.url
                # Retry once if we saw a 404 — likely lazy-compile race.
                if final_status == 404 and attempt == 0:
                    print(f"   retrying {path} after transient 404…")
                    continue
                break

            if response is None or final_status is None:
                failures.append(f"{path}: no response received")
                continue

            print(f"   status={final_status} final_url={final_url_value}")
            if final_status >= 500:
                failures.append(
                    f"{path}: server error (HTTP {final_status})"
                )
                continue
            if final_status == 404:
                failures.append(
                    f"{path}: route not found (HTTP 404) after retry"
                )
                continue

            # Expected behavior: middleware/page redirects unauthenticated
            # users to /login. Either the final URL is /login or the page
            # contains the login form.
            html = page.content()
            redirected_to_login = "/login" in (final_url_value or "")
            login_form_present = (
                "Sign in" in html
                or "Log in" in html
                or 'name="password"' in html
            )
            if not (redirected_to_login or login_form_present):
                failures.append(
                    f"{path}: not redirected to login (final URL: {final_url_value})"
                )
                continue

            page.screenshot(
                path=str(
                    SCREENSHOT_DIR / f"gated{path.replace('/', '_') or '_root'}.png"
                ),
                full_page=False,
            )

        # ----- 3. Surface console errors -----
        if console_errors:
            print("⚠ Console errors observed:")
            for err in console_errors[:20]:
                print(f"   - {err[:200]}")
            # Don't fail on console errors — they're informational. The
            # Supabase client logs warnings in dev mode that aren't real
            # regressions.

        browser.close()

    if failures:
        print()
        print("✗ Smoke test FAILED")
        for f in failures:
            print(f"   - {f}")
        return 1

    print()
    print("✓ Smoke test PASSED")
    print(f"   Screenshots: {SCREENSHOT_DIR}")
    return 0


def _check_response(
    response: Response | None, expect_status: tuple[int, ...]
) -> tuple[bool, str]:
    if response is None:
        return False, "no response captured"
    status = response.status
    if status >= 500:
        return False, f"server error (HTTP {status})"
    if status not in expect_status and status >= 400:
        return False, f"unexpected status HTTP {status}"
    return True, "ok"


if __name__ == "__main__":
    sys.exit(main())
