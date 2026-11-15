import type { Metadata } from "next";
import { CarteChaine } from "../../../../../../../components/due-diligence/CarteChaine";
import { FormulaireEtape } from "../../../../../../../components/due-diligence/FormulaireEtape";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminChaine,
  droitsDd,
  etapesPourCarte,
  hrefEcranDossier,
  messageCoherenceChaine,
  type ReponseChaine,
} from "../../../../../../../lib/due-diligence";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Chaîne de valeur", "Value chain") };
}

/**
 * Chaîne de valeur (DD-04) : étapes ordonnées, acteurs, parts de coût et de marge, contraintes. La
 * carte est interactive : une étape sélectionnée affiche ses risques. Rangs, parts affichées et
 * cohérence viennent du moteur de l'API.
 */
export default async function PageChaineDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseChaine>(cheminChaine(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "La chaîne de valeur n'a pas pu être chargée.",
          "The value chain could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "chaine")}
      />
    );
  }
  const etapes = etapesPourCarte(r.donnees);
  const message = messageCoherenceChaine(r.donnees.synthese, langue);
  const triees = [...r.donnees.etapes].sort((a, b) => a.ordre - b.ordre);

  return (
    <>
      {etapes.length === 0 ? (
        <EtatVide
          titre={t("Aucune étape de chaîne de valeur.", "No value chain step.")}
          icone="barres"
        >
          <p>
            {droits.ecrire
              ? t(
                  "Décrivez les étapes de la chaîne, de l'approvisionnement au client final, avec leurs acteurs et leurs parts de coût et de marge.",
                  "Describe the steps of the chain, from supply to the end client, with their actors and their cost and margin shares.",
                )
              : t(
                  "Les étapes apparaîtront ici dès qu'un consultant les aura saisies.",
                  "Steps will appear here as soon as a consultant has entered them.",
                )}
          </p>
        </EtatVide>
      ) : (
        <>
          {message ? (
            <Alerte
              tonalite="attention"
              titre={t("Parts à vérifier", "Shares to check")}
              annonce="aucune"
            >
              <p>{message}</p>
            </Alerte>
          ) : null}
          <CarteChaine missionId={id} dossierId={dossierId} etapes={etapes} />
        </>
      )}

      {droits.ecrire ? (
        <Carte titre={t("Étapes de la chaîne", "Chain steps")} niveauTitre={3}>
          <div className="mp-dd-pile">
            {triees.map((e) => (
              <details key={e.id} className="mp-dd-details">
                <summary>
                  {t(
                    `Corriger l'étape ${e.ordre} : ${e.libelle}`,
                    `Edit step ${e.ordre}: ${e.libelle}`,
                  )}
                </summary>
                <div className="mp-dd-details__corps">
                  <FormulaireEtape dossierId={dossierId} etape={e} />
                </div>
              </details>
            ))}
            <details className="mp-dd-details" open={triees.length === 0}>
              <summary>{t("Ajouter une étape", "Add a step")}</summary>
              <div className="mp-dd-details__corps">
                <FormulaireEtape
                  dossierId={dossierId}
                  ordreSuivant={triees.length > 0 ? triees[triees.length - 1]!.ordre + 1 : 1}
                />
              </div>
            </details>
          </div>
        </Carte>
      ) : null}
    </>
  );
}
