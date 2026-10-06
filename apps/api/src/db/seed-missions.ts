import { calculerBudget, figerVersion, type Devise } from "@missionpilot/engines";
import type { Role } from "@missionpilot/shared";
import type { MissionAcces } from "../missions/acces.js";
import { calculerDepuisDecoupage, insererLignes, versVersionMoteur } from "../missions/budget.js";
import { copierElements, elementsDuModele } from "../missions/decoupage.js";
import { aujourdhui } from "../missions/outils.js";
import type { Db } from "./pool.js";

/*
 * Démonstration du cycle commercial et des missions (données fictives) :
 * quelques opportunités et une mission signée avec découpage et budget
 * initial figé. Idempotent : rien n'est recréé si l'intitulé existe déjà.
 */

const OPPORTUNITES_DEMO = [
  {
    intitule: "Plan stratégique 2027-2031 (démo)",
    client: "Kora Agro-Industries (fictif)",
    type: "plan_strategique",
    montant: 45_000_000,
    probabilite: 60,
    etape: "negociation",
    motifPerte: null,
  },
  {
    intitule: "Audit organisationnel du réseau d'agences (démo)",
    client: "Lagune Microfinance (fictif)",
    type: "audit_organisationnel",
    montant: 18_000_000,
    probabilite: 30,
    etape: "qualification",
    motifPerte: null,
  },
  {
    intitule: "Formation des managers de proximité (démo)",
    client: "Mutuelle des Enseignants Démo (fictif)",
    type: "formation",
    montant: 6_500_000,
    probabilite: 0,
    etape: "proposition",
    motifPerte: "Budget de formation reporté à l'exercice suivant.",
  },
] as const;

const MISSION_DEMO = {
  intitule: "Plan stratégique Transports Akwaba (démo)",
  client: "Transports Akwaba (fictif)",
  type: "plan_strategique",
};

async function idPar(db: Db, sql: string, valeur: string): Promise<string | undefined> {
  return (await db.query(sql, [valeur])).rows[0]?.id as string | undefined;
}

async function semerOpportunites(db: Db, cabinetId: string, auteur: string | null): Promise<void> {
  for (const o of OPPORTUNITES_DEMO) {
    if (await idPar(db, "SELECT id FROM opportunites WHERE intitule = $1", o.intitule)) continue;
    const client = await idPar(db, "SELECT id FROM clients WHERE raison_sociale = $1", o.client);
    const type = await idPar(db, "SELECT id FROM types_mission WHERE code = $1", o.type);
    if (!client) continue;
    const perdue = o.motifPerte !== null;
    await db.query(
      `INSERT INTO opportunites (cabinet_id, client_id, intitule, type_mission_id, montant_estime,
         probabilite, etape, statut, motif_perte, cloturee_le, responsable_id, cree_par,
         date_cloture_prevue)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, current_date + 45)`,
      [
        cabinetId,
        client,
        o.intitule,
        type ?? null,
        o.montant,
        o.probabilite,
        o.etape,
        perdue ? "perdue" : "ouverte",
        o.motifPerte,
        perdue ? new Date() : null,
        auteur,
      ],
    );
  }
}

/** Mission signée : découpage du type, budget initial calculé par les moteurs puis figé. */
async function semerMissionSignee(db: Db, cabinetId: string, ids: Map<Role, string>) {
  if (await idPar(db, "SELECT id FROM missions WHERE intitule = $1", MISSION_DEMO.intitule)) return;
  const client = await idPar(
    db,
    "SELECT id FROM clients WHERE raison_sociale = $1",
    MISSION_DEMO.client,
  );
  const type = await idPar(db, "SELECT id FROM types_mission WHERE code = $1", MISSION_DEMO.type);
  if (!client || !type) return;
  const directeur = ids.get("directeur_mission") ?? null;
  const signature = aujourdhui();
  const m = await db.query(
    `INSERT INTO missions (cabinet_id, intitule, client_id, type_mission_id, directeur_id, chef_id,
       date_debut, date_fin, devise, mode_facturation, statut, activite, secteur, bureau, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, current_date + 7, current_date + 97, 'XOF', 'forfait',
       'proposition', 'Conseil en stratégie', 'Transport et logistique', 'Abidjan', $5)
     RETURNING id`,
    [cabinetId, MISSION_DEMO.intitule, client, type, directeur, ids.get("chef_mission") ?? null],
  );
  const missionId = m.rows[0].id as string;
  await copierElements(db, cabinetId, missionId, await elementsDuModele(db, type));
  const consultant = ids.get("consultant");
  if (consultant) {
    await db.query(
      `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par)
       VALUES ($1, $2, $3, $4)`,
      [cabinetId, missionId, consultant, directeur],
    );
  }
  const mission = {
    id: missionId,
    devise: "XOF",
    proposition_id: null,
  } as unknown as MissionAcces;
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
    `UPDATE missions SET statut = 'signee', date_signature = $2, signee_par = $3, taux_change = 1,
       devise_reference = 'XOF' WHERE id = $1`,
    [missionId, signature, directeur],
  );
  await db.query(
    `INSERT INTO mission_documents (cabinet_id, mission_id, type, nom, version, auteur_id)
     VALUES ($1, $2, 'lettre_de_mission', 'Lettre de mission', 1, $3)`,
    [cabinetId, missionId, directeur],
  );
}

/** Cycle commercial et missions de démonstration. Idempotent. */
export async function semerMissions(
  db: Db,
  cabinetId: string,
  ids: Map<Role, string>,
): Promise<void> {
  await semerOpportunites(db, cabinetId, ids.get("chef_mission") ?? null);
  await semerMissionSignee(db, cabinetId, ids);
}
