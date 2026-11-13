import type { Metadata } from "next";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  droitsReferentiel,
  fusionnerTaux,
  type Grade,
  type TauxGrade,
} from "../../../../lib/collaborateurs";
import { exigerPermission } from "../../../../lib/session";
import { obtenirT } from "../../../../lib/i18n/serveur";
import { CarteGrade, CreationGrade } from "./Grades";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Grades", "Grades") };
}

export default async function PageGrades() {
  const tr = await obtenirT();
  const { utilisateur } = await exigerPermission("catalogue.lire");
  const droits = droitsReferentiel(utilisateur.roles);
  const grades = await chargerServeur<{ elements: Grade[] }>("/api/grades");
  // Taux de vente (FIN-02) : chargés seulement avec finance.lire, jamais envoyés sinon.
  const taux = droits.voirFinances
    ? await chargerServeur<{ elements: TauxGrade[] }>("/api/grades/taux")
    : null;

  const tauxParGrade =
    droits.voirFinances && taux?.ok && grades.ok
      ? new Map(fusionnerTaux(grades.donnees.elements, taux.donnees.elements).map((g) => [g.id, g]))
      : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={tr("Grades", "Grades")}
        soustitre={tr(
          "Niveaux de séniorité utilisés pour les équipes types, les jours par grade et les taux de vente.",
          "Seniority levels used for typical teams, days per grade and selling rates.",
        )}
      />

      {taux && !taux.ok ? (
        <EtatErreur
          titre={tr(
            "Les taux de vente n'ont pas pu être chargés.",
            "The selling rates could not be loaded.",
          )}
          message={taux.message}
          hrefReessayer="/catalogue/grades"
        />
      ) : null}

      {!grades.ok ? (
        <EtatErreur
          titre={tr(
            "La liste des grades n'a pas pu être chargée.",
            "The list of grades could not be loaded.",
          )}
          message={grades.message}
          hrefReessayer="/catalogue/grades"
        />
      ) : grades.donnees.elements.length === 0 ? (
        <EtatVide titre={tr("Aucun grade défini.", "No grade defined.")} icone="personnes">
          <p>
            {droits.gererGrades
              ? tr(
                  "Créez vos grades ci-dessous, ou installez le catalogue de conseil depuis l'onglet Types de mission.",
                  "Create your grades below, or install the consulting catalog from the Engagement types tab.",
                )
              : tr(
                  "Un associé doit d'abord définir les grades du cabinet.",
                  "A partner must first define the firm's grades.",
                )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-cartes">
          {grades.donnees.elements.map((g) => {
            const t = tauxParGrade?.get(g.id);
            return (
              <li key={g.id}>
                <CarteGrade
                  grade={g}
                  taux={
                    t ? { taux_vente_standard: t.taux_vente_standard, devise: t.devise } : undefined
                  }
                  peutGerer={droits.gererGrades}
                  peutGererTaux={droits.gererTaux}
                />
              </li>
            );
          })}
        </ul>
      )}

      {droits.gererGrades ? (
        <Carte titre={tr("Nouveau grade", "New grade")}>
          <CreationGrade />
        </Carte>
      ) : null}
    </div>
  );
}
