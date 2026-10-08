import Link from "next/link";
import { formaterDateHeure } from "../../lib/format";
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
export function VersionsModele({
  missionId,
  planId,
  versions,
  courante,
  curseur,
  curseurSuivant,
}: VersionsModeleProps) {
  return (
    <>
      <Tableau
        legende="Versions du modèle financier"
        lignes={versions}
        cleLigne={(v) => v.id}
        messageVide="Aucune version enregistrée."
        colonnes={[
          {
            cle: "version",
            entete: "Version",
            rendu: (v) =>
              v.version === courante ? (
                <strong>{`Version ${v.version} (affichée)`}</strong>
              ) : (
                <Link
                  href={hrefModele(missionId, planId, {
                    version: v.version,
                    curseur,
                  })}
                >
                  {`Afficher la version ${v.version}`}
                </Link>
              ),
          },
          {
            cle: "calcule_le",
            entete: "Calculée le",
            rendu: (v) => formaterDateHeure(v.calcule_le),
          },
          { cle: "auteur_nom", entete: "Par", rendu: (v) => v.auteur_nom },
          {
            cle: "validation",
            entete: "Validation",
            rendu: (v) => (
              <BadgeStatut tonalite={v.validation ? "succes" : "attention"}>
                {libelleValidationModele(v)}
              </BadgeStatut>
            ),
          },
          {
            cle: "alertes",
            entete: "Alertes (base)",
            rendu: (v) =>
              v.alertes.length === 0 ? (
                "Aucune"
              ) : (
                <BadgeStatut
                  tonalite={
                    v.alertes.some((a) => a.gravite === "critique") ? "danger" : "attention"
                  }
                >
                  {`${v.alertes.length} alerte${v.alertes.length > 1 ? "s" : ""}`}
                </BadgeStatut>
              ),
          },
          { cle: "commentaire", entete: "Commentaire", rendu: (v) => v.commentaire ?? "—" },
        ]}
      />
      <PaginationCurseur
        libelle="Pages des versions"
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
