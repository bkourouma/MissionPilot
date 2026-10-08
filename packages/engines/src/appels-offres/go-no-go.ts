import {
  borner100,
  diviserArrondi,
  ErreurAppelsOffres,
  estEntierNaturel,
  pourCentPlancher,
} from "./commun";

/**
 * Score go/no-go d'un appel d'offres (AO-02) : DÉTERMINISTE, de 0 à 100, sur cinq critères
 * notés chacun de 0 à 100. La décision reste celle de l'associé : le moteur RECOMMANDE.
 *
 * - adéquation : note fournie (par défaut le score de rapprochement AO-01) ;
 * - références : pertinentes / exigées (100 au-delà ; sans exigence : 100 s'il y en a, 50 sinon) ;
 * - charge : jours disponibles / jours requis (100 au-delà ou sans besoin) ;
 * - marge estimée (points de base, 1 % = 100) : 0 si nulle ou négative, 100 à la cible ou
 *   au-delà, proportionnelle entre les deux ; FACULTATIVE (donnée FIN-02 : sans elle, le critère
 *   n'est pas évalué et son poids est retiré du dénominateur) ;
 * - concurrence connue : 100 − 10 par concurrent ordinaire − 25 par concurrent fort, bornée à 0.
 *
 * Score = Σ poids × note / Σ poids des critères évalués, arrondi à l'entier (moitié vers le
 * haut). Critères éliminatoires (recommandation « no_go » quel que soit le score) : marge nulle
 * ou négative, références exigées non atteintes. Sinon : « go » à partir de `seuilGo`,
 * « a_examiner » à partir de `seuilExamen`, « no_go » en deçà. Poids et seuils : valeurs de
 * départ à calibrer au pilote.
 */

export const CRITERES_GO_NO_GO = [
  "adequation",
  "references",
  "charge",
  "marge",
  "concurrence",
] as const;
export type CritereGoNoGo = (typeof CRITERES_GO_NO_GO)[number];

export const RECOMMANDATIONS_GO_NO_GO = ["go", "a_examiner", "no_go"] as const;
export type RecommandationGoNoGo = (typeof RECOMMANDATIONS_GO_NO_GO)[number];

export const ELIMINATOIRES_GO_NO_GO = ["marge_non_positive", "references_insuffisantes"] as const;
export type EliminatoireGoNoGo = (typeof ELIMINATOIRES_GO_NO_GO)[number];

export interface ParametresGoNoGo {
  poids: Readonly<Record<CritereGoNoGo, number>>;
  seuilGo: number;
  seuilExamen: number;
}

export const PARAMETRES_GO_NO_GO_DEFAUT: ParametresGoNoGo = {
  poids: { adequation: 30, references: 25, charge: 15, marge: 20, concurrence: 10 },
  seuilGo: 65,
  seuilExamen: 50,
};

/** Marge : bornes en points de base (−100 % à +100 %). */
export const MARGE_BP_MIN = -10_000;
export const MARGE_BP_MAX = 10_000;

export interface EntreesGoNoGo {
  adequation: number;
  references: { pertinentes: number; exigees: number };
  charge: { joursDisponibles: number; joursRequis: number };
  marge: { tauxBp: number; cibleBp: number } | null;
  concurrence: { connus: number; forts: number };
}

export interface NoteCritere {
  critere: CritereGoNoGo;
  poids: number;
  /** Note de 0 à 100, `null` si le critère n'est pas évalué. */
  note: number | null;
}

export interface ResultatGoNoGo {
  score: number;
  recommandation: RecommandationGoNoGo;
  criteres: NoteCritere[];
  eliminatoires: EliminatoireGoNoGo[];
}

const invalide = (message: string) => new ErreurAppelsOffres("ENTREE_INVALIDE", message);

