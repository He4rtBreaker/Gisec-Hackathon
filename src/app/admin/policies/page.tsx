import { SIGNAL_CATALOG, listPolicies } from "@/lib/policies";
import PolicyTable from "@/components/admin/PolicyTable";
import PolicySimulator from "@/components/admin/PolicySimulator";

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  const policies = listPolicies();

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
      <header>
        <div className="mz-label">Policies</div>
        <h1 className="mt-1 text-[21px] font-semibold tracking-tight">Routing policy</h1>
        <ul className="mt-2 max-w-[760px] list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink-dim">
          <li>Rules run top to bottom by priority. The first rule that matches decides.</li>
          <li>
            A ROUTE rule whose target cannot take the request (accreditation, capacity, offline, no
            artefact, network boundary) falls through to the next rule.
          </li>
          <li>Anything left unmatched is refused.</li>
          <li>
            Two built-in guards run first and cannot be edited: a pinned target must be accredited
            for the thread&apos;s seal, and the Enclave may only be pinned by Secret-cleared users.
          </li>
        </ul>
      </header>

      <PolicyTable policies={policies} signals={SIGNAL_CATALOG} />
      <PolicySimulator signals={SIGNAL_CATALOG} />
    </div>
  );
}
