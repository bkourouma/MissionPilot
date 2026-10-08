/**
 * Feuilles de temps (TPS-01 à TPS-05) : types des réponses de l'API, lecture des saisies,
 * charge utile de `PUT /api/feuilles-temps/:id/lignes` et règles d'affichage des actions.
 * Logique pure, testée dans `temps.test.ts`.
 *
 * L'interface saisit dans l'unité du cabinet (jours au pas de 0,5, ou heures) et n'effectue
 * qu'une somme d'affichage : la conversion en jours, le contrôle de capacité, l'affectation
 * des tâches et le verrouillage des périodes sont faits par l'API.
 */
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { formaterNombre } from "./format";
import { lireNombre, type Resultat } from "./saisie";

export type UniteSaisie = "demi_journee" | "heure";
export type StatutFeuille = "brouillon" | "soumise" | "validee" | "rejetee" | "verrouillee";
export type StatutPartie = "en_attente" | "validee" | "rejetee";

export interface ActiviteInterne {
  id: string;
  code: string;
  libelle: string;
  est_absence: boolean;
  actif?: boolean;
}

export interface LigneFeuille {
  id: string;
  date: string;
  mission_id: string | null;
  mission_intitule: string | null;
  tache_id: string | null;
  tache_libelle: string | null;
  activite_id: string | null;
  activite_code: string | null;
  activite_libelle: string | null;
  jours: number;
  heures: number | null;
  commentaire: string | null;
}

export interface PartieFeuille {
  mission_id: string | null;
  intitule: string;
  statut: StatutPartie | null;
  decide_par: string | null;
  decide_le: string | null;
  motif: string | null;
  peut_decider: boolean;
}

export interface Avertissement {
  code: string;
  message: string;
}

export interface Feuille {
  id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  auteur_id: string | null;
  semaine: string;
  statut: StatutFeuille;
  origine: string;
  cycle: number;
  soumise_le: string | null;
  validee_le: string | null;
  rejetee_le: string | null;
  motif_rejet: string | null;
  verrouillee_le: string | null;
  modifie_le: string;
  lignes: LigneFeuille[];
  parties: PartieFeuille[];
  vue_partielle: boolean;
  totaux: { par_jour: { date: string; jours: number }[]; semaine: number };
  avertissements: Avertissement[];
}

export interface LignePreRemplie {
  date: string;
  mission_id: string;
  tache_id: string;
  jours: number;
  tache_libelle: string | null;
  mission_intitule: string | null;
}

/** Réponse de `GET /api/feuilles-temps/semaine`. */
export interface SemaineTemps {
  semaine: { debut: string; fin: string };
  unite_saisie_temps: UniteSaisie;
  heures_par_jour: number;
  controle_capacite: "signaler" | "refuser";
  activites: ActiviteInterne[];
  jours_clotures: string[];
  collaborateur: { id: string; nom: string } | null;
  feuille: Feuille | null;
  pre_remplissage: LignePreRemplie[];
}

/** Élément de `GET /api/feuilles-temps` (liste, sans les lignes). */
export interface ResumeFeuille {
  id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  auteur_id: string | null;
  semaine: string;
  statut: StatutFeuille;
  cycle: number;
  soumise_le: string | null;
  validee_le: string | null;
  rejetee_le: string | null;
}

export const STATUT_FEUILLE: Record<StatutFeuille, { libelle: string; tonalite: TonaliteStatut }> =
  {
    brouillon: { libelle: "Brouillon", tonalite: "neutre" },
    soumise: { libelle: "Soumise, en attente de validation", tonalite: "attention" },
    validee: { libelle: "Validée", tonalite: "succes" },
    rejetee: { libelle: "Rejetée", tonalite: "danger" },
    verrouillee: { libelle: "Verrouillée (période clôturée)", tonalite: "neutre" },
  };

export const STATUT_PARTIE: Record<StatutPartie, { libelle: string; tonalite: TonaliteStatut }> = {
  en_attente: { libelle: "En attente", tonalite: "attention" },
  validee: { libelle: "Validée", tonalite: "succes" },
  rejetee: { libelle: "Rejetée", tonalite: "danger" },
};

