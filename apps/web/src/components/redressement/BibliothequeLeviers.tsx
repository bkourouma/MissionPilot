import Link from "next/link";
import { RED_FAMILLES_LEVIER, type RedDefinitionLevierVue } from "@missionpilot/shared";
import { classesBouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { hrefPlanAvecLevier, libelleFamilleLevier, libellePoste } from "../../lib/redressement";

/**
 * Bibliothèque des six leviers du catalogue du moteur, par famille : libellé, description et
 * hypothèses. Le lien « Créer une action avec ce levier » ouvre le formulaire du plan.
 */
export function BibliothequeLeviers({
  missionId,
  leviers,
  peutCreer,
}: {
  missionId: string;
  leviers: RedDefinitionLevierVue[];
  peutCreer: boolean;
}) {
  return (
    <div className="mp-red-section">
      {RED_FAMILLES_LEVIER.map((famille) => {
        const liste = leviers.filter((l) => l.famille === famille);
        if (liste.length === 0) return null;
        return (
          <section key={famille} className="mp-red-section" aria-labelledby={`famille-${famille}`}>
            <h3 id={`famille-${famille}`} className="mp-red-section__titre">
              {libelleFamilleLevier(famille)}
            </h3>
            <div className="mp-red-cartes">
              {liste.map((l) => (
                <Carte key={l.code} titre={l.libelle} niveauTitre={4}>
                  <div className="mp-red-carte-corps">
                    <p>{l.description}</p>
                    <p className="mp-texte-doux mp-texte-petit">
                      Postes de la base : {l.postes_base.map(libellePoste).join(", ")}.
                    </p>
                    {l.hypotheses.length > 0 ? (
                      <ul className="mp-liste-simple mp-texte-petit">
                        {l.hypotheses.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    ) : null}
                    {peutCreer ? (
                      <Link
                        href={hrefPlanAvecLevier(missionId, l.code)}
                        className={classesBouton("secondaire")}
                      >
                        Créer une action avec ce levier
                      </Link>
                    ) : null}
                  </div>
                </Carte>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
