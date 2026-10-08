import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { FormulaireKpiObjectif } from "../../../../../../../components/plan/FormulaireKpiObjectif";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { FREQUENCE_LIBELLES } from "../../../../../../../lib/kpi";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../../lib/periode";
import {
  cheminKpiPlan,
  decompteObjectifsKpi,
  hrefDetailKpi,
  hrefKpiPlan,
  peutCreerKpiPlan,
  type KpiPlan,
  type ObjectifAvecKpi,
} from "../../../../../../../lib/plan-kpi";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  libellePerspective as perspectivePlan,
  libelleStatutContenu,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "KPI du plan" };

function Objectif({
  o,
  missionId,
  planId,
  creer,
  jour,
}: {
  o: ObjectifAvecKpi;
  missionId: string;
  planId: string;
  creer: boolean;
  jour: string;
}) {
  const idTitre = `objectif-kpi-${o.id}`;
  return (
    <article className="mp-plan-kpi" aria-labelledby={idTitre}>
      <h4 id={idTitre} className="mp-plan__intertitre">
        {o.titre}
      </h4>
      <p className="mp-texte-doux mp-texte-petit">
        {[
          perspectivePlan(o.perspective),
          o.indicateur ? `Indicateur : ${o.indicateur}` : null,
          o.cible ? `Cible : ${o.cible}` : null,
          libelleStatutContenu(o.statut_contenu),
          o.retire ? "Objectif retiré du plan" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {o.kpis.length ? (
        <ul className="mp-plan-kpi__liste" aria-label={`KPI issus de l'objectif ${o.titre}`}>
          {o.kpis.map((k) => (
            <li key={k.id}>
              <Link href={hrefDetailKpi(missionId, k.id)}>{k.libelle}</Link>{" "}
              <span className="mp-texte-doux mp-texte-petit">
                {`(${k.unite} · ${FREQUENCE_LIBELLES[k.frequence as keyof typeof FREQUENCE_LIBELLES] ?? k.frequence} · ${perspectivePlan(k.perspective)})`}
              </span>{" "}
              {k.actif ? null : <BadgeStatut tonalite="neutre">Désactivé</BadgeStatut>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mp-texte-doux">Aucun KPI pour cet objectif.</p>
      )}
      {creer && !o.retire ? (
        <FormulaireKpiObjectif planId={planId} objectif={o} aujourdhui={jour} />
      ) : null}
    </article>
  );
}

/**
 * KPI issus des objectifs du plan (PLA-10) : pour chaque objectif, les KPI déjà créés dans le
 * module de pilotage (#4) et la création d'un nouveau KPI prérempli depuis l'objectif. Le suivi
 * (mesures, cibles, alertes, tableau de bord) se fait ensuite dans l'onglet KPI de la mission.
 */
export default async function PageKpiPlan({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const m = mission.donnees;
  const plan = r.donnees;
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  if (!aPermission(utilisateur.roles, "kpi.lire")) {
    return (
      <Alerte tonalite="info" annonce="aucune">
        <p>Votre rôle ne permet pas de consulter les KPI.</p>
      </Alerte>
    );
  }
  const k = await chargerServeur<KpiPlan>(cheminKpiPlan(plan.id));
  const creer = peutCreerKpiPlan(utilisateur.roles, droits.cloturee) && droits.responsable;
  const jour = aujourdhui();

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="KPI issus des objectifs" niveauTitre={3}>
        <div className="mp-plan__section">
          {!k.ok ? (
            <EtatErreur
              titre="Les KPI du plan n'ont pas pu être chargés."
              message={k.message}
              hrefReessayer={hrefKpiPlan(id, plan.id)}
            />
          ) : k.donnees.objectifs.length === 0 ? (
            <EtatVide titre="Aucun objectif dans ce plan." icone="barres">
              <p>
                Ajoutez des objectifs (onglet « Contenus ») : chacun pourra porter un ou plusieurs
                KPI suivis dans le module de pilotage.
              </p>
            </EtatVide>
          ) : (
            <>
              <p>{decompteObjectifsKpi(k.donnees)}</p>
              <p className="mp-texte-doux mp-texte-petit">
                Chaque KPI est créé dans le module de pilotage de la mission, où se suivent ses
                mesures, ses cibles et ses alertes. Les statuts et taux d&apos;atteinte sont
                calculés par le moteur KPI.
                {creer
                  ? ""
                  : " Créer un KPI est réservé aux responsables de la mission qui gèrent les KPI."}
              </p>
              {k.donnees.objectifs.map((o) => (
                <Objectif
                  key={o.id}
                  o={o}
                  missionId={id}
                  planId={plan.id}
                  creer={creer}
                  jour={jour}
                />
              ))}
            </>
          )}
        </div>
      </Carte>
    </>
  );
}
