/**
 * Gardes humaines par classe de risque (QUA-01, QUA-04, PRD complémentaire §10).
 *
 * | Classe | Garde                                                                  |
 * | ------ | ---------------------------------------------------------------------- |
 * | R0     | automatique, journalisée (aucune étape humaine)                        |
 * | R1     | validation de l'auteur                                                 |
 * | R2     | validation du consultant, puis relecture du chef de mission            |
 * | R3     | R2, plus revue d'un second expert (quatre yeux) et signature du        |
 * |        | directeur de mission                                                   |
 *
 * Séparation des tâches : un même acteur ne cumule pas deux rôles de la garde
 * (auteur compris), sauf :
 * - l'auteur qui valide son propre contenu (étape `validation_auteur` de R1,
 *   ou `validation_consultant` : le consultant prend la responsabilité du
 *   brouillon qu'il a fait produire ou rédigé), toujours permis ;
 * - une paire déclarée dans `cumulsPermis` (petit cabinet : directeur qui
 *   relit et signe, par exemple).
 * Le second expert n'est JAMAIS l'auteur ni le valideur (quatre yeux) : ce
 * cumul ne se permet pas.
 *
 * Le moteur ne connaît ni les rôles des personnes ni la mission : l'appelant
 * dit si l'acteur est habilité à l'étape (`habilite`), et journalise lui-même
 * l'application d'une garde R0.
 */
import { CLASSES_RISQUE, estClasseRisque, type ClasseRisque } from "./classes";
import { ErreurQualite } from "./erreurs";

export const ETAPES_GARDE = [
  "validation_auteur",
  "validation_consultant",
  "relecture_chef_mission",
  "revue_second_expert",
  "signature_directeur_mission",
] as const;

export type EtapeGarde = (typeof ETAPES_GARDE)[number];

/** Rôle tenu dans une garde : une étape, ou l'auteur du contenu. */
export type RoleGarde = EtapeGarde | "auteur";

const ETAPES_PAR_CLASSE: Readonly<Record<ClasseRisque, readonly EtapeGarde[]>> = {
  R0: [],
  R1: ["validation_auteur"],
  R2: ["validation_consultant", "relecture_chef_mission"],
  R3: [
    "validation_consultant",
    "relecture_chef_mission",
    "revue_second_expert",
    "signature_directeur_mission",
  ],
};

/** Ordre canonique des rôles (comparaison des paires et ordre des violations). */
const ORDRE_ROLES: readonly RoleGarde[] = ["auteur", ...ETAPES_GARDE];

/** Cumuls toujours permis : l'auteur valide son propre contenu. */
const CUMULS_TOUJOURS_PERMIS: readonly (readonly [RoleGarde, RoleGarde])[] = [
  ["auteur", "validation_auteur"],
  ["auteur", "validation_consultant"],
];

/** Cumuls jamais permis, même déclarés : quatre yeux de la classe R3 (QUA-04). */
const CUMULS_JAMAIS_PERMIS: readonly (readonly [RoleGarde, RoleGarde])[] = [
  ["auteur", "revue_second_expert"],
  ["validation_consultant", "revue_second_expert"],
];

export interface GardeRequise {
  readonly classe: ClasseRisque;
  /** Étapes humaines dans l'ordre où elles se franchissent (vide en R0). */
  readonly etapes: readonly EtapeGarde[];
  /** R0 : exécution automatique sans étape humaine. */
  readonly automatique: boolean;
  /** Toute application de la garde est journalisée, quelle que soit la classe. */
  readonly journalisation: true;
  /** R3 : revue d'un second expert distinct de l'auteur et du valideur. */
  readonly quatreYeux: boolean;
  /** R3 : signature du directeur de mission. */
  readonly signature: boolean;
}

export function gardesRequises(classe: ClasseRisque): GardeRequise {
  verifierClasse(classe);
  const etapes = ETAPES_PAR_CLASSE[classe];
  return {
    classe,
    etapes,
    automatique: etapes.length === 0,
    journalisation: true,
    quatreYeux: etapes.includes("revue_second_expert"),
    signature: etapes.includes("signature_directeur_mission"),
  };
}

export interface ValidationGarde {
  readonly etape: EtapeGarde;
  /** Identifiant stable de la personne (utilisateur). */
  readonly acteur: string;
  /** L'appelant a vérifié que l'acteur tient ce rôle sur la mission (défaut : vrai). */
  readonly habilite?: boolean;
}

export interface OptionsGarde {
  /** Auteur humain du contenu ; `null` ou absent si l'auteur n'est pas une personne (agent). */
  readonly auteur?: string | null;
  /** Paires de rôles qu'un même acteur peut cumuler (cas explicitement permis par le cabinet). */
  readonly cumulsPermis?: readonly (readonly [RoleGarde, RoleGarde])[];
}

export type CodeViolationGarde =
  "AUTEUR_ATTENDU" | "CUMUL_INTERDIT" | "QUATRE_YEUX" | "ETAPE_EN_DOUBLE" | "ACTEUR_NON_HABILITE";

export interface ViolationGarde {
  readonly code: CodeViolationGarde;
  /** Rôles en cause, dans l'ordre canonique. */
  readonly roles: readonly RoleGarde[];
  readonly acteur: string;
}

