/**
 * Cas types d'un jeu de règles (STD-05, STD-11) dans l'éditeur sans code : contexte type, règles
 * attendues et conflits attendus. Testé dans `methodes-cas-types.test.ts`.
 */
import {
  casTypeCreationSchema,
  codeReferentielSchema,
  creerTraduire,
  type CasTypeCreation,
  type Langue,
} from "@missionpilot/shared";
import {
  construireContexte,
  saisieDepuisContexte,
  type CasTypeVersion,
  type Facteur,
  type SaisieContexte,
} from "./methodes";
import { aDesErreurs, messageCode } from "./methodes-editeur";
import { lireNombre, type Resultat } from "./saisie";

// --- Cas type --------------------------------------------------------------------------------

export interface SaisieCasType {
  code: string;
  libelle: string;
  contexte: SaisieContexte;
  /** Codes des règles qui doivent se déclencher. */
  regles: string[];
  /** Nombre de conflits non résolus attendu ; vide = non vérifié. */
  conflits: string;
}
/** « code », « libelle », « regles », « conflits » ; les erreurs de contexte sont indexées par code de facteur. */
export type ChampCasType = string;

export const saisieCasTypeVide = (): SaisieCasType => ({
  code: "",
  libelle: "",
  contexte: {},
  regles: [],
  conflits: "",
});

export const saisieDepuisCasType = (c: CasTypeVersion): SaisieCasType => ({
  code: c.code,
  libelle: c.libelle ?? "",
  contexte: saisieDepuisContexte(c.cas.contexte),
  regles: [...(c.cas.attendu.regles_declenchees ?? [])],
  conflits:
    c.cas.attendu.conflits_non_resolus === undefined
      ? ""
      : String(c.cas.attendu.conflits_non_resolus),
});

/**
 * Cas type de l'API. Les attentes que le formulaire ne montre pas (effets présents ou absents,
 * briques de base) sont reprises de `existant` : modifier un cas type n'en supprime rien.
 */
export function construireCasType(
  s: SaisieCasType,
  facteurs: readonly Facteur[],
  reglesConnues: readonly string[],
  existant?: CasTypeVersion["cas"],
  langue: Langue = "fr",
): Resultat<CasTypeCreation, ChampCasType> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampCasType, string>> = {};
  if (!s.libelle.trim()) erreurs.libelle = t("Libellé obligatoire.", "Label required.");
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) erreurs.code = messageCode(langue);
  const contexte = construireContexte(s.contexte, facteurs, langue);
  if (!contexte.ok) Object.assign(erreurs, contexte.erreurs);
  const conflits = s.conflits.trim() === "" ? null : lireNombre(s.conflits);
  if (
    conflits !== null &&
    (Number.isNaN(conflits) || !Number.isInteger(conflits) || conflits < 0)
  ) {
    erreurs.conflits = t("Nombre entier, 0 ou plus.", "Whole number, 0 or more.");
  }
  const regles = s.regles.filter((r) => reglesConnues.includes(r));
  const autresAttentes = existant?.attendu.presents?.length || existant?.attendu.absents?.length;
  if (regles.length === 0 && conflits === null && !autresAttentes) {
    erreurs.regles = t(
      "Cocher au moins une règle attendue, ou indiquer le nombre de conflits.",
      "Select at least one expected rule, or give the number of conflicts.",
    );
  }
  if (aDesErreurs(erreurs) || !contexte.ok) return { ok: false, erreurs };
  const p = casTypeCreationSchema.safeParse({
    code: s.code.trim(),
    libelle: s.libelle.trim(),
    contexte: contexte.charge,
    ...(existant?.briques_de_base ? { briques_de_base: existant.briques_de_base } : {}),
    attendu: {
      ...(existant?.attendu.presents ? { presents: existant.attendu.presents } : {}),
      ...(existant?.attendu.absents ? { absents: existant.attendu.absents } : {}),
      ...(regles.length > 0 ? { regles_declenchees: regles } : {}),
      ...(conflits !== null ? { conflits_non_resolus: conflits } : {}),
    },
  });
  return p.success
    ? { ok: true, charge: p.data }
    : {
        ok: false,
        erreurs: {
          regles: t(
            "Cas type refusé : vérifier les champs.",
            "Test case rejected: check the fields.",
          ),
        },
      };
}
