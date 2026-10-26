import { evaluerGarde, type ClasseRisque, type EtapeGarde } from "@missionpilot/engines";
import type { ContexteTenantDemo } from "../contexte.js";
import { acteur, acteurDe, present, type Acteur } from "../ia-qualite-standard/qualite-outils.js";

/*
 * Choix des acteurs du circuit qualité d'un livrable déjà ouvert (l'auteur est imposé : c'est
 * celui qui a généré le rapport). Mêmes principes que `distribuer` du lot 6 : la validation du
 * consultant revient de préférence à un membre de l'équipe autre que l'auteur, la relecture au
 * chef de mission (ou au directeur, à défaut un associé), le second expert est hors équipe, la
 * signature est celle du directeur de la mission, à défaut d'un associé. La séparation des tâches
 * est vérifiée par le MÊME moteur que l'API (`evaluerGarde`) ; une violation lève une erreur.
 */

export interface EquipeMission {
  directeur: Acteur;
  chef: Acteur;
  membres: Acteur[];
}

/** Équipe d'une mission : directeur, chef et membres de `mission_equipe` qui ont un compte du seed. */
export async function equipeDe(ctx: ContexteTenantDemo, missionId: string): Promise<EquipeMission> {
  const m = await ctx.proprietaire.query<{ directeur_id: string | null; chef_id: string | null }>(
    "SELECT directeur_id, chef_id FROM missions WHERE id = $1",
    [missionId],
  );
  const directeur = acteurDe(ctx, m.rows[0]?.directeur_id ?? null);
  const chef = acteurDe(ctx, m.rows[0]?.chef_id ?? null);
  if (!directeur || !chef) throw new Error(`Mission ${missionId} : directeur ou chef sans compte.`);
  const eq = await ctx.proprietaire.query<{ utilisateur_id: string }>(
    "SELECT utilisateur_id FROM mission_equipe WHERE mission_id = $1 ORDER BY ajoute_le, utilisateur_id",
    [missionId],
  );
  const membres = eq.rows
    .map((l) => acteurDe(ctx, l.utilisateur_id))
    .filter((a): a is Acteur => a !== undefined);
  return { directeur, chef, membres };
}

export type Roles = Partial<Record<EtapeGarde, Acteur>>;

/** Étapes déjà franchies : identifiants des acteurs (reprise d'un suivi à moitié mené). */
export type Faites = Partial<Record<EtapeGarde, string>>;

function premier(cands: Acteur[], interdits: Set<string>, date: string): Acteur | undefined {
  return cands.find((a) => !interdits.has(a.id) && present(a.cle, date));
}

/**
 * Acteurs des étapes NON encore franchies de la classe. `auteurId` : auteur du livrable.
 * `date` : jour du circuit (un compte n'agit pas avant son arrivée dans le cabinet).
 */
export function choisirActeurs(
  ctx: ContexteTenantDemo,
  eq: EquipeMission,
  classe: ClasseRisque,
  auteurId: string | null,
  faites: Faites,
  date: string,
): Roles {
  // Associés de la mission d'abord : un associé étranger à la mission ne doit pas devenir
  // intervenant qualité (il ne serait plus indépendant pour la revue à froid).
  const associesEquipe = eq.membres.filter((a) => a.role === "associe");
  const associe = acteur(ctx, "associe");
  const associe2 = acteur(ctx, "associe.2");
  const directeur2 = acteur(ctx, "directeur.mission.2");
  const associes = [...associesEquipe, associe, associe2];
  const auteur = auteurId ? new Set([auteurId]) : new Set<string>();
  const consultants = eq.membres.filter((a) => a.role === "consultant");
  const roles: Roles = {};
  const pris = new Set(auteur);

  // Validation du consultant : un membre de l'équipe autre que l'auteur ; l'auteur en dernier recours.
  const cherche = (etape: EtapeGarde, cands: Acteur[], tolere: Acteur[] = []): void => {
    const id = faites[etape];
    if (id) {
      pris.add(id);
      return;
    }
    const a = premier(cands, pris, date) ?? premier(tolere, new Set(), date);
    if (!a) throw new Error(`Aucun acteur disponible pour « ${etape} » le ${date}.`);
    roles[etape] = a;
    pris.add(a.id);
  };
  cherche(
    "validation_consultant",
    [...consultants, eq.chef, eq.directeur],
    [...consultants, eq.chef, eq.directeur],
  );
  cherche("relecture_chef_mission", [eq.chef, eq.directeur, ...associes]);
  if (classe === "R3") cherche("revue_second_expert", [associe2, directeur2, associe]);
  // Signature : directeur de la mission, à défaut un associé, distincts des autres rôles si possible.
  if (!faites.signature_directeur_mission) {
    const sig =
      premier([eq.directeur, ...associes], pris, date) ??
      premier([eq.directeur, ...associes], auteur, date);
    if (!sig) throw new Error(`Aucun signataire disponible le ${date}.`);
    roles.signature_directeur_mission = sig;
  }

  // Même contrôle que l'API : le moteur de garde ne doit relever aucune violation.
  const attribues = (Object.entries(faites) as [EtapeGarde, string][]).map(([etape, id]) => ({
    etape,
    acteur: id,
  }));
  for (const [etape, a] of Object.entries(roles) as [EtapeGarde, Acteur][]) {
    if (classe === "R2" && etape === "signature_directeur_mission") continue;
    attribues.push({ etape, acteur: a.id });
  }
  const evaluation = evaluerGarde(classe, attribues, { auteur: auteurId });
  if (evaluation.violations.length > 0) {
    throw new Error(`Garde ${classe} : ${evaluation.violations.map((v) => v.code).join(", ")}.`);
  }
  return roles;
}
