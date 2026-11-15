/**
 * Référentiel des collaborateurs et grades (PLN-05, FIN-02) : logique pure, testée dans
 * `collaborateurs.test.ts`. Les types non financiers et financiers sont séparés : une donnée
 * financière n'est chargée par le serveur web que si l'utilisateur a `finance.lire`.
 */
import {
  aPermission,
  TYPES_COLLABORATEUR,
  type CollaborateurCouts,
  type Langue,
  type Role,
  type TypeCollaborateur,
} from "@missionpilot/shared";
import { DEVISES, type Devise } from "./format";
import { decouperListe, joindreListe, lireMontant, lireNombre, type Resultat } from "./saisie";

export interface Grade {
  id: string;
  code: string;
  libelle: string;
  ordre: number;
  actif: boolean;
  a_valider: boolean;
}

/** Ligne de `GET /api/grades/taux` (finance.lire). */
export interface TauxGrade {
  id: string;
  taux_vente_standard: number | null;
  devise: Devise;
}

export interface Collaborateur {
  id: string;
  utilisateur_id: string | null;
  nom: string;
  grade_id: string | null;
  grade_code: string | null;
  grade_libelle: string | null;
  competences: string[];
  secteurs: string[];
  langues: string[];
  capacite_pct: number;
  type: TypeCollaborateur;
  actif: boolean;
}

export interface LigneCouts {
  id: string;
  cout_journalier: number | null;
  taux_vente_specifique: number | null;
  cout_achat: number | null;
  devise: Devise;
  depuis_le: string;
}

export interface CoutsCollaborateur {
  collaborateur_id: string;
  courant: LigneCouts | null;
  historique: LigneCouts[];
}

export const TYPE_LIBELLES: Record<TypeCollaborateur, string> = {
  interne: "Interne",
  externe: "Expert externe",
  sous_traitant: "Sous-traitant",
};

export const TYPE_LIBELLES_EN: Record<TypeCollaborateur, string> = {
  interne: "Internal",
  externe: "External expert",
  sous_traitant: "Subcontractor",
};

export const libelleTypeCollaborateur = (t: TypeCollaborateur, langue: Langue = "fr"): string =>
  langue === "en" ? TYPE_LIBELLES_EN[t] : TYPE_LIBELLES[t];

export const OPTIONS_TYPES = TYPES_COLLABORATEUR.map((t) => ({
  valeur: t,
  libelle: TYPE_LIBELLES[t],
}));

export const optionsTypes = (langue: Langue = "fr") =>
  TYPES_COLLABORATEUR.map((t) => ({ valeur: t, libelle: libelleTypeCollaborateur(t, langue) }));

// --- Droits ---------------------------------------------------------------------

export interface DroitsReferentiel {
  /** Modifier le référentiel des collaborateurs. */
  ecrireCollaborateurs: boolean;
  /** Voir coûts journaliers et taux (associés, gestionnaires). */
  voirFinances: boolean;
  /** Saisir une nouvelle ligne de coûts ou un taux de grade. */
  gererTaux: boolean;
  /** Créer et modifier les grades. */
  gererGrades: boolean;
}

export function droitsReferentiel(roles: readonly Role[]): DroitsReferentiel {
  const voirFinances = aPermission(roles, "finance.lire");
  return {
    ecrireCollaborateurs: aPermission(roles, "collaborateurs.ecrire"),
    voirFinances,
    // Saisir sans pouvoir relire n'a pas de sens : taux.gerer seul ne suffit pas.
    gererTaux: voirFinances && aPermission(roles, "taux.gerer"),
    gererGrades: aPermission(roles, "cabinet.gerer"),
  };
}

export interface GradeAvecTaux extends Grade {
  taux_vente_standard: number | null;
  devise: Devise;
}

/**
 * Associe les taux aux grades. Appelée uniquement côté serveur, et seulement avec des taux
 * chargés sous `finance.lire` : sans ce droit, les grades restent sans aucun champ financier.
 */
export function fusionnerTaux(
  grades: readonly Grade[],
  taux: readonly TauxGrade[],
): GradeAvecTaux[] {
  const parId = new Map(taux.map((t) => [t.id, t]));
  return grades.map((g) => ({
    ...g,
    taux_vente_standard: parId.get(g.id)?.taux_vente_standard ?? null,
    devise: parId.get(g.id)?.devise ?? "XOF",
  }));
}

