import type { ModeFacturation } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { GRADES_DEPART } from "./catalogue-conseil.js";

/*
 * Types de mission de départ des SERVICES CANDIDATS (PRD complémentaire §11.6, décision n° 6) :
 * DIAGNOSTIC FLASH (5 jours-homme, prix fixe) et BUSINESS PLAN BANCABLE. Même format et même
 * principe que `catalogue-conseil.ts` (non modifié : `test/catalogue.test.ts` y compte quatre types).
 *
 * VALEURS DE DÉPART À VALIDER PAR UN EXPERT : les découpages, jours par grade, équipes types et
 * durées ci-dessous sont des hypothèses de MissionPilot, pas des données fournies par un cabinet.
 * Chaque type inséré porte `a_valider = true` jusqu'à validation par un associé ou un expert métier.
 * La méthode (étapes, briques, règles) vit dans le STANDARD (migrations 0560 et 0561), pas ici :
 * ce fichier ne fournit que le modèle de planification et de budget de la mission.
 */

type Jours = Record<string, number>;

interface ElementDepart {
  libelle: string;
  jours?: Jours;
  livrable?: boolean;
  jalon?: boolean;
  enfants?: ElementDepart[];
}

interface TypeDepart {
  code: string;
  libelle: string;
  domaine: string;
  mode_facturation: ModeFacturation;
  duree_type_jours: number;
  equipe_type: { grade_code: string; nombre: number }[];
  phases: ElementDepart[];
}

const t = (libelle: string, jours: Jours, opts: Partial<ElementDepart> = {}): ElementDepart => ({
  libelle,
  jours,
  ...opts,
});
const lot = (libelle: string, enfants: ElementDepart[]): ElementDepart => ({ libelle, enfants });
const phase = (libelle: string, enfants: ElementDepart[]): ElementDepart => ({ libelle, enfants });

export const TYPES_SERVICES_CANDIDATS: readonly TypeDepart[] = [
  {
    // 5 jours-homme au total : cadrage 0,5 ; collecte 2 ; analyse 1,5 ; rapport 0,5 ; restitution 0,5.
    code: "diagnostic_flash",
    libelle: "Diagnostic flash",
    domaine: "Diagnostic",
    mode_facturation: "forfait",
    duree_type_jours: 7,
    equipe_type: [
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      phase("Cadrage", [
        lot("Cadrage de la mission", [
          t("Appel de cadrage et liste des documents à fournir", { manager: 0.25, senior: 0.25 }),
        ]),
      ]),
      phase("Collecte", [
        lot("Collecte des éléments", [
          t("Revue des documents financiers et administratifs", { senior: 0.5, junior: 1 }),
          t("Entretien avec le dirigeant", { associe: 0.25, manager: 0.25, senior: 0.25 }),
        ]),
      ]),
      phase("Analyse", [
        lot("Analyse rapide", [
          t("Analyse financière rapide (rentabilité, trésorerie, endettement)", {
            senior: 0.5,
            junior: 0.5,
          }),
          t("Forces, faiblesses et risques majeurs", { manager: 0.25, senior: 0.25 }),
        ]),
      ]),
      phase("Rapport court", [
        lot("Rapport", [
          t(
            "Rapport court de diagnostic et priorités d'action",
            { manager: 0.25, senior: 0.25 },
            { livrable: true },
          ),
        ]),
      ]),
      phase("Restitution", [
        lot("Restitution au dirigeant", [
          t("Restitution et recommandations", { associe: 0.25, manager: 0.25 }, { jalon: true }),
        ]),
      ]),
    ],
  },
  {
    code: "business_plan_bancable",
    libelle: "Business plan bancable",
    domaine: "Financement",
    mode_facturation: "forfait",
    duree_type_jours: 40,
    equipe_type: [
      { grade_code: "associe", nombre: 1 },
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      phase("Cadrage", [
        lot("Cadrage du projet de financement", [
          t(
            "Réunion de lancement et définition du besoin de financement",
            { associe: 0.5, manager: 1, senior: 1 },
            { jalon: true },
          ),
          t(
            "Note de cadrage et liste des pièces à réunir",
            { manager: 0.5, senior: 1 },
            { livrable: true },
          ),
        ]),
      ]),
      phase("Diagnostic financier", [
        lot("Historique", [
          t("Reconstitution et retraitement des états financiers historiques", {
            senior: 3,
            junior: 3,
          }),
          t("Analyse de la rentabilité, de la structure financière et de l'endettement", {
            manager: 1,
            senior: 2,
          }),
        ]),
        lot("Synthèse du diagnostic", [
          t("Note de diagnostic financier", { manager: 1, senior: 1 }, { livrable: true }),
        ]),
      ]),
      phase("Modèle financier", [
        lot("Hypothèses", [
          t("Étude de marché et hypothèses d'activité validées avec le dirigeant", {
            manager: 1,
            senior: 2,
            junior: 2,
          }),
        ]),
        lot("Projections", [
          t("Modèle financier prévisionnel (compte de résultat, bilan, trésorerie)", {
            manager: 1,
            senior: 4,
            junior: 3,
          }),
          t("Scénarios et sensibilités", { manager: 0.5, senior: 1.5 }),
        ]),
      ]),
      phase("Bancabilité et plan de financement", [
        lot("Capacité de remboursement", [
          t("Analyse de la capacité de remboursement et des ratios attendus par les financeurs", {
            manager: 1,
            senior: 2,
          }),
        ]),
        lot("Plan de financement", [
          t("Plan de financement, structure de la dette et des fonds propres", {
            associe: 0.5,
            manager: 1,
            senior: 1.5,
          }),
        ]),
      ]),
      phase("Dossier et recherche de financement", [
        lot("Dossier de financement", [
          t(
            "Rédaction du business plan et du dossier de présentation",
            { associe: 1, manager: 2, senior: 3, junior: 2 },
            { livrable: true },
          ),
        ]),
        lot("Recherche de financement", [
          t("Identification des guichets compatibles et préparation des dossiers", {
            manager: 1,
            senior: 2,
            junior: 1,
          }),
        ]),
      ]),
      phase("Restitution", [
        lot("Restitution finale", [
          t(
            "Restitution au dirigeant et remise du dossier",
            { associe: 1, manager: 1 },
            { jalon: true },
          ),
        ]),
      ]),
    ],
  },
];

