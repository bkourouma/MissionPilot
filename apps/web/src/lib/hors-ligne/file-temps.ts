/**
 * File locale des saisies de temps faites hors connexion : logique pure, testée dans
 * `file-temps.test.ts` (magasin simulé, IndexedDB simulé).
 *
 * - Une entrée par feuille et par utilisateur : l'API remplace toutes les lignes d'une feuille
 *   d'un coup (`PUT /feuilles-temps/:id/lignes`), seul le dernier état compte. Une nouvelle
 *   saisie remplace donc l'entrée de sa feuille et prend la dernière place dans la file.
 * - Rejeu dans l'ordre des séquences ; une coupure arrête le rejeu (rien n'est envoyé hors
 *   ordre), un conflit (feuille soumise, validée, période clôturée…) met l'entrée de côté pour
 *   décision de l'utilisateur et le rejeu continue avec la suivante. Rien n'est jamais perdu
 *   sans action explicite (« Abandonner »).
 * - Clé d'idempotence par entrée (`cle`, aléatoire) : une entrée n'est retirée qu'après
 *   confirmation de l'API pour CETTE clé, un seul rejeu tourne à la fois (verrou par onglet et,
 *   si le navigateur le permet, entre onglets). La clé est transmise à l'API
 *   (en-tête `Idempotency-Key`, `envoi.ts`) : une saisie déjà appliquée n'est jamais ré-appliquée.
 * - Contenu : identifiants de feuille, de tâches et d'activités, valeurs saisies. Jamais de
 *   jeton, de cookie, de libellé de mission ni de donnée financière.
 */
import { ErreurApi, MESSAGE_INATTENDU, messageErreur } from "../api";
import type { LigneCharge, UniteSaisie } from "../temps";

/** `en_attente` : à envoyer ; `a_corriger` : saisie illisible, jamais envoyée en l'état. */
export type EtatEntree = "en_attente" | "a_corriger" | "conflit" | "refuse";

export interface SaisieEnAttente {
  /** Clé d'idempotence, propre à cet état de la feuille. */
  cle: string;
  utilisateurId: string;
  feuilleId: string;
  /** Lundi de la semaine (AAAA-MM-JJ), pour l'affichage. */
  semaine: string;
  unite: UniteSaisie;
  sequence: number;
  /** Horodatage local de la saisie (ms). */
  creeLe: number;
  /** Clés des rangées affichées et texte saisi par case (`rangée|date`), pour restaurer. */
  rangees: string[];
  valeurs: Record<string, string>;
  /** Corps du `PUT`, `null` quand la saisie est à corriger. */
  charge: { lignes: LigneCharge[] } | null;
  etat: EtatEntree;
  tentatives: number;
  motif?: { code: string; message: string };
}

/** Stockage des entrées (IndexedDB, `localStorage` ou mémoire : voir `magasins.ts`). */
export interface Magasin {
  readonly persistant: boolean;
  tout(): Promise<SaisieEnAttente[]>;
  mettre(e: SaisieEnAttente): Promise<void>;
  retirer(cle: string): Promise<void>;
  vider(): Promise<void>;
}

const ETATS: readonly EtatEntree[] = ["en_attente", "a_corriger", "conflit", "refuse"];

/** Contrôle d'une entrée relue du stockage (données d'un autre onglet, d'une autre version). */
export function estSaisie(v: unknown): v is SaisieEnAttente {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const valeurs = o.valeurs;
  return (
    typeof o.cle === "string" &&
    typeof o.utilisateurId === "string" &&
    typeof o.feuilleId === "string" &&
    typeof o.semaine === "string" &&
    (o.unite === "demi_journee" || o.unite === "heure") &&
    typeof o.sequence === "number" &&
    typeof o.creeLe === "number" &&
    Array.isArray(o.rangees) &&
    o.rangees.every((r) => typeof r === "string") &&
    typeof valeurs === "object" &&
    valeurs !== null &&
    Object.values(valeurs).every((x) => typeof x === "string") &&
    (o.charge === null ||
      (typeof o.charge === "object" && Array.isArray((o.charge as { lignes?: unknown }).lignes))) &&
    ETATS.includes(o.etat as EtatEntree) &&
    typeof o.tentatives === "number"
  );
}

