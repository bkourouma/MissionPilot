/** Redressement (saisie) : correspondance de postes, urgence et incidents de paiement. */
import {
  RED_POSTES,
  RED_REPONSES_URGENCE,
  RED_DOMAINES,
  type RedCorrespondanceCreation,
  type RedDomaine,
  type RedPoste,
  type RedPostesVue,
  type RedReferentielVue,
  type RedReponseUrgence,
  type RedScoreCreation,
  type RedUrgenceCreation,
} from "@missionpilot/shared";
import { texteOuNull, type Resultat } from "./saisie";
import {
  type Erreurs,
  FORMAT_CODE,
  lireEntier,
  CODES_PAR_POSTE_MAX,
  parserCodes,
} from "./redressement-saisie-base";

// --- Correspondance de postes ------------------------------------------------------------------------

export interface SaisiePoste {
  /** Codes séparés par des virgules. */
  codes: string;
  sans_objet: boolean;
}
export type SaisieCorrespondance = Record<RedPoste, SaisiePoste>;
export type ChampCorrespondance = "postes" | "motif" | `poste.${RedPoste}`;

/** Formulaire depuis une correspondance (courante ou indicative) : un champ par poste. */
export function saisieCorrespondanceDepuis(
  postes: RedPostesVue | null | undefined,
): SaisieCorrespondance {
  const saisie = {} as SaisieCorrespondance;
  for (const p of RED_POSTES) {
    const a = postes?.[p];
    saisie[p] = { codes: a ? a.codes.join(", ") : "", sans_objet: a?.sans_objet ?? false };
  }
  return saisie;
}

/** Postes sans code et non « Sans objet » : omis (ils restent « à renseigner », jamais zéro). */
export function corpsCorrespondanceDepuisFormulaire(
  saisie: SaisieCorrespondance,
  motif: string,
  connus: readonly string[] = [],
): Resultat<RedCorrespondanceCreation, ChampCorrespondance> {
  const erreurs: Erreurs<ChampCorrespondance> = {};
  const postes: RedCorrespondanceCreation["postes"] = {};
  for (const p of RED_POSTES) {
    const s = saisie[p];
    const codes = parserCodes(s.codes, connus);
    if (s.sans_objet) {
      if (codes.length > 0) erreurs[`poste.${p}`] = "Un poste sans objet ne porte aucun code.";
      else postes[p] = { codes: [], sans_objet: true };
      continue;
    }
    if (codes.length === 0) continue;
    if (codes.length > CODES_PAR_POSTE_MAX) {
      erreurs[`poste.${p}`] = `Cinquante codes au plus par poste (${codes.length} saisis).`;
    } else if (codes.some((c) => !FORMAT_CODE.test(c))) {
      erreurs[`poste.${p}`] =
        "Un code ne contient que des lettres, des chiffres, « . », « _ » ou « - » (40 caractères au plus).";
    } else {
      postes[p] = { codes, sans_objet: false };
    }
  }
  if (Object.keys(postes).length === 0 && Object.keys(erreurs).length === 0) {
    erreurs.postes = "Renseignez au moins un poste : des codes de lignes, ou « Sans objet ».";
  }
  const m = texteOuNull(motif);
  if (m !== null && m.length > 500) erreurs.motif = "Le motif compte 500 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: m === null ? { postes } : { postes, motif: m } };
}

// --- Urgence -------------------------------------------------------------------------------------------

export type GrilleUrgence = RedReferentielVue["grille_urgence"];

export interface GroupeQuestions {
  domaine: RedDomaine;
  questions: GrilleUrgence;
}

/** Questions regroupées par domaine, dans l'ordre des domaines (un `fieldset` par groupe). */
export function grouperQuestions(grille: GrilleUrgence): GroupeQuestions[] {
  return RED_DOMAINES.map((domaine) => ({
    domaine,
    questions: grille.filter((q) => q.domaine === domaine),
  })).filter((g) => g.questions.length > 0);
}

