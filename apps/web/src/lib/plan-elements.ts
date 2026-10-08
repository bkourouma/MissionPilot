/**
 * Contenus du plan stratégique (diagnostic, SWOT, vision et mission, axes, objectifs,
 * initiatives) : état des formulaires, contrôles en français (mêmes bornes que les schémas de
 * `@missionpilot/shared`, l'API reste juge), construction des `donnees` envoyées à l'API et
 * texte comparable d'une version (historique, différences). Logique pure, testée dans
 * `plan-elements.test.ts`.
 *
 * Une version reprend TOUJOURS l'ensemble du contenu (API) : le formulaire de modification
 * est prérempli avec la version courante. Les gains annuels d'une initiative (base du ROI)
 * sont saisis par le consultant, une valeur par année d'horizon ; la VAN et le TRI sont
 * calculés par le moteur de l'API, jamais ici.
 */
import {
  DEPENDANCES_INITIATIVE_MAX,
  PERSPECTIVES_PLAN,
  STATUTS_INITIATIVE,
  type PerspectivePlan,
  type StatutInitiative,
  type TypeElementPlan,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "./format";
import { lireMontantSigne } from "./plan-hypotheses";
import {
  libellePerspective,
  libelleStatutInitiative,
  lireListe,
  lireTexte,
  PERSPECTIVE_LIBELLES,
} from "./plan-strategique";
import { lireMontant, montantVersSaisie, type Resultat } from "./saisie";

/** Bornes des schémas partagés (`DONNEES_ELEMENT_PLAN`). */
export const BORNES_ELEMENT = {
  synthese: 20_000,
  constat: 500,
  constats: 30,
  visionMission: 2_000,
  valeur: 200,
  valeurs: 20,
  titre: 200,
  description: 5_000,
  court: 200,
} as const;

export type ChampElement =
  | "synthese"
  | "forces"
  | "faiblesses"
  | "opportunites"
  | "menaces"
  | "swot"
  | "vision"
  | "mission"
  | "valeurs"
  | "titre"
  | "description"
  | "perspective"
  | "indicateur"
  | "cible"
  | "echeance"
  | "responsable_id"
  | "debut"
  | "budget"
  | "statut"
  | "gains"
  | "dependances";

/** Saisie d'un formulaire de contenu : textes bruts ; seuls les champs du type servent. */
export interface SaisieElement {
  synthese: string;
  forces: string;
  faiblesses: string;
  opportunites: string;
  menaces: string;
  vision: string;
  mission: string;
  valeurs: string;
  titre: string;
  description: string;
  perspective: string;
  indicateur: string;
  cible: string;
  echeance: string;
  responsable_id: string;
  debut: string;
  budget: string;
  statut: string;
  /** Gains nets annuels : exactement « horizon » cases. */
  gains: string[];
  /** Initiatives du plan qui doivent se terminer avant celle-ci (PLA-05). */
  dependances: string[];
}

export function saisieElementVide(horizon: number): SaisieElement {
  return {
    synthese: "",
    forces: "",
    faiblesses: "",
    opportunites: "",
    menaces: "",
    vision: "",
    mission: "",
    valeurs: "",
    titre: "",
    description: "",
    perspective: "",
    indicateur: "",
    cible: "",
    echeance: "",
    responsable_id: "",
    debut: "",
    budget: "",
    statut: "a_lancer",
    gains: Array.from({ length: horizon }, () => ""),
    dependances: [],
  };
}

const lignes = (l: readonly string[]) => l.join("\n");
const texteOuVide = (d: Record<string, unknown>, cle: string) => lireTexte(d, cle) ?? "";

/** Formulaire prérempli avec la version courante (une version reprend tout le contenu). */
export function saisieDepuisDonnees(
  donnees: Record<string, unknown>,
  devise: Devise,
  horizon: number,
): SaisieElement {
  const gains = Array.isArray(donnees.gains_annuels) ? (donnees.gains_annuels as unknown[]) : [];
  const budget = typeof donnees.budget === "number" ? donnees.budget : null;
  return {
    ...saisieElementVide(horizon),
    synthese: texteOuVide(donnees, "synthese"),
    forces: lignes(lireListe(donnees, "forces")),
    faiblesses: lignes(lireListe(donnees, "faiblesses")),
    opportunites: lignes(lireListe(donnees, "opportunites")),
    menaces: lignes(lireListe(donnees, "menaces")),
    vision: texteOuVide(donnees, "vision"),
    mission: texteOuVide(donnees, "mission"),
    valeurs: lignes(lireListe(donnees, "valeurs")),
    titre: texteOuVide(donnees, "titre"),
    description: texteOuVide(donnees, "description"),
    perspective: texteOuVide(donnees, "perspective"),
    indicateur: texteOuVide(donnees, "indicateur"),
    cible: texteOuVide(donnees, "cible"),
    echeance: texteOuVide(donnees, "echeance"),
    responsable_id: texteOuVide(donnees, "responsable_id"),
    debut: texteOuVide(donnees, "debut"),
    budget: budget === null ? "" : montantVersSaisie(budget, devise),
    statut: lireTexte(donnees, "statut") ?? "a_lancer",
    gains: Array.from({ length: horizon }, (_, i) =>
      typeof gains[i] === "number" ? montantVersSaisie(gains[i] as number, devise) : "",
    ),
    dependances: lireListe(donnees, "dependances"),
  };
}

// --- Contrôles --------------------------------------------------------------------------------

type Erreurs = Partial<Record<ChampElement, string>>;

const REQUIS = "Champ obligatoire.";
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Date AAAA-MM-JJ valide, de 2000 à 2100 (contrainte de la base). */
export function dateValide(v: string): boolean {
  const m = DATE.exec(v);
  if (!m) return false;
  const annee = Number(m[1]);
  const d = new Date(`${v}T00:00:00Z`);
  return (
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === v &&
    annee >= 2000 &&
    annee <= 2100
  );
}

function texteRequis(v: string, cle: ChampElement, max: number, err: Erreurs): string {
  const t = v.trim();
  if (t === "") err[cle] = REQUIS;
  else if (t.length > max) err[cle] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t;
}

function texteFacultatif(v: string, cle: ChampElement, max: number, err: Erreurs) {
  const t = v.trim();
  if (t.length > max) err[cle] = `${max.toLocaleString("fr-FR")} caractères au plus.`;
  return t === "" ? undefined : t;
}

/** Une entrée par ligne, sans doublon ni ligne vide. */
export function lireLignes(v: string): string[] {
  return [
    ...new Set(
      v
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== ""),
    ),
  ];
}

