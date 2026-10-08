import type { ModeFacturation } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";

/*
 * Catalogue standard d'un cabinet de CONSEIL (cadrage du 2026-10-06 :
 * plan stratégique, audit organisationnel, formation, assistance).
 *
 * VALEURS DE DÉPART À VALIDER PAR LE MÉTIER : les découpages, jours types par
 * grade, équipes types et taux de vente ci-dessous sont des hypothèses de
 * MissionPilot, plausibles pour un cabinet de la zone UEMOA, pas des données
 * fournies par un cabinet. Chaque grade et type inséré porte `a_valider = true`
 * jusqu'à ce qu'un associé ou un expert métier le valide.
 */

interface GradeDepart {
  code: string;
  libelle: string;
  ordre: number;
  /** Taux de vente journalier standard, en FCFA (XOF), hors taxes. */
  taux: number;
}

export const GRADES_DEPART: readonly GradeDepart[] = [
  { code: "stagiaire", libelle: "Stagiaire", ordre: 10, taux: 40_000 },
  { code: "junior", libelle: "Consultant junior", ordre: 20, taux: 100_000 },
  { code: "senior", libelle: "Consultant senior", ordre: 30, taux: 175_000 },
  { code: "manager", libelle: "Manager", ordre: 40, taux: 275_000 },
  { code: "directeur", libelle: "Directeur", ordre: 50, taux: 400_000 },
  { code: "associe", libelle: "Associé", ordre: 60, taux: 550_000 },
];

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

