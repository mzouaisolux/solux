import { savePreventiveDays } from "./settings-actions";
import { PREVENTIVE_DAYS_DEFAULT } from "@/lib/app-settings";

/**
 * Product settings (m120) — the locked dashboard spec makes the
 * PREVENTIVE window an admin setting ("seuil configurable, défaut 7
 * jours, jamais hardcodé"). One number, one save button. The dashboard
 * preventive blocks (ETA close, prod deadline close, quotes without
 * reply, parked affairs) all read this value.
 */
export function SettingsSection({
  preventiveDays,
  available,
}: {
  preventiveDays: number;
  available: boolean;
}) {
  return (
    <div className="ad-block" style={{ marginTop: 28 }}>
      <h3 className="ad-block-title">Product settings</h3>
      {!available ? (
        <p className="ad-lead" style={{ marginTop: 8 }}>
          <code>app_settings</code> table missing — apply migration{" "}
          <code>120_app_settings.sql</code> in Supabase to tune the dashboard
          preventive window (using the default of {PREVENTIVE_DAYS_DEFAULT}{" "}
          days until then).
        </p>
      ) : (
        <form
          action={savePreventiveDays}
          style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}
        >
          <label htmlFor="preventive-days" style={{ fontSize: 13 }}>
            Dashboard preventive window (days) — feeds “ETA close”, “prod
            deadline close”, “quote without reply”, “parked affairs”:
          </label>
          <input
            id="preventive-days"
            name="days"
            type="number"
            min={1}
            max={60}
            defaultValue={preventiveDays}
            className="sx-input"
            style={{ width: 90 }}
          />
          <button type="submit" className="sx-btn sx-btn-sm">
            Save
          </button>
          <span className="ad-lead" style={{ fontSize: 12 }}>
            Default {PREVENTIVE_DAYS_DEFAULT} days.
          </span>
        </form>
      )}
    </div>
  );
}
