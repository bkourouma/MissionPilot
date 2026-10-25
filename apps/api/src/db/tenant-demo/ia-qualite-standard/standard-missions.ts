import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { exigerMission, type CleMission } from "./commun.js";
import { methodeStandard, versionPubliee } from "./standard-aide.js";

/*
 * Mission figée sur une version de méthode (STD-08) : PUT /api/missions/:id/methode par le
 * directeur de mission, puis, pour le plan de Baobab, migration motivée vers la version 2 de la
 * variante. Le contexte est celui du dossier client (facteurs du dictionnaire) ; un contexte qui
 * active une brique de classe R2 ou R3 exige un motif : il est toujours fourni.
 *
 * Limite assumée : `mission_methodes` est en ajout seul (MPM03), les lignes portent l'horodatage
 * du seed. Les rattachements des missions terminées sont donc présentés comme une mise en
 * conformité rétroactive au référentiel de méthodes (motif), pas comme une liaison d'époque.
 */

type Contexte = Record<string, string | number | boolean | string[]>;

interface Liaison {
  mission: CleMission;
  /** Méthode du cabinet (code) ou du standard (`standard:<code>`). */
  methode: string;
  version?: number;
  contexte: Contexte;
  motif: string;
}

const RETRO =
  "Rattachement rétroactif à la méthode lors de la mise en place du référentiel de méthodes.";
const CADRAGE = "Méthode retenue au cadrage de la mission avec le directeur de mission.";

export const LIAISONS: Liaison[] = [
  {
    mission: "plan-sicafe",
    methode: "standard:plan_strategique",
    contexte: {
      pays: "ci",
      zone: "uemoa",
      secteur: "citi_a",
      filieres: ["cacao", "cafe"],
      agricole: true,
      taille: "grande",
      situation: "stabilite",
      saisonnalite: "campagne_agricole",
    },
    motif: RETRO,
  },
  {
    mission: "notation-sahel-coton",
    methode: "standard:notation_entreprise",
    contexte: {
      pays: "ml",
      zone: "uemoa",
      secteur: "citi_a",
      filieres: ["coton"],
      agricole: true,
      taille: "moyenne",
      fiabilite_comptes: "reconstitues",
      actionnariat: "cooperative",
    },
    motif: RETRO,
  },
  {
    mission: "redressement-wouri",
    methode: "redressement_cabinet",
    contexte: {
      pays: "cm",
      zone: "cemac",
      secteur: "citi_c",
      filieres: ["agroalimentaire"],
      taille: "grande",
      situation: "difficulte",
      fiabilite_comptes: "certifies",
    },
    motif: RETRO,
  },
  {
    mission: "dd-mboa",
    methode: "due_diligence_cabinet",
    contexte: {
      pays: "cm",
      zone: "cemac",
      secteur: "citi_d",
      taille: "petite",
      actionnariat: "startup_financee",
      situation: "croissance",
    },
    motif: RETRO,
  },
  {
    mission: "bp-atlantique",
    methode: "standard:business_plan_bancable",
    contexte: {
      pays: "ci",
      zone: "uemoa",
      secteur: "citi_g",
      taille: "grande",
      effectif: 640,
      situation: "croissance",
      fiabilite_comptes: "certifies",
      part_informel: "faible",
      financeur: "banque",
      actionnariat: "filiale_groupe",
    },
    motif: RETRO,
  },
  {
    mission: "plan-baobab",
    methode: "plan_strategique_cabinet",
    version: 1,
    contexte: {
      pays: "ci",
      zone: "uemoa",
      secteur: "citi_k",
      taille: "grande",
      situation: "stabilite",
      actionnariat: "filiale_groupe",
      exigence_bailleur: "aucune",
    },
    motif: CADRAGE,
  },
  {
    mission: "redressement-gabon",
    methode: "redressement_cabinet",
    contexte: {
      pays: "ga",
      zone: "cemac",
      secteur: "citi_b",
      taille: "moyenne",
      situation: "difficulte",
      commerce_exterieur: ["importations_intrants", "change"],
    },
    motif: CADRAGE,
  },
  {
    mission: "flash-teranga",
    methode: "diagnostic_flash_cabinet",
    version: 1,
    contexte: {
      pays: "sn",
      zone: "uemoa",
      secteur: "citi_h",
      taille: "moyenne",
      effectif: 85,
      situation: "tension",
      fiabilite_comptes: "non_certifies",
      part_informel: "forte",
      commerce_exterieur: ["export", "change"],
    },
    motif: CADRAGE,
  },
  {
    mission: "notation-banque-sahel",
    methode: "standard:notation_entreprise",
    contexte: {
      pays: "bf",
      zone: "uemoa",
      secteur: "citi_k",
      taille: "grande",
      culture_manageriale: "mixte",
    },
    motif: CADRAGE,
  },
  {
    mission: "plan-sicafe-export",
    methode: "plan_strategique_cabinet",
    version: 2,
    contexte: {
      pays: "ci",
      zone: "uemoa",
      secteur: "citi_a",
      filieres: ["cacao"],
      agricole: true,
      taille: "moyenne",
      commerce_exterieur: ["export", "change"],
      saisonnalite: "campagne_agricole",
      exigence_bailleur: "ifc",
    },
    motif: CADRAGE,
  },
  {
    mission: "dd-wouri-distribution",
    methode: "due_diligence_cabinet",
    contexte: {
      pays: "cm",
      zone: "cemac",
      secteur: "citi_g",
      taille: "moyenne",
      filieres: ["agroalimentaire"],
      actionnariat: "filiale_groupe",
    },
    motif: CADRAGE,
  },
];

async function versionCible(ctx: ContexteTenantDemo, l: Liaison): Promise<string> {
  if (l.methode.startsWith("standard:")) {
    const m = await methodeStandard(ctx, l.methode.slice("standard:".length));
    if (!m.publiee) throw new Error(`Standard ${l.methode} sans version publiée.`);
    return m.publiee;
  }
  return versionPubliee(ctx, l.methode, l.version ?? 1);
}

export async function semerLiaisons(ctx: ContexteTenantDemo): Promise<void> {
  const directeur = ctx.session("directeur.mission");
  for (const l of LIAISONS) {
    const mission = await exigerMission(ctx, l.mission);
    const deja = await ctx.proprietaire.query(
      "SELECT 1 FROM mission_methodes WHERE mission_id = $1",
      [mission.id],
    );
    if (deja.rowCount) continue;
    const r = await directeur.put(`/api/missions/${mission.id}/methode`, {
      version_id: await versionCible(ctx, l),
      contexte: l.contexte,
      motif: l.motif,
    });
    attendre(200, r, `liaison de méthode ${l.mission}`);
  }
  // Plan de Baobab : migration motivée vers la version 2 de la variante (revue par un pair).
  const baobab = await exigerMission(ctx, "plan-baobab");
  const v2 = await versionPubliee(ctx, "plan_strategique_cabinet", 2);
  const migree = await ctx.proprietaire.query(
    "SELECT 1 FROM mission_methodes WHERE mission_id = $1 AND evenement = 'migration'",
    [baobab.id],
  );
  if (!migree.rowCount) {
    const r = await directeur.post(`/api/missions/${baobab.id}/methode/migration`, {
      version_id: v2,
      motif:
        "Adoption de la revue par un pair avant la restitution du plan, souhaitée par le comité de pilotage du client.",
    });
    attendre(200, r, "migration du plan de Baobab");
  }
  ctx.journal("  missions rattachées à leur méthode.");
}
