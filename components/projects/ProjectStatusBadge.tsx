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
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap ${c.pill} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {PROJECT_REQUEST_STATUS_LABEL[status] ?? status}
    </span>
  );
}
