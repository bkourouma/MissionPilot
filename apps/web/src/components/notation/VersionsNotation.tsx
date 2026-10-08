import Link from "next/link";
import { formaterDate } from "../../lib/format";
import {
  formaterScore,
  hrefNotation,
  libelleStatutVersion,
  tonaliteStatutVersion,
  type VersionResume,
} from "../../lib/notation";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BadgeClasse } from "./BadgeClasse";

export interface VersionsNotationProps {
  missionId: string;
  versions: VersionResume[];
  /** Numéro de la version affichée. */
  courante: number;
}

/**
 * Versions successives de la notation (chaque calcul est figé), de la plus récente à la plus
 * ancienne, avec le score et la classe rendus par l'API. Un lien ouvre chaque version.
 */
export function VersionsNotation({ missionId, versions, courante }: VersionsNotationProps) {
  return (
    <nav aria-label="Versions de la notation">
      <ul className="mp-notation-versions">
        {versions.map((v) => (
          <li key={v.numero}>
            <Link
              href={hrefNotation(missionId, v.numero)}
              aria-current={v.numero === courante ? "page" : undefined}
              prefetch={false}
            >
              <span className="mp-notation-versions__numero">Version {v.numero}</span>
              <BadgeStatut tonalite={tonaliteStatutVersion(v.statut)}>
                {libelleStatutVersion(v.statut)}
              </BadgeStatut>
              <span className="mp-notation-chiffre">
                {v.score === null ? "Score non notable" : `${formaterScore(v.score)} sur 100`}
              </span>
              {v.score === null ? null : <BadgeClasse classe={v.classe} />}
              <span className="mp-texte-doux mp-texte-petit">
                calculée le {formaterDate(v.calcule_le)}
                {v.publiee_le ? `, publiée le ${formaterDate(v.publiee_le)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