// --- Formulaire collaborateur -----------------------------------------------------

export interface SaisieCollaborateur {
  nom: string;
  grade_id: string;
  type: string;
  capacite_pct: string;
  competences: string;
  secteurs: string;
  langues: string;
}

export type ChampCollaborateur = keyof SaisieCollaborateur;

export const SAISIE_COLLABORATEUR_VIDE: SaisieCollaborateur = {
  nom: "",
  grade_id: "",
  type: "interne",
  capacite_pct: "100",
  competences: "",
  secteurs: "",
  langues: "français",
};

export function saisieDepuisCollaborateur(c: Collaborateur): SaisieCollaborateur {
  return {
    nom: c.nom,
    grade_id: c.grade_id ?? "",
    type: c.type,
    capacite_pct: String(c.capacite_pct),
    competences: joindreListe(c.competences),
    secteurs: joindreListe(c.secteurs),
    langues: joindreListe(c.langues),
  };
}

export interface ChargeCollaborateur {
  nom: string;
  grade_id: string | null;
  type: TypeCollaborateur;
  capacite_pct: number;
  competences: string[];
  secteurs: string[];
  langues: string[];
}

function verifierListe(
  liste: string[],
  maxElements: number,
  maxLongueur: number,
  langue: Langue = "fr",
) {
  const en = langue === "en";
  if (liste.length > maxElements) {
    return en ? `${maxElements} items at most.` : `${maxElements} éléments au plus.`;
  }
  if (liste.some((e) => e.length > maxLongueur)) {
    return en
      ? `Each item must be ${maxLongueur} characters at most.`
      : `Chaque élément doit faire ${maxLongueur} caractères au plus.`;
  }
  return undefined;
}

export function validerCollaborateur(
  s: SaisieCollaborateur,
  langue: Langue = "fr",
): Resultat<ChargeCollaborateur, ChampCollaborateur> {
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const erreurs: Partial<Record<ChampCollaborateur, string>> = {};
  const nom = s.nom.trim();
  if (nom === "")
    erreurs.nom = t("Saisissez le nom du collaborateur.", "Enter the team member's name.");
  else if (nom.length > 160) erreurs.nom = t("160 caractères au plus.", "160 characters at most.");
  if (!(TYPES_COLLABORATEUR as readonly string[]).includes(s.type))
    erreurs.type = t("Choisissez un type.", "Choose a type.");
  const capacite = lireNombre(s.capacite_pct);
  if (capacite === null || Number.isNaN(capacite) || !Number.isInteger(capacite))
    erreurs.capacite_pct = t(
      "Saisissez un nombre entier entre 0 et 100.",
      "Enter a whole number between 0 and 100.",
    );
  else if (capacite < 0 || capacite > 100)
    erreurs.capacite_pct = t(
      "La capacité est comprise entre 0 et 100 %.",
      "Capacity is between 0 and 100%.",
    );
  const competences = decouperListe(s.competences);
  const secteurs = decouperListe(s.secteurs);
  const langues = decouperListe(s.langues);
  const ec = verifierListe(competences, 50, 80, langue);
  if (ec) erreurs.competences = ec;
  const es = verifierListe(secteurs, 50, 80, langue);
  if (es) erreurs.secteurs = es;
  const el = verifierListe(langues, 20, 40, langue);
  if (el) erreurs.langues = el;
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      nom,
      grade_id: s.grade_id === "" ? null : s.grade_id,
      type: s.type as TypeCollaborateur,
      capacite_pct: capacite as number,
      competences,
      secteurs,
      langues,
    },
  };
}

// --- Coûts (FIN-02) -------------------------------------------------------------

export interface SaisieCouts {
  cout_journalier: string;
  taux_vente_specifique: string;
  cout_achat: string;
  devise: string;
  depuis_le: string;
}

export type ChampCouts = keyof SaisieCouts;

