/** Notation augmentée : sessions de calibrage (NOT-13) (voir `notation-augmentee.ts`). */
import { entier, FORMAT_IDENTIFIANT } from "./notation-augmentee-commun";
import {
  MESSAGE_IDENTIFIANT,
  NIVEAUX_ITEM_MAX,
  NIVEAUX_ITEM_MIN,
} from "./notation-augmentee-banque";
import { formaterPointsSignes } from "./notation-augmentee-analyse";
import { aPermission, type Role } from "@missionpilot/shared";
import { estExpertPublieur, type TonaliteNotation } from "./notation";
import { codeDepuisTitre } from "./notation-grilles";
import { type Resultat } from "./saisie";

const segment = encodeURIComponent;

/* =====================================================================================
 * NOT-13 : sessions de calibrage
 * ===================================================================================== */

export interface CasCalibration {
  code: string;
  libelle: string;
}

export interface MesureCasCalibration {
  cas: string;
  cotations: number;
  min: number;
  max: number;
  ecart: number;
  mediane: number;
  /** `null` : un seul évaluateur, rien à comparer. */
  accord: boolean | null;
}

export interface MesureEvaluateurCalibration {
  evaluateur: { id: string; nom: string | null };
  cotations: number;
  cas_compares: number;
  biais: number | null;
  ecart_absolu_moyen: number | null;
}

/** Mesure produite par le moteur (`mesurerCalibration`) : rien n'est recalculé ici. */
export interface MesureCalibrationVue {
  tolerance: number;
  cas_doublement_cotes: number;
  cas_en_accord: number;
  taux_accord: number | null;
  ecart_moyen: number | null;
  a_discuter: string[];
  cas: MesureCasCalibration[];
  evaluateurs: MesureEvaluateurCalibration[];
}

export interface MaCotationCalibration {
  cas: string;
  niveau: number;
  motif: string | null;
  cree_le: string;
}

export interface CotationVisibleCalibration {
  cas: string;
  evaluateur: { id: string; nom: string };
  niveau: number;
  motif: string | null;
}

/** Réponse de `GET /api/notation/calibrations/:id` (et des écritures sur une session). */
export interface SessionCalibration {
  id: string;
  titre: string;
  cas: CasCalibration[];
  niveaux: number;
  tolerance: number;
  notation_id: string | null;
  cree_par: string;
  cree_le: string;
  cloturee_par: string | null;
  cloturee_le: string | null;
  conclusion: string | null;
  close: boolean;
  /** Nombre d'évaluateurs ayant coté chaque cas (jamais leurs niveaux avant la clôture). */
  avancement: { code: string; libelle: string; evaluateurs: number }[];
  mes_cotations: MaCotationCalibration[];
  /** `null` : cotations des autres masquées (double cotation à l'aveugle). */
  cotations: CotationVisibleCalibration[] | null;
  mesure: MesureCalibrationVue | null;
}

export const CHEMIN_CALIBRATIONS = "/api/notation/calibrations";
export const cheminCalibration = (id: string) => `${CHEMIN_CALIBRATIONS}/${segment(id)}`;
export const cheminCotations = (id: string) => `${cheminCalibration(id)}/cotations`;
export const cheminCloture = (id: string) => `${cheminCalibration(id)}/cloturer`;
export const hrefCalibration = (id: string) => `/notation/calibrations/${segment(id)}`;
export const HREF_NOUVELLE_CALIBRATION = "/notation/calibrations/nouvelle";

export const CAS_CALIBRATION_MAX = 200;
export const TITRE_CALIBRATION_LONGUEUR_MAX = 200;
export const LIBELLE_CAS_LONGUEUR_MAX = 200;
export const MOTIF_COTATION_LONGUEUR_MAX = 2000;
export const CONCLUSION_LONGUEUR_MAX = 4000;
export const TOLERANCE_CALIBRATION_MAX = 9;
export const NIVEAUX_CALIBRATION_DEFAUT = 5;

