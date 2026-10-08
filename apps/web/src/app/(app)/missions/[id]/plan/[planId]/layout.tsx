import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgePartage } from "../../../../../../components/plan/BadgeStatutPlan";
import "../../../../../../components/plan/plan.css";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Onglets } from "../../../../../../components/ui/Onglets";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { hrefFeuilleDeRoute } from "../../../../../../lib/plan-feuille-de-route";
import { hrefKpiPlan } from "../../../../../../lib/plan-kpi";
import { chargerPlan } from "../../../../../../lib/plan-serveur";
import {
  decompteStatuts,
  hrefModele,
  hrefPlan,
  hrefPlans,
} from "../../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../../lib/session";

/**
 * En-tête d'un plan stratégique (titre, horizon, devise, partage, avancement de la
 * validation) et sous-onglets « Contenus », « Feuille de route », « Modèle financier » et
 * « KPI ». Un plan d'une autre
 * mission, d'un autre cabinet ou invisible répond 404 (comme l'API).
 */
export default async function LayoutPlan({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  if (!estIdentifiant(planId)) notFound();
  const { utilisateur } = await exigerPermission("plan.lire");
  const mission = await chargerMission(id);
  // L'en-tête de la mission affiche déjà son erreur de chargement.
  if (!mission.ok) return null;
  const r = await chargerPlan(planId);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Le plan stratégique n'a pas pu être chargé."
        message={r.message}
        hrefReessayer={hrefPlan(id, planId)}
      />
    );
  }
  const plan = r.donnees;
  if (plan.mission_id !== mission.donnees.id) notFound();
  const d = decompteStatuts(plan.elements);
  const pages = [
    { id: "contenus", libelle: "Contenus", href: hrefPlan(id, plan.id) },
    { id: "feuille", libelle: "Feuille de route", href: hrefFeuilleDeRoute(id, plan.id) },
    { id: "modele", libelle: "Modèle financier", href: hrefModele(id, plan.id) },
    ...(aPermission(utilisateur.roles, "kpi.lire")
      ? [{ id: "kpi", libelle: "KPI", href: hrefKpiPlan(id, plan.id) }]
      : []),
  ];
  return (
    <div className="mp-plan">
      <section className="mp-plan__section" aria-labelledby="titre-plan">
        <p className="mp-texte-petit">
          <Link href={hrefPlans(id)}>Tous les plans de la mission</Link>
        </p>
        <h2 id="titre-plan" className="mp-section__titre">
          {plan.titre}
        </h2>
        <div className="mp-plan__badges">
          <BadgePartage partage={plan.partage_client} />
          <BadgeStatut tonalite={d.total > 0 && d.aValider === 0 ? "succes" : "neutre"}>
            {d.total === 0
              ? "Aucun contenu"
              : `${d.valides} contenu${d.valides > 1 ? "s" : ""} validé${d.valides > 1 ? "s" : ""} sur ${d.total}`}
          </BadgeStatut>
          <span className="mp-texte-doux mp-texte-petit">
            {`Horizon ${plan.horizon} ans · montants en ${plan.devise}`}
          </span>
        </div>
      </section>
      <Onglets libelle="Sections du plan stratégique" pages={pages} />
      {children}
    </div>
  );
}