/** Unité affichée : « j » ou « h ». */
export const SYMBOLE_UNITE: Record<UniteSaisie, string> = { demi_journee: "j", heure: "h" };
export const NOM_UNITE: Record<UniteSaisie, string> = {
  demi_journee: "jours (pas de 0,5)",
  heure: "heures",
};

// --- Lecture d'une case ---------------------------------------------------------------

export type LectureCase = { ok: true; valeur: number | null } | { ok: false; message: string };

/**
 * Texte d'une case → valeur dans l'unité du cabinet. Vide ou zéro : pas de ligne. Jours :
 * multiples de 0,5, 3 au plus. Heures : minutes entières, 24 au plus.
 */
export function lireCase(texte: string, unite: UniteSaisie): LectureCase {
  const n = lireNombre(texte);
  if (n === null) return { ok: true, valeur: null };
  if (Number.isNaN(n)) return { ok: false, message: "Nombre invalide (ex. 0,5)." };
  if (n < 0) return { ok: false, message: "Valeur positive attendue." };
  if (n === 0) return { ok: true, valeur: null };
  if (unite === "demi_journee") {
    if (n > 3) return { ok: false, message: "3 jours au plus par case." };
    if (Math.abs(n * 2 - Math.round(n * 2)) > 1e-9)
      return { ok: false, message: "Par pas de 0,5 jour (0,5 ; 1 ; 1,5…)." };
    return { ok: true, valeur: n };
  }
  if (n > 24) return { ok: false, message: "24 heures au plus par case." };
  if (Math.abs(n * 60 - Math.round(n * 60)) > 1e-6)
    return { ok: false, message: "Heures en minutes entières (ex. 1,5 ou 7,25)." };
  return { ok: true, valeur: n };
}

/** Valeur de l'API → texte modifiable (« 2,5 »). */
export const valeurVersTexte = (v: number | null | undefined): string =>
  v === null || v === undefined || v === 0 ? "" : String(v).replace(".", ",");

// --- Grille de saisie -----------------------------------------------------------------

/** Rangée de la grille : une tâche affectée ou une activité interne. */
export interface Rangee {
  /** « t:<tache_id> » ou « a:<activite_id> ». */
  cle: string;
  type: "tache" | "activite";
  id: string;
  libelle: string;
  /** Intitulé de la mission, ou « Activités internes ». */
  groupe: string;
  mission_id: string | null;
  est_absence?: boolean;
}

export const GROUPE_INTERNE = "Activités internes";
export const cleTache = (id: string) => `t:${id}`;
export const cleActivite = (id: string) => `a:${id}`;
export const cleCase = (rangee: string, date: string) => `${rangee}|${date}`;

/** Tâche affectée de la semaine (issue de « Mon planning »). */
export interface TacheAffectee {
  tache_id: string;
  tache_libelle: string | null;
  mission_id: string;
  mission_intitule: string | null;
}

