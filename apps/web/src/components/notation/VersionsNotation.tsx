import Link from "next/link";
import { formaterDate } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
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
export async function VersionsNotation({ missionId, versions, courante }: VersionsNotationProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <nav aria-label={t("Versions de la notation", "Rating versions")}>
      <ul className="mp-notation-versions">
        {versions.map((v) => (
          <li key={v.numero}>
            <Link
              href={hrefNotation(missionId, v.numero)}
              aria-current={v.numero === courante ? "page" : undefined}
              prefetch={false}
            >
              <span className="mp-notation-versions__numero">
                {t("Version", "Version")} {v.numero}
              </span>
              <BadgeStatut tonalite={tonaliteStatutVersion(v.statut)}>
                {libelleStatutVersion(v.statut, langue)}
              </BadgeStatut>
              <span className="mp-notation-chiffre">
                {v.score === null
                  ? t("Score non notable", "Score not rated")
                  : `${formaterScore(v.score, langue)} ${t("sur 100", "out of 100")}`}
              </span>
              {v.score === null ? null : <BadgeClasse classe={v.classe} />}
              <span className="mp-texte-doux mp-texte-petit">
                {t("calculée le", "computed on")} {formaterDate(v.calcule_le, "UTC", langue)}
                {v.publiee_le
                  ? `, ${t("publiée le", "published on")} ${formaterDate(v.publiee_le, "UTC", langue)}`
                  : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
