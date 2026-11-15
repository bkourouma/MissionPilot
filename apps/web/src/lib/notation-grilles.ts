/**
 * Grilles de notation du cabinet (NOT-01) : liste, versions, copie de la grille générique,
 * édition des pondérations par dimension (regroupées par famille) et par secteur, validation
 * d'une version par un expert métier. Logique pure, testée dans `notation-grilles.test.ts`.
 *
 * Les SOMMES de poids affichées en direct aident la saisie (« la somme fait-elle 100 ? ») :
 * elles additionnent les valeurs saisies, au centième près, et ne produisent aucun score. Le
 * moteur normalise de toute façon les poids à 100 en proportion ; le contenu est validé par le
 * schéma partagé ici, puis par le moteur côté API.
 */
import {
  aPermission,
  creerTraduire,
  grilleNotationSchema,
  identifiantGrilleSchema,
  type GrilleNotationCreation,
  type GrilleNotationDonnees,
  type Langue,
  type Role,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { formaterNombre } from "./format";
import { estExpertPublieur, libelleFamille, messageNotation } from "./notation";
import type { Personne } from "./personnes";
import { normaliserNombreSaisi, type Resultat } from "./saisie";

// --- Types des réponses de l'API ------------------------------------------------------------

export type OrigineGrille = "generique" | "copie" | "cabinet";
export type StatutVersionGrille = "brouillon" | "valide";

/** Ligne de GET /api/notation/grilles. */
export interface GrilleResume {
  id: string;
  code: string;
  titre: string;
  origine: OrigineGrille;
  cree_le: string;
  modifie_le: string;
  version_validee_id: string | null;
  brouillon: boolean;
}

export interface PageGrilles {
  elements: GrilleResume[];
  curseur_suivant: string | null;
}

export interface VersionGrilleResume {
  id: string;
  grille_id: string;
  version: number;
  statut: StatutVersionGrille;
  cree_le: string;
  modifie_le: string;
  valide_le: string | null;
  cree_par: string;
  modifie_par?: string | null;
  valide_par: string | null;
}

/** Réponse de GET /api/notation/grilles/:id (versions de la plus récente à la plus ancienne). */
export interface GrilleDetail {
  id: string;
  code: string;
  titre: string;
  origine: OrigineGrille;
  copie_de: string | null;
  cree_par: string;
  cree_le: string;
  modifie_le: string;
  versions: VersionGrilleResume[];
}

/** Réponse de GET /api/notation/grilles/versions/:id. */
export interface VersionGrille extends VersionGrilleResume {
  code: string;
  contenu: GrilleNotationDonnees;
}

// --- Libellés ----------------------------------------------------------------------------------

export const ORIGINES: Record<OrigineGrille, string> = {
  generique: "Copie de la grille générique",
  copie: "Copie d'une grille du cabinet",
  cabinet: "Saisie par le cabinet",
};

export const ORIGINES_EN: Record<OrigineGrille, string> = {
  generique: "Copy of the generic framework",
  copie: "Copy of a firm framework",
  cabinet: "Entered by the firm",
};

export const libelleOrigine = (o: string, langue: Langue = "fr") =>
  ((langue === "en" ? ORIGINES_EN : ORIGINES) as Record<string, string>)[o] ??
  (langue === "en" ? "Unknown origin" : "Origine inconnue");

export const STATUTS_GRILLE: Record<
  StatutVersionGrille,
  { libelle: string; tonalite: "succes" | "neutre" }
> = {
  brouillon: { libelle: "Brouillon", tonalite: "neutre" },
  valide: { libelle: "Validée (figée)", tonalite: "succes" },
};

export const STATUTS_GRILLE_EN: Record<
  StatutVersionGrille,
  { libelle: string; tonalite: "succes" | "neutre" }
> = {
  brouillon: { libelle: "Draft", tonalite: "neutre" },
  valide: { libelle: "Approved (locked)", tonalite: "succes" },
};

export const libelleStatutGrille = (s: string, langue: Langue = "fr") =>
  ((langue === "en" ? STATUTS_GRILLE_EN : STATUTS_GRILLE) as Record<string, { libelle: string }>)[s]
    ?.libelle ?? (langue === "en" ? "Unknown status" : "Statut inconnu");

/** Auteur d'une version : « vous », le nom connu, sinon un libellé neutre. */
export function nomAuteurGrille(
  id: string | null | undefined,
  moiId: string,
  personnes: readonly Personne[],
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!id) return "—";
  if (id === moiId) return t("vous", "you");
  return (
    personnes.find((p) => p.utilisateur_id === id)?.nom ??
    t("un membre du cabinet", "a firm member")
  );
}

