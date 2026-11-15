import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireAtelier } from "../../../../../../../components/plan-ateliers/FormulaireAtelier";
import "../../../../../../../components/plan-ateliers/plan-ateliers.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminListeAteliers,
  hrefAtelier,
  hrefAteliers,
  libelleMethode,
  libelleStatutAtelier,
  TONALITE_STATUT_ATELIER,
  type PageAteliers,
} from "../../../../../../../lib/plan-ateliers";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Ateliers du plan", "Plan workshops") };
}

/**
 * Ateliers stratégiques en ligne (PLA-15) : liste des ateliers du plan et création d'un brouillon.
 * Vote par points, priorisation par classement et matrice impact/effort ; les agrégats sortent du
 * moteur et ne se voient qu'après la clôture de l'atelier.
 */
export default async function PageAteliersPlan({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, plan] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !plan.ok || plan.donnees.mission_id !== mission.donnees.id) return null;
  const ctx: ContextePlan = {
    roles: utilisateur.roles,
    utilisateurId: utilisateur.id,
    mission: mission.donnees,
  };
  const droits = droitsPlan(ctx);
  const r = await chargerServeur<PageAteliers>(cheminListeAteliers(planId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t("Les ateliers n'ont pas pu être chargés.", "Workshops could not be loaded.")}
        message={r.message}
        hrefReessayer={hrefAteliers(id, planId)}
      />
    );
  }
  const { elements, curseur_suivant } = r.donnees;

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte titre={t("Ateliers", "Workshops")} niveauTitre={3}>
        {elements.length === 0 ? (
          <EtatVide
            titre={t("Aucun atelier pour ce plan.", "No workshop for this plan.")}
            icone="personnes"
          >
            <p>
              {t(
                "Un atelier réunit les membres du cabinet et les dirigeants du client pour voter, classer ou placer des options dans une matrice.",
                "A workshop brings together firm members and client executives to vote, rank or place options in a matrix.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes" aria-label={t("Ateliers du plan", "Plan workshops")}>
            {elements.map((a) => (
              <li key={a.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefAtelier(id, planId, a.id)} className="mp-coupure">
                    {a.titre}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {[
                      a.methodes.map((m) => libelleMethode(m, langue)).join(", "),
                      `${a.nombre_options} options`,
                      t(
                        `${a.nombre_participants} invité${a.nombre_participants > 1 ? "s" : ""}`,
                        `${a.nombre_participants} invited`,
                      ),
                      a.clos_le
                        ? `${t("clos le", "closed on")} ${formaterDate(a.clos_le, "UTC", langue)}`
                        : a.ouvert_le
                          ? `${t("ouvert le", "opened on")} ${formaterDate(a.ouvert_le, "UTC", langue)}`
                          : `${t("créé le", "created on")} ${formaterDate(a.cree_le, "UTC", langue)}`,
                    ].join(" · ")}
                  </span>
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite={TONALITE_STATUT_ATELIER[a.statut]}>
                    {libelleStatutAtelier(a.statut, langue)}
                  </BadgeStatut>
                </div>
              </li>
            ))}
          </ul>
        )}
        {curseur_suivant ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Seuls les 30 ateliers les plus récents sont affichés.",
              "Only the 30 most recent workshops are shown.",
            )}
          </p>
        ) : null}
      </Carte>
      {droits.rediger ? (
        <Carte titre={t("Nouvel atelier", "New workshop")} niveauTitre={3}>
          <FormulaireAtelier missionId={id} planId={planId} />
        </Carte>
      ) : null}
    </>
  );
}