async function insererElements(
  db: Db,
  cabinetId: string,
  typeId: string,
  elements: readonly ElementDepart[],
  parentId: string | null,
  niveau: number,
): Promise<void> {
  for (const [i, e] of elements.entries()) {
    const r = await db.query(
      `INSERT INTO modele_elements (cabinet_id, type_mission_id, parent_id, niveau, libelle, ordre,
         jours_par_grade, est_livrable, est_jalon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        cabinetId,
        typeId,
        parentId,
        niveau,
        e.libelle,
        (i + 1) * 10,
        JSON.stringify(e.jours ?? {}),
        e.livrable ?? false,
        e.jalon ?? false,
      ],
    );
    if (e.enfants)
      await insererElements(db, cabinetId, typeId, e.enfants, r.rows[0].id, niveau + 1);
  }
}

/**
 * Insère les types de mission des services candidats dans le cabinet, après avoir semé les grades
 * manquants (le catalogue de conseil n'est pas forcément semé). Idempotent : un grade ou un type
 * dont le code existe déjà n'est pas touché. À appeler dans une transaction `withTenant(cabinetId, …)`.
 */
export async function semerTypesServicesCandidats(
  db: Db,
  cabinetId: string,
  code?: string,
): Promise<{ grades: number; types: number }> {
  let grades = 0;
  for (const g of GRADES_DEPART) {
    const r = await db.query(
      `INSERT INTO grades (cabinet_id, code, libelle, ordre, taux_vente_standard, devise, a_valider)
       VALUES ($1, $2, $3, $4, $5, 'XOF', true) ON CONFLICT (cabinet_id, code) DO NOTHING`,
      [cabinetId, g.code, g.libelle, g.ordre, g.taux],
    );
    grades += r.rowCount ?? 0;
  }
  let types = 0;
  for (const type of TYPES_SERVICES_CANDIDATS) {
    if (code !== undefined && type.code !== code) continue;
    const r = await db.query(
      `INSERT INTO types_mission (cabinet_id, code, libelle, domaine, mode_facturation,
         duree_type_jours, equipe_type, a_valider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (cabinet_id, code) DO NOTHING RETURNING id`,
      [
        cabinetId,
        type.code,
        type.libelle,
        type.domaine,
        type.mode_facturation,
        type.duree_type_jours,
        JSON.stringify(type.equipe_type),
      ],
    );
    if (!r.rows[0]) continue;
    types += 1;
    await insererElements(db, cabinetId, r.rows[0].id, type.phases, null, 1);
  }
  return { grades, types };
}
