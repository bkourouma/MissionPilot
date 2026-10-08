import {
  ajouterJours,
  calculerBudget,
  figerVersion,
  listerJoursOuvres,
  lundiDeLaSemaine,
  versCentiemes,
  type Devise,
} from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import type { MissionAcces } from "../missions/acces.js";
import { calculerDepuisDecoupage, insererLignes, versVersionMoteur } from "../missions/budget.js";
import { aujourdhui, chargerCalendrier } from "../missions/outils.js";
import { evaluerAlertes } from "../temps/suivi.js";
import type { Db } from "./pool.js";

/*
 * Démonstration des temps (données fictives) : mission « Audit
 * organisationnel » en cours depuis six semaines, qui reproduit l'exemple
 * chiffré du PRD (« Volumes journaliers budgétés et réalisés ») :
 *
 *   Phase                      Budget  Réalisé  Reste  Atterrissage  Écart
 *   Diagnostic                     12     13,5      0          13,5   +1,5
 *   Analyse des processus           8        7      1             8      0
 *   Recommandations                15        6     10            16     +1
 *   Plan de transformation         10        0     10            10      0
 *   Validation et restitution       5        0      5             5      0
 *   Total mission                  50     26,5     26          52,5   +2,5
 *
 * Les temps sont des feuilles hebdomadaires VALIDÉES (consultant validé par
 * la cheffe de mission, cheffe de mission validée par l'associée) ; les
 * restes à faire nuls ou partiels sont déclarés, ceux des deux dernières
 * phases sont estimés (budget − réalisé). Idempotent : rien n'est recréé si
 * la mission existe déjà.
 */

const MISSION_TEMPS = {
  intitule: "Audit organisationnel Lagune Microfinance (démo)",
  client: "Lagune Microfinance (fictif)",
  type: "audit_organisationnel",
};

type Phase = "diag" | "analyse" | "reco" | "plan" | "validation";

const PHASES: readonly { cle: Phase; libelle: string; budget: Record<string, number> }[] = [
  { cle: "diag", libelle: "Diagnostic", budget: { senior: 8, manager: 4 } },
  { cle: "analyse", libelle: "Analyse des processus", budget: { senior: 6, manager: 2 } },
  { cle: "reco", libelle: "Recommandations", budget: { senior: 10, manager: 5 } },
  { cle: "plan", libelle: "Plan de transformation", budget: { senior: 6, manager: 4 } },
  { cle: "validation", libelle: "Validation et restitution", budget: { manager: 3, associe: 2 } },
];

/** Jours réalisés par semaine (1 à 6) : consultant et cheffe de mission. */
const REALISE: Record<"consultant" | "chef_mission", [number, Phase, number][]> = {
  consultant: [
    [1, "diag", 3],
    [2, "diag", 3],
    [3, "diag", 2.5],
    [3, "analyse", 2],
    [4, "analyse", 3],
    [5, "reco", 3],
    [6, "reco", 3],
  ],
  chef_mission: [
    [1, "diag", 2],
    [2, "diag", 2],
    [3, "diag", 1],
    [4, "analyse", 2],
  ],
};

/** Restes à faire déclarés en semaine 6. */
const RESTE: [Phase, "consultant" | "chef_mission", number][] = [
  ["diag", "consultant", 0],
  ["diag", "chef_mission", 0],
  ["analyse", "consultant", 1],
  ["analyse", "chef_mission", 0],
  ["reco", "consultant", 10],
];

async function id(db: Db, sql: string, valeur: string): Promise<string | undefined> {
  return (await db.query(sql, [valeur])).rows[0]?.id as string | undefined;
}

/** Répartit des jours sur les jours ouvrés de la semaine, par demi-journées, 1 j au plus par jour. */
function repartir(
  ouvres: readonly string[],
  travaux: readonly { tacheId: string; jours: number }[],
): { date: string; tacheId: string; centiemes: number }[] {
  const lignes: { date: string; tacheId: string; centiemes: number }[] = [];
  let jour = 0;
  let libre = 100;
  for (const t of travaux) {
    let reste = versCentiemes(t.jours);
    while (reste > 0 && jour < ouvres.length) {
      const pris = Math.min(reste, libre);
      lignes.push({ date: ouvres[jour] as string, tacheId: t.tacheId, centiemes: pris });
      reste -= pris;
      libre -= pris;
      if (libre === 0) {
        jour++;
        libre = 100;
      }
    }
  }
  return lignes;
}