export interface SaisieCasCalibration {
  code: string;
  libelle: string;
}

export interface SaisieCalibration {
  titre: string;
  niveaux: string;
  tolerance: string;
  cas: SaisieCasCalibration[];
}

export function saisieCalibrationVide(): SaisieCalibration {
  return {
    titre: "",
    niveaux: String(NIVEAUX_CALIBRATION_DEFAUT),
    tolerance: "0",
    cas: [
      { code: "", libelle: "" },
      { code: "", libelle: "" },
    ],
  };
}

/** Code d'un cas : celui saisi, sinon dérivé du libellé (« Cas Acme 2026 » → « cas_acme_2026 »). */
export function codeCas(c: SaisieCasCalibration, rang: number): string {
  const saisi = c.code.trim();
  if (saisi !== "") return saisi;
  return codeDepuisTitre(c.libelle) || `cas_${rang + 1}`;
}

/**
 * Contrôle d'une création de session. Les lignes de cas entièrement vides sont ignorées. Clés
 * d'erreur : `titre`, `niveaux`, `tolerance`, `cas`, `cas-code-I`, `cas-libelle-I` (I = rang de la
 * ligne saisie, à partir de 0).
 */
export function validerSaisieCalibration(s: SaisieCalibration): Resultat<
  {
    titre: string;
    cas: CasCalibration[];
    niveaux: number;
    tolerance: number;
    notation_id: null;
  },
  string
> {
  const e: Record<string, string> = {};
  const titre = s.titre.trim();
  if (titre === "") e.titre = "Le titre de la session est obligatoire.";
  else if (titre.length > TITRE_CALIBRATION_LONGUEUR_MAX) {
    e.titre = `Titre de ${TITRE_CALIBRATION_LONGUEUR_MAX} caractères au plus.`;
  }
  const niveaux = entier(s.niveaux);
  if (niveaux === null || niveaux < NIVEAUX_ITEM_MIN || niveaux > NIVEAUX_ITEM_MAX) {
    e.niveaux = `Nombre de niveaux : entier de ${NIVEAUX_ITEM_MIN} à ${NIVEAUX_ITEM_MAX}.`;
  }
  const tolerance = entier(s.tolerance);
  if (tolerance === null || tolerance > TOLERANCE_CALIBRATION_MAX) {
    e.tolerance = `Tolérance : entier de 0 à ${TOLERANCE_CALIBRATION_MAX}.`;
  } else if (niveaux !== null && tolerance >= niveaux) {
    e.tolerance = "La tolérance est inférieure au nombre de niveaux.";
  }

  const cas: CasCalibration[] = [];
  const vus = new Set<string>();
  s.cas.forEach((ligne, i) => {
    if (ligne.code.trim() === "" && ligne.libelle.trim() === "") return;
    const libelle = ligne.libelle.trim();
    if (libelle === "") e[`cas-libelle-${i}`] = "Le libellé du cas est obligatoire.";
    else if (libelle.length > LIBELLE_CAS_LONGUEUR_MAX) {
      e[`cas-libelle-${i}`] = `Libellé de ${LIBELLE_CAS_LONGUEUR_MAX} caractères au plus.`;
    }
    const code = codeCas(ligne, i);
    if (!FORMAT_IDENTIFIANT.test(code)) e[`cas-code-${i}`] = MESSAGE_IDENTIFIANT;
    else if (vus.has(code)) e[`cas-code-${i}`] = "Ce code est déjà utilisé par un autre cas.";
    vus.add(code);
    cas.push({ code, libelle });
  });
  if (cas.length === 0) e.cas = "Au moins un cas à coter est obligatoire.";
  else if (cas.length > CAS_CALIBRATION_MAX) {
    e.cas = `${CAS_CALIBRATION_MAX} cas au plus par session.`;
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      titre,
      cas,
      niveaux: niveaux as number,
      tolerance: tolerance as number,
      notation_id: null,
    },
  };
}