function verifierEntrees(e: EntreesGoNoGo): void {
  if (!estEntierNaturel(e.adequation) || e.adequation > 100) {
    throw invalide("L'adéquation est une note entière de 0 à 100.");
  }
  const entiers = [
    e.references.pertinentes,
    e.references.exigees,
    e.charge.joursDisponibles,
    e.charge.joursRequis,
    e.concurrence.connus,
    e.concurrence.forts,
  ];
  if (!entiers.every(estEntierNaturel)) {
    throw invalide("Références, jours et concurrents sont des entiers positifs ou nuls.");
  }
  if (e.concurrence.forts > e.concurrence.connus) {
    throw invalide("Les concurrents forts font partie des concurrents connus.");
  }
  if (e.marge) {
    const { tauxBp, cibleBp } = e.marge;
    if (!Number.isSafeInteger(tauxBp) || tauxBp < MARGE_BP_MIN || tauxBp > MARGE_BP_MAX) {
      throw invalide("La marge estimée est comprise entre −100 % et 100 %.");
    }
    if (!Number.isSafeInteger(cibleBp) || cibleBp < 1 || cibleBp > MARGE_BP_MAX) {
      throw invalide("La marge cible est comprise entre 0,01 % et 100 %.");
    }
  }
}

function verifierParametres(p: ParametresGoNoGo): void {
  const poids = CRITERES_GO_NO_GO.map((c) => p.poids[c]);
  if (!poids.every(estEntierNaturel) || poids.reduce((n, x) => n + x, 0) === 0) {
    throw invalide("Les poids sont des entiers positifs ou nuls, non tous nuls.");
  }
  const seuils = [p.seuilGo, p.seuilExamen];
  if (!seuils.every((s) => estEntierNaturel(s) && s <= 100) || p.seuilExamen > p.seuilGo) {
    throw invalide("Seuils entiers de 0 à 100, le seuil d'examen ne dépassant pas celui du go.");
  }
}

function noteReferences(r: EntreesGoNoGo["references"]): number {
  if (r.exigees === 0) return r.pertinentes > 0 ? 100 : 50;
  return pourCentPlancher(r.pertinentes, r.exigees);
}

function noteCharge(c: EntreesGoNoGo["charge"]): number {
  if (c.joursRequis === 0) return 100;
  return pourCentPlancher(c.joursDisponibles, c.joursRequis);
}

function noteMarge(m: NonNullable<EntreesGoNoGo["marge"]>): number {
  if (m.tauxBp <= 0) return 0;
  return pourCentPlancher(m.tauxBp, m.cibleBp);
}

function noteConcurrence(c: EntreesGoNoGo["concurrence"]): number {
  return borner100(100 - 10 * (c.connus - c.forts) - 25 * c.forts);
}

/** Notes, score et recommandation go/no-go. */
export function evaluerGoNoGo(
  entrees: EntreesGoNoGo,
  parametres: ParametresGoNoGo = PARAMETRES_GO_NO_GO_DEFAUT,
): ResultatGoNoGo {
  verifierEntrees(entrees);
  verifierParametres(parametres);
  const notes: Record<CritereGoNoGo, number | null> = {
    adequation: entrees.adequation,
    references: noteReferences(entrees.references),
    charge: noteCharge(entrees.charge),
    marge: entrees.marge ? noteMarge(entrees.marge) : null,
    concurrence: noteConcurrence(entrees.concurrence),
  };
  const criteres = CRITERES_GO_NO_GO.map((critere) => ({
    critere,
    poids: parametres.poids[critere],
    note: notes[critere],
  }));
  const evalues = criteres.filter((c) => c.note !== null && c.poids > 0);
  const denominateur = evalues.reduce((n, c) => n + c.poids, 0);
  const numerateur = evalues.reduce((n, c) => n + c.poids * (c.note as number), 0);
  const score = denominateur === 0 ? 0 : diviserArrondi(numerateur, denominateur);

  const eliminatoires: EliminatoireGoNoGo[] = [];
  if (entrees.marge && entrees.marge.tauxBp <= 0) eliminatoires.push("marge_non_positive");
  if (entrees.references.pertinentes < entrees.references.exigees) {
    eliminatoires.push("references_insuffisantes");
  }
  const recommandation: RecommandationGoNoGo =
    eliminatoires.length > 0 || score < parametres.seuilExamen
      ? "no_go"
      : score >= parametres.seuilGo
        ? "go"
        : "a_examiner";
  return { score, recommandation, criteres, eliminatoires };
}