export const TYPES_DEPART: readonly TypeDepart[] = [
  {
    code: "plan_strategique",
    libelle: "Plan stratégique",
    domaine: "Stratégie",
    mode_facturation: "forfait",
    duree_type_jours: 90,
    equipe_type: [
      { grade_code: "associe", nombre: 1 },
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      phase("Cadrage et lancement", [
        lot("Cadrage", [
          t(
            "Réunion de lancement avec la direction",
            { associe: 0.5, manager: 1, senior: 1 },
            { jalon: true },
          ),
          t("Note de cadrage et planning détaillé", { manager: 1, senior: 1 }, { livrable: true }),
        ]),
      ]),
      phase("Diagnostic stratégique", [
        lot("Diagnostic externe", [
          t("Analyse de l'environnement (PESTEL)", { senior: 2, junior: 3 }),
          t("Analyse du marché et de la concurrence", { senior: 2, junior: 4 }),
        ]),
        lot("Diagnostic interne", [
          t("Entretiens avec la direction et les cadres", { manager: 2, senior: 3, junior: 3 }),
          t("Analyse financière historique (3 à 5 exercices)", { senior: 3, junior: 3 }),
          t("Analyse de l'organisation et des ressources", { senior: 2, junior: 2 }),
        ]),
        lot("Synthèse du diagnostic", [
          t(
            "Rapport de diagnostic et matrice SWOT",
            { associe: 1, manager: 2, senior: 2 },
            { livrable: true },
          ),
          t("Restitution du diagnostic", { associe: 0.5, manager: 1, senior: 1 }, { jalon: true }),
        ]),
      ]),
      phase("Formulation stratégique", [
        lot("Vision et orientations", [
          t("Atelier vision, mission et valeurs", { associe: 1, manager: 1, senior: 1 }),
          t("Axes et objectifs stratégiques", { associe: 1, manager: 2, senior: 2 }),
        ]),
        lot("Validation des orientations", [
          t(
            "Séminaire de validation avec le comité de direction",
            { associe: 1, manager: 1, senior: 1 },
            { jalon: true },
          ),
        ]),
      ]),
      phase("Plan d'actions et modèle financier", [
        lot("Plan d'actions", [
          t("Plan d'actions opérationnel et indicateurs de suivi", {
            manager: 2,
            senior: 3,
            junior: 2,
          }),
        ]),
        lot("Projections financières", [
          t("Modèle financier prévisionnel sur l'horizon du plan", {
            manager: 1,
            senior: 3,
            junior: 3,
          }),
        ]),
        lot("Document final", [
          t(
            "Rédaction du plan stratégique",
            { associe: 1, manager: 2, senior: 2 },
            { livrable: true },
          ),
          t("Restitution finale", { associe: 1, manager: 1 }, { jalon: true }),
        ]),
      ]),
    ],
  },
  {
    code: "audit_organisationnel",
    libelle: "Audit organisationnel",
    domaine: "Organisation",
    mode_facturation: "forfait",
    duree_type_jours: 45,
    equipe_type: [
      { grade_code: "directeur", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
      { grade_code: "junior", nombre: 1 },
    ],
    phases: [
      phase("Cadrage", [
        lot("Lancement", [
          t("Réunion de lancement", { directeur: 0.5, senior: 1 }, { jalon: true }),
          t("Collecte de la documentation (organigramme, procédures, fiches de poste)", {
            junior: 2,
          }),
        ]),
      ]),
      phase("Analyse de l'existant", [
        lot("Structure et processus", [
          t("Revue documentaire", { senior: 2, junior: 3 }),
          t("Entretiens individuels et focus groups", { directeur: 1, senior: 4, junior: 4 }),
          t("Cartographie des processus clés", { senior: 3, junior: 3 }),
        ]),
        lot("Ressources humaines", [
          t("Analyse des effectifs, des postes et des compétences", { senior: 2, junior: 2 }),
        ]),
      ]),
      phase("Recommandations", [
        lot("Rapport d'audit", [
          t(
            "Rapport provisoire et recommandations",
            { directeur: 2, senior: 3, junior: 1 },
            { livrable: true },
          ),
          t("Restitution au comité de direction", { directeur: 1, senior: 1 }, { jalon: true }),
          t("Rapport définitif", { directeur: 1, senior: 1 }, { livrable: true }),
        ]),
      ]),
    ],
  },
  {
    code: "formation",
    libelle: "Formation",
    domaine: "Formation",
    mode_facturation: "forfait",
    duree_type_jours: 30,
    equipe_type: [
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
    ],
    phases: [
      phase("Ingénierie pédagogique", [
        lot("Analyse des besoins", [
          t("Recueil des besoins de formation", { manager: 0.5, senior: 1 }),
          t("Programme et objectifs pédagogiques", { manager: 1, senior: 1 }, { livrable: true }),
        ]),
        lot("Conception", [
          t(
            "Supports de formation et cas pratiques",
            { manager: 1, senior: 3 },
            { livrable: true },
          ),
        ]),
      ]),
      phase("Animation", [
        lot("Sessions", [
          t("Animation des sessions de formation", { manager: 2, senior: 3 }, { jalon: true }),
          t("Logistique et listes d'émargement", { senior: 0.5 }),
        ]),
      ]),
      phase("Évaluation", [
        lot("Bilan", [
          t("Évaluation à chaud des participants", { senior: 0.5 }),
          t("Rapport de fin de formation", { manager: 0.5, senior: 1 }, { livrable: true }),
        ]),
      ]),
    ],
  },
  {
    code: "assistance",
    libelle: "Assistance / accompagnement",
    domaine: "Accompagnement",
    mode_facturation: "abonnement",
    duree_type_jours: 180,
    equipe_type: [
      { grade_code: "manager", nombre: 1 },
      { grade_code: "senior", nombre: 1 },
    ],
    phases: [
      phase("Démarrage", [
        lot("Diagnostic initial", [
          t("Réunion de démarrage", { manager: 0.5, senior: 0.5 }, { jalon: true }),
          t(
            "Diagnostic rapide et plan d'accompagnement",
            { manager: 1, senior: 2 },
            { livrable: true },
          ),
        ]),
      ]),
      phase("Accompagnement opérationnel", [
        lot("Interventions périodiques", [
          t("Interventions sur site ou à distance", { manager: 3, senior: 8 }),
          t("Points de suivi mensuels avec la direction", { manager: 3 }),
        ]),
        lot("Reporting", [t("Notes de suivi mensuelles", { senior: 3 }, { livrable: true })]),
      ]),
      phase("Bilan", [
        lot("Clôture", [
          t("Rapport de bilan de l'accompagnement", { manager: 1, senior: 1 }, { livrable: true }),
          t("Réunion de clôture", { manager: 0.5 }, { jalon: true }),
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
 * Insère les grades par défaut et le catalogue conseil dans le cabinet.
 * Idempotent : un grade ou un type dont le code existe déjà n'est pas touché.
 * À appeler dans une transaction `withTenant(cabinetId, …)`.
 */
export async function semerCatalogueConseil(
  db: Db,
  cabinetId: string,
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
  for (const type of TYPES_DEPART) {
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
