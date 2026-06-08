import { redirect } from "next/navigation";

/**
 * The separate "Review queue" page was retired — its job (task lists awaiting
 * the Task List Manager's review) now lives directly inside /task-lists, where
 * awaiting-review items float to the top with a pulsing "Needs review"
 * highlight. This route now just redirects there so old links/bookmarks keep
 * working. (Single operational inbox.)
 */
export default function ProductionQueuePage() {
  redirect("/task-lists");
}
