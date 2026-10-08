import type { Devise } from "../../lib/format";
import {
  formaterValeur,
  grouperLignes,
  type ExercicePlan,
  type LigneEtat,
} from "../../lib/plan-modele";

export interface TableauEtatProps {
  titre: string;
  lignes: readonly LigneEtat[];
  annees: readonly ExercicePlan[];
  devise: Devise;
  /** Préfixe unique des identifiants (plusieurs tableaux par page). */
  idPrefixe: string;
}

/**
 * État financier prévisionnel en tableau accessible : une ligne par poste (en-tête de ligne),
 * une colonne par exercice. Valeurs du moteur, mises en forme dans la devise du plan, jamais
 * recalculées. Le code de poste SYSCOHADA, indicatif, suit le libellé. Défilement horizontal
 * sur téléphone, colonne des postes figée.
 */
export function TableauEtat({ titre, lignes, annees, devise, idPrefixe }: TableauEtatProps) {
  const idTitre = `${idPrefixe}-titre`;
  return (
    <div className="mp-plan-etat" role="region" aria-labelledby={idTitre} tabIndex={0}>
      <table>
        <caption id={idTitre}>{titre}</caption>
        <thead>
          <tr>
            <th scope="col">Poste</th>
            {annees.map((a) => (
              <th key={a.exercice} scope="col">
                {a.exercice}
              </th>
            ))}
          </tr>
        </thead>
        {grouperLignes(lignes).map((g, i) => (
          <tbody key={g.titre ?? `groupe-${i}`}>
            {g.titre ? (
              <tr className="mp-plan-etat__groupe">
                <th scope="rowgroup" colSpan={annees.length + 1}>
                  {g.titre}
                </th>
              </tr>
            ) : null}
            {g.lignes.map((l) => (
              <tr key={l.cle} className={l.total ? "mp-plan-etat__total" : undefined}>
                <th scope="row">
                  {l.libelle}
                  {l.code ? (
                    <>
                      {" "}
                      <span className="mp-plan-etat__code">
                        <span className="mp-visuellement-cache">code SYSCOHADA indicatif </span>(
                        {l.code})
                      </span>
                    </>
                  ) : null}
                </th>
                {annees.map((a) => {
                  const v = l.valeur(a);
                  return (
                    <td
                      key={a.exercice}
                      className={
                        l.format === "montant" && typeof v === "number" && v < 0
                          ? "mp-plan-etat__negatif"
                          : undefined
                      }
                    >
                      {formaterValeur(l.format, v, devise)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
