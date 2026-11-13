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
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
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
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Portefeuille d'initiatives", "Initiative portfolio") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t(
          "Le portefeuille d'initiatives n'a pas pu être chargé.",
          "The initiative portfolio could not be loaded.",
        )}
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
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte titre={t("Initiatives à évaluer", "Initiatives to assess")} niveauTitre={3}>
        {d.initiatives.length === 0 ? (
          <EtatVide
            titre={t("Aucune initiative candidate.", "No candidate initiatives.")}
            icone="barres"
          >
            <p>
              {t(
                "Rédigez des initiatives dans l'onglet « Contenus » (ou ajoutez-en depuis la bibliothèque) : seules les initiatives actives, ni terminées ni abandonnées, se priorisent.",
                "Write initiatives in the \u201cContent\u201d tab (or add some from the library): only active initiatives, neither completed nor abandoned, can be prioritized.",
              )}
            </p>
          </EtatVide>
        ) : (
          <div className="mp-plan__section">
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                `${evaluees} initiative${evaluees > 1 ? "s" : ""} évaluée${evaluees > 1 ? "s" : ""} sur ${d.initiatives.length}. Une initiative non évaluée reste hors proposition.`,
                `${evaluees} of ${d.initiatives.length} initiative${d.initiatives.length > 1 ? "s" : ""} assessed. An unassessed initiative stays out of the proposal.`,
              )}
            </p>
            <ul
              className="mp-liste-lignes"
              aria-label={t("Initiatives du portefeuille", "Portfolio initiatives")}
            >
              {d.initiatives.map((i) => (
                <li key={i.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong className="mp-coupure">{i.titre}</strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {[
                        i.budget === null
                          ? null
                          : `Budget ${formaterMontantMineur(i.budget, d.devise, langue)}`,
                        i.evaluation
                          ? t(
                              `Valeur ${i.evaluation.valeur} · effort ${i.evaluation.effort} · risque ${i.evaluation.risque} · charge ${i.evaluation.charge_jours} j-h · score ${i.evaluation.score}`,
                              `Value ${i.evaluation.valeur} · effort ${i.evaluation.effort} · risk ${i.evaluation.risque} · workload ${i.evaluation.charge_jours} person-days · score ${i.evaluation.score}`,
                            )
                          : t("Non évaluée", "Not assessed"),
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
                      {i.evaluation
                        ? `Version ${i.evaluation.version}`
                        : t("À évaluer", "To assess")}
                    </BadgeStatut>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Carte>
      <Carte titre={t("Proposition et arbitrage", "Proposal and prioritization")} niveauTitre={3}>
        <PrioritisationPortefeuille
          planId={planId}
          devise={d.devise}
          poidsDefaut={d.poids_defaut}
          initiatives={d.initiatives}
          arbitrer={droits.valider}
        />
      </Carte>
      <Carte titre={t("Arbitrages enregistrés", "Saved prioritizations")} niveauTitre={3}>
        {!historique.ok ? (
          <Alerte
            tonalite="attention"
            titre={t("Historique indisponible", "History unavailable")}
            annonce="aucune"
          >
            <p>{historique.message}</p>
          </Alerte>
        ) : historique.donnees.elements.length === 0 ? (
          <p>
            {t(
              "Aucun arbitrage enregistré pour ce plan.",
              "No prioritization saved for this plan.",
            )}
          </p>
        ) : (
          <ul
            className="mp-liste-lignes"
            aria-label={t("Arbitrages du portefeuille", "Portfolio prioritizations")}
          >
            {historique.donnees.elements.map((a) => (
              <li key={a.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>{`${formaterDateHeure(a.decide_le, undefined, langue)} · ${a.decideur_nom}`}</strong>
                  <span className="mp-texte-petit">
                    {t(
                      `Retenues : ${a.retenues.map((x) => titres.get(x) ?? "initiative retirée").join(", ") || "aucune"}`,
                      `Selected: ${a.retenues.map((x) => titres.get(x) ?? "removed initiative").join(", ") || "none"}`,
                    )}
                  </span>
                  {a.motifs.length ? (
                    <ul
                      className="mp-liste-simple"
                      aria-label={t(
                        "Écarts à la proposition du moteur",
                        "Deviations from the engine proposal",
                      )}
                    >
                      {a.motifs.map((m) => (
                        <li key={m.initiative_id}>
                          {`${titres.get(m.initiative_id) ?? t("Initiative retirée", "Removed initiative")}${langue === "en" ? ":" : " :"} ${m.motif}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="mp-texte-doux mp-texte-petit">
                      {t(
                        "Conforme à la proposition du moteur.",
                        "In line with the engine proposal.",
                      )}
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
            {t(
              "Seuls les 10 arbitrages les plus récents sont affichés.",
              "Only the 10 most recent prioritizations are shown.",
            )}
          </p>
        ) : null}
      </Carte>
    </>
  );
}
