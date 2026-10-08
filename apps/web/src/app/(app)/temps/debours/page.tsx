import type { Metadata } from "next";
import { aPermission, type Role } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import type { MissionDebours } from "../../../../components/facturation/FormulaireDebours";
import { chargerServeur } from "../../../../lib/api-serveur";
import { chargerToutesLesPages } from "../../../../lib/pagination";
import {
  lireStatutDebours,
  OPTIONS_STATUTS_DEBOURS,
  type PageDebours,
} from "../../../../lib/debours";
import type { Mission } from "../../../../lib/missions";
import type { MonPlanning } from "../../../../lib/planification";
import { exigerPermission } from "../../../../lib/session";
import { SegmentsStatut } from "../../../../components/facturation/SegmentsStatut";
import { DeclarationDebours, ListeMesDebours } from "./MesDebours";

export const metadata: Metadata = { title: "Mes débours" };

/**
 * Missions où déclarer un débours : missions visibles non clôturées ; sans « mission.lire »
 * (expert externe), celles de « Mon planning » (devise inconnue, choisie à la saisie).
 */
async function missionsDebours(roles: readonly Role[]): Promise<MissionDebours[]> {
  if (aPermission(roles, "mission.lire")) {
    const r = await chargerToutesLesPages<Mission>(chargerServeur, "/api/missions");
    if (!r.ok) return [];
    return r.donnees.elements
      .filter((m) => m.statut !== "cloturee")
      .map((m) => ({ id: m.id, intitule: m.intitule, devise: m.devise }));
  }
  const r = await chargerServeur<MonPlanning>("/api/mon-planning");
  if (!r.ok) return [];
  const vues = new Map<string, MissionDebours>();
  for (const l of r.donnees.lignes) {
    if (l.mission.accessible && !vues.has(l.mission.id))
      vues.set(l.mission.id, {
        id: l.mission.id,
        intitule: l.mission.intitule ?? "Mission",
        devise: null,
      });
  }
  return [...vues.values()];
}

export default async function PageMesDebours({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("debours.saisir");
  const p = await searchParams;
  const statut = lireStatutDebours(p.statut);
  const c = Array.isArray(p.curseur) ? p.curseur[0] : p.curseur;
  const curseur = c && c.length <= 500 && /^[A-Za-z0-9_-]+$/.test(c) ? c : "";
  const q = new URLSearchParams({ limite: "30" });
  if (statut) q.set("statut", statut);
  if (curseur) q.set("curseur", curseur);
  const [liste, missions] = await Promise.all([
    chargerServeur<PageDebours>(`/api/debours?${q.toString()}`),
    missionsDebours(utilisateur.roles),
  ]);
  const href = (cur?: string | null) => {
    const r = new URLSearchParams();
    if (statut) r.set("statut", statut);
    if (cur) r.set("curseur", cur);
    const s = r.toString();
    return s ? `/temps/debours?${s}` : "/temps/debours";
  };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Mes débours et notes de frais"
        soustitre="Déclarez vos dépenses de mission, puis soumettez-les : le chef ou le directeur de la mission les valide."
      />
      <Carte titre="Déclarer une dépense">
        <DeclarationDebours missions={missions} />
      </Carte>
      <section className="mp-pile" aria-labelledby="titre-mes-debours">
        <div className="mp-entete-section">
          <h2 id="titre-mes-debours" className="mp-section__titre">
            Mes déclarations
          </h2>
          <SegmentsStatut
            statut={statut}
            options={OPTIONS_STATUTS_DEBOURS}
            href={(s) => (s ? `/temps/debours?statut=${s}` : "/temps/debours")}
            libelle="Statut des débours affichés"
          />
        </div>
        {!liste.ok ? (
          <EtatErreur
            titre="Vos débours n'ont pas pu être chargés."
            message={liste.message}
            hrefReessayer={href()}
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={statut ? "Aucun débours avec ce statut." : "Aucun débours déclaré."}
            icone="facture"
          >
            <p>Vos dépenses déclarées apparaîtront ici, avec leur statut de validation.</p>
          </EtatVide>
        ) : (
          <ListeMesDebours
            liste={liste.donnees.elements}
            missions={missions}
            utilisateurId={utilisateur.id}
            roles={utilisateur.roles}
          />
        )}
        {liste.ok ? (
          <PaginationCurseur
            hrefSuivante={
              liste.donnees.curseur_suivant ? href(liste.donnees.curseur_suivant) : null
            }
            hrefDebut={curseur ? href() : null}
            libelle="Pages des débours"
          />
        ) : null}
      </section>
    </div>
  );
}