function liste(v: string, cle: ChampElement, max: number, maxLongueur: number, err: Erreurs) {
  const l = lireLignes(v);
  if (l.length > max) err[cle] = `${max} lignes au plus.`;
  else if (l.some((x) => x.length > maxLongueur)) {
    err[cle] = `Chaque ligne fait ${maxLongueur} caractères au plus.`;
  }
  return l;
}

function dateFacultative(v: string, cle: ChampElement, err: Erreurs) {
  const t = v.trim();
  if (t === "") return undefined;
  if (!dateValide(t)) err[cle] = "Date invalide (entre 2000 et 2100).";
  return t;
}

const B = BORNES_ELEMENT;

function donneesSwot(s: SaisieElement, err: Erreurs) {
  const d = {
    forces: liste(s.forces, "forces", B.constats, B.constat, err),
    faiblesses: liste(s.faiblesses, "faiblesses", B.constats, B.constat, err),
    opportunites: liste(s.opportunites, "opportunites", B.constats, B.constat, err),
    menaces: liste(s.menaces, "menaces", B.constats, B.constat, err),
  };
  if (Object.values(d).every((l) => l.length === 0)) {
    err.swot = "Renseignez au moins un constat (force, faiblesse, opportunité ou menace).";
  }
  return d;
}

function donneesObjectif(s: SaisieElement, err: Erreurs) {
  if (!(PERSPECTIVES_PLAN as readonly string[]).includes(s.perspective)) {
    err.perspective = "Choisissez une perspective.";
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err),
    description: texteFacultatif(s.description, "description", B.description, err),
    perspective: s.perspective as PerspectivePlan,
    indicateur: texteFacultatif(s.indicateur, "indicateur", B.court, err),
    cible: texteFacultatif(s.cible, "cible", B.court, err),
    echeance: dateFacultative(s.echeance, "echeance", err),
  };
}

