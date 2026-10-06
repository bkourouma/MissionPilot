import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Onglets } from "../../../../components/ui/Onglets";
import { MODE_LIBELLES } from "../../../../lib/catalogue";
import { estIdentifiant } from "../../../../lib/identifiant";
import { STATUT_MISSION } from "../../../../lib/missions";
import { chargerMission } from "../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../lib/session";

/**
 * En-tête commun d'une mission et onglets Fiche / Découpage / Planning / Affectations / Suivi /
 * Budget / Débours / Facturation (selon les droits).
 */
export default async function LayoutMission({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Mission" retour={{ href: "/missions", libelle: "Missions" }} />
        <EtatErreur
          titre="La mission n'a pas pu être chargée."
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
    { id: "fiche", libelle: "Fiche", href: base },
    { id: "decoupage", libelle: "Découpage", href: `${base}/decoupage` },
    { id: "planning", libelle: "Planning", href: `${base}/planning` },
    { id: "affectations", libelle: "Affectations", href: `${base}/affectations` },
    ...(aPermission(utilisateur.roles, "budget.lire_jours")
      ? [
          { id: "suivi", libelle: "Suivi", href: `${base}/suivi` },
          { id: "budget", libelle: "Budget", href: `${base}/budget` },
        ]
      : []),
    ...(aPermission(utilisateur.roles, "debours.saisir")
      ? [{ id: "debours", libelle: "Débours", href: `${base}/debours` }]
      : []),
    ...(aPermission(utilisateur.roles, "facture.lire")
      ? [{ id: "facturation", libelle: "Facturation", href: `${base}/facturation` }]
      : []),
  ];
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={m.intitule}
        retour={{ href: "/missions", libelle: "Missions" }}
        soustitre={`${m.client_raison_sociale} · ${MODE_LIBELLES[m.mode_facturation]} · ${m.devise}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />
      <Onglets libelle="Sections de la mission" pages={pages} />
      {children}
    </div>
  );
}
