import Link from "next/link";
import type { RedClotureResume } from "@missionpilot/shared";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { hrefRedressement } from "../../lib/redressement";
import { libelleStatutCloture, tonaliteStatutCloture } from "../../lib/redressement-cloture";
import { BadgeStatut } from "../ui/BadgeStatut";

/** Versions du bilan (la plus récente d'abord) : un lien par version, la version affichée est marquée. */
export async function ClotureVersions({
  missionId,
  versions,
  courante,
}: {
  missionId: string;
  versions: readonly RedClotureResume[];
  courante: number;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <nav aria-label={t("Versions du bilan de clôture", "Close-out review versions")}>
      <ul className="mp-clo-versions">
        {versions.map((v) => (
          <li key={v.id}>
            <Link
              href={`${hrefRedressement(missionId, "cloture")}?version=${v.version}`}
              aria-current={v.version === courante ? "page" : undefined}
            >
              <span>{`${t("Version", "Version")} ${v.version}`}</span>
              <BadgeStatut tonalite={tonaliteStatutCloture(v.statut)} sansIcone>
                {libelleStatutCloture(v.statut, langue)}
              </BadgeStatut>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
