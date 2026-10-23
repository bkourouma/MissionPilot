/**
 * Éditeur de méthodes sans code (STD-11), suite de `methodes.ts` : formulaires d'étape, de brique,
 * de règle (relecture) et d'élément, en création comme en modification en place. Chaque fonction
 * transforme une saisie en corps de requête validé par le schéma partagé de l'API ; aucun calcul
 * métier, l'API et les moteurs restent seuls juges. Rubriques : `methodes-rubriques.ts`, cas types :
 * `methodes-cas-types.ts`, facteurs : `methodes-facteurs.ts`. Testé dans `methodes-editeur.test.ts`.
 */
import {
  briqueModificationSchema,
  codeReferentielSchema,
  elementMethodeCreationSchema,
  elementMethodeModificationSchema,
  etapeCreationSchema,
  etapeModificationSchema,
  type ConditionModulationApi,
  type EffetModulationApi,
  type RegleModulationApi,
  type TypeElementMethode,
} from "@missionpilot/shared";
import {
  validerBrique,
  type BriqueVersion,
  type ChampBrique,
  type ElementVersion,
  type EtapeVersion,
  type SaisieBrique,
  type SaisieComparaison,
  type SaisieEffet,
  type SaisieRegle,
  type TypeEffetEditeur,
} from "./methodes";
import type { Resultat } from "./saisie";

export const MESSAGE_CODE = "Code : minuscules, chiffres, « _ », « . » ou « - ».";
export const vide = (v: string) => (v.trim() === "" ? null : v.trim());
export const aDesErreurs = (e: object) => Object.keys(e).length > 0;

// --- Étape -----------------------------------------------------------------------------------

export interface SaisieEtape {
  code: string;
  libelle: string;
  description: string;
}
export type ChampEtape = "code" | "libelle" | "description";

export const saisieEtapeVide = (): SaisieEtape => ({ code: "", libelle: "", description: "" });
export const saisieDepuisEtape = (e: EtapeVersion): SaisieEtape => ({
  code: e.code,
  libelle: e.libelle,
  description: e.description ?? "",
});

/** Création : `POST …/etapes`. */
export function validerEtapeCreation(
  s: SaisieEtape,
): Resultat<{ code: string; libelle: string; description: string | null }, ChampEtape> {
  const erreurs: Partial<Record<ChampEtape, string>> = {};
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) erreurs.code = MESSAGE_CODE;
  if (aDesErreurs(erreurs)) return { ok: false, erreurs };
  const p = etapeCreationSchema.safeParse({
    code: s.code.trim(),
    libelle: s.libelle.trim(),
    description: vide(s.description),
  });
  if (!p.success)
    return { ok: false, erreurs: { libelle: "Étape refusée : vérifier les champs." } };
  return { ok: true, charge: { ...p.data, description: p.data.description ?? null } };
}

/** Modification : `PATCH …/etapes/:id` (le code ne change pas). */
export function validerEtapeModification(
  s: SaisieEtape,
): Resultat<{ libelle: string; description: string | null }, ChampEtape> {
  if (!s.libelle.trim()) return { ok: false, erreurs: { libelle: "Libellé obligatoire." } };
  const p = etapeModificationSchema.safeParse({
    libelle: s.libelle.trim(),
    description: vide(s.description),
  });
  if (!p.success)
    return { ok: false, erreurs: { libelle: "Étape refusée : vérifier les champs." } };
  return {
    ok: true,
    charge: { libelle: s.libelle.trim(), description: p.data.description ?? null },
  };
}

// --- Brique (modification) --------------------------------------------------------------------

export function saisieDepuisBrique(b: BriqueVersion): SaisieBrique {
  return {
    etape_id: b.etape_id,
    code: b.code,
    libelle: b.libelle,
    objet: b.objet,
    entrees: b.entrees ?? "",
    moteur: b.moteur ?? "",
    agent: b.agent ?? "",
    classe_risque: b.classe_risque,
    sortie: b.sortie ?? "",
    definition_termine: b.definition_termine ?? "",
    temps_type_jours:
      b.temps_type_jours === null ? "" : String(b.temps_type_jours).replace(".", ","),
    profil_temps: b.profil_temps ?? "",
    niveau_autonomie_max: b.niveau_autonomie_max,
    active_par_defaut: b.active_par_defaut,
  };
}

type BriqueModificationCorps = ReturnType<typeof briqueModificationSchema.parse>;

/** Modification : `PATCH …/briques/:id` (mêmes contrôles que la création, sans le code). */
export function validerBriqueModification(
  s: SaisieBrique,
): Resultat<BriqueModificationCorps, ChampBrique> {
  const r = validerBrique(s);
  if (!r.ok) return r;
  const sansCode = Object.fromEntries(Object.entries(r.charge).filter(([cle]) => cle !== "code"));
  const p = briqueModificationSchema.safeParse(sansCode);
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { libelle: "Brique refusée : vérifier les champs." } };
}

