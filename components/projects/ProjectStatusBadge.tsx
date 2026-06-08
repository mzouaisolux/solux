import {
  PROJECT_REQUEST_STATUS_LABEL,
  type ProjectRequestStatus,
} from "@/lib/types";
import { projectStatusColors } from "@/lib/project-status-colors";

/**
 * Colored status pill for a Project Request. Pure presentation — pass the
 * status (and optionally archived) and it renders the semantic pill.
 */
export function ProjectStatusBadge({
  status,
  archived,
  className = "",
}: {
  status: ProjectRequestStatus;
  archived?: boolean | null;
  className?: string;
}) {
  const c = projectStatusColors(status, archived);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${c.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {PROJECT_REQUEST_STATUS_LABEL[status] ?? status}
    </span>
  );
}