export function validerCouts(
  s: SaisieCouts,
  langue: Langue = "fr",
): Resultat<CollaborateurCouts, ChampCouts | "global"> {
  const en = langue === "en";
  const erreurs: Partial<Record<ChampCouts | "global", string>> = {};
  if (!(DEVISES as readonly string[]).includes(s.devise)) {
    erreurs.devise = en ? "Choose a currency." : "Choisissez une devise.";
    return { ok: false, erreurs };
  }
  const devise = s.devise as Devise;
  const montants = {
    cout_journalier: lireMontant(s.cout_journalier, devise),
    taux_vente_specifique: lireMontant(s.taux_vente_specifique, devise),
    cout_achat: lireMontant(s.cout_achat, devise),
  };
  const msg =
    devise === "XOF" || devise === "XAF"
      ? en
        ? "Invalid amount: positive whole number expected (e.g. 150,000)."
        : "Montant invalide : nombre entier positif attendu (ex. 150 000)."
      : en
        ? "Invalid amount: positive number, up to two decimals (e.g. 1,500.50)."
        : "Montant invalide : nombre positif, deux décimales au plus (ex. 1 500,50).";
  for (const [champ, v] of Object.entries(montants) as [ChampCouts, number | null][]) {
    if (v !== null && Number.isNaN(v)) erreurs[champ] = msg;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.depuis_le))
    erreurs.depuis_le = en ? "Choose the effective date." : "Choisissez la date d'effet.";
  if (
    Object.keys(erreurs).length === 0 &&
    montants.cout_journalier === null &&
    montants.taux_vente_specifique === null &&
    montants.cout_achat === null
  )
    erreurs.global = en ? "Enter at least one amount." : "Renseignez au moins un montant.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { ...montants, devise, depuis_le: s.depuis_le },
  };
}

// --- Formulaire grade -------------------------------------------------------------

export interface SaisieGrade {
  code: string;
  libelle: string;
  ordre: string;
}

export type ChampGrade = keyof SaisieGrade;

export function validerGrade(
  s: SaisieGrade,
  creation: boolean,
  langue: Langue = "fr",
): Resultat<{ code?: string; libelle: string; ordre: number }, ChampGrade> {
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const erreurs: Partial<Record<ChampGrade, string>> = {};
  const code = s.code.trim();
  if (creation && !/^[a-z0-9_]{1,40}$/.test(code))
    erreurs.code = t(
      "Code : minuscules, chiffres et tiret bas, 40 caractères au plus (ex. senior).",
      "Code: lowercase letters, digits and underscore, 40 characters at most (e.g. senior).",
    );
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t("Saisissez le libellé du grade.", "Enter the grade label.");
  else if (libelle.length > 80)
    erreurs.libelle = t("80 caractères au plus.", "80 characters at most.");
  const ordre = lireNombre(s.ordre);
  if (
    ordre === null ||
    Number.isNaN(ordre) ||
    !Number.isInteger(ordre) ||
    ordre < 0 ||
    ordre > 1000
  )
    erreurs.ordre = t(
      "Saisissez un nombre entier entre 0 et 1000.",
      "Enter a whole number between 0 and 1000.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: creation
      ? { code, libelle, ordre: ordre as number }
      : { libelle, ordre: ordre as number },
  };
}

export function validerTauxGrade(
  saisie: string,
  devise: string,
  langue: Langue = "fr",
): Resultat<{ taux_vente_standard: number | null; devise: Devise }, "taux" | "devise"> {
  const en = langue === "en";
  if (!(DEVISES as readonly string[]).includes(devise))
    return { ok: false, erreurs: { devise: en ? "Choose a currency." : "Choisissez une devise." } };
  const d = devise as Devise;
  const v = lireMontant(saisie, d);
  if (v !== null && Number.isNaN(v))
    return {
      ok: false,
      erreurs: {
        taux:
          d === "XOF" || d === "XAF"
            ? en
              ? "Positive whole number expected (e.g. 250,000)."
              : "Nombre entier positif attendu (ex. 250 000)."
            : en
              ? "Positive number, up to two decimals."
              : "Nombre positif, deux décimales au plus.",
      },
    };
  return { ok: true, charge: { taux_vente_standard: v, devise: d } };
}

/** Filtre de type lu dans l'URL ; `undefined` si absent ou inconnu. */
export function lireTypeFiltre(v: string | string[] | undefined): TypeCollaborateur | undefined {
  const brut = Array.isArray(v) ? v[0] : v;
  return (TYPES_COLLABORATEUR as readonly string[]).includes(brut ?? "")
    ? (brut as TypeCollaborateur)
    : undefined;
}
