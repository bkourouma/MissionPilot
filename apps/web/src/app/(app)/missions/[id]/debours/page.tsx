import type { Metadata } from "next";
import { SegmentsStatut } from "../../../../../components/facturation/SegmentsStatut";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  lireStatutDebours,
  optionsStatutsDebours,
  valideurDeMission,
  type PageDebours,
} from "../../../../../lib/debours";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { DeclarationDeboursMission, ListeDeboursMission } from "./DeboursMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Débours de la mission", "Engagement expenses") };
}

/**
 * Débours de la mission (FIN-05). Le chef, le directeur de la mission et les associés voient
 * et décident de tous les débours ; les autres membres ne voient que les leurs.
 */
export default async function PageDeboursMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("debours.saisir");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const p = await searchParams;
  const statut = lireStatutDebours(p.statut);
  const c = Array.isArray(p.curseur) ? p.curseur[0] : p.curseur;
  const curseur = c && c.length <= 500 && /^[A-Za-z0-9_-]+$/.test(c) ? c : "";
  const q = new URLSearchParams({ limite: "30" });
  if (statut) q.set("statut", statut);
  if (curseur) q.set("curseur", curseur);
  const liste = await chargerServeur<PageDebours>(`/api/missions/${m.id}/debours?${q.toString()}`);
  const base = `/missions/${m.id}/debours`;
  const href = (s: string, cur?: string | null) => {
    const u = new URLSearchParams();
    if (s) u.set("statut", s);
    if (cur) u.set("curseur", cur);
    const qs = u.toString();
    return qs ? `${base}?${qs}` : base;
  };
  const contexte = {
    roles: utilisateur.roles,
    utilisateurId: utilisateur.id,
    chefId: m.chef_id,
    directeurId: m.directeur_id,
    missionCloturee: m.statut === "cloturee",
  };
  const valideur = valideurDeMission(contexte);

  return (
    <div className="mp-pile mp-pile--large">
      <p className="mp-texte-doux">
        {valideur
          ? t(
              "Vous validez les débours de cette mission : ouvrez le justificatif joint avant de valider, ou rejetez avec un motif.",
              "You approve the expenses of this engagement: open the attached receipt before approving, or reject with a reason.",
            )
          : t(
              "Vos débours sur cette mission. Le chef ou le directeur de la mission les valide après soumission.",
              "Your expenses on this engagement. The engagement manager or director approves them after submission.",
            )}
      </p>
      <DeclarationDeboursMission
        mission={{ id: m.id, intitule: m.intitule, devise: m.devise }}
        ouverte={m.statut !== "cloturee"}
      />
      <SegmentsStatut
        statut={statut}
        options={optionsStatutsDebours(langue)}
        href={(s) => href(s)}
        libelle={t("Statut des débours affichés", "Status of the expenses shown")}
      />
      {!liste.ok ? (
        <EtatErreur
          titre={t("Les débours n'ont pas pu être chargés.", "Expenses could not be loaded.")}
          message={liste.message}
          hrefReessayer={href(statut)}
        />
      ) : liste.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            statut === "soumis"
              ? t("Aucun débours en attente de validation.", "No expenses pending approval.")
              : t("Aucun débours.", "No expenses.")
          }
          icone="facture"
        />
      ) : (
        <ListeDeboursMission
          liste={liste.donnees.elements}
          contexte={contexte}
          avecAuteur={valideur}
        />
      )}
      {liste.ok ? (
        <PaginationCurseur
          hrefSuivante={
            liste.donnees.curseur_suivant ? href(statut, liste.donnees.curseur_suivant) : null
          }
          hrefDebut={curseur ? href(statut) : null}
          libelle={t("Pages des débours", "Expense pages")}
        />
      ) : null}
    </div>
  );
}
