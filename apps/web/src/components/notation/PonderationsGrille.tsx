import type { GrilleNotationDonnees } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { libelleFamille } from "../../lib/notation";
import {
  editionDepuisContenu,
  messageSomme,
  messageSousTotal,
  totauxEdition,
} from "../../lib/notation-grilles";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

export interface PonderationsGrilleProps {
  contenu: GrilleNotationDonnees;
}

type Dimension = GrilleNotationDonnees["dimensions"][number];

/**
 * Pondérations d'une version de grille, en lecture seule : poids par défaut de chaque dimension
 * (avec sa famille) et poids de chaque secteur (« par défaut » quand le secteur ne le remplace
 * pas), puis les sommes saisies.
 */
export function PonderationsGrille({ contenu }: PonderationsGrilleProps) {
  const secteurs = contenu.secteurs ?? [];
  const colonnes: ColonneTableau<Dimension>[] = [
    { cle: "libelle", entete: "Dimension" },
    { cle: "famille", entete: "Famille", rendu: (d) => libelleFamille(d.famille) },
    {
      cle: "poids",
      entete: "Par défaut",
      alignement: "droite",
      rendu: (d) => formaterNombre(d.poids, 2),
    },
    ...secteurs.map((s): ColonneTableau<Dimension> => ({
      cle: `secteur-${s.secteur}`,
      entete: s.libelle ?? s.secteur,
      alignement: "droite",
      rendu: (d) => {
        const p = s.poids.find((x) => x.dimension === d.id);
        return p ? formaterNombre(p.poids, 2) : <span className="mp-texte-doux">par défaut</span>;
      },
    })),
  ];
  const totaux = totauxEdition(contenu.dimensions, editionDepuisContenu(contenu));
  return (
    <div className="mp-notation__section">
      <Tableau
        legende={`Pondérations de « ${contenu.titre} »`}
        colonnes={colonnes}
        lignes={contenu.dimensions}
        cleLigne={(d) => d.id}
      />
      <ul className="mp-liste-simple mp-texte-petit">
        {totaux.familles.map((f) => (
          <li key={f.famille}>{messageSousTotal(f.total, f.libelle)}</li>
        ))}
        <li>{messageSomme(totaux.total, "Total des dimensions")}</li>
        {totaux.secteurs.map((s, i) => (
          <li key={s.secteur}>
            {messageSomme(s.total, `Secteur « ${secteurs[i]?.libelle ?? s.secteur} »`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
