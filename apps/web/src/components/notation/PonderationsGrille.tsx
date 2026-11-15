import { creerTraduire, type GrilleNotationDonnees } from "@missionpilot/shared";
import { formaterNombre } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
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
export async function PonderationsGrille({ contenu }: PonderationsGrilleProps) {
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const secteurs = contenu.secteurs ?? [];
  const colonnes: ColonneTableau<Dimension>[] = [
    { cle: "libelle", entete: t("Dimension", "Dimension") },
    {
      cle: "famille",
      entete: t("Famille", "Family"),
      rendu: (d) => libelleFamille(d.famille, langue),
    },
    {
      cle: "poids",
      entete: t("Par défaut", "Default"),
      alignement: "droite",
      rendu: (d) => formaterNombre(d.poids, 2, langue),
    },
    ...secteurs.map((s): ColonneTableau<Dimension> => ({
      cle: `secteur-${s.secteur}`,
      entete: s.libelle ?? s.secteur,
      alignement: "droite",
      rendu: (d) => {
        const p = s.poids.find((x) => x.dimension === d.id);
        return p ? (
          formaterNombre(p.poids, 2, langue)
        ) : (
          <span className="mp-texte-doux">{t("par défaut", "default")}</span>
        );
      },
    })),
  ];
  const totaux = totauxEdition(contenu.dimensions, editionDepuisContenu(contenu), langue);
  return (
    <div className="mp-notation__section">
      <Tableau
        legende={t(`Pondérations de « ${contenu.titre} »`, `Weightings of "${contenu.titre}"`)}
        colonnes={colonnes}
        lignes={contenu.dimensions}
        cleLigne={(d) => d.id}
      />
      <ul className="mp-liste-simple mp-texte-petit">
        {totaux.familles.map((f) => (
          <li key={f.famille}>{messageSousTotal(f.total, f.libelle, langue)}</li>
        ))}
        <li>
          {messageSomme(totaux.total, t("Total des dimensions", "Total of dimensions"), langue)}
        </li>
        {totaux.secteurs.map((s, i) => (
          <li key={s.secteur}>
            {messageSomme(
              s.total,
              t(
                `Secteur « ${secteurs[i]?.libelle ?? s.secteur} »`,
                `Sector "${secteurs[i]?.libelle ?? s.secteur}"`,
              ),
              langue,
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