// --- Règle (relecture dans l'éditeur) ----------------------------------------------------------

function texteValeur(v: unknown): string {
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.map(texteValeur).join(", ");
  return String(v).replace(".", ",");
}

function comparaisonDepuisCondition(c: ConditionModulationApi): SaisieComparaison | null {
  if (c.type !== "comparaison") return null;
  return { facteur: c.facteur, comparateur: c.comparateur, valeur: texteValeur(c.valeur) };
}

function effetDepuisApi(e: EffetModulationApi): SaisieEffet {
  const type = e.type as TypeEffetEditeur;
  switch (e.type) {
    case "activer_brique":
    case "retirer_brique":
      return { type, code: e.brique, valeur: "" };
    case "activer_item":
    case "retirer_item":
      return { type, code: e.item, valeur: "" };
    case "recommandation_candidate":
      return { type, code: e.recommandation, valeur: "" };
    case "relever_classe_risque":
      return { type, code: e.cible, valeur: e.classe };
    case "ponderation":
    case "seuil":
      return { type, code: e.cible, valeur: texteValeur(e.valeur) };
    default:
      return { type, code: e.cible, valeur: e.choix };
  }
}

/**
 * Règle de l'API → saisie de l'éditeur. `null` si la condition dépasse ce que l'éditeur sait
 * montrer (négation, imbrication, test d'une brique active) : la règle reste lisible à l'écran
 * mais se supprime puis se recrée plutôt que de risquer de la déformer.
 */
export function saisieDepuisRegle(r: RegleModulationApi): SaisieRegle | null {
  const racine = r.condition;
  const feuilles =
    racine.type === "tous" || racine.type === "au_moins_un" ? racine.conditions : [racine];
  const comparaisons = feuilles.map(comparaisonDepuisCondition);
  if (comparaisons.length === 0 || comparaisons.some((c) => c === null)) return null;
  return {
    code: r.code,
    libelle: r.libelle ?? "",
    priorite: String(r.priorite),
    combinaison: racine.type === "au_moins_un" ? "au_moins_un" : "tous",
    comparaisons: comparaisons as SaisieComparaison[],
    effets: r.effets.map(effetDepuisApi),
  };
}

// --- Élément ---------------------------------------------------------------------------------

export interface SaisieElement {
  type: TypeElementMethode;
  code: string;
  libelle: string;
  description: string;
  brique_id: string;
  essentiel: boolean;
  actif_par_defaut: boolean;
}
export type ChampElement = "code" | "libelle" | "description";

export const saisieElementVide = (): SaisieElement => ({
  type: "livrable",
  code: "",
  libelle: "",
  description: "",
  brique_id: "",
  essentiel: false,
  actif_par_defaut: true,
});

export const saisieDepuisElement = (e: ElementVersion): SaisieElement => ({
  type: e.type as TypeElementMethode,
  code: e.code,
  libelle: e.libelle,
  description: e.description ?? "",
  brique_id: e.brique_id ?? "",
  essentiel: e.essentiel,
  actif_par_defaut: e.actif_par_defaut,
});

/** Un item seul peut être « essentiel » (questionnaire réduit). */
const essentielEffectif = (s: SaisieElement) => s.type === "item" && s.essentiel;

type ElementCreationCorps = ReturnType<typeof elementMethodeCreationSchema.parse>;
type ElementModificationCorps = ReturnType<typeof elementMethodeModificationSchema.parse>;

export function validerElementCreation(
  s: SaisieElement,
): Resultat<ElementCreationCorps, ChampElement> {
  const erreurs: Partial<Record<ChampElement, string>> = {};
  if (!s.libelle.trim()) erreurs.libelle = "Libellé obligatoire.";
  if (!codeReferentielSchema.safeParse(s.code.trim()).success) erreurs.code = MESSAGE_CODE;
  if (aDesErreurs(erreurs)) return { ok: false, erreurs };
  const p = elementMethodeCreationSchema.safeParse({
    type: s.type,
    code: s.code.trim(),
    libelle: s.libelle.trim(),
    description: vide(s.description),
    brique_id: s.brique_id || null,
    essentiel: essentielEffectif(s),
    actif_par_defaut: s.actif_par_defaut,
  });
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { libelle: "Élément refusé : vérifier les champs." } };
}

/** Modification : le code et le type ne changent pas. */
export function validerElementModification(
  s: SaisieElement,
): Resultat<ElementModificationCorps, ChampElement> {
  if (!s.libelle.trim()) return { ok: false, erreurs: { libelle: "Libellé obligatoire." } };
  const p = elementMethodeModificationSchema.safeParse({
    libelle: s.libelle.trim(),
    description: vide(s.description),
    brique_id: s.brique_id || null,
    essentiel: essentielEffectif(s),
    actif_par_defaut: s.actif_par_defaut,
  });
  return p.success
    ? { ok: true, charge: p.data }
    : { ok: false, erreurs: { libelle: "Élément refusé : vérifier les champs." } };
}
