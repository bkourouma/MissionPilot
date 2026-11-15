import type { Metadata } from "next";
import { aPermission, type Role, type Traduire } from "@missionpilot/shared";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import type { MissionDebours } from "../../../../components/facturation/FormulaireDebours";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../../lib/pagination";
import {
  lireStatutDebours,
  optionsStatutsDebours,
  type PageDebours,
} from "../../../../lib/debours";
import type { Mission } from "../../../../lib/missions";
import type { MonPlanning } from "../../../../lib/planification";
import { exigerPermission } from "../../../../lib/session";
import { SegmentsStatut } from "../../../../components/facturation/SegmentsStatut";
import { DeclarationDebours, ListeMesDebours } from "./MesDebours";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Mes débours", "My expenses") };
}

/**
 * Missions où déclarer un débours : missions visibles non clôturées ; sans « mission.lire »
 * (expert externe), celles de « Mon planning » (devise inconnue, choisie à la saisie).
 */
async function missionsDebours(roles: readonly Role[], t: Traduire): Promise<MissionDebours[]> {
  if (aPermission(roles, "mission.lire")) {
    const r = await chargerToutesLesPages<Mission>(chargerServeur, "/api/missions", {
      limiteMax: LIMITE_PAGE_MAX,
    });
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
        intitule: l.mission.intitule ?? t("Mission", "Engagement"),
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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const p = await searchParams;
  const statut = lireStatutDebours(p.statut);
  const c = Array.isArray(p.curseur) ? p.curseur[0] : p.curseur;
  const curseur = c && c.length <= 500 && /^[A-Za-z0-9_-]+$/.test(c) ? c : "";
  const q = new URLSearchParams({ limite: "30" });
  if (statut) q.set("statut", statut);
  if (curseur) q.set("curseur", curseur);
  const [liste, missions] = await Promise.all([
    chargerServeur<PageDebours>(`/api/debours?${q.toString()}`),
    missionsDebours(utilisateur.roles, t),
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
        titre={t("Mes débours et notes de frais", "My expenses and expense reports")}
        soustitre={t(
          "Déclarez vos dépenses de mission, puis soumettez-les : le chef ou le directeur de la mission les valide.",
          "Declare your engagement expenses, then submit them: the engagement manager or director approves them.",
        )}
      />
      <Carte titre={t("Déclarer une dépense", "Declare an expense")}>
        <DeclarationDebours missions={missions} />
      </Carte>
      <section className="mp-pile" aria-labelledby="titre-mes-debours">
        <div className="mp-entete-section">
          <h2 id="titre-mes-debours" className="mp-section__titre">
            {t("Mes déclarations", "My declarations")}
          </h2>
          <SegmentsStatut
            statut={statut}
            options={optionsStatutsDebours(langue)}
            href={(s) => (s ? `/temps/debours?statut=${s}` : "/temps/debours")}
            libelle={t("Statut des débours affichés", "Status of the expenses shown")}
          />
        </div>
        {!liste.ok ? (
          <EtatErreur
            titre={t(
              "Vos débours n'ont pas pu être chargés.",
              "Your expenses could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer={href()}
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              statut
                ? t("Aucun débours avec ce statut.", "No expenses with this status.")
                : t("Aucun débours déclaré.", "No expenses declared.")
            }
            icone="facture"
          >
            <p>
              {t(
                "Vos dépenses déclarées apparaîtront ici, avec leur statut de validation.",
                "Your declared expenses will appear here, with their approval status.",
              )}
            </p>
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
            libelle={t("Pages des débours", "Expense pages")}
          />
        ) : null}
      </section>
    </div>
  );
}
