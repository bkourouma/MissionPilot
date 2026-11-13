import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Onglets } from "../../../../components/ui/Onglets";
import { libelleMode } from "../../../../lib/catalogue";
import { libelleDevise } from "../../../../lib/format";
import { hrefMissionMethode } from "../../../../lib/methodes";
import { hrefQualiteMission } from "../../../../lib/qualite";
import { estIdentifiant } from "../../../../lib/identifiant";
import { obtenirT, obtenirLangue } from "../../../../lib/i18n/serveur";
import { libelleStatutMission, STATUT_MISSION } from "../../../../lib/missions";
import { ongletsMissionCanaux } from "../../../../lib/navigation";
import { chargerMission } from "../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../lib/session";

/**
 * En-tête commun d'une mission et onglets Fiche / Découpage / Planning / Affectations /
 * Documents / Rapports / KPI / Redressement / Due diligence / Avancement (rapport hebdomadaire) / Suivi / Budget / Débours / Facturation
 * (selon les droits), les onglets « Signatures » et « Transcriptions » des canaux simulés
 * (`ongletsMissionCanaux`), plus deux
 * onglets qui mènent hors de la rubrique : « Méthode » (référentiel, `standard.lire`, page
 * `/methodes/missions/[id]`) et « Qualité » (suivi qualité des livrables de la mission, ouvert à
 * toute l'équipe : la consultation n'exige que `mission.lire`, comme l'API).
 */
export default async function LayoutMission({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Mission", "Engagement")}
          retour={{ href: "/missions", libelle: t("Missions", "Engagements") }}
        />
        <EtatErreur
          titre={t("La mission n'a pas pu être chargée.", "The engagement could not be loaded.")}
          message={r.message}
          hrefReessayer={`/missions/${id}`}
        />
      </div>
    );
  }
  const m = r.donnees;
  const statut = STATUT_MISSION[m.statut];
  const base = `/missions/${m.id}`;
  const pages = [
    { id: "fiche", libelle: t("Fiche", "Overview"), href: base },
    { id: "decoupage", libelle: t("Découpage", "Work breakdown"), href: `${base}/decoupage` },
    { id: "planning", libelle: t("Planning", "Schedule"), href: `${base}/planning` },
    { id: "affectations", libelle: t("Affectations", "Assignments"), href: `${base}/affectations` },
    { id: "documents", libelle: "Documents", href: `${base}/documents` },
    { id: "rapports", libelle: t("Rapports", "Reports"), href: `${base}/rapports` },
    ...(aPermission(utilisateur.roles, "salle.lire")
      ? [{ id: "salle", libelle: t("Salle de mission", "Engagement room"), href: `${base}/salle` }]
      : []),
    ...(aPermission(utilisateur.roles, "questionnaire.lire")
      ? [
          {
            id: "questionnaires",
            libelle: t("Questionnaires", "Questionnaires"),
            href: `${base}/questionnaires`,
          },
        ]
      : []),
    ...(aPermission(utilisateur.roles, "notation.gerer") ||
    aPermission(utilisateur.roles, "notation.publier")
      ? [{ id: "notation", libelle: t("Notation", "Rating"), href: `${base}/notation` }]
      : []),
    ...(aPermission(utilisateur.roles, "plan.lire")
      ? [{ id: "plan", libelle: t("Plan stratégique", "Strategic plan"), href: `${base}/plan` }]
      : []),
    ...(aPermission(utilisateur.roles, "dd.lire")
      ? [{ id: "due-diligence", libelle: "Due diligence", href: `${base}/due-diligence` }]
      : []),
    ...(aPermission(utilisateur.roles, "kpi.lire")
      ? [{ id: "kpi", libelle: "KPI", href: `${base}/kpi` }]
      : []),
    ...(aPermission(utilisateur.roles, "avancement.lire")
      ? [{ id: "avancement", libelle: t("Avancement", "Progress"), href: `${base}/avancement` }]
      : []),
    ...(aPermission(utilisateur.roles, "redressement.lire")
      ? [
          {
            id: "redressement",
            libelle: t("Redressement", "Turnaround"),
            href: `${base}/redressement`,
          },
        ]
      : []),
    ...(aPermission(utilisateur.roles, "preuve.lire")
      ? [{ id: "preuves", libelle: t("Preuves", "Evidence"), href: `${base}/preuves` }]
      : []),
    ...ongletsMissionCanaux(utilisateur.roles, base, langue),
    ...(aPermission(utilisateur.roles, "standard.lire")
      ? [{ id: "methode", libelle: t("Méthode", "Method"), href: hrefMissionMethode(m.id) }]
      : []),
    { id: "qualite", libelle: t("Qualité", "Quality"), href: hrefQualiteMission(m.id) },
    ...(aPermission(utilisateur.roles, "budget.lire_jours")
      ? [
          { id: "suivi", libelle: t("Suivi", "Tracking"), href: `${base}/suivi` },
          { id: "budget", libelle: "Budget", href: `${base}/budget` },
        ]
      : []),
    ...(aPermission(utilisateur.roles, "debours.saisir")
      ? [{ id: "debours", libelle: t("Débours", "Expenses"), href: `${base}/debours` }]
      : []),
    ...(aPermission(utilisateur.roles, "facture.lire")
      ? [{ id: "facturation", libelle: t("Facturation", "Billing"), href: `${base}/facturation` }]
      : []),
    ...(["en_cours", "a_cloturer", "cloturee"].includes(m.statut)
      ? [{ id: "cloture", libelle: t("Clôture", "Close-out"), href: `${base}/cloture` }]
      : []),
    ...(m.statut === "cloturee"
      ? [{ id: "bilan", libelle: t("Bilan", "Review"), href: `${base}/bilan` }]
      : []),
  ];
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={m.intitule}
        retour={{ href: "/missions", libelle: t("Missions", "Engagements") }}
        soustitre={`${m.client_raison_sociale} · ${libelleMode(m.mode_facturation, langue)} · ${libelleDevise(m.devise)}`}
        badges={
          <BadgeStatut tonalite={statut.tonalite}>
            {libelleStatutMission(m.statut, langue)}
          </BadgeStatut>
        }
      />
      <Onglets libelle={t("Sections de la mission", "Engagement sections")} pages={pages} />
      {children}
    </div>
  );
}
