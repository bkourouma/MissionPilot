import Link from "next/link";
import { RED_FAMILLES_LEVIER, type RedDefinitionLevierVue } from "@missionpilot/shared";
import { classesBouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { hrefPlanAvecLevier, libelleFamilleLevier, libellePoste } from "../../lib/redressement";

/**
 * Bibliothèque des six leviers du catalogue du moteur, par famille : libellé, description et
 * hypothèses. Le lien « Créer une action avec ce levier » ouvre le formulaire du plan.
 */
export async function BibliothequeLeviers({
  missionId,
  leviers,
  peutCreer,
}: {
  missionId: string;
  leviers: RedDefinitionLevierVue[];
  peutCreer: boolean;
}) {
  const langue = await obtenirLangue();
  const t = await obtenirT();
  return (
    <div className="mp-red-section">
      {RED_FAMILLES_LEVIER.map((famille) => {
        const liste = leviers.filter((l) => l.famille === famille);
        if (liste.length === 0) return null;
        return (
          <section key={famille} className="mp-red-section" aria-labelledby={`famille-${famille}`}>
            <h3 id={`famille-${famille}`} className="mp-red-section__titre">
              {libelleFamilleLevier(famille, langue)}
            </h3>
            <div className="mp-red-cartes">
              {liste.map((l) => (
                <Carte key={l.code} titre={l.libelle} niveauTitre={4}>
                  <div className="mp-red-carte-corps">
                    <p>{l.description}</p>
                    <p className="mp-texte-doux mp-texte-petit">
                      {t("Postes de la base :", "Base items:")}{" "}
                      {l.postes_base.map((p) => libellePoste(p, langue)).join(", ")}.
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
                        {t("Créer une action avec ce levier", "Create an action with this lever")}
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