function gainsAnnuels(s: SaisieElement, horizon: number, devise: Devise, err: Erreurs) {
  const cases = Array.from({ length: horizon }, (_, i) => (s.gains[i] ?? "").trim());
  if (cases.every((c) => c === "")) return undefined;
  if (cases.some((c) => c === "")) {
    err.gains = `Renseignez les ${horizon} années, ou laissez-les toutes vides (ROI non calculé).`;
    return undefined;
  }
  const valeurs = cases.map((c) => lireMontantSigne(c, devise));
  if (valeurs.some((v) => v === null || Number.isNaN(v))) {
    err.gains = "Montant illisible : chiffres seulement, signe moins pour une perte.";
    return undefined;
  }
  return valeurs as number[];
}

function donneesInitiative(s: SaisieElement, horizon: number, devise: Devise, err: Erreurs) {
  const echeance = s.echeance.trim();
  if (echeance === "") err.echeance = REQUIS;
  else if (!dateValide(echeance)) err.echeance = "Date invalide (entre 2000 et 2100).";
  const debut = dateFacultative(s.debut, "debut", err);
  if (debut && !err.debut && !err.echeance && debut > echeance) {
    err.debut = "Le début doit précéder l'échéance.";
  }
  const budget = lireMontant(s.budget, devise);
  if (budget === null) err.budget = REQUIS;
  else if (Number.isNaN(budget)) err.budget = "Montant invalide (positif ou nul).";
  if (!(STATUTS_INITIATIVE as readonly string[]).includes(s.statut)) {
    err.statut = "Choisissez un statut.";
  }
  const responsable = s.responsable_id.trim();
  if (s.dependances.length > DEPENDANCES_INITIATIVE_MAX) {
    err.dependances = `${DEPENDANCES_INITIATIVE_MAX} dépendances au plus.`;
  }
  return {
    titre: texteRequis(s.titre, "titre", B.titre, err),
    description: texteFacultatif(s.description, "description", B.description, err),
    responsable_id: responsable === "" ? undefined : responsable,
    debut,
    echeance,
    budget: budget ?? 0,
    statut: s.statut as StatutInitiative,
    gains_annuels: gainsAnnuels(s, horizon, devise, err),
    // Absent plutôt que vide : une version sans dépendance garde la forme d'avant PLA-05.
    dependances: s.dependances.length ? [...new Set(s.dependances)] : undefined,
  };
}

function donneesSelonType(
  type: TypeElementPlan,
  s: SaisieElement,
  horizon: number,
  devise: Devise,
  err: Erreurs,
): Record<string, unknown> {
  switch (type) {
    case "diagnostic":
      return { synthese: texteRequis(s.synthese, "synthese", B.synthese, err) };
    case "swot":
      return donneesSwot(s, err);
    case "vision_mission": {
      const valeurs = liste(s.valeurs, "valeurs", B.valeurs, B.valeur, err);
      return {
        vision: texteRequis(s.vision, "vision", B.visionMission, err),
        mission: texteRequis(s.mission, "mission", B.visionMission, err),
        valeurs: valeurs.length ? valeurs : undefined,
      };
    }
    case "axe":
      return {
        titre: texteRequis(s.titre, "titre", B.titre, err),
        description: texteFacultatif(s.description, "description", B.description, err),
      };
    case "objectif":
      return donneesObjectif(s, err);
    case "initiative":
      return donneesInitiative(s, horizon, devise, err);
  }
}