export function trierRangees(r: Rangee[]): Rangee[] {
  const rang = (x: Rangee) => (x.type === "activite" ? 1 : 0);
  return r.sort(
    (a, b) =>
      rang(a) - rang(b) ||
      a.groupe.localeCompare(b.groupe, "fr") ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}

/**
 * Rangées initiales : lignes déjà saisies, puis tâches affectées de la semaine (même à zéro,
 * pour qu'elles soient saisissables sans recherche), sans doublon.
 */
export function rangeesInitiales(
  lignes: readonly LigneFeuille[],
  taches: readonly TacheAffectee[],
  activites: readonly ActiviteInterne[],
  clesSupplementaires: readonly string[] = [],
): Rangee[] {
  const parCle = new Map<string, Rangee>();
  for (const l of lignes) {
    if (l.tache_id) {
      parCle.set(cleTache(l.tache_id), {
        cle: cleTache(l.tache_id),
        type: "tache",
        id: l.tache_id,
        libelle: l.tache_libelle ?? "Tâche",
        groupe: l.mission_intitule ?? "Mission",
        mission_id: l.mission_id,
      });
    } else if (l.activite_id) {
      parCle.set(cleActivite(l.activite_id), {
        cle: cleActivite(l.activite_id),
        type: "activite",
        id: l.activite_id,
        libelle: l.activite_libelle ?? "Activité interne",
        groupe: GROUPE_INTERNE,
        mission_id: null,
        est_absence: activites.find((a) => a.id === l.activite_id)?.est_absence ?? false,
      });
    }
  }
  for (const t of taches) {
    const cle = cleTache(t.tache_id);
    if (parCle.has(cle)) continue;
    parCle.set(cle, {
      cle,
      type: "tache",
      id: t.tache_id,
      libelle: t.tache_libelle ?? "Tâche",
      groupe: t.mission_intitule ?? "Mission",
      mission_id: t.mission_id,
    });
  }
  for (const cle of clesSupplementaires) {
    if (parCle.has(cle) || !cle.startsWith("a:")) continue;
    const a = activites.find((x) => cleActivite(x.id) === cle);
    if (a) parCle.set(cle, rangeeActivite(a));
  }
  return trierRangees([...parCle.values()]);
}

export function rangeeActivite(a: ActiviteInterne): Rangee {
  return {
    cle: cleActivite(a.id),
    type: "activite",
    id: a.id,
    libelle: a.libelle,
    groupe: GROUPE_INTERNE,
    mission_id: null,
    est_absence: a.est_absence,
  };
}

/** Rangées minimales (type et identifiant) reconstruites depuis leurs clés, pour l'envoi. */
export function rangeesDepuisCles(cles: readonly string[]): Pick<Rangee, "cle" | "type" | "id">[] {
  return cles
    .filter((c) => /^[ta]:[0-9a-f-]{36}$/i.test(c))
    .map((cle) => ({ cle, type: cle.startsWith("t:") ? "tache" : "activite", id: cle.slice(2) }));
}

/** Valeurs initiales des cases (texte), dans l'unité du cabinet. */
export function valeursInitiales(
  lignes: readonly LigneFeuille[],
  unite: UniteSaisie,
): Record<string, string> {
  const valeurs: Record<string, string> = {};
  for (const l of lignes) {
    const rangee = l.tache_id
      ? cleTache(l.tache_id)
      : l.activite_id
        ? cleActivite(l.activite_id)
        : null;
    if (!rangee) continue;
    valeurs[cleCase(rangee, l.date)] = valeurVersTexte(unite === "heure" ? l.heures : l.jours);
  }
  return valeurs;
}

export interface LigneCharge {
  date: string;
  tache_id?: string;
  activite_id?: string;
  jours?: number;
  heures?: number;
}

/**
 * Charge utile du remplacement des lignes : une ligne par case non vide. Une case illisible
 * bloque l'envoi (message par case) ; rien n'est arrondi ni converti ici.
 */
export function construireCharge(
  rangees: readonly Pick<Rangee, "cle" | "type" | "id">[],
  valeurs: Readonly<Record<string, string>>,
  jours: readonly string[],
  unite: UniteSaisie,
): Resultat<{ lignes: LigneCharge[] }, string> {
  const erreurs: Record<string, string> = {};
  const lignes: LigneCharge[] = [];
  for (const r of rangees) {
    for (const date of jours) {
      const cle = cleCase(r.cle, date);
      const lu = lireCase(valeurs[cle] ?? "", unite);
      if (!lu.ok) {
        erreurs[cle] = lu.message;
        continue;
      }
      if (lu.valeur === null) continue;
      lignes.push({
        date,
        ...(r.type === "tache" ? { tache_id: r.id } : { activite_id: r.id }),
        ...(unite === "heure" ? { heures: lu.valeur } : { jours: lu.valeur }),
      });
    }
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { lignes } };
}

/**
 * Somme d'affichage des cases lisibles (en centièmes ou en minutes entières, sans erreur
 * d'arrondi). Ce total indicatif n'est pas un chiffre métier : le total de référence et le
 * contrôle de capacité viennent de l'API.
 */
export function sommeAffichage(textes: readonly string[], unite: UniteSaisie): number {
  const facteur = unite === "heure" ? 60 : 100;
  let total = 0;
  for (const t of textes) {
    const lu = lireCase(t, unite);
    if (lu.ok && lu.valeur !== null) total += Math.round(lu.valeur * facteur);
  }
  return total / facteur;
}

/** « 2,5 j » ou « 7,5 h ». */
export const formaterValeur = (v: number, unite: UniteSaisie) =>
  `${formaterNombre(v, 2)}\u00a0${SYMBOLE_UNITE[unite]}`;

// --- Règles d'actions --------------------------------------------------------------------

export interface ActionsFeuille {
  /** L'auteur modifie sa feuille en brouillon ou rejetée. */
  modifier: boolean;
  soumettre: boolean;
  libelleSoumettre: string;
}

export function actionsFeuille(
  f: Pick<Feuille, "statut" | "auteur_id"> | null,
  utilisateurId: string,
): ActionsFeuille {
  const auteur = f !== null && f.auteur_id === utilisateurId;
  const modifiable = auteur && (f.statut === "brouillon" || f.statut === "rejetee");
  return {
    modifier: modifiable,
    soumettre: modifiable,
    libelleSoumettre: f?.statut === "rejetee" ? "Resoumettre la feuille" : "Soumettre la feuille",
  };
}

/**
 * Bouton de décision sur une partie : l'API le permet (`peut_decider`), la feuille est soumise
 * et l'utilisateur n'en est jamais l'auteur (même associé : on ne valide pas sa propre feuille
 * depuis l'interface).
 */
export function peutDeciderPartie(
  f: Pick<Feuille, "statut" | "auteur_id">,
  p: Pick<PartieFeuille, "peut_decider">,
  utilisateurId: string,
): boolean {
  return p.peut_decider && f.statut === "soumise" && f.auteur_id !== utilisateurId;
}

/** Motif d'un rejet ou d'un refus : obligatoire, 500 caractères au plus. */
export function validerMotif(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif: "Indiquez le motif." } };
  if (m.length > 500) return { ok: false, erreurs: { motif: "500 caractères au plus." } };
  return { ok: true, charge: { motif: m } };
}

