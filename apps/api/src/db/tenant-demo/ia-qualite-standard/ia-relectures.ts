import { genererContenu } from "../../../ia/orchestrateur.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import type { CleMission, MissionLot } from "./commun.js";
import { acteursMission, authDe, depsIa, instant, nomClient } from "./ia-aide.js";
import { TEXTES_MISSION, TEXTES_RELECTURE } from "./ia-donnees.js";

/*
 * Relectures récentes du module « ia » (trois dernières semaines) : demande par l'orchestrateur à
 * horloge fictive, puis modification par le demandeur et validation par un autre intervenant
 * autorisé de la mission (chef, directeur ou associé), TOUJOURS par les routes.
 */

interface Relecture {
  id: string;
  mission: CleMission;
  prompt: string;
  avant: number;
  heure: number;
  /** Index du texte d'entrée dans TEXTES_MISSION. */
  entree: number;
  demandeur: "chef" | "directeur";
  /** Le demandeur modifie le brouillon (route) ; sans valideur, le contenu reste « modifié ». */
  modifie: boolean;
  valideur?: "directeur" | "associe";
}

const RELECTURES: readonly Relecture[] = [
  {
    id: "baobab-synthese",
    mission: "plan-baobab",
    prompt: "synthese_comite",
    avant: 9,
    heure: 9,
    entree: 0,
    demandeur: "chef",
    modifie: true,
    valideur: "directeur",
  },
  {
    id: "gabon-compte-rendu",
    mission: "redressement-gabon",
    prompt: "compte_rendu_reunion",
    avant: 7,
    heure: 14,
    entree: 1,
    demandeur: "chef",
    modifie: true,
    valideur: "associe",
  },
  {
    id: "teranga-risques",
    mission: "flash-teranga",
    prompt: "analyse_risques",
    avant: 5,
    heure: 10,
    entree: 0,
    demandeur: "chef",
    modifie: true,
    valideur: "directeur",
  },
  {
    id: "banque-sahel-reponse",
    mission: "notation-banque-sahel",
    prompt: "reponse_demande_client",
    avant: 4,
    heure: 16,
    entree: 0,
    demandeur: "chef",
    modifie: true,
    valideur: "directeur",
  },
  {
    id: "atlantique-synthese",
    mission: "bp-atlantique",
    prompt: "synthese_comite",
    avant: 15,
    heure: 11,
    entree: 4,
    demandeur: "directeur",
    modifie: true,
    valideur: "associe",
  },
  {
    id: "mboa-compte-rendu",
    mission: "dd-mboa",
    prompt: "compte_rendu_reunion",
    avant: 12,
    heure: 15,
    entree: 2,
    demandeur: "chef",
    modifie: true,
  },
  {
    id: "baobab-risques",
    mission: "plan-baobab",
    prompt: "analyse_risques",
    avant: 3,
    heure: 9,
    entree: 1,
    demandeur: "chef",
    modifie: false,
  },
  {
    id: "gabon-reponse",
    mission: "redressement-gabon",
    prompt: "reponse_demande_client",
    avant: 2,
    heure: 11,
    entree: 2,
    demandeur: "chef",
    modifie: false,
  },
  {
    id: "teranga-synthese",
    mission: "flash-teranga",
    prompt: "synthese_comite",
    avant: 1,
    heure: 17,
    entree: 3,
    demandeur: "directeur",
    modifie: false,
  },
  {
    id: "sicafe-piece",
    mission: "plan-sicafe",
    prompt: "classement_piece",
    avant: 6,
    heure: 10,
    entree: 1,
    demandeur: "chef",
    modifie: false,
  },
  {
    id: "wouri-synthese",
    mission: "redressement-wouri",
    prompt: "synthese_comite",
    avant: 10,
    heure: 13,
    entree: 5,
    demandeur: "directeur",
    modifie: false,
  },
];

export async function etatContenu(
  ctx: ContexteTenantDemo,
  demandeId: string,
): Promise<string | null> {
  const r = await ctx.proprietaire.query<{ statut_contenu: string }>(
    "SELECT statut_contenu FROM ia_generations WHERE demande_id = $1 ORDER BY version DESC LIMIT 1",
    [demandeId],
  );
  return r.rows[0]?.statut_contenu ?? null;
}

/** Relectures récentes : demande (orchestrateur), puis modification et validation par les routes. */
export async function relectures(
  ctx: ContexteTenantDemo,
  missions: Partial<Record<CleMission, MissionLot>>,
): Promise<number> {
  let faites = 0;
  for (const r of RELECTURES) {
    const m = missions[r.mission];
    if (!m) continue;
    const acteurs = await acteursMission(ctx, m);
    if (!acteurs) continue;
    const demandeur = r.demandeur === "chef" ? acteurs.chef : acteurs.directeur;
    const quand = instant(ctx.dateAvant(r.avant), r.heure);
    const auth = authDe(ctx, demandeur);
    const deja = await ctx.proprietaire.query<{ id: string }>(
      `SELECT id FROM ia_demandes WHERE cabinet_id = $1 AND prompt_nom = $2 AND demandeur_id = $3
         AND cree_le = $4 AND mission_id = $5`,
      [ctx.cabinetId, r.prompt, auth.utilisateurId, quand, m.id],
    );
    let demandeId = deja.rows[0]?.id;
    if (!demandeId) {
      const textes = TEXTES_MISSION[r.prompt]!;
      const client = await nomClient(ctx, m.clientId);
      const res = await genererContenu(ctx.database, depsIa(ctx, quand), {
        promptNom: r.prompt,
        variables: { texte: textes[r.entree % textes.length]!.replaceAll("{client}", client) },
        utilisateur: auth,
        entite: { missionId: m.id },
      });
      demandeId = res.demandeId;
      faites += 1;
    }
    let etat = await etatContenu(ctx, demandeId);
    if (r.modifie && etat === "brouillon_ia") {
      attendre(
        200,
        await ctx.session(demandeur).post(`/api/ia/generations/${demandeId}/modifier`, {
          texte: TEXTES_RELECTURE[r.id],
        }),
        `relecture ${r.id}`,
      );
      etat = "modifie";
    }
    if (r.valideur && etat === "modifie") {
      const valideur = r.valideur === "directeur" ? acteurs.directeur : "associe";
      attendre(
        200,
        await ctx.session(valideur).post(`/api/ia/generations/${demandeId}/valider`, {}),
        `validation ${r.id}`,
      );
    }
  }
  return faites;
}
