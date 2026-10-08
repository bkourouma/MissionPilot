import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { formaterNombre } from "../../lib/format";
import { CLASSE_FIABILITE, COMPOSANTES_FIABILITE, type Fiabilite } from "../../lib/dossier";

/**
 * Indice de fiabilité des données du client (DOS-04), calculé par le moteur de l'API :
 * classe, composantes en points, recommandations de prudence.
 */
export function CarteFiabilite({ fiabilite }: { fiabilite: Fiabilite }) {
  const classe = CLASSE_FIABILITE[fiabilite.classe];
  return (
    <Carte
      titre="Fiabilité des données"
      actions={<BadgeStatut tonalite={classe.tonalite}>{classe.libelle}</BadgeStatut>}
    >
      <p>
        <strong>{formaterNombre(fiabilite.points, 0)} points sur 100.</strong>{" "}
        {fiabilite.analyses_indicatives
          ? "Toute analyse financière de ce client est à présenter comme indicative."
          : "Les analyses peuvent s'appuyer sur ces données sans réserve particulière."}
      </p>
      <dl className="mp-liste-def mp-liste-def--compacte">
        {COMPOSANTES_FIABILITE.map((c) => (
          <div key={c.cle}>
            <dt>{c.libelle}</dt>
            <dd>
              {formaterNombre(fiabilite.detail[c.cle], 0)} / {c.max}
            </dd>
          </div>
        ))}
      </dl>
      {fiabilite.recommandations.length > 0 ? (
        <>
          <h3 className="mp-section__titre">Recommandations de prudence</h3>
          <ul>
            {fiabilite.recommandations.map((r) => (
              <li key={r.code}>{r.message}</li>
            ))}
          </ul>
        </>
      ) : null}
    </Carte>
  );
}
