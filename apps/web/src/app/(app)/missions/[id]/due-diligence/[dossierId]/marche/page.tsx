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
  libellesDd,
  type ReponseDimensionnements,
} from "../../../../../../../lib/due-diligence";
import {
  chargerDossier,
  chargerPreuvesMission,
} from "../../../../../../../lib/due-diligence-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { libelleDevise } from "../../../../../../../lib/format";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Marché", "Market") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
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
        titre={t("Le dimensionnement n'a pas pu être chargé.", "The sizing could not be loaded.")}
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
        {t(
          `Les montants sont exprimés en ${libelleDevise(devise)}. Chaque paramètre cite une preuve de la mission ou un avis d'expert motivé ; le moteur calcule la fourchette, la sensibilité et la couverture des sources.`,
          `Amounts are expressed in ${libelleDevise(devise)}. Each parameter cites evidence from the engagement or a reasoned expert opinion; the engine computes the range, the sensitivity and the source coverage.`,
        )}
      </p>
      {r.donnees.recoupement ? (
        <Carte
          titre={t("Recoupement des deux méthodes", "Cross-check of the two methods")}
          niveauTitre={3}
        >
          <RecoupementMarche recoupement={r.donnees.recoupement} />
        </Carte>
      ) : null}
      <div className="mp-dd-grille">
        {METHODES_DIMENSIONNEMENT.map((methode) => {
          const existants = r.donnees.elements.filter((d) => d.methode === methode);
          return (
            <Carte key={methode} titre={L.METHODE[methode]} niveauTitre={3}>
              <div className="mp-dd-pile">
                {existants.length === 0 ? (
                  <p className="mp-texte-doux">
                    {t("Aucun dimensionnement par cette méthode.", "No sizing by this method.")}
                  </p>
                ) : (
                  existants.map((d) => (
                    <section key={d.id} className="mp-dd-pile" aria-label={d.libelle}>
                      <p className="mp-dd-element__titre">
                        {t(
                          `${d.libelle} (version ${d.version})`,
                          `${d.libelle} (version ${d.version})`,
                        )}
                      </p>
                      <ResultatMarche resultat={d.resultat} devise={devise} />
                      {droits.ecrire ? (
                        <details className="mp-dd-details">
                          <summary>
                            {t(
                              "Nouvelle version de ce dimensionnement",
                              "New version of this sizing",
                            )}
                          </summary>
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
                    <summary>{t("Nouveau dimensionnement", "New sizing")}</summary>
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
