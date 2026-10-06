import { libelleJourCourt, libelleJourLong } from "../../lib/semaine";
import { formaterValeur, NOM_UNITE, type LigneFeuille, type UniteSaisie } from "../../lib/temps";

export interface TableauLignesProps {
  legende: string;
  lignes: readonly LigneFeuille[];
  jours: readonly string[];
  unite: UniteSaisie;
}

/** Valeur d'une ligne dans l'unité du cabinet (heures saisies, ou jours). */
const valeur = (l: LigneFeuille, unite: UniteSaisie) =>
  unite === "heure" && l.heures !== null ? l.heures : l.jours;

/**
 * Lignes d'une feuille en lecture seule (validation) : une rangée par tâche ou activité, une
 * colonne par jour. Même mise en forme que la grille de saisie, fiches sur téléphone.
 */
export function TableauLignes({ legende, lignes, jours, unite }: TableauLignesProps) {
  const rangees = [
    ...new Map(
      lignes.map((l) => [
        l.tache_id ?? `a${l.activite_id}`,
        l.tache_libelle ?? l.activite_libelle ?? "Ligne",
      ]),
    ),
  ];
  const cle = (l: LigneFeuille) => l.tache_id ?? `a${l.activite_id}`;
  const somme = (ls: LigneFeuille[]) =>
    Math.round(ls.reduce((t, l) => t + valeur(l, unite) * 100, 0)) / 100;
  if (lignes.length === 0) return <p className="mp-texte-doux">Aucune ligne.</p>;
  return (
    <div className="mp-feuille">
      <table className="mp-feuille__table">
        <caption className="mp-visuellement-cache">{`${legende}, en ${NOM_UNITE[unite]}`}</caption>
        <thead>
          <tr>
            <th scope="col">Tâche ou activité</th>
            {jours.map((d) => (
              <th key={d} scope="col" className="mp-aligne-droite">
                <span aria-hidden="true">{libelleJourCourt(d)}</span>
                <span className="mp-visuellement-cache">{libelleJourLong(d)}</span>
              </th>
            ))}
            <th scope="col" className="mp-aligne-droite">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rangees.map(([id, libelle]) => {
            const siennes = lignes.filter((l) => cle(l) === id);
            return (
              <tr key={id}>
                <th scope="row" className="mp-feuille__libelle">
                  {libelle}
                </th>
                {jours.map((d) => {
                  const duJour = siennes.filter((l) => l.date === d);
                  return (
                    <td key={d} data-jour={libelleJourCourt(d)} className="mp-feuille__case">
                      <span className="mp-feuille__valeur">
                        {duJour.length ? formaterValeur(somme(duJour), unite) : "—"}
                      </span>
                      {duJour
                        .filter((l) => l.commentaire)
                        .map((l) => (
                          <span key={l.id} className="mp-texte-doux mp-texte-petit">
                            {l.commentaire}
                          </span>
                        ))}
                    </td>
                  );
                })}
                <td data-jour="Total" className="mp-feuille__total">
                  {formaterValeur(somme(siennes), unite)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
