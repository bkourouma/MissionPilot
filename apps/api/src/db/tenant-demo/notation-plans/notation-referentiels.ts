import { GRILLE_GENERIQUE } from "@missionpilot/shared";
import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { CASTING, trouverMission } from "./casting.js";
import { semerBanqueItems } from "./notation-referentiels-banque.js";
import {
  semerCalibrages,
  semerInitiatives,
  semerParametres,
} from "./notation-referentiels-calibrage.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Étape « notation-referentiels » de la phase « notation-plans » : référentiels de la notation
 * du cabinet « Tenant démo ». Tout passe par les routes /api/notation/** dans les sessions des
 * rôles qui ont la permission (séparation des tâches respectée : une version de grille ou un
 * item est validé par un expert métier qui n'en est ni l'auteur ni le dernier modificateur).
 *
 * CE QUE L'ÉTAPE SUIVANTE (« notations », missions 2 et 9) DOIT UTILISER
 * ----------------------------------------------------------------------
 * Grilles de notation (table notation_grilles, retrouvées par `code`) :
 *   - « competitivite-excellence » : copie de la grille générique de MissionPilot ; version 1
 *     VALIDÉE (auteur chef.mission, validée par expert.metier), version 2 en BROUILLON
 *     (révision en cours, ne sert pas au calcul). À utiliser pour la mission 2 (Sahel Coton).
 *   - « grille-banque-pme » : même contenu, poids de dimensions renforcés sur le pilotage et les
 *     coûts (analyse de portefeuille bancaire) ; version 1 VALIDÉE (auteur chef.mission.2,
 *     validée par expert.metier.2). À utiliser pour la mission 9 (Banque du Sahel).
 *   Identifiant de la version à passer en `grille_version_id` du calcul :
 *     SELECT v.id FROM notation_grille_versions v JOIN notation_grilles g ON g.id = v.grille_id
 *      WHERE g.code = '<code>' AND v.statut = 'valide' ORDER BY v.version DESC LIMIT 1;
 *   Les deux grilles s'accordent avec le questionnaire « notation_generique » (étape
 *   « questionnaires ») : mêmes identifiants de questions.
 * Secteurs de pondération des deux grilles : agro_industrie, numerique, industrie, services,
 * commerce (ceux de la grille générique ; le calcul peut passer `secteur`).
 *
 * Autres référentiels créés : banque d'items (20 codes, dont 15 validés et 5 en brouillon ;
 * 2 codes ont une version 2 en brouillon), paramètres de confiance (seuil 0,55, cible de
 * 3 répondants), 8 initiatives types (dont une retirée) et leurs impacts observés, 2 sessions
 * de calibrage (une close avec conclusion, une ouverte) avec leurs cotations, 2 sélections
 * adaptatives enregistrées sur la mission 9.
 *
 * Idempotent : clé naturelle = code (grille, item, initiative), titre (calibrage, sélection).
 */

interface DefGrille {
  code: string;
  titre: string;
  /** Poids de dimension remplaçant ceux de la grille générique (absent : inchangés). */
  poids?: Record<string, number>;
  auteur: CleCompteCabinet;
  valideur: CleCompteCabinet;
  /** Version 2 ouverte en brouillon après la validation de la version 1. */
  brouillon?: { auteur: CleCompteCabinet; titre: string; poids: Record<string, number> };
}

const GRILLES: readonly DefGrille[] = [
  {
    code: "competitivite-excellence",
    titre: "Grille de compétitivité et d'excellence opérationnelle — Tenant démo",
    auteur: "chef.mission",
    valideur: "expert.metier",
    brouillon: {
      auteur: "consultant",
      titre: "Grille de compétitivité et d'excellence opérationnelle — révision 2026",
      poids: { pilotage: 14, couts: 12, innovation: 8 },
    },
  },
  {
    code: "grille-banque-pme",
    titre: "Grille de notation d'un portefeuille PME bancaire — Tenant démo",
    poids: {
      strategie: 10,
      processus: 12,
      pilotage: 14,
      amelioration: 8,
      organisation: 8,
      engagement: 6,
      qualite: 12,
      couts: 14,
      innovation: 6,
      positionnement: 10,
    },
    auteur: "chef.mission.2",
    valideur: "expert.metier.2",
  },
];

