import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionsAtelier } from "../../../../../../../../components/plan-ateliers/ActionsAtelier";
import { ContributionAtelier } from "../../../../../../../../components/plan-ateliers/ContributionAtelier";
import { FormulaireAtelier } from "../../../../../../../../components/plan-ateliers/FormulaireAtelier";
import { InvitationAtelier } from "../../../../../../../../components/plan-ateliers/InvitationAtelier";
import "../../../../../../../../components/plan-ateliers/plan-ateliers.css";
import { ResultatsAtelier } from "../../../../../../../../components/plan-ateliers/ResultatsAtelier";
import { SyntheseAtelier } from "../../../../../../../../components/plan-ateliers/SyntheseAtelier";
import { Alerte } from "../../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../../../../lib/format";
import type { GenerationIa } from "../../../../../../../../lib/ia-contenu";
import { chargerMission } from "../../../../../../../../lib/missions-serveur";
import {
  cheminAtelier,
  cheminContributions,
  cheminSynthese,
  droitsAtelier,
  hrefAtelier,
  hrefAteliers,
  libelleMethode,
  libelleStatutAtelier,
  peutContribuerCabinet,
  phraseMasque,
  phraseParticipation,
  raisonOuvertureImpossible,
  TONALITE_STATUT_ATELIER,
  type AtelierDetail,
  type MesContributions,
} from "../../../../../../../../lib/plan-ateliers";
import { chargerPlan } from "../../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../../lib/session";
import { obtenirLangue, obtenirT } from "../../../../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Atelier", "Workshop") };
}

/**
 * Un atelier stratégique (PLA-15) : énoncé et options, participants, SA contribution tant que
 * l'atelier est ouvert, puis résultats figés du moteur et synthèse IA (brouillon à valider) une fois
 * clos. Pendant l'atelier, seul le taux de participation est visible ; aucune contribution
 * individuelle n'est jamais affichée (anonymat du vote).
 */
