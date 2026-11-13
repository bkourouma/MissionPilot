import Link from "next/link";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleValidationModele, type ResumeModele } from "../../lib/plan-modele";
import { hrefModele } from "../../lib/plan-strategique";
import { BadgeStatut } from "../ui/BadgeStatut";
import { PaginationCurseur } from "../ui/EtatListe";
import { Tableau } from "../ui/Tableau";

export interface VersionsModeleProps {
  missionId: string;
  planId: string;
  versions: ResumeModele[];
  courante: number | null;
  curseur: string | null;
  curseurSuivant: string | null;
}

/** Versions enregistrées du modèle, de la plus récente à la plus ancienne (pagination par curseur). */
export async function VersionsModele({
  missionId,
  planId,
  versions,
  courante,
  curseur,
  curseurSuivant,
}: VersionsModeleProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <>
      <Tableau
        legende={t("Versions du modèle financier", "Financial model versions")}
        lignes={versions}
        cleLigne={(v) => v.id}
        messageVide={t("Aucune version enregistrée.", "No saved versions.")}
        colonnes={[
          {
            cle: "version",
            entete: t("Version", "Version"),
            rendu: (v) =>
              v.version === courante ? (
                <strong>
                  {t(`Version ${v.version} (affichée)`, `Version ${v.version} (shown)`)}
                </strong>
              ) : (
                <Link
                  href={hrefModele(missionId, planId, {
                    version: v.version,
                    curseur,
                  })}
                >
                  {t(`Afficher la version ${v.version}`, `Show version ${v.version}`)}
                </Link>
              ),
          },
          {
            cle: "calcule_le",
            entete: t("Calculée le", "Computed on"),
            rendu: (v) => formaterDateHeure(v.calcule_le, undefined, langue),
          },
          { cle: "auteur_nom", entete: t("Par", "By"), rendu: (v) => v.auteur_nom },
          {
            cle: "validation",
            entete: t("Validation", "Approval"),
            rendu: (v) => (
              <BadgeStatut tonalite={v.validation ? "succes" : "attention"}>
                {libelleValidationModele(v, langue)}
              </BadgeStatut>
            ),
          },
          {
            cle: "alertes",
            entete: t("Alertes (base)", "Alerts (base)"),
            rendu: (v) =>
              v.alertes.length === 0 ? (
                t("Aucune", "None")
              ) : (
                <BadgeStatut
                  tonalite={
                    v.alertes.some((a) => a.gravite === "critique") ? "danger" : "attention"
                  }
                >
                  {t(
                    `${v.alertes.length} alerte${v.alertes.length > 1 ? "s" : ""}`,
                    `${v.alertes.length} alert${v.alertes.length > 1 ? "s" : ""}`,
                  )}
                </BadgeStatut>
              ),
          },
          {
            cle: "commentaire",
            entete: t("Commentaire", "Comment"),
            rendu: (v) => v.commentaire ?? "—",
          },
        ]}
      />
      <PaginationCurseur
        libelle={t("Pages des versions", "Version pages")}
        hrefSuivante={
          curseurSuivant
            ? hrefModele(missionId, planId, { version: courante, curseur: curseurSuivant })
            : null
        }
        hrefDebut={curseur ? hrefModele(missionId, planId, { version: courante }) : null}
      />
    </>
  );
}