/** Cotation d'un cas : niveau dans l'échelle de la session, motif facultatif. */
export function validerCotation(
  cas: string,
  niveauSaisi: string,
  motifSaisi: string,
  niveaux: number,
): Resultat<{ cotations: { cas: string; niveau: number; motif?: string }[] }, "niveau" | "motif"> {
  const e: Partial<Record<"niveau" | "motif", string>> = {};
  const niveau = entier(niveauSaisi);
  if (niveau === null || niveau < 1 || niveau > niveaux) {
    e.niveau = `Choisissez un niveau de 1 à ${niveaux}.`;
  }
  const motif = motifSaisi.trim();
  if (motif.length > MOTIF_COTATION_LONGUEUR_MAX) {
    e.motif = `Motif de ${MOTIF_COTATION_LONGUEUR_MAX} caractères au plus.`;
  }
  if (e.niveau || e.motif) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: { cotations: [{ cas, niveau: niveau as number, ...(motif === "" ? {} : { motif }) }] },
  };
}

/** Conclusion obligatoire de la clôture d'une session. */
export function validerConclusion(saisie: string): Resultat<{ conclusion: string }, "conclusion"> {
  const conclusion = saisie.trim();
  if (conclusion === "") {
    return { ok: false, erreurs: { conclusion: "La conclusion de la session est obligatoire." } };
  }
  if (conclusion.length > CONCLUSION_LONGUEUR_MAX) {
    return {
      ok: false,
      erreurs: { conclusion: `Conclusion de ${CONCLUSION_LONGUEUR_MAX} caractères au plus.` },
    };
  }
  return { ok: true, charge: { conclusion } };
}

export interface DroitsCalibration {
  coter: boolean;
  cloturer: boolean;
  explicationCloture: string | null;
}

/** Droits d'AFFICHAGE d'une session ; la clôture est réservée à un expert métier (MPN11). */
export function droitsCalibration(roles: readonly Role[], close: boolean): DroitsCalibration {
  const redige = aPermission(roles, "notation.gerer") || aPermission(roles, "notation.publier");
  const expert = estExpertPublieur(roles);
  return {
    coter: !close && redige,
    cloturer: !close && expert,
    explicationCloture:
      !close && !expert
        ? "La clôture d'une session revient à un expert métier du cabinet : votre rôle permet de coter, pas de clore."
        : null,
  };
}

export const LIBELLE_COTATIONS_MASQUEES =
  "Les cotations des autres évaluateurs restent masquées tant que la session est ouverte (cotation à l'aveugle). Un expert métier voit celles des cas qu'il a lui-même cotés ; tout le monde voit tout à la clôture.";

/** Accord d'un cas selon la mesure du moteur. */
export function libelleAccord(accord: boolean | null): {
  libelle: string;
  tonalite: TonaliteNotation;
} {
  if (accord === null) return { libelle: "Un seul évaluateur", tonalite: "neutre" };
  return accord
    ? { libelle: "En accord", tonalite: "succes" }
    : { libelle: "À discuter", tonalite: "attention" };
}

/** Niveaux de l'échelle d'une session (1 à n), pour les listes de choix. */
export const niveauxEchelle = (n: number): number[] =>
  Array.from({ length: Math.max(0, Math.min(n, NIVEAUX_ITEM_MAX)) }, (_, i) => i + 1);

/** Biais d'un évaluateur, en français (positif : plus généreux que ses pairs). */
export function phraseBiais(biais: number | null): string {
  if (biais === null) return "Non comparable";
  if (Math.round(Math.abs(biais) * 100) === 0) return "Aligné sur ses pairs";
  return biais > 0
    ? `Plus généreux que ses pairs (${formaterPointsSignes(biais)} niveau)`
    : `Plus sévère que ses pairs (${formaterPointsSignes(biais)} niveau)`;
}
