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
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Chaîne de valeur" };

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
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseChaine>(cheminChaine(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La chaîne de valeur n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "chaine")}
      />
    );
  }
  const etapes = etapesPourCarte(r.donnees);
  const message = messageCoherenceChaine(r.donnees.synthese);
  const triees = [...r.donnees.etapes].sort((a, b) => a.ordre - b.ordre);

  return (
    <>
      {etapes.length === 0 ? (
        <EtatVide titre="Aucune étape de chaîne de valeur." icone="barres">
          <p>
            {droits.ecrire
              ? "Décrivez les étapes de la chaîne, de l'approvisionnement au client final, avec leurs acteurs et leurs parts de coût et de marge."
              : "Les étapes apparaîtront ici dès qu'un consultant les aura saisies."}
          </p>
        </EtatVide>
      ) : (
        <>
          {message ? (
            <Alerte tonalite="attention" titre="Parts à vérifier" annonce="aucune">
              <p>{message}</p>
            </Alerte>
          ) : null}
          <CarteChaine missionId={id} dossierId={dossierId} etapes={etapes} />
        </>
      )}

      {droits.ecrire ? (
        <Carte titre="Étapes de la chaîne" niveauTitre={3}>
          <div className="mp-dd-pile">
            {triees.map((e) => (
              <details key={e.id} className="mp-dd-details">
                <summary>{`Corriger l'étape ${e.ordre} : ${e.libelle}`}</summary>
                <div className="mp-dd-details__corps">
                  <FormulaireEtape dossierId={dossierId} etape={e} />
                </div>
              </details>
            ))}
            <details className="mp-dd-details" open={triees.length === 0}>
              <summary>Ajouter une étape</summary>
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
