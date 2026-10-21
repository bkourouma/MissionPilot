/**
 * Modification additive d'un facteur de contexte du cabinet (STD-04, STD-11) : on corrige les
 * textes, on ajoute des valeurs, on élargit les bornes, on ne retire ni ne resserre rien. Testé
 * dans `methodes-facteurs.test.ts`.
 */
import {
  codeReferentielSchema,
  facteurModificationSchema,
  VALEURS_LISTE_MAX,
  type FacteurModification,
} from "@missionpilot/shared";
import type { Facteur } from "./methodes";
import { aDesErreurs, vide } from "./methodes-editeur";
import { lireNombre, type Resultat } from "./saisie";

// --- Facteur du cabinet : modification additive ----------------------------------------------

export interface SaisieModificationFacteur {
  libelle: string;
  description: string;
  /** Valeurs à AJOUTER, une par ligne : « code : libellé ». */
  nouvelles: string;
  min: string;
  max: string;
}
export type ChampModificationFacteur = "libelle" | "description" | "nouvelles" | "min" | "max";

export const saisieModificationFacteur = (f: Facteur): SaisieModificationFacteur => ({
  libelle: f.libelle,
  description: f.description ?? "",
  nouvelles: "",
  min: f.min === null ? "" : String(f.min).replace(".", ","),
  max: f.max === null ? "" : String(f.max).replace(".", ","),
});

/** Lignes « code : libellé » → valeurs ; une ligne sans libellé reprend son code. */
export function lireNouvellesValeurs(texte: string): { code: string; libelle: string }[] {
  return texte
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) => {
      const [code, ...reste] = l.split(":");
      const c = (code ?? "").trim();
      return { code: c, libelle: reste.join(":").trim() || c };
    });
}

function erreurValeurs(f: Facteur, nouvelles: readonly { code: string }[]): string | undefined {
  const codes = (f.valeurs ?? []).map((v) => v.code);
  if (nouvelles.some((v) => !codeReferentielSchema.safeParse(v.code).success)) {
    return "Une valeur par ligne, « code : libellé », code en minuscules.";
  }
  const doublon = nouvelles.find(
    (v, i) => codes.includes(v.code) || nouvelles.findIndex((x) => x.code === v.code) !== i,
  );
  if (doublon) return `La valeur « ${doublon.code} » existe déjà.`;
  if (codes.length + nouvelles.length > VALEURS_LISTE_MAX) {
    return `Une liste compte ${VALEURS_LISTE_MAX} valeurs au plus.`;
  }
  return undefined;
}

/** Une borne ne peut qu'être élargie ou levée, jamais resserrée ni ajoutée. */
function erreurBorne(
  nom: "minimale" | "maximale",
  actuelle: number | null,
  saisie: string,
): { erreur?: string; valeur?: number | null } {
  const brut = saisie.trim() === "" ? null : lireNombre(saisie);
  if (brut !== null && Number.isNaN(brut)) return { erreur: "Nombre attendu." };
  if (brut === actuelle) return {};
  if (actuelle === null) {
    return { erreur: `Pas de borne ${nom} aujourd'hui : en poser une resserrerait le facteur.` };
  }
  if (brut === null) return { valeur: null };
  const resserre = nom === "minimale" ? brut > actuelle : brut < actuelle;
  return resserre
    ? {
        erreur: `La borne ${nom} ne peut que s'élargir (actuellement ${String(actuelle).replace(".", ",")}).`,
      }
    : { valeur: brut };
}

/** Saisie → corps de `PATCH /api/standard/facteurs/:id` (liste de valeurs COMPLÈTE). */
export function construireModificationFacteur(
  f: Facteur,
  s: SaisieModificationFacteur,
): Resultat<FacteurModification, ChampModificationFacteur> {
  const erreurs: Partial<Record<ChampModificationFacteur, string>> = {};
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  const avecValeurs = f.type === "enumeration" || f.type === "liste";
  const nouvelles = avecValeurs ? lireNouvellesValeurs(s.nouvelles) : [];
  const ev = erreurValeurs(f, nouvelles);
  if (ev) erreurs.nouvelles = ev;
  const min = f.type === "nombre" ? erreurBorne("minimale", f.min, s.min) : {};
  const max = f.type === "nombre" ? erreurBorne("maximale", f.max, s.max) : {};
  if (min.erreur) erreurs.min = min.erreur;
  if (max.erreur) erreurs.max = max.erreur;
  if (aDesErreurs(erreurs)) return { ok: false, erreurs };
  const p = facteurModificationSchema.safeParse({
    libelle: s.libelle.trim(),
    description: vide(s.description),
    ...(nouvelles.length > 0 ? { valeurs: [...(f.valeurs ?? []), ...nouvelles] } : {}),
    ...(min.valeur !== undefined ? { min: min.valeur } : {}),
    ...(max.valeur !== undefined ? { max: max.valeur } : {}),
  });
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { libelle: "Modification refusée : vérifier les champs." } };
}