export function compterReponses(reponses: Readonly<Record<string, string | undefined>>): number {
  return Object.values(reponses).filter((r) => r !== undefined && r !== "").length;
}

/** « 12 questions sur 15 renseignées » (annoncé poliment). */
export function libelleCompteur(repondues: number, total: number): string {
  const s = repondues > 1 ? "s" : "";
  return `${repondues} question${s} sur ${total} renseignée${s}`;
}

export type ChampUrgence = "reponses" | "commentaire";

/** Corps de la route 12 : les seules questions renseignées ; la durée est celle passée sur la page. */
export function corpsUrgenceDepuisFormulaire(
  reponses: Readonly<Record<string, RedReponseUrgence | undefined>>,
  dureeSecondes: number | null,
  commentaire: string,
  grille: GrilleUrgence,
): Resultat<RedUrgenceCreation, ChampUrgence> {
  const erreurs: Erreurs<ChampUrgence> = {};
  const codes = new Set(grille.map((q) => q.code));
  const choisies: Record<string, RedReponseUrgence> = {};
  for (const [code, r] of Object.entries(reponses)) {
    if (r === undefined || !codes.has(code)) continue;
    if (!(RED_REPONSES_URGENCE as readonly string[]).includes(r)) continue;
    choisies[code] = r;
  }
  if (Object.keys(choisies).length === 0) {
    erreurs.reponses = "Répondez à au moins une question pour lancer l'évaluation.";
  }
  const c = texteOuNull(commentaire);
  if (c !== null && c.length > 2000)
    erreurs.commentaire = "Le commentaire compte 2 000 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedUrgenceCreation = { reponses: choisies };
  if (dureeSecondes !== null && Number.isFinite(dureeSecondes)) {
    charge.duree_secondes = Math.min(86_400, Math.max(0, Math.floor(dureeSecondes)));
  }
  if (c !== null) charge.commentaire = c;
  return { ok: true, charge };
}

// --- Incidents de paiement (score d'alerte) -------------------------------------------------------------

export type ReponseTernaire = "oui" | "non" | "inconnu";
export interface SaisieIncidents {
  /** Vide : inconnu. */
  rejets: string;
  /** Vide : inconnu. */
  retards: string;
  arrieres: ReponseTernaire;
}
export type ChampIncidents = "rejets" | "retards";

export function saisieIncidentsDepuis(
  incidents:
    | {
        rejets_bancaires_12m: number | null;
        retards_fournisseurs_90j: number | null;
        arrieres_fiscaux_sociaux: boolean | null;
      }
    | null
    | undefined,
): SaisieIncidents {
  return {
    rejets: incidents?.rejets_bancaires_12m != null ? String(incidents.rejets_bancaires_12m) : "",
    retards:
      incidents?.retards_fournisseurs_90j != null ? String(incidents.retards_fournisseurs_90j) : "",
    arrieres:
      incidents?.arrieres_fiscaux_sociaux == null
        ? "inconnu"
        : incidents.arrieres_fiscaux_sociaux
          ? "oui"
          : "non",
  };
}

export function corpsScoreDepuisFormulaire(
  s: SaisieIncidents,
): Resultat<RedScoreCreation, ChampIncidents> {
  const erreurs: Erreurs<ChampIncidents> = {};
  const rejets = lireEntier(s.rejets, 0, 999);
  const retards = lireEntier(s.retards, 0, 999);
  if (rejets !== null && Number.isNaN(rejets))
    erreurs.rejets = "Saisissez un nombre entier de 0 à 999.";
  if (retards !== null && Number.isNaN(retards))
    erreurs.retards = "Saisissez un nombre entier de 0 à 999.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      incidents: {
        rejets_bancaires_12m: rejets,
        retards_fournisseurs_90j: retards,
        arrieres_fiscaux_sociaux: s.arrieres === "inconnu" ? null : s.arrieres === "oui",
      },
    },
  };
}
