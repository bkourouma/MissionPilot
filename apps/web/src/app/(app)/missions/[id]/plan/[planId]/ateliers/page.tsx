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
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Ateliers du plan" };

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
        titre="Les ateliers n'ont pas pu être chargés."
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
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="Ateliers" niveauTitre={3}>
        {elements.length === 0 ? (
          <EtatVide titre="Aucun atelier pour ce plan." icone="personnes">
            <p>
              Un atelier réunit les membres du cabinet et les dirigeants du client pour voter,
              classer ou placer des options dans une matrice.
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes" aria-label="Ateliers du plan">
            {elements.map((a) => (
              <li key={a.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefAtelier(id, planId, a.id)} className="mp-coupure">
                    {a.titre}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {[
                      a.methodes.map(libelleMethode).join(", "),
                      `${a.nombre_options} options`,
                      `${a.nombre_participants} invité${a.nombre_participants > 1 ? "s" : ""}`,
                      a.clos_le
                        ? `clos le ${formaterDate(a.clos_le)}`
                        : a.ouvert_le
                          ? `ouvert le ${formaterDate(a.ouvert_le)}`
                          : `créé le ${formaterDate(a.cree_le)}`,
                    ].join(" · ")}
                  </span>
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite={TONALITE_STATUT_ATELIER[a.statut]}>
                    {libelleStatutAtelier(a.statut)}
                  </BadgeStatut>
                </div>
              </li>
            ))}
          </ul>
        )}
        {curseur_suivant ? (
          <p className="mp-texte-doux mp-texte-petit">
            Seuls les 30 ateliers les plus récents sont affichés.
          </p>
        ) : null}
      </Carte>
      {droits.rediger ? (
        <Carte titre="Nouvel atelier" niveauTitre={3}>
          <FormulaireAtelier missionId={id} planId={planId} />
        </Carte>
      ) : null}
    </>
  );
}
