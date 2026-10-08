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
import { CarteGrade, CreationGrade } from "./Grades";

export const metadata: Metadata = { title: "Grades" };

export default async function PageGrades() {
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
        titre="Grades"
        soustitre="Niveaux de séniorité utilisés pour les équipes types, les jours par grade et les taux de vente."
      />

      {taux && !taux.ok ? (
        <EtatErreur
          titre="Les taux de vente n'ont pas pu être chargés."
          message={taux.message}
          hrefReessayer="/catalogue/grades"
        />
      ) : null}

      {!grades.ok ? (
        <EtatErreur
          titre="La liste des grades n'a pas pu être chargée."
          message={grades.message}
          hrefReessayer="/catalogue/grades"
        />
      ) : grades.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun grade défini." icone="personnes">
          <p>
            {droits.gererGrades
              ? "Créez vos grades ci-dessous, ou installez le catalogue de conseil depuis l'onglet Types de mission."
              : "Un associé doit d'abord définir les grades du cabinet."}
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
        <Carte titre="Nouveau grade">
          <CreationGrade />
        </Carte>
      ) : null}
    </div>
  );
}
