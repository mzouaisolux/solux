// The experimental affairs prototype was promoted to the real /affairs
// workspace (P2b-1). Keep this route as a redirect so old links still work.
import { redirect } from "next/navigation";

export default function AffairsExperimentalRedirect() {
  redirect("/affairs");
}
