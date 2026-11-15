import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgePartage } from "../../../../../../components/plan/BadgeStatutPlan";
import "../../../../../../components/plan/plan.css";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { Onglets } from "../../../../../../components/ui/Onglets";
import { libelleDevise } from "../../../../../../lib/format";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { hrefBancabilite } from "../../../../../../lib/plan-bancabilite";
import { hrefBibliothequePlan } from "../../../../../../lib/plan-bibliotheque";
import { hrefCascade } from "../../../../../../lib/plan-cascade";
import { hrefFeuilleDeRoute } from "../../../../../../lib/plan-feuille-de-route";
import { hrefKpiPlan } from "../../../../../../lib/plan-kpi";
import { hrefPortefeuille } from "../../../../../../lib/plan-portefeuille";
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
 * validation) et sous-onglets « Contenus », « Feuille de route », « Cascade » (PLA-12),
 * « Bibliothèque » (PLA-13), « Portefeuille » (PLA-14), « Modèle financier », « Bancabilité »
 * (PLA-17) et « KPI ». Un plan d'une autre
 * mission, d'un autre cabinet ou invisible répond 404 (comme l'API).
 */
export default async function LayoutPlan({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string; planId: string }>;
}) {
  const t = await obtenirT();
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
        titre={t(
          "Le plan stratégique n'a pas pu être chargé.",
          "The strategic plan could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefPlan(id, planId)}
      />
    );
  }
  const plan = r.donnees;
  if (plan.mission_id !== mission.donnees.id) notFound();
  const d = decompteStatuts(plan.elements);
  const pages = [
    { id: "contenus", libelle: t("Contenus", "Content"), href: hrefPlan(id, plan.id) },
    {
      id: "feuille",
      libelle: t("Feuille de route", "Roadmap"),
      href: hrefFeuilleDeRoute(id, plan.id),
    },
    { id: "cascade", libelle: t("Cascade", "Cascade"), href: hrefCascade(id, plan.id) },
    {
      id: "bibliotheque",
      libelle: t("Bibliothèque", "Library"),
      href: hrefBibliothequePlan(id, plan.id),
    },
    {
      id: "portefeuille",
      libelle: t("Portefeuille", "Portfolio"),
      href: hrefPortefeuille(id, plan.id),
    },
    {
      id: "modele",
      libelle: t("Modèle financier", "Financial model"),
      href: hrefModele(id, plan.id),
    },
    {
      id: "bancabilite",
      libelle: t("Bancabilité", "Bankability"),
      href: hrefBancabilite(id, plan.id),
    },
    // Lot 5a : ateliers (PLA-15), simulation de Monte-Carlo (PLA-16), plan vivant (PLA-18).
    {
      id: "ateliers",
      libelle: t("Ateliers", "Workshops"),
      href: `${hrefPlan(id, plan.id)}/ateliers`,
    },
    {
      id: "simulation",
      libelle: t("Simulation", "Simulation"),
      href: `${hrefPlan(id, plan.id)}/simulation`,
    },
    {
      id: "plan-vivant",
      libelle: t("Plan vivant", "Living plan"),
      href: `${hrefPlan(id, plan.id)}/plan-vivant`,
    },
    ...(aPermission(utilisateur.roles, "kpi.lire")
      ? [{ id: "kpi", libelle: "KPI", href: hrefKpiPlan(id, plan.id) }]
      : []),
  ];
  return (
    <div className="mp-plan">
      <section className="mp-plan__section" aria-labelledby="titre-plan">
        <p className="mp-texte-petit">
          <Link href={hrefPlans(id)}>
            {t("Tous les plans de la mission", "All engagement plans")}
          </Link>
        </p>
        <h2 id="titre-plan" className="mp-section__titre">
          {plan.titre}
        </h2>
        <div className="mp-plan__badges">
          <BadgePartage partage={plan.partage_client} />
          <BadgeStatut tonalite={d.total > 0 && d.aValider === 0 ? "succes" : "neutre"}>
            {d.total === 0
              ? t("Aucun contenu", "No content")
              : t(
                  `${d.valides} contenu${d.valides > 1 ? "s" : ""} validé${d.valides > 1 ? "s" : ""} sur ${d.total}`,
                  `${d.valides} of ${d.total} item${d.total > 1 ? "s" : ""} approved`,
                )}
          </BadgeStatut>
          <span className="mp-texte-doux mp-texte-petit">
            {t(
              `Horizon ${plan.horizon} ans · montants en ${libelleDevise(plan.devise)}`,
              `Horizon ${plan.horizon} years · amounts in ${libelleDevise(plan.devise)}`,
            )}
          </span>
        </div>
      </section>
      <Onglets
        libelle={t("Sections du plan stratégique", "Strategic plan sections")}
        pages={pages}
      />
      {children}
    </div>
  );
}