export async function semerTemps(db: Db, cabinetId: string, ids: Map<Role, string>): Promise<void> {
  if (await id(db, "SELECT id FROM missions WHERE intitule = $1", MISSION_TEMPS.intitule)) return;
  const client = await id(
    db,
    "SELECT id FROM clients WHERE raison_sociale = $1",
    MISSION_TEMPS.client,
  );
  const type = await id(db, "SELECT id FROM types_mission WHERE code = $1", MISSION_TEMPS.type);
  const directeur = ids.get("directeur_mission");
  const chef = ids.get("chef_mission");
  const associe = ids.get("associe");
  const consultant = ids.get("consultant");
  if (!client || !directeur || !chef || !associe || !consultant) return;
  const collaborateur = async (utilisateurId: string) =>
    id(db, "SELECT id FROM collaborateurs WHERE utilisateur_id = $1 AND actif", utilisateurId);
  const collaborateurs = {
    consultant: await collaborateur(consultant),
    chef_mission: await collaborateur(chef),
  };
  if (!collaborateurs.consultant || !collaborateurs.chef_mission) return;

  // Six semaines écoulées avant la semaine courante.
  const s1 = ajouterJours(lundiDeLaSemaine(aujourdhui()), -42);
  const semaine = (n: number) => ajouterJours(s1, 7 * (n - 1));
  const m = await db.query(
    `INSERT INTO missions (cabinet_id, intitule, client_id, type_mission_id, directeur_id, chef_id,
       date_debut, date_fin, devise, mode_facturation, statut, activite, secteur, bureau, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'XOF', 'forfait', 'proposition',
       'Conseil en organisation', 'Microfinance', 'Abidjan', $5)
     RETURNING id`,
    [
      cabinetId,
      MISSION_TEMPS.intitule,
      client,
      type ?? null,
      directeur,
      chef,
      s1,
      ajouterJours(s1, 7 * 12 - 3),
    ],
  );
  const missionId = m.rows[0].id as string;
  const taches = new Map<Phase, string>();
  for (const [i, p] of PHASES.entries()) {
    const phase = await db.query(
      `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [cabinetId, missionId, p.libelle, i + 1],
    );
    const tache = await db.query(
      `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, libelle, ordre, est_livrable,
         duree_jours_ouvres)
       VALUES ($1, $2, $3, $4, 1, $5, 10) RETURNING id`,
      [cabinetId, missionId, phase.rows[0].id, p.libelle, p.cle === "reco" || p.cle === "plan"],
    );
    const tacheId = tache.rows[0].id as string;
    taches.set(p.cle, tacheId);
    for (const [grade, jours] of Object.entries(p.budget)) {
      const gradeId = await id(db, "SELECT id FROM grades WHERE code = $1", grade);
      if (!gradeId) continue;
      await db.query(
        `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id, jours)
         VALUES ($1, $2, $3, $4, $5)`,
        [cabinetId, missionId, tacheId, gradeId, jours],
      );
    }
  }

  // Budget initial figé à la signature, par les moteurs (comme la mission de démonstration).
  const signature = ajouterJours(s1, -7);
  const mission = { id: missionId, devise: "XOF", proposition_id: null } as unknown as MissionAcces;
  const calcul = await calculerDepuisDecoupage(db, mission, { date: signature });
  const v = await db.query(
    `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, cree_par)
     VALUES ($1, $2, 1, 'initial', 'XOF', $3) RETURNING id`,
    [cabinetId, missionId, directeur],
  );
  const versionId = v.rows[0].id as string;
  await insererLignes(db, cabinetId, missionId, versionId, calcul.lignes);
  const moteur = versVersionMoteur({
    id: versionId,
    numero: 1,
    type: "initial",
    devise: "XOF" as Devise,
    figee: false,
    motif: null,
    lignes: calcul.lignes,
  });
  calculerBudget(moteur);
  const figee = figerVersion(moteur, signature);
  await db.query(
    `UPDATE budget_versions SET figee = true, date_figeage = $2, validee_par = $3, validee_le = now()
     WHERE id = $1`,
    [versionId, figee.dateFigeage, directeur],
  );
  await db.query(
    `UPDATE missions SET statut = 'en_cours', date_signature = $2, signee_par = $3, taux_change = 1,
       devise_reference = 'XOF' WHERE id = $1`,
    [missionId, signature, directeur],
  );

  // Équipe et affectations nominatives (les temps portent sur des tâches affectées).
  const affecter = async (
    qui: "consultant" | "chef_mission",
    phase: Phase,
    jours: number,
    de: number,
    a: number,
  ) => {
    await db.query(
      `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, jours_alloues,
         date_debut, date_fin, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cabinetId,
        missionId,
        taches.get(phase),
        collaborateurs[qui],
        jours,
        semaine(de),
        ajouterJours(semaine(a), 4),
        chef,
      ],
    );
  };
  await affecter("consultant", "diag", 8.5, 1, 3);
  await affecter("consultant", "analyse", 6, 3, 4);
  await affecter("consultant", "reco", 16, 5, 9);
  await affecter("chef_mission", "diag", 5, 1, 3);
  await affecter("chef_mission", "analyse", 2, 4, 4);
  for (const u of [consultant, chef]) {
    await db.query(
      `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par)
       VALUES ($1, $2, $3, $4) ON CONFLICT (mission_id, utilisateur_id) DO NOTHING`,
      [cabinetId, missionId, u, chef],
    );
  }

  // Feuilles validées : consultant par la cheffe de mission, cheffe de mission par l'associée.
  const calendrier = await chargerCalendrier(db, cabinetId);
  for (const qui of ["consultant", "chef_mission"] as const) {
    const auteur = qui === "consultant" ? consultant : chef;
    const valideur = qui === "consultant" ? chef : associe;
    for (let n = 1; n <= 6; n++) {
      const travaux = REALISE[qui]
        .filter(([s]) => s === n)
        .map(([, phase, jours]) => ({ tacheId: taches.get(phase) as string, jours }));
      if (travaux.length === 0) continue;
      const debut = semaine(n);
      const ouvres = listerJoursOuvres({ debut, fin: ajouterJours(debut, 6) }, calendrier);
      const f = await db.query(
        `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [cabinetId, collaborateurs[qui], auteur, debut],
      );
      const feuilleId = f.rows[0].id as string;
      for (const l of repartir(ouvres, travaux)) {
        await db.query(
          `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, centiemes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cabinetId, feuilleId, l.date, missionId, l.tacheId, l.centiemes],
        );
      }
      const soumise = `${ajouterJours(debut, 4)}T16:00:00Z`;
      await db.query(
        `UPDATE feuilles_temps SET statut = 'soumise', cycle = 1, soumise_le = $2,
           premiere_soumission_le = $2 WHERE id = $1`,
        [feuilleId, soumise],
      );
      await db.query(
        `INSERT INTO feuille_validations (cabinet_id, feuille_id, cycle, mission_id, decision, decide_par,
           decide_le)
         VALUES ($1, $2, 1, $3, 'validee', $4, $5)`,
        [cabinetId, feuilleId, missionId, valideur, `${ajouterJours(debut, 7)}T09:00:00Z`],
      );
      await db.query(
        "UPDATE feuilles_temps SET statut = 'validee', validee_le = $2 WHERE id = $1",
        [feuilleId, `${ajouterJours(debut, 7)}T09:00:00Z`],
      );
    }
  }

  // Restes à faire déclarés en fin de semaine 6.
  for (const [phase, qui, jours] of RESTE) {
    await db.query(
      `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
         centiemes, declare_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cabinetId,
        missionId,
        taches.get(phase),
        collaborateurs[qui],
        semaine(6),
        versCentiemes(jours),
        chef,
      ],
    );
  }
  // Alertes (parcours C) : atterrissage de la mission au-delà du budget (+5 %).
  await evaluerAlertes(db, cabinetId, missionId);
}