export interface EvaluationGarde {
  readonly classe: ClasseRisque;
  readonly automatique: boolean;
  /** Toutes les étapes requises sont faites et aucune règle n'est violée. */
  readonly complete: boolean;
  readonly etapesRequises: readonly EtapeGarde[];
  /** Étapes requises déjà franchies, dans l'ordre canonique. */
  readonly etapesFaites: readonly EtapeGarde[];
  readonly manquantes: readonly EtapeGarde[];
  /** Première étape manquante dans l'ordre canonique, `null` si aucune. */
  readonly prochaineEtape: EtapeGarde | null;
  readonly violations: readonly ViolationGarde[];
  /** Validations d'étapes que la classe n'exige pas (sans effet, signalées). */
  readonly etapesSuperflues: readonly EtapeGarde[];
}

function verifierClasse(classe: unknown): asserts classe is ClasseRisque {
  if (!estClasseRisque(classe)) {
    throw new ErreurQualite(
      "CLASSE_INVALIDE",
      `Classe de risque inconnue (attendu ${CLASSES_RISQUE.join(", ")}).`,
    );
  }
}

function estEtape(valeur: unknown): valeur is EtapeGarde {
  return typeof valeur === "string" && (ETAPES_GARDE as readonly string[]).includes(valeur);
}

function verifierValidations(validations: readonly ValidationGarde[]): void {
  for (const v of validations) {
    if (!estEtape(v.etape)) {
      throw new ErreurQualite("VALIDATION_INVALIDE", "Étape de garde inconnue.");
    }
    if (typeof v.acteur !== "string" || v.acteur === "") {
      throw new ErreurQualite("VALIDATION_INVALIDE", "Acteur de la validation absent.");
    }
  }
}

function clePaire(a: RoleGarde, b: RoleGarde): string {
  return ORDRE_ROLES.indexOf(a) <= ORDRE_ROLES.indexOf(b) ? `${a}|${b}` : `${b}|${a}`;
}

function verifierCumulsPermis(cumuls: readonly (readonly [RoleGarde, RoleGarde])[]): Set<string> {
  const cles = new Set<string>();
  for (const paire of cumuls) {
    const [a, b] = paire;
    if (!ORDRE_ROLES.includes(a) || !ORDRE_ROLES.includes(b) || a === b) {
      throw new ErreurQualite("OPTIONS_INVALIDES", "Cumul permis mal formé.");
    }
    cles.add(clePaire(a, b));
  }
  return cles;
}

/** Violations de séparation des tâches entre les rôles tenus par un même acteur. */
function violationsCumul(
  tenus: ReadonlyMap<RoleGarde, string>,
  permis: ReadonlySet<string>,
): ViolationGarde[] {
  const toujours = new Set(CUMULS_TOUJOURS_PERMIS.map(([a, b]) => clePaire(a, b)));
  const jamais = new Set(CUMULS_JAMAIS_PERMIS.map(([a, b]) => clePaire(a, b)));
  const violations: ViolationGarde[] = [];
  const roles = ORDRE_ROLES.filter((r) => tenus.has(r));
  roles.forEach((a, i) => {
    for (const b of roles.slice(i + 1)) {
      const acteur = tenus.get(a)!;
      if (acteur !== tenus.get(b)) continue;
      const cle = clePaire(a, b);
      if (jamais.has(cle)) violations.push({ code: "QUATRE_YEUX", roles: [a, b], acteur });
      else if (!toujours.has(cle) && !permis.has(cle)) {
        violations.push({ code: "CUMUL_INTERDIT", roles: [a, b], acteur });
      }
    }
  });
  return violations;
}

/**
 * Évalue les validations reçues contre la garde de la classe : étapes
 * manquantes, prochaine étape, violations (auteur attendu, cumuls, quatre
 * yeux, doublons, acteur non habilité). Pur : aucune horloge, ordre stable.
 */
export function evaluerGarde(
  classe: ClasseRisque,
  validations: readonly ValidationGarde[],
  options: OptionsGarde = {},
): EvaluationGarde {
  const garde = gardesRequises(classe);
  verifierValidations(validations);
  const permis = verifierCumulsPermis(options.cumulsPermis ?? []);
  const auteur = options.auteur ?? null;
  const violations: ViolationGarde[] = [];
  const parEtape = new Map<EtapeGarde, ValidationGarde>();
  const superflues = new Set<EtapeGarde>();

  for (const v of validations) {
    if (!garde.etapes.includes(v.etape)) {
      superflues.add(v.etape);
      continue;
    }
    if (parEtape.has(v.etape)) {
      violations.push({ code: "ETAPE_EN_DOUBLE", roles: [v.etape], acteur: v.acteur });
      continue;
    }
    parEtape.set(v.etape, v);
    if (v.habilite === false) {
      violations.push({ code: "ACTEUR_NON_HABILITE", roles: [v.etape], acteur: v.acteur });
    }
    if (v.etape === "validation_auteur" && auteur !== null && v.acteur !== auteur) {
      violations.push({ code: "AUTEUR_ATTENDU", roles: [v.etape], acteur: v.acteur });
    }
  }

  const tenus = new Map<RoleGarde, string>();
  if (auteur !== null) tenus.set("auteur", auteur);
  for (const [etape, v] of parEtape) tenus.set(etape, v.acteur);
  violations.push(...violationsCumul(tenus, permis));

  const etapesFaites = garde.etapes.filter((e) => parEtape.has(e));
  const manquantes = garde.etapes.filter((e) => !parEtape.has(e));
  return {
    classe,
    automatique: garde.automatique,
    complete: manquantes.length === 0 && violations.length === 0,
    etapesRequises: garde.etapes,
    etapesFaites,
    manquantes,
    prochaineEtape: manquantes[0] ?? null,
    violations,
    etapesSuperflues: ETAPES_GARDE.filter((e) => superflues.has(e)),
  };
}