/** Clé d'idempotence aléatoire (UUID v4 si possible). */
export function nouvelleCle(aleatoire: () => number = Math.random): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(aleatoire() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(aleatoire() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

const parOrdre = (a: SaisieEnAttente, b: SaisieEnAttente) =>
  a.sequence - b.sequence || a.creeLe - b.creeLe || a.cle.localeCompare(b.cle);

/** Entrées de l'utilisateur, dans l'ordre de la file. */
export async function lister(m: Magasin, utilisateurId: string): Promise<SaisieEnAttente[]> {
  return (await m.tout()).filter((e) => e.utilisateurId === utilisateurId).sort(parOrdre);
}

export type NouvelleSaisie = Omit<SaisieEnAttente, "sequence" | "etat" | "tentatives" | "motif">;

/**
 * Met une saisie en file : elle remplace l'entrée de la même feuille (quel que soit son état)
 * et passe en dernière position.
 */
export async function mettreEnFile(m: Magasin, s: NouvelleSaisie): Promise<SaisieEnAttente> {
  const toutes = await m.tout();
  const sequence = toutes.reduce((max, e) => Math.max(max, e.sequence), 0) + 1;
  const entree: SaisieEnAttente = {
    ...s,
    sequence,
    etat: s.charge ? "en_attente" : "a_corriger",
    tentatives: 0,
  };
  await m.mettre(entree);
  for (const e of toutes) {
    if (e.utilisateurId === s.utilisateurId && e.feuilleId === s.feuilleId && e.cle !== s.cle) {
      await m.retirer(e.cle);
    }
  }
  return entree;
}

async function relire(m: Magasin, cle: string): Promise<SaisieEnAttente | undefined> {
  return (await m.tout()).find((e) => e.cle === cle);
}

/** Met à jour une entrée seulement si elle n'a pas été remplacée entre-temps. */
async function modifierSiPresente(
  m: Magasin,
  cle: string,
  changer: (e: SaisieEnAttente) => SaisieEnAttente,
): Promise<SaisieEnAttente | undefined> {
  const e = await relire(m, cle);
  if (!e) return undefined;
  const suivante = changer(e);
  await m.mettre(suivante);
  return suivante;
}

/** Met l'entrée de côté (conflit ou refus) : elle n'est plus rejouée sans décision. */
export function mettreDeCote(
  m: Magasin,
  cle: string,
  etat: "conflit" | "refuse",
  motif: { code: string; message: string },
) {
  return modifierSiPresente(m, cle, (e) => ({ ...e, etat, motif }));
}

/** Décision « Renvoyer ma saisie » : l'entrée repart, en fin de file. */
export async function renvoyer(m: Magasin, cle: string) {
  const sequence = (await m.tout()).reduce((max, e) => Math.max(max, e.sequence), 0) + 1;
  return modifierSiPresente(m, cle, (e) => {
    const suivante: SaisieEnAttente = {
      ...e,
      sequence,
      tentatives: 0,
      etat: e.charge ? "en_attente" : "a_corriger",
    };
    delete suivante.motif;
    return suivante;
  });
}

/** Décision « Abandonner ma saisie ». */
export const abandonner = (m: Magasin, cle: string) => m.retirer(cle);

/** Purge complète (déconnexion). */
export const purger = (m: Magasin) => m.vider();

/** Retire les saisies d'un autre compte (appareil partagé) : jamais affichées ni rejouées. */
export async function purgerAutresUtilisateurs(m: Magasin, utilisateurId: string) {
  for (const e of await m.tout()) {
    if (e.utilisateurId !== utilisateurId) await m.retirer(e.cle);
  }
}

/** Issue d'un envoi refusé ou interrompu. */
export type Issue = "reseau" | "session" | "conflit" | "refuse";

/**
 * Réseau, délai, 5xx, 429 : à retenter. 401 ou 2FA à configurer : session à rouvrir (la saisie
 * attend). 409, 403, 404, 423 : l'état de la feuille a changé côté serveur (conflit). Le reste
 * (400, 422…) : saisie refusée, à corriger.
 */
export function classer(e: unknown): Issue {
  if (!(e instanceof ErreurApi)) return "refuse";
  if (e.statut === 0 || e.statut >= 500 || e.statut === 429) return "reseau";
  if (e.statut === 401 || e.code === "TFA_A_CONFIGURER") return "session";
  if ([403, 404, 409, 423].includes(e.statut)) return "conflit";
  return "refuse";
}

/** Code posé par le client quand la feuille a changé depuis la saisie locale. */
export const CODE_MODIFIEE_AILLEURS = "MODIFIEE_AILLEURS";
export const CODE_NON_MODIFIABLE = "FEUILLE_NON_MODIFIABLE";

const LIBELLES_CONFLIT: Record<string, string> = {
  PERIODE_CLOTUREE:
    "Une partie de la période a été clôturée entre-temps : ces temps ne peuvent plus être saisis directement. Gardez votre saisie pour une demande de correction, ou abandonnez-la.",
  CONFLIT:
    "La feuille a été soumise ou validée entre-temps : votre saisie n'a pas été appliquée. Pour modifier des temps validés, faites une demande de correction.",
  [CODE_NON_MODIFIABLE]:
    "La feuille n'est plus modifiable (soumise, validée ou verrouillée) : votre saisie n'a pas été appliquée.",
  [CODE_MODIFIEE_AILLEURS]:
    "La feuille a été modifiée depuis un autre appareil après votre saisie : choisissez la version à garder.",
  INTROUVABLE: "La feuille n'existe plus ou ne vous est plus accessible.",
  INTERDIT: "Vous ne pouvez plus modifier cette feuille.",
};

/** Motif enregistré pour une erreur d'envoi (message de l'API en repli, toujours en français). */
export function motifDepuisErreur(e: unknown): { code: string; message: string } {
  if (!(e instanceof ErreurApi)) return { code: "ERREUR_INATTENDUE", message: MESSAGE_INATTENDU };
  const code = e.statut === 404 ? "INTROUVABLE" : e.statut === 403 ? "INTERDIT" : e.code;
  return { code, message: LIBELLES_CONFLIT[code] ?? messageErreur(e) };
}

export function libelleMotif(motif: { code: string; message: string } | undefined): string {
  if (!motif) return "";
  return LIBELLES_CONFLIT[motif.code] ?? motif.message;
}

/** Demande de correction utile : temps validés ou période clôturée. */
export const correctionPossible = (motif: { code: string } | undefined) =>
  motif?.code === "PERIODE_CLOTUREE" ||
  motif?.code === "CONFLIT" ||
  motif?.code === CODE_NON_MODIFIABLE;

export interface Bilan {
  envoyes: { cle: string; feuilleId: string; reponse: unknown }[];
  misDeCote: SaisieEnAttente[];
  /** Pourquoi le rejeu s'est arrêté avant la fin de la file (`null` : file traitée). */
  arret: null | "reseau" | "session";
}

export interface OptionsRejeu {
  magasin: Magasin;
  utilisateurId: string;
  envoyer: (e: SaisieEnAttente) => Promise<unknown>;
}

/** Traite la file une fois, dans l'ordre (ne pas appeler directement : voir `creerRejoueur`). */
export async function rejouerUneFois({ magasin, utilisateurId, envoyer }: OptionsRejeu) {
  const bilan: Bilan = { envoyes: [], misDeCote: [], arret: null };
  const file = (await lister(magasin, utilisateurId)).filter((e) => e.etat === "en_attente");
  for (const e of file) {
    // L'entrée a pu être remplacée (nouvelle saisie) ou abandonnée pendant le rejeu.
    const actuelle = await relire(magasin, e.cle);
    if (!actuelle || actuelle.etat !== "en_attente") continue;
    let reponse: unknown;
    try {
      reponse = await envoyer(actuelle);
    } catch (erreur) {
      const issue = classer(erreur);
      if (issue === "reseau" || issue === "session") {
        await modifierSiPresente(magasin, actuelle.cle, (x) => ({
          ...x,
          tentatives: x.tentatives + 1,
        }));
        bilan.arret = issue;
        return bilan;
      }
      const mise = await mettreDeCote(magasin, actuelle.cle, issue, motifDepuisErreur(erreur));
      if (mise) bilan.misDeCote.push(mise);
      continue;
    }
    // Un échec du stockage ici remonte à l'appelant : l'entrée restée en file sera renvoyée,
    // sans effet de bord puisque le `PUT` complet rejoué donne le même état.
    await magasin.retirer(actuelle.cle);
    bilan.envoyes.push({ cle: actuelle.cle, feuilleId: actuelle.feuilleId, reponse });
  }
  return bilan;
}

/** Exécute `fn` sous un verrou partagé entre onglets quand le navigateur le permet. */
export type Verrou = <T>(fn: () => Promise<T>) => Promise<T>;

export const verrouNavigateur: Verrou = (fn) => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") return fn();
  return locks.request("missionpilot-rejeu-temps", () => fn()) as ReturnType<typeof fn>;
};

/**
 * Rejoueur à exécution unique : un appel pendant un rejeu en cours est servi par UN rejeu
 * suivant (une saisie arrivée pendant l'envoi part donc aussi), jamais par deux en parallèle.
 */
export function creerRejoueur(verrou: Verrou = verrouNavigateur) {
  let courant: Promise<Bilan> | null = null;
  let suivant: Promise<Bilan> | null = null;
  const rejouer = (o: OptionsRejeu): Promise<Bilan> => {
    if (!courant) {
      courant = verrou(() => rejouerUneFois(o)).finally(() => {
        courant = null;
      });
      return courant;
    }
    if (!suivant) {
      suivant = courant
        .catch(() => undefined)
        .then(() => {
          suivant = null;
          return rejouer(o);
        });
    }
    return suivant;
  };
  return rejouer;
}

/**
 * Que faire, à l'ouverture d'une feuille, de la saisie locale qui la concerne ?
 * - `restaurer` : feuille modifiable, saisie postérieure à la dernière modification connue ;
 * - `non_modifiable` : la feuille a été soumise, validée ou verrouillée entre-temps ;
 * - `modifiee_ailleurs` : la feuille a changé côté serveur après la saisie (autre appareil) ;
 * - `decision` : la saisie est déjà de côté (conflit, refus) et attend un choix.
 * Dans aucun cas la saisie n'est jetée sans que l'utilisateur l'ait décidé.
 */
export function decisionAuChargement(
  e: SaisieEnAttente | undefined,
  feuille: { modifiable: boolean; modifieLe: string },
): "aucune" | "restaurer" | "non_modifiable" | "modifiee_ailleurs" | "decision" {
  if (!e) return "aucune";
  if (!feuille.modifiable) return "non_modifiable";
  if (e.etat === "conflit" || e.etat === "refuse") return "decision";
  const serveur = Date.parse(feuille.modifieLe);
  if (e.etat === "en_attente" && Number.isFinite(serveur) && serveur > e.creeLe) {
    return "modifiee_ailleurs";
  }
  return "restaurer";
}

/** Délai avant une nouvelle tentative : 2 s, 4 s, 8 s… plafonné à 30 s. */
export function delaiReprise(tentatives: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, Math.min(tentatives, 10)));
}

/** Nombre de cases remplies d'une saisie (affichage du détail). */
export function casesRemplies(
  e: Pick<SaisieEnAttente, "valeurs">,
): { cle: string; date: string; valeur: string }[] {
  return Object.entries(e.valeurs)
    .filter(([, v]) => v.trim() !== "")
    .map(([cle, valeur]) => ({
      cle,
      date: cle.slice(cle.lastIndexOf("|") + 1),
      valeur: valeur.trim(),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.cle.localeCompare(b.cle));
}
