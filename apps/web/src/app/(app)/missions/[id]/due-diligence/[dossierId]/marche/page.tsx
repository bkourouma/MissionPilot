import type { Metadata } from "next";
import { METHODES_DIMENSIONNEMENT } from "@missionpilot/shared";
import { FormulaireParametres } from "../../../../../../../components/due-diligence/FormulaireParametres";
import {
  RecoupementMarche,
  ResultatMarche,
} from "../../../../../../../components/due-diligence/ResultatMarche";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminDimensionnements,
  droitsDd,
  hrefEcranDossier,
  METHODE_DIMENSIONNEMENT_LIBELLES,
  type ReponseDimensionnements,
} from "../../../../../../../lib/due-diligence";
import {
  chargerDossier,
  chargerPreuvesMission,
} from "../../../../../../../lib/due-diligence-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Marché" };

/**
 * Dimensionnement de marché (DD-12), descendant et ascendant : fourchette (basse, centrale, haute),
 * sensibilité, couverture des sources, ajustements d'expert et recoupement des deux méthodes. Tous
 * les montants sortent du moteur de l'API, dans la devise du dossier.
 */
export default async function PageMarcheDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const { utilisateur } = await exigerPermission("dd.lire");
  const [mission, dossier] = await Promise.all([chargerMission(id), chargerDossier(dossierId)]);
  if (!mission.ok || !dossier.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const devise = dossier.donnees.devise;
  const [r, preuves] = await Promise.all([
    chargerServeur<ReponseDimensionnements>(cheminDimensionnements(dossierId)),
    droits.ecrire ? chargerPreuvesMission(id) : Promise.resolve(null),
  ]);
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Le dimensionnement n'a pas pu être chargé."
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "marche")}
      />
    );
  }
  const listePreuves = preuves && preuves.ok ? preuves.donnees : [];
  const erreurPreuves = preuves && !preuves.ok ? preuves.message : null;

  return (
    <>
      <p className="mp-texte-doux">
        {`Les montants sont exprimés en ${devise}. Chaque paramètre cite une preuve de la mission ou un avis d'expert motivé ; le moteur calcule la fourchette, la sensibilité et la couverture des sources.`}
      </p>
      {r.donnees.recoupement ? (
        <Carte titre="Recoupement des deux méthodes" niveauTitre={3}>
          <RecoupementMarche recoupement={r.donnees.recoupement} />
        </Carte>
      ) : null}
      <div className="mp-dd-grille">
        {METHODES_DIMENSIONNEMENT.map((methode) => {
          const existants = r.donnees.elements.filter((d) => d.methode === methode);
          return (
            <Carte key={methode} titre={METHODE_DIMENSIONNEMENT_LIBELLES[methode]} niveauTitre={3}>
              <div className="mp-dd-pile">
                {existants.length === 0 ? (
                  <p className="mp-texte-doux">Aucun dimensionnement par cette méthode.</p>
                ) : (
                  existants.map((d) => (
                    <section key={d.id} className="mp-dd-pile" aria-label={d.libelle}>
                      <p className="mp-dd-element__titre">{`${d.libelle} (version ${d.version})`}</p>
                      <ResultatMarche resultat={d.resultat} devise={devise} />
                      {droits.ecrire ? (
                        <details className="mp-dd-details">
                          <summary>Nouvelle version de ce dimensionnement</summary>
                          <div className="mp-dd-details__corps">
                            <FormulaireParametres
                              dossierId={dossierId}
                              methode={methode}
                              devise={devise}
                              preuves={listePreuves}
                              erreurPreuves={erreurPreuves}
                              dimensionnement={d}
                            />
                          </div>
                        </details>
                      ) : null}
                    </section>
                  ))
                )}
                {droits.ecrire ? (
                  <details className="mp-dd-details" open={existants.length === 0}>
                    <summary>Nouveau dimensionnement</summary>
                    <div className="mp-dd-details__corps">
                      <FormulaireParametres
                        dossierId={dossierId}
                        methode={methode}
                        devise={devise}
                        preuves={listePreuves}
                        erreurPreuves={erreurPreuves}
                      />
                    </div>
                  </details>
                ) : null}
              </div>
            </Carte>
          );
        })}
      </div>
    </>
  );
}