/** Contenu de la grille générique, avec de nouveaux titre et poids de dimensions éventuels. */
function contenuGrille(titre: string, poids?: Record<string, number>) {
  return {
    ...GRILLE_GENERIQUE,
    titre,
    dimensions: GRILLE_GENERIQUE.dimensions.map((d) => ({ ...d, poids: poids?.[d.id] ?? d.poids })),
  };
}

interface LigneVersion extends Record<string, unknown> {
  id: string;
  version: number;
  statut: string;
}

async function versionsGrille(ctx: ContexteTenantDemo, code: string): Promise<LigneVersion[]> {
  return lire<LigneVersion>(
    ctx,
    `SELECT v.id, v.version, v.statut FROM notation_grille_versions v
       JOIN notation_grilles g ON g.id = v.grille_id AND g.cabinet_id = v.cabinet_id
      WHERE g.cabinet_id = $1 AND g.code = $2 ORDER BY v.version`,
    [ctx.cabinetId, code],
  );
}

async function semerGrilles(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of GRILLES) {
    let lignes = await versionsGrille(ctx, def.code);
    let grilleId: string;
    if (lignes.length === 0) {
      const r = await ctx.session(def.auteur).post("/api/notation/grilles", {
        code: def.code,
        titre: def.titre,
        source: { type: "contenu", contenu: contenuGrille(def.titre, def.poids) },
      });
      exiger(r, 201, `Grille ${def.code}`);
      grilleId = r.json().id as string;
      lignes = await versionsGrille(ctx, def.code);
    } else {
      const g = await lire<{ id: string }>(
        ctx,
        "SELECT id FROM notation_grilles WHERE cabinet_id = $1 AND code = $2",
        [ctx.cabinetId, def.code],
      );
      grilleId = (g[0] as { id: string }).id;
    }
    const v1 = lignes.find((l) => l.version === 1);
    if (v1?.statut === "brouillon") {
      const r = await ctx
        .session(def.valideur)
        .post(`/api/notation/grilles/versions/${v1.id}/valider`);
      exiger(r, 200, `Validation de la grille ${def.code}`);
    }
    if (def.brouillon && !lignes.some((l) => l.version === 2)) {
      const r = await ctx
        .session(def.brouillon.auteur)
        .post(`/api/notation/grilles/${grilleId}/versions`, {
          contenu: contenuGrille(def.brouillon.titre, def.brouillon.poids),
        });
      exiger(r, 201, `Version 2 de la grille ${def.code}`);
    }
  }
}

/** Questionnaires adaptatifs construits par le moteur à partir des items VALIDÉS (ajout seul). */
async function semerSelections(ctx: ContexteTenantDemo): Promise<void> {
  const mission = await trouverMission(ctx, CASTING.banqueSahel);
  const selections = [
    {
      titre: "Questionnaire adaptatif — dirigeants, Banque du Sahel",
      regles: { public: "dirigeant", max_par_dimension: 2 },
    },
    {
      titre: "Questionnaire court — équipes de la direction des risques, Banque du Sahel",
      regles: { public: "equipe", max_par_dimension: 1, duree_max_secondes: 240 },
    },
  ];
  for (const s of selections) {
    const presente = await existe(
      ctx,
      "SELECT 1 FROM notation_selections WHERE mission_id = $1 AND definition->>'titre' = $2",
      [mission.id, s.titre],
    );
    if (presente) continue;
    const r = await ctx
      .session("directeur.mission")
      .post(`/api/missions/${mission.id}/notation/selections`, {
        regles: s.regles,
        titre: s.titre,
        enregistrer: true,
      });
    exiger(r, 201, `Sélection « ${s.titre} »`);
  }
}

export async function semerNotationReferentiels(ctx: ContexteTenantDemo): Promise<void> {
  await semerGrilles(ctx);
  await semerBanqueItems(ctx);
  await semerParametres(ctx);
  await semerInitiatives(ctx);
  await semerCalibrages(ctx);
  await semerSelections(ctx);
}