export default async function PageAtelier({
  params,
}: {
  params: Promise<{ id: string; planId: string; atelierId: string }>;
}) {
  const { id, planId, atelierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, plan] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  if (!mission.ok || !plan.ok || plan.donnees.mission_id !== mission.donnees.id) return null;
  const ctx: ContextePlan = {
    roles: utilisateur.roles,
    utilisateurId: utilisateur.id,
    mission: mission.donnees,
  };
  const dPlan = droitsPlan(ctx);
  const droits = droitsAtelier(utilisateur.roles, dPlan);

  const r = await chargerServeur<AtelierDetail>(cheminAtelier(planId, atelierId));
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t("L'atelier n'a pas pu être chargé.", "The workshop could not be loaded.")}
        message={r.message}
        hrefReessayer={hrefAtelier(id, planId, atelierId)}
      />
    );
  }
  const a = r.donnees;
  const contribue = peutContribuerCabinet(a, utilisateur.id);
  const [mes, synthese] = await Promise.all([
    contribue
      ? chargerServeur<{ contributions: MesContributions }>(cheminContributions(planId, atelierId))
      : null,
    a.statut === "clos"
      ? chargerServeur<{ synthese: GenerationIa | null }>(cheminSynthese(planId, atelierId))
      : null,
  ]);
  const raisonOuverture = raisonOuvertureImpossible(a, langue);

  return (
    <>
      <Link href={hrefAteliers(id, planId)} className="mp-lien-retour">
        {t("Tous les ateliers", "All workshops")}
      </Link>
      {dPlan.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte
        titre={a.titre}
        niveauTitre={2}
        actions={
          <BadgeStatut tonalite={TONALITE_STATUT_ATELIER[a.statut]}>
            {libelleStatutAtelier(a.statut, langue)}
          </BadgeStatut>
        }
      >
        <div className="mp-pile">
          {a.consigne ? <p className="mp-coupure">{a.consigne}</p> : null}
          <p className="mp-texte-doux">
            {`${t("Méthodes", "Methods")} : ${a.methodes.map((m) => libelleMethode(m, langue)).join(", ")}.${
              a.methodes.includes("vote")
                ? t(
                    ` Vote : ${a.budget_points} points par personne${a.plafond_par_option === null ? "" : `, ${a.plafond_par_option} au plus par option`}.`,
                    ` Voting: ${a.budget_points} points per person${a.plafond_par_option === null ? "" : `, ${a.plafond_par_option} at most per option`}.`,
                  )
                : ""
            }`}
          </p>
          <p className="mp-texte-doux mp-texte-petit">
            {[
              a.ouvert_le
                ? `${t("Ouvert le", "Opened on")} ${formaterDateHeure(a.ouvert_le, undefined, langue)}`
                : null,
              a.clos_le
                ? `${t("Clos le", "Closed on")} ${formaterDateHeure(a.clos_le, undefined, langue)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {droits.ecrire ? (
            <ActionsAtelier
              planId={planId}
              atelierId={a.id}
              statut={a.statut}
              raisonOuverture={raisonOuverture}
            />
          ) : null}
        </div>
      </Carte>

      <Carte titre={t("Options", "Options")} niveauTitre={3}>
        <ol
          className="mp-atelier__liste"
          aria-label={t("Options de l'atelier", "Workshop options")}
        >
          {a.options.map((o) => (
            <li key={o.id} className="mp-atelier__ligne">
              <span className="mp-atelier__rang" aria-hidden="true">{`${o.rang}.`}</span>
              <div className="mp-atelier__texte">
                <strong className="mp-coupure">{o.libelle}</strong>
                {o.description ? (
                  <span className="mp-texte-doux mp-texte-petit mp-coupure">{o.description}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Carte>

      {a.statut === "brouillon" && droits.ecrire ? (
        <Carte titre={t("Modifier le brouillon", "Edit the draft")} niveauTitre={3}>
          <FormulaireAtelier missionId={id} planId={planId} atelier={a} />
        </Carte>
      ) : null}

      <Carte titre={t("Participants", "Participants")} niveauTitre={3}>
        <div className="mp-pile">
          <p className="mp-texte-doux">{phraseParticipation(a.participation, langue)}</p>
          {a.participants.length === 0 ? (
            <p>{t("Aucun participant invité.", "No participant invited.")}</p>
          ) : (
            <ul
              className="mp-liste-lignes"
              aria-label={t("Participants invités", "Invited participants")}
            >
              {a.participants.map((p) => (
                <li key={p.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <strong className="mp-coupure">{p.nom}</strong>
                    <span className="mp-texte-doux mp-texte-petit">
                      {p.partie === "client"
                        ? t("Dirigeant du client", "Client executive")
                        : t("Membre du cabinet", "Firm member")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {droits.ecrire && a.statut !== "clos" ? (
            <InvitationAtelier
              planId={planId}
              atelierId={a.id}
              peutInviterClient={droits.inviterClient}
            />
          ) : null}
        </div>
      </Carte>

      {contribue ? (
        <Carte titre={t("Ma contribution", "My contribution")} niveauTitre={3}>
          {mes && !mes.ok ? (
            <Alerte
              tonalite="attention"
              titre={t("Contribution indisponible", "Contribution unavailable")}
              annonce="aucune"
            >
              <p>{mes.message}</p>
            </Alerte>
          ) : (
            <ContributionAtelier
              methodes={a.methodes}
              options={a.options}
              budgetPoints={a.budget_points}
              plafondParOption={a.plafond_par_option}
              axes={a.axes}
              initiale={mes?.ok ? mes.donnees.contributions : {}}
              cheminBase={cheminContributions(planId, atelierId)}
            />
          )}
        </Carte>
      ) : null}

      {a.statut === "ouvert" ? (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={t("Résultats après la clôture", "Results after closing")}
        >
          <p>
            {t(
              "Pour préserver l'indépendance des avis, les résultats ne sont calculés et affichés qu'à la clôture de l'atelier. Seul le taux de participation est visible d'ici là.",
              "To preserve the independence of opinions, results are only computed and shown when the workshop is closed. Until then, only the participation rate is visible.",
            )}
          </p>
        </Alerte>
      ) : null}

      {a.statut === "clos" && a.masque_seuil ? (
        <Alerte tonalite="info" annonce="aucune" titre={t("Agrégats masqués", "Aggregates hidden")}>
          <p>
            {phraseMasque(a.seuil_participants, langue)}{" "}
            {t(
              "Pour préserver l'anonymat, aucun résultat n'est affiché sous ce seuil.",
              "To preserve anonymity, no result is shown below this threshold.",
            )}
          </p>
        </Alerte>
      ) : null}

      {a.statut === "clos" && a.resultats ? (
        <>
          <ResultatsAtelier resultats={a.resultats} options={a.options} />
          <Carte titre={t("Synthèse", "Summary")} niveauTitre={3}>
            {synthese && !synthese.ok ? (
              <Alerte
                tonalite="attention"
                titre={t("Synthèse indisponible", "Summary unavailable")}
                annonce="aucune"
              >
                <p>{synthese.message}</p>
              </Alerte>
            ) : (
              <SyntheseAtelier
                planId={planId}
                atelierId={a.id}
                initiale={synthese?.ok ? synthese.donnees.synthese : null}
                peutGenerer={droits.synthese}
                utilisateur={{ id: utilisateur.id, roles: utilisateur.roles }}
              />
            )}
          </Carte>
        </>
      ) : null}
    </>
  );
}
