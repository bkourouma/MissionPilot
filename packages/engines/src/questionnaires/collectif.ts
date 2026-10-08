/**
 * Modes de réponse (SOC-10) et réponse collective.
 *
 * - `individuel` : chaque répondant a ses propres réponses.
 * - `par_fonction` : idem, mais chaque répondant porte obligatoirement un
 *   libellé de fonction (DECISIONS.md, V2 « règles posées »).
 * - `collectif` : UNE réponse partagée que plusieurs contributeurs complètent
 *   en brouillon ; elle est verrouillée à la première soumission, toute
 *   modification ou seconde soumission est refusée (`DEJA_SOUMISE`).
 *
 * Les états rendus sont figés (`Object.freeze`) : chaque opération renvoie un
 * nouvel état, l'ancien reste intact.
 */
import { analyserDateISO, type DateISO } from "../commun/dates";
import { ErreurQuestionnaire, type Anomalie } from "./erreurs";
import { exigerReponsesValides } from "./reponses";
import {
  lireReponse,
  type DefinitionQuestionnaire,
  type Reponses,
  type ValeurReponse,
} from "./types";
import { validerReponse } from "./valeurs";
import { exigerDefinitionValide } from "./definition";

export type ModeQuestionnaire = "individuel" | "collectif" | "par_fonction";

export interface Repondant {
  readonly id: string;
  readonly role?: string;
  readonly fonction?: string;
}

/**
 * Contrôle la liste des répondants d'une campagne : au moins un, identifiants
 * renseignés et uniques, fonction obligatoire en mode `par_fonction`. Rend la
 * liste normalisée (fonction sans espaces de bord).
 */
export function validerRepondants(
  mode: ModeQuestionnaire,
  repondants: readonly Repondant[],
): Repondant[] {
  if (repondants.length === 0) {
    throw new ErreurQuestionnaire("REPONDANT_INVALIDE", "Au moins un répondant est attendu.");
  }
  const vus = new Set<string>();
  return repondants.map((r) => {
    if (r.id.trim() === "" || vus.has(r.id)) {
      throw new ErreurQuestionnaire(
        "REPONDANT_INVALIDE",
        `Répondant vide ou en double : « ${r.id} ».`,
      );
    }
    vus.add(r.id);
    const fonction = r.fonction?.trim() ?? "";
    if (mode === "par_fonction" && fonction === "") {
      throw new ErreurQuestionnaire(
        "FONCTION_OBLIGATOIRE",
        `Le répondant « ${r.id} » doit indiquer sa fonction.`,
      );
    }
    return fonction === "" ? { id: r.id, ...(r.role ? { role: r.role } : {}) } : { ...r, fonction };
  });
}

export interface Signature {
  readonly auteur: string;
  readonly date: DateISO;
}

export interface Contribution extends Signature {
  /** Réponses saisies ; une valeur vide (`null`, "", []) efface la réponse partagée. */
  readonly reponses: Reponses;
}

export interface ReponseCollective {
  readonly statut: "brouillon" | "soumise";
  readonly reponses: Readonly<Record<string, ValeurReponse>>;
  /** Dernier auteur et date de saisie de chaque réponse présente. */
  readonly saisies: Readonly<Record<string, Signature>>;
  readonly soumission: Signature | null;
}

function figer(etat: ReponseCollective): ReponseCollective {
  return Object.freeze({
    statut: etat.statut,
    reponses: Object.freeze({ ...etat.reponses }),
    saisies: Object.freeze({ ...etat.saisies }),
    soumission: etat.soumission === null ? null : Object.freeze({ ...etat.soumission }),
  });
}

function verifierSignature(s: Signature): void {
  if (s.auteur.trim() === "") {
    throw new ErreurQuestionnaire("REPONDANT_INVALIDE", "L'auteur de la saisie est obligatoire.");
  }
  if (!analyserDateISO(s.date).valide) {
    throw new ErreurQuestionnaire("OPTIONS_INVALIDES", `Date de saisie invalide : « ${s.date} ».`);
  }
}

function exigerBrouillon(etat: ReponseCollective): void {
  if (etat.statut === "soumise") {
    throw new ErreurQuestionnaire(
      "DEJA_SOUMISE",
      "La réponse collective est déjà soumise : elle est verrouillée.",
    );
  }
}

/** Réponse collective vierge, en brouillon. */
export function creerReponseCollective(): ReponseCollective {
  return figer({ statut: "brouillon", reponses: {}, saisies: {}, soumission: null });
}

/**
 * Fusionne la contribution d'un répondant dans la réponse partagée : chaque
 * question citée prend la nouvelle valeur (la dernière saisie l'emporte), une
 * valeur vide l'efface. Les valeurs sont validées une à une ; une question
 * inconnue ou une valeur invalide fait refuser toute la contribution. Refuse
 * toute modification après soumission.
 */
export function fusionnerReponses(
  def: DefinitionQuestionnaire,
  etat: ReponseCollective,
  contribution: Contribution,
): ReponseCollective {
  exigerBrouillon(etat);
  verifierSignature(contribution);
  exigerDefinitionValide(def);
  const questions = new Map(
    def.sections.flatMap((s) => s.questions.map((q) => [q.id, q] as const)),
  );
  const reponses: Record<string, ValeurReponse> = { ...etat.reponses };
  const saisies: Record<string, Signature> = { ...etat.saisies };
  const erreurs: Anomalie[] = [];
  const signature = { auteur: contribution.auteur, date: contribution.date };

  for (const id of Object.keys(contribution.reponses).sort()) {
    const q = questions.get(id);
    if (q === undefined) {
      erreurs.push({
        code: "QUESTION_INCONNUE",
        chemin: id,
        message: `Question inconnue : « ${id} ».`,
      });
      continue;
    }
    const r = validerReponse(q, lireReponse(contribution.reponses, id));
    if (!r.valide) {
      erreurs.push({ code: r.code, chemin: id, message: r.message });
    } else if (r.valeur === null) {
      delete reponses[id];
      delete saisies[id];
    } else {
      reponses[id] = r.valeur;
      saisies[id] = signature;
    }
  }
  if (erreurs.length > 0) {
    throw new ErreurQuestionnaire("REPONSES_INVALIDES", "Contribution refusée.", erreurs);
  }
  return figer({ statut: "brouillon", reponses, saisies, soumission: null });
}

/**
 * Soumet la réponse partagée : exige un jeu complet et valide (obligatoires
 * visibles), écarte les réponses aux questions devenues invisibles, puis
 * verrouille. Une seconde soumission lève `DEJA_SOUMISE`.
 */
export function soumettreReponses(
  def: DefinitionQuestionnaire,
  etat: ReponseCollective,
  signature: Signature,
): ReponseCollective {
  exigerBrouillon(etat);
  verifierSignature(signature);
  const reponses = exigerReponsesValides(def, etat.reponses, "soumission");
  const saisies = Object.fromEntries(
    Object.entries(etat.saisies).filter(([id]) =>
      Object.prototype.hasOwnProperty.call(reponses, id),
    ),
  );
  return figer({
    statut: "soumise",
    reponses,
    saisies,
    soumission: { auteur: signature.auteur, date: signature.date },
  });
}
