import Link from "next/link";
import type { RedClotureResume } from "@missionpilot/shared";
import { hrefRedressement } from "../../lib/redressement";
import { libelleStatutCloture, tonaliteStatutCloture } from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";

/** Versions du bilan (la plus récente d'abord) : un lien par version, la version affichée est marquée. */
export function ClotureVersions({
  missionId,
  versions,
  courante,
}: {
  missionId: string;
  versions: readonly RedClotureResume[];
  courante: number;
}) {
  return (
    <nav aria-label="Versions du bilan de clôture">
      <ul className="mp-clo-versions">
        {versions.map((v) => (
          <li key={v.id}>
            <Link
              href={`${hrefRedressement(missionId, "cloture")}?version=${v.version}`}
              aria-current={v.version === courante ? "page" : undefined}
            >
              <span>{`Version ${v.version}`}</span>
              <BadgeStatut tonalite={tonaliteStatutCloture(v.statut)} sansIcone>
                {libelleStatutCloture(v.statut)}
              </BadgeStatut>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