/** Supprime les clés absentes ou nulles (champs facultatifs non saisis). */
export function sansVides(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

/**
 * Contrôle la saisie et construit les `donnees` d'une version (contenu complet du type).
 * `horizon` borne les gains annuels ; `devise` convertit les montants en unités mineures.
 */
export function validerElement(
  type: TypeElementPlan,
  s: SaisieElement,
  ctx: { horizon: number; devise: Devise },
): Resultat<Record<string, unknown>, ChampElement> {
  const err: Erreurs = {};
  const donnees = donneesSelonType(type, s, ctx.horizon, ctx.devise, err);
  if (Object.keys(err).length > 0) return { ok: false, erreurs: err };
  return { ok: true, charge: sansVides(donnees) };
}

function canonique(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonique).join(",")}]`;
  if (x !== null && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && o[k] !== null)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonique(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x);
}

/** Vrai si les données saisies reprennent exactement la version courante (l'API refuserait : 409). */
export function memeContenu(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return canonique(a) === canonique(b);
}

export const MESSAGE_CONTENU_IDENTIQUE =
  "Aucune modification : le contenu est identique à la version courante.";

// --- Responsables d'initiative ----------------------------------------------------------------

/** Personne désignable comme responsable (équipe de la mission ou référentiel du cabinet). */
export interface PersonnePlan {
  id: string;
  nom: string;
}

/**
 * Personnes proposées comme responsables : le référentiel du cabinet s'il est lisible
 * (`collaborateurs.lire`), sinon l'équipe de la mission ; l'utilisateur courant toujours
 * présent (« (vous) »). Triées par nom, sans doublon.
 */
export function personnesPlan(
  cabinet: readonly { utilisateur_id: string; nom: string }[],
  equipe: readonly { utilisateur_id: string; nom: string }[],
  moi: { id: string; nom: string },
): PersonnePlan[] {
  const source = cabinet.length ? cabinet : equipe;
  const vus = new Set<string>();
  const liste: PersonnePlan[] = [];
  for (const p of source) {
    if (vus.has(p.utilisateur_id)) continue;
    vus.add(p.utilisateur_id);
    liste.push({
      id: p.utilisateur_id,
      nom: p.utilisateur_id === moi.id ? `${p.nom} (vous)` : p.nom,
    });
  }
  if (!vus.has(moi.id)) liste.push({ id: moi.id, nom: `${moi.nom} (vous)` });
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Nom affichable d'un responsable ; l'API accepte tout utilisateur interne actif. */
export function nomPersonnePlan(id: unknown, personnes: readonly PersonnePlan[]): string {
  if (typeof id !== "string" || id === "") return "Non désigné";
  return personnes.find((p) => p.id === id)?.nom ?? "Membre du cabinet (hors liste affichée)";
}

/**
 * Options du choix de responsable : « Non désigné », les personnes connues, et le
 * responsable actuel s'il n'en fait pas partie (pour ne pas le perdre en modifiant).
 */
export function optionsResponsables(
  personnes: readonly PersonnePlan[],
  actuel: string | null | undefined,
): { valeur: string; libelle: string }[] {
  const options = [
    { valeur: "", libelle: "Non désigné" },
    ...personnes.map((p) => ({ valeur: p.id, libelle: p.nom })),
  ];
  if (actuel && !personnes.some((p) => p.id === actuel)) {
    options.push({ valeur: actuel, libelle: "Responsable actuel (hors liste affichée)" });
  }
  return options;
}

// --- Texte comparable d'une version -----------------------------------------------------------

export interface ContexteTexte {
  devise: Devise;
  /** Nom d'un responsable d'initiative (identifiant → nom affichable). */
  nomResponsable: (id: string | null) => string;
  /** Titre d'une initiative du plan (dépendances) ; absent : « initiative du plan ». */
  nomInitiative?: (id: string) => string;
}

const puces = (titre: string, l: readonly string[]) =>
  `${titre}\n${l.length ? l.map((x) => `• ${x}`).join("\n") : "(aucun)"}`;

function ligne(libelle: string, v: string | null | undefined): string | null {
  return v ? `${libelle} : ${v}` : null;
}

function texteInitiative(d: Record<string, unknown>, c: ContexteTexte): string[] {
  const gains = Array.isArray(d.gains_annuels) ? (d.gains_annuels as unknown[]) : [];
  return [
    ligne(
      "Responsable",
      d.responsable_id ? c.nomResponsable(String(d.responsable_id)) : "Non désigné",
    ),
    ligne("Début", lireTexte(d, "debut") ? formaterDate(lireTexte(d, "debut")) : null),
    ligne("Échéance", formaterDate(lireTexte(d, "echeance"))),
    ligne(
      "Budget",
      formaterMontantMineur(typeof d.budget === "number" ? d.budget : null, c.devise),
    ),
    ligne("Statut", libelleStatutInitiative(d.statut)),
    ligne(
      "Dépend de",
      lireListe(d, "dependances")
        .map((id) => c.nomInitiative?.(id) ?? "initiative du plan")
        .join(", ") || null,
    ),
    ligne(
      "Gains nets annuels",
      gains.length
        ? gains
            .map((g, i) => `année ${i + 1} : ${formaterMontantMineur(g as number, c.devise)}`)
            .join(" ; ")
        : "non estimés",
    ),
  ].filter((x): x is string => x !== null);
}

/** Texte lisible et stable d'une version, pour l'historique et la comparaison mot à mot. */
export function texteElement(
  type: TypeElementPlan,
  d: Record<string, unknown>,
  c: ContexteTexte,
): string {
  const parties: (string | null)[] = (() => {
    switch (type) {
      case "diagnostic":
        return [lireTexte(d, "synthese")];
      case "swot":
        return [
          puces("Forces", lireListe(d, "forces")),
          puces("Faiblesses", lireListe(d, "faiblesses")),
          puces("Opportunités", lireListe(d, "opportunites")),
          puces("Menaces", lireListe(d, "menaces")),
        ];
      case "vision_mission":
        return [
          ligne("Vision", lireTexte(d, "vision")),
          ligne("Mission", lireTexte(d, "mission")),
          ligne("Valeurs", lireListe(d, "valeurs").join(", ") || null),
        ];
      case "axe":
        return [ligne("Titre", lireTexte(d, "titre")), lireTexte(d, "description")];
      case "objectif":
        return [
          ligne("Titre", lireTexte(d, "titre")),
          ligne("Perspective", libellePerspective(d.perspective)),
          ligne("Indicateur", lireTexte(d, "indicateur")),
          ligne("Cible", lireTexte(d, "cible")),
          ligne(
            "Échéance",
            lireTexte(d, "echeance") ? formaterDate(lireTexte(d, "echeance")) : null,
          ),
          lireTexte(d, "description"),
        ];
      case "initiative":
        return [
          ligne("Titre", lireTexte(d, "titre")),
          ...texteInitiative(d, c),
          lireTexte(d, "description"),
        ];
    }
  })();
  return parties.filter((x): x is string => Boolean(x)).join("\n\n");
}

/** Options de perspective (formulaire d'objectif). */
export const OPTIONS_PERSPECTIVES = PERSPECTIVES_PLAN.map((p) => ({
  valeur: p,
  libelle: PERSPECTIVE_LIBELLES[p],
}));

/** Options de statut d'initiative. */
export const OPTIONS_STATUTS_INITIATIVE = STATUTS_INITIATIVE.map((s) => ({
  valeur: s,
  libelle: libelleStatutInitiative(s),
}));

// --- Dépendances d'une initiative (PLA-05) ----------------------------------------------------

/** Initiative du plan proposable comme prédécesseur. */
export interface OptionInitiative {
  id: string;
  titre: string;
  retire: boolean;
}

/** Initiatives du plan (titre de la version courante, retirées comprises pour l'affichage). */
export function initiativesDuPlan(
  elements: readonly {
    id: string;
    type: string;
    retire: boolean;
    donnees: Record<string, unknown>;
  }[],
): OptionInitiative[] {
  return elements
    .filter((e) => e.type === "initiative")
    .map((e) => ({
      id: e.id,
      titre: lireTexte(e.donnees, "titre") ?? "Initiative",
      retire: e.retire,
    }));
}

/**
 * Prédécesseurs proposés : autres initiatives ACTIVES du plan (l'API refuse une initiative
 * retirée), plus celles déjà choisies (pour pouvoir les décocher), triées par titre.
 */
export function optionsDependances(
  initiatives: readonly OptionInitiative[],
  soi: string | null,
  choisies: readonly string[],
): { valeur: string; libelle: string }[] {
  return initiatives
    .filter((i) => i.id !== soi && (!i.retire || choisies.includes(i.id)))
    .map((i) => ({ valeur: i.id, libelle: i.retire ? `${i.titre} (retirée)` : i.titre }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
}

/** Titre d'une initiative pour l'affichage d'une dépendance. */
export function nomInitiative(id: string, initiatives: readonly OptionInitiative[]): string {
  const i = initiatives.find((x) => x.id === id);
  if (!i) return "Initiative inconnue";
  return i.retire ? `${i.titre} (retirée)` : i.titre;
}