/** Lignes d'une partie (mission ou activités internes) d'une feuille. */
export function lignesDePartie(
  lignes: readonly LigneFeuille[],
  missionId: string | null,
): LigneFeuille[] {
  return lignes.filter((l) => l.mission_id === missionId);
}

// --- Reste à faire (TPS-05) -----------------------------------------------------------------

export interface SaisieReste {
  tache_id: string;
  mission_id: string;
  texte: string;
  /** Dernière valeur déclarée (texte), pour n'envoyer que les changements. */
  initial: string;
}

/**
 * Déclarations du reste à faire groupées par mission (un appel par mission). Valeur en jours,
 * positive, au centième ; seules les cases modifiées et non vides partent.
 */
export function chargesResteAFaire(
  saisies: readonly SaisieReste[],
  semaine: string,
  unite: UniteSaisie = "demi_journee",
): Resultat<
  {
    mission_id: string;
    corps: { semaine: string; lignes: { tache_id: string; jours: number }[] };
  }[],
  string
> {
  const erreurs: Record<string, string> = {};
  const parMission = new Map<string, { tache_id: string; jours: number }[]>();
  for (const s of saisies) {
    if (s.texte.trim() === s.initial.trim()) continue;
    const n = lireNombre(s.texte);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 9999) {
      erreurs[s.tache_id] = "Nombre de jours positif (ex. 2,5).";
      continue;
    }
    if (unite === "demi_journee" && Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) {
      erreurs[s.tache_id] = "Par pas de 0,5 jour.";
      continue;
    }
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
      erreurs[s.tache_id] = "Deux décimales au plus.";
      continue;
    }
    parMission.set(s.mission_id, [
      ...(parMission.get(s.mission_id) ?? []),
      { tache_id: s.tache_id, jours: n },
    ]);
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: [...parMission].map(([mission_id, lignes]) => ({
      mission_id,
      corps: { semaine, lignes },
    })),
  };
}