// --- Chemins ----------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);

export const GRILLES_PAR_PAGE = 50;

/** Curseur opaque de l'API (base64url) lu dans l'URL ; toute autre valeur est ignorée. */
export function lireCurseurGrilles(v: string | string[] | undefined): string {
  const brut = Array.isArray(v) ? v[0] : v;
  return typeof brut === "string" && /^[A-Za-z0-9_-]{1,500}$/.test(brut) ? brut : "";
}

/** Collection des grilles (POST : création). */
export const CHEMIN_GRILLES = "/api/notation/grilles";

export function cheminGrilles(curseur = "", limite = GRILLES_PAR_PAGE): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${CHEMIN_GRILLES}?${q.toString()}`;
}

export const cheminGrille = (id: string) => `/api/notation/grilles/${segment(id)}`;
export const cheminNouvelleVersion = (grilleId: string) =>
  `/api/notation/grilles/${segment(grilleId)}/versions`;
export const cheminVersionGrille = (id: string) => `/api/notation/grilles/versions/${segment(id)}`;
export const cheminValiderVersion = (id: string) =>
  `/api/notation/grilles/versions/${segment(id)}/valider`;

export const hrefGrilles = (curseur?: string | null) =>
  curseur ? `/notation?curseur=${encodeURIComponent(curseur)}` : "/notation";
export const hrefGrille = (id: string) => `/notation/${segment(id)}`;
export const hrefVersionGrille = (id: string) => `/notation/versions/${segment(id)}`;

// --- Droits d'affichage (l'API reste juge) ---------------------------------------------------

export interface DroitsVersionGrille {
  modifier: boolean;
  valider: boolean;
  /** Pourquoi « Valider » n'est pas proposé (brouillon seulement). */
  explicationValidation: string | null;
  /** Avertissement : modifier ce brouillon empêchera de le valider soi-même. */
  avertissementModification: string | null;
}

export function droitsVersionGrille(
  roles: readonly Role[],
  utilisateurId: string,
  v: Pick<VersionGrilleResume, "statut" | "cree_par" | "modifie_par">,
  langue: Langue = "fr",
): DroitsVersionGrille {
  const t = creerTraduire(langue);
  const brouillon = v.statut === "brouillon";
  const redige = aPermission(roles, "notation.gerer") || aPermission(roles, "notation.publier");
  const expert = estExpertPublieur(roles);
  const auteur = v.cree_par === utilisateurId || v.modifie_par === utilisateurId;
  let explicationValidation: string | null = null;
  if (brouillon && !expert) {
    explicationValidation = t(
      "La validation d'une version de grille revient à un expert métier du cabinet : votre rôle permet de la préparer, pas de la valider.",
      "Approving a framework version is up to a business expert of the firm: your role allows you to prepare it, not to approve it.",
    );
  } else if (brouillon && auteur) {
    explicationValidation = t(
      "Vous avez rédigé ou modifié ce brouillon : un autre expert métier doit le relire et le valider (séparation des tâches).",
      "You wrote or edited this draft: another business expert must review and approve it (separation of duties).",
    );
  }
  return {
    modifier: brouillon && redige,
    valider: brouillon && expert && !auteur,
    explicationValidation,
    avertissementModification:
      brouillon && expert && !auteur
        ? t(
            "Si vous enregistrez une modification, vous en deviendrez le dernier modificateur : un autre expert métier devra alors valider cette version.",
            "If you save a change, you become its last editor: another business expert will then have to approve this version.",
          )
        : null,
  };
}

// --- Création d'une grille -------------------------------------------------------------------

export interface SaisieCreationGrille {
  code: string;
  titre: string;
  source: "generique" | "copie";
  grilleId: string;
}

export const MESSAGE_CODE_GRILLE =
  "Code : lettres minuscules sans accent, chiffres, « _ », « . » ou « - », 80 caractères au plus, en commençant par une lettre ou un chiffre (ex. grille_industrie).";

export const MESSAGE_CODE_GRILLE_EN =
  'Code: lowercase letters without accents, digits, "_", "." or "-", 80 characters at most, starting with a letter or a digit (e.g. industry_framework).';

/** Code proposé à partir d'un titre : « Grille Industrie 2027 » → « grille_industrie_2027 ». */
export function codeDepuisTitre(titre: string): string {
  return titre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function validerCreationGrille(
  s: SaisieCreationGrille,
  langue: Langue = "fr",
): Resultat<GrilleNotationCreation, "code" | "titre" | "grilleId"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"code" | "titre" | "grilleId", string>> = {};
  const code = s.code.trim();
  if (code === "") {
    erreurs.code = t("Le code de la grille est obligatoire.", "The framework code is required.");
  } else if (!identifiantGrilleSchema.safeParse(code).success) {
    erreurs.code = langue === "en" ? MESSAGE_CODE_GRILLE_EN : MESSAGE_CODE_GRILLE;
  }
  const titre = s.titre.trim();
  if (titre.length > 200) {
    erreurs.titre = t(
      "Le titre ne doit pas dépasser 200 caractères.",
      "The title must not exceed 200 characters.",
    );
  }
  if (s.source === "copie" && s.grilleId === "") {
    erreurs.grilleId = t(
      "Choisissez la grille du cabinet à copier.",
      "Choose the firm framework to copy.",
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      code,
      ...(titre ? { titre } : {}),
      source:
        s.source === "copie" ? { type: "copie", grille_id: s.grilleId } : { type: "generique" },
    },
  };
}

// --- Édition des pondérations -----------------------------------------------------------------

export interface EditionSecteur {
  secteur: string;
  libelle: string;
  /** Poids saisi par dimension ; vide = poids par défaut de la dimension. */
  poids: Record<string, string>;
}

export interface EditionGrille {
  titre: string;
  /** Poids par défaut saisi par dimension. */
  poids: Record<string, string>;
  secteurs: EditionSecteur[];
}

/** Nombre → texte modifiable à la française (« 12,5 »). */
export const poidsVersSaisie = (n: number) => String(n).replace(".", ",");

export function editionDepuisContenu(c: GrilleNotationDonnees): EditionGrille {
  return {
    titre: c.titre,
    poids: Object.fromEntries(c.dimensions.map((d) => [d.id, poidsVersSaisie(d.poids)])),
    secteurs: (c.secteurs ?? []).map((s) => ({
      secteur: s.secteur,
      libelle: s.libelle ?? "",
      poids: Object.fromEntries(
        c.dimensions.map((d) => {
          const p = s.poids.find((x) => x.dimension === d.id);
          return [d.id, p ? poidsVersSaisie(p.poids) : ""];
        }),
      ),
    })),
  };
}

export const POIDS_MAX = 10_000;

/**
 * Poids saisi à la française : nombre de 0 à 10 000, deux décimales au plus. `null` si vide,
 * `Number.NaN` si invalide.
 */
export function lirePoids(v: string): number | null {
  const brut = normaliserNombreSaisi(v);
  if (brut === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(brut)) return Number.NaN;
  const n = Number(brut);
  return n <= POIDS_MAX ? n : Number.NaN;
}

/** Somme au centième près (évite 99,99999 en virgule flottante) ; null si un poids est invalide. */
export function sommePoids(valeurs: readonly (number | null)[]): number | null {
  let centiemes = 0;
  for (const v of valeurs) {
    if (v === null) continue;
    if (!Number.isFinite(v)) return null;
    centiemes += Math.round(v * 100);
  }
  return centiemes / 100;
}

export interface TotalFamille {
  famille: string;
  libelle: string;
  dimensions: { id: string; libelle: string }[];
  total: number | null;
}

export interface TotauxEdition {
  familles: TotalFamille[];
  total: number | null;
  /** Par secteur : somme des poids effectifs (saisi, sinon poids par défaut de la dimension). */
  secteurs: { secteur: string; total: number | null }[];
}

type DimensionsGrille = GrilleNotationDonnees["dimensions"];

/** Sommes affichées en direct pendant la saisie. */
export function totauxEdition(
  dimensions: DimensionsGrille,
  e: EditionGrille,
  langue: Langue = "fr",
): TotauxEdition {
  const defaut = (id: string) => lirePoids(e.poids[id] ?? "");
  const familles: TotalFamille[] = [];
  for (const d of dimensions) {
    let f = familles.find((x) => x.famille === d.famille);
    if (!f) {
      f = {
        famille: d.famille,
        libelle: libelleFamille(d.famille, langue),
        dimensions: [],
        total: 0,
      };
      familles.push(f);
    }
    f.dimensions.push({ id: d.id, libelle: d.libelle });
  }
  for (const f of familles) {
    f.total = sommePoids(f.dimensions.map((d) => valeurObligatoire(defaut(d.id))));
  }
  return {
    familles,
    total: sommePoids(dimensions.map((d) => valeurObligatoire(defaut(d.id)))),
    secteurs: e.secteurs.map((s) => ({
      secteur: s.secteur,
      total: sommePoids(
        dimensions.map((d) => {
          const saisi = lirePoids(s.poids[d.id] ?? "");
          return saisi === null ? valeurObligatoire(defaut(d.id)) : saisi;
        }),
      ),
    })),
  };
}

/** Un poids par défaut vide est une erreur de saisie : il rend la somme incalculable. */
const valeurObligatoire = (v: number | null) => (v === null ? Number.NaN : v);

export const SOMME_CIBLE = 100;

/** Somme conforme ? (au centième près) */
export const sommeConforme = (total: number | null) => total !== null && total === SOMME_CIBLE;

/** Texte de la somme affichée en direct (annoncé poliment aux lecteurs d'écran). */
export function messageSomme(total: number | null, portee: string, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (total === null) {
    return t(
      `${portee} : somme incalculable, corrigez les poids signalés.`,
      `${portee}: sum cannot be computed, fix the flagged weights.`,
    );
  }
  const texte = formaterNombre(total, 2, langue);
  if (sommeConforme(total)) {
    return t(
      `${portee} : somme ${texte} sur 100, conforme.`,
      `${portee}: sum ${texte} out of 100, compliant.`,
    );
  }
  return t(
    `${portee} : somme ${texte} au lieu de 100. Le moteur ramènera ces poids à 100 en proportion ; visez 100 pour une lecture directe.`,
    `${portee}: sum ${texte} instead of 100. The engine will scale these weights to 100 proportionally; aim for 100 for a direct reading.`,
  );
}

/** Sous-total d'une famille : la part de la famille dans le total, sans cible propre. */
export function messageSousTotal(
  total: number | null,
  famille: string,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (total === null) {
    return t(
      `Sous-total « ${famille} » : incalculable, corrigez les poids signalés.`,
      `Subtotal "${famille}": cannot be computed, fix the flagged weights.`,
    );
  }
  return t(
    `Sous-total « ${famille} » : ${formaterNombre(total, 2)}.`,
    `Subtotal "${famille}": ${formaterNombre(total, 2, langue)}.`,
  );
}

export type CleErreurGrille = string;

/**
 * Contenu à envoyer (PUT) à partir du contenu d'origine et de la saisie : seuls le titre, les
 * poids par défaut et les surcharges de secteur changent ; indicateurs et conversions sont
 * repris tels quels. Clés d'erreur : `titre`, `poids.<dimension>`,
 * `secteur.<rang>.<dimension>`, `secteur.<rang>.code`, `secteur.<rang>.libelle`, `global`.
 */
export function contenuDepuisEdition(
  origine: GrilleNotationDonnees,
  e: EditionGrille,
  langue: Langue = "fr",
): Resultat<GrilleNotationDonnees, CleErreurGrille> {
  const t = creerTraduire(langue);
  const messagePoids = langue === "en" ? MESSAGE_POIDS_EN : MESSAGE_POIDS;
  const erreurs: Record<string, string> = {};
  const titre = e.titre.trim();
  const titreTrop = t(
    "Le titre ne doit pas dépasser 200 caractères.",
    "The title must not exceed 200 characters.",
  );
  if (titre === "") {
    erreurs.titre = t("Le titre de la grille est obligatoire.", "The framework title is required.");
  } else if (titre.length > 200) erreurs.titre = titreTrop;

  const dimensions = origine.dimensions.map((d) => {
    const p = lirePoids(e.poids[d.id] ?? "");
    if (p === null) {
      erreurs[`poids.${d.id}`] = t(
        "Poids obligatoire (0 si la dimension ne compte pas).",
        "Weight required (0 if the dimension does not count).",
      );
    } else if (Number.isNaN(p)) erreurs[`poids.${d.id}`] = messagePoids;
    return { ...d, poids: p ?? 0 };
  });
  const total = sommePoids(dimensions.map((d) => d.poids));
  if (total !== null && total <= 0 && Object.keys(erreurs).length === 0) {
    erreurs.global = t(
      "Au moins une dimension doit avoir un poids positif.",
      "At least one dimension must have a positive weight.",
    );
  }

  const codes = new Set<string>();
  const secteurs = e.secteurs.map((s, i) => {
    const code = s.secteur.trim();
    if (!identifiantGrilleSchema.safeParse(code).success) {
      erreurs[`secteur.${i}.code`] =
        langue === "en" ? MESSAGE_CODE_SECTEUR_EN : MESSAGE_CODE_SECTEUR;
    } else if (codes.has(code)) {
      erreurs[`secteur.${i}.code`] = t(
        "Ce code de secteur est déjà utilisé.",
        "This sector code is already used.",
      );
    }
    codes.add(code);
    const libelle = s.libelle.trim();
    if (libelle.length > 200) {
      erreurs[`secteur.${i}.libelle`] = t(
        "Le libellé ne doit pas dépasser 200 caractères.",
        "The label must not exceed 200 characters.",
      );
    }
    const poids = origine.dimensions.flatMap((d) => {
      const p = lirePoids(s.poids[d.id] ?? "");
      if (p === null) return [];
      if (Number.isNaN(p)) {
        erreurs[`secteur.${i}.${d.id}`] = messagePoids;
        return [];
      }
      return [{ dimension: d.id, poids: p }];
    });
    return { secteur: code, ...(libelle ? { libelle } : {}), poids };
  });

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const contenu: GrilleNotationDonnees = {
    ...origine,
    titre,
    dimensions,
    ...(secteurs.length > 0 || origine.secteurs !== undefined ? { secteurs } : {}),
  };
  const controle = grilleNotationSchema.safeParse(contenu);
  if (!controle.success) {
    return {
      ok: false,
      erreurs: {
        global: t(
          "Le contenu de la grille est incomplet ou invalide : vérifiez les poids saisis.",
          "The framework content is incomplete or invalid: check the weights entered.",
        ),
      },
    };
  }
  return { ok: true, charge: controle.data };
}

export const MESSAGE_POIDS =
  "Poids invalide : un nombre positif de 0 à 10 000, deux décimales au plus (ex. 12 ou 7,5).";

export const MESSAGE_POIDS_EN =
  "Invalid weight: a positive number from 0 to 10,000, two decimals at most (e.g. 12 or 7.5).";

export const MESSAGE_CODE_SECTEUR_EN =
  'Sector code: lowercase letters without accents, digits, "_", "." or "-" (e.g. construction).';

export const MESSAGE_CODE_SECTEUR =
  "Code du secteur : lettres minuscules sans accent, chiffres, « _ », « . » ou « - » (ex. btp).";

/** Ajoute un secteur dont les poids partent des poids par défaut saisis (somme identique). */
export function ajouterSecteur(
  e: EditionGrille,
  code: string,
  libelle: string,
  langue: Langue = "fr",
): Resultat<EditionGrille, "code" | "libelle"> {
  const t = creerTraduire(langue);
  const c = code.trim();
  if (!identifiantGrilleSchema.safeParse(c).success) {
    return {
      ok: false,
      erreurs: { code: langue === "en" ? MESSAGE_CODE_SECTEUR_EN : MESSAGE_CODE_SECTEUR },
    };
  }
  if (e.secteurs.some((s) => s.secteur === c)) {
    return {
      ok: false,
      erreurs: {
        code: t(
          "Ce code de secteur existe déjà dans la grille.",
          "This sector code already exists in the framework.",
        ),
      },
    };
  }
  const l = libelle.trim();
  if (l.length > 200) {
    return {
      ok: false,
      erreurs: {
        libelle: t(
          "Le libellé ne doit pas dépasser 200 caractères.",
          "The label must not exceed 200 characters.",
        ),
      },
    };
  }
  if (e.secteurs.length >= 50) {
    return {
      ok: false,
      erreurs: {
        code: t("Une grille compte 50 secteurs au plus.", "A framework has 50 sectors at most."),
      },
    };
  }
  return {
    ok: true,
    charge: { ...e, secteurs: [...e.secteurs, { secteur: c, libelle: l, poids: { ...e.poids } }] },
  };
}

export const retirerSecteur = (e: EditionGrille, rang: number): EditionGrille => ({
  ...e,
  secteurs: e.secteurs.filter((_, i) => i !== rang),
});

// --- Erreurs ----------------------------------------------------------------------------------

/**
 * Anomalies de grille détaillées par le moteur (400 avec `details`) : seuls les messages du
 * moteur (préfixés d'un code « CODE : ») sont repris, jamais un message brut de validation.
 */
export function anomaliesGrille(e: unknown): string[] {
  if (!(e instanceof ErreurApi) || e.code !== "REQUETE_INVALIDE") return [];
  const details = e.details as { fieldErrors?: Record<string, unknown>; formErrors?: unknown };
  const brutes: unknown[] = [
    ...(Array.isArray(details?.formErrors) ? details.formErrors : []),
    ...Object.values(details?.fieldErrors ?? {}).flatMap((v) => (Array.isArray(v) ? v : [])),
  ];
  const messages = brutes.flatMap((m) => {
    if (typeof m !== "string") return [];
    const r = /^[A-Z][A-Z_]+ : (.+)$/.exec(m);
    return r?.[1] ? [r[1]] : [];
  });
  return [...new Set(messages)].slice(0, 20);
}

/** Message français d'une erreur sur une grille (création, modification, validation). */
export function messageGrille(e: unknown, langue: Langue = "fr"): string {
  if (e instanceof ErreurApi && e.statut === 404) {
    return creerTraduire(langue)(
      "Cette grille ou cette version n'est plus accessible. Actualisez la page.",
      "This framework or version is no longer accessible. Refresh the page.",
    );
  }
  if (e instanceof ErreurApi && e.statut === 409 && e.code === "CONFLIT") return e.message;
  return messageNotation(e, langue);
}
