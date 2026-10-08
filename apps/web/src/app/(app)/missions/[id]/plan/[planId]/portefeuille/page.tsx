import type { Metadata } from "next";
import { EvaluationInitiative } from "../../../../../../../components/plan/EvaluationInitiative";
import { PrioritisationPortefeuille } from "../../../../../../../components/plan/PrioritisationPortefeuille";
import "../../../../../../../components/plan/plan-augmente.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDateHeure, formaterMontantMineur } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminArbitrages,
  cheminPortefeuille,
  hrefPortefeuille,
  type Arbitrage,
  type Portefeuille,
} from "../../../../../../../lib/plan-portefeuille";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Portefeuille d'initiatives" };

/**
 * Priorisation du portefeuille d'initiatives (PLA-14) : évaluation de chaque initiative (valeur,
 * effort, risque, charge), proposition du moteur sous contraintes de budget et de capacité, puis
 * arbitrage humain tracé (chaque écart à la proposition exige un motif). Scores et sélection
 * sortent du moteur côté API ; l'arbitrage est réservé aux responsables qui valident le plan.
 */
export default async function PagePortefeuillePlan({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const ctx: ContextePlan = {
    roles: utilisateur.roles,
    utilisateurId: utilisateur.id,
    mission: mission.donnees,
  };
  const droits = droitsPlan(ctx);
  const [p, historique] = await Promise.all([
    chargerServeur<Portefeuille>(cheminPortefeuille(planId)),
    chargerServeur<{ elements: Arbitrage[]; curseur_suivant: string | null }>(
      cheminArbitrages(planId),
    ),
  ]);
  if (!p.ok) {
    return (
      <EtatErreur
        titre="Le portefeuille d'initiatives n'a pas pu être chargé."
        message={p.message}
        hrefReessayer={hrefPortefeuille(id, planId)}
      />
    );
  }
  const d = p.donnees;
  const titres = new Map(d.initiatives.map((i) => [i.id, i.titre]));
  const evaluees = d.initiatives.filter((i) => i.evaluation).length;

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="Initiatives à évaluer" niveauTitre={3}>
        {d.initiatives.length === 0 ? (
          <EtatVide titre="Aucune initiative candidate." icone="barres">
            <p>
              Rédigez des initiatives dans l&apos;onglet « Contenus » (ou ajoutez-en depuis la
              bibliothèque) : seules les initiatives actives, ni terminées ni abandonnées, se
              priorisent.
            </p>
          </EtatVide>
        ) : (
          <div className="mp-plan__section">
            <p className="mp-texte-doux mp-texte-petit">
              {`${evaluees} initiative${evaluees > 1 ? "s" : ""} évaluée${evaluees > 1 ? "s" : ""} sur ${d.initiatives.length}. Une initiative non évaluée reste hors proposition.`}
            </p>
            <ul className="mp-liste-lignes" aria-label="Initiatives du portefeuille">
              {d.initiatives.map((i) => (
                <li key={i.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong className="mp-coupure">{i.titre}</strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {[
                        i.budget === null
                          ? null
                          : `Budget ${formaterMontantMineur(i.budget, d.devise)}`,
                        i.evaluation
                          ? `Valeur ${i.evaluation.valeur} · effort ${i.evaluation.effort} · risque ${i.evaluation.risque} · charge ${i.evaluation.charge_jours} j-h · score ${i.evaluation.score}`
                          : "Non évaluée",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {droits.rediger ? (
                      <EvaluationInitiative
                        planId={planId}
                        initiativeId={i.id}
                        titre={i.titre}
                        evaluation={i.evaluation}
                      />
                    ) : null}
                  </div>
                  <div className="mp-badges">
                    <BadgeStatut tonalite={i.evaluation ? "succes" : "attention"}>
                      {i.evaluation ? `Version ${i.evaluation.version}` : "À évaluer"}
                    </BadgeStatut>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Carte>
      <Carte titre="Proposition et arbitrage" niveauTitre={3}>
        <PrioritisationPortefeuille
          planId={planId}
          devise={d.devise}
          poidsDefaut={d.poids_defaut}
          initiatives={d.initiatives}
          arbitrer={droits.valider}
        />
      </Carte>
      <Carte titre="Arbitrages enregistrés" niveauTitre={3}>
        {!historique.ok ? (
          <Alerte tonalite="attention" titre="Historique indisponible" annonce="aucune">
            <p>{historique.message}</p>
          </Alerte>
        ) : historique.donnees.elements.length === 0 ? (
          <p>Aucun arbitrage enregistré pour ce plan.</p>
        ) : (
          <ul className="mp-liste-lignes" aria-label="Arbitrages du portefeuille">
            {historique.donnees.elements.map((a) => (
              <li key={a.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>{`${formaterDateHeure(a.decide_le)} · ${a.decideur_nom}`}</strong>
                  <span className="mp-texte-petit">
                    {`Retenues : ${a.retenues.map((x) => titres.get(x) ?? "initiative retirée").join(", ") || "aucune"}`}
                  </span>
                  {a.motifs.length ? (
                    <ul className="mp-liste-simple" aria-label="Écarts à la proposition du moteur">
                      {a.motifs.map((m) => (
                        <li key={m.initiative_id}>
                          {`${titres.get(m.initiative_id) ?? "Initiative retirée"} : ${m.motif}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="mp-texte-doux mp-texte-petit">
                      Conforme à la proposition du moteur.
                    </span>
                  )}
                  {a.commentaire ? <p className="mp-coupure">{a.commentaire}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {historique.ok && historique.donnees.curseur_suivant ? (
          <p className="mp-texte-doux mp-texte-petit">
            Seuls les 10 arbitrages les plus récents sont affichés.
          </p>
        ) : null}
      </Carte>
    </>
  );
}
