/**
 * Rapport d'état financier du dossier client (carte « Finances »). Logique pure, testée dans
 * `rapport-etat-financier.test.ts`.
 *
 * Les chiffres du rapport viennent du moteur de calcul côté serveur ; le commentaire est celui
 * du consultant, ajouté tel quel. Le rapport est un brouillon à relire avant diffusion. Rien
 * n'est conservé dans le navigateur.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import { LIMITE_PAGE_MAX } from "./pagination";
import { messageRapport, type RapportMission } from "./rapports";

export const FORMATS_ETAT_FINANCIER = ["pdf", "docx"] as const;
export type FormatEtatFinancier = (typeof FORMATS_ETAT_FINANCIER)[number];

export const FORMATS_ETAT_FINANCIER_LIBELLES: Record<
  FormatEtatFinancier,
  { libelle: string; aide: string }
> = {
  pdf: { libelle: "PDF", aide: "Pour lire et imprimer. Rendu plus long : jusqu'à 30 secondes." },
  docx: { libelle: "Word (.docx)", aide: "Document modifiable avant diffusion." },
};

export const FORMATS_ETAT_FINANCIER_LIBELLES_EN: Record<
  FormatEtatFinancier,
  { libelle: string; aide: string }
> = {
  pdf: { libelle: "PDF", aide: "For reading and printing. Longer rendering: up to 30 seconds." },
  docx: { libelle: "Word (.docx)", aide: "Editable document before distribution." },
};

/** Libellé et aide d'un format dans la langue demandée. */
export const formatEtatFinancier = (f: FormatEtatFinancier, langue: Langue = "fr") =>
  (langue === "en" ? FORMATS_ETAT_FINANCIER_LIBELLES_EN : FORMATS_ETAT_FINANCIER_LIBELLES)[f];

export const estFormatEtatFinancier = (v: unknown): v is FormatEtatFinancier =>
  typeof v === "string" && (FORMATS_ETAT_FINANCIER as readonly string[]).includes(v);

export const EXERCICES_MIN = 1;
export const EXERCICES_MAX = 5;
export const EXERCICES_DEFAUT = 3;
export const COMMENTAIRE_MAX = 4000;

export const MODELE_ETAT_FINANCIER = "etat_financier";

/** Mission telle que listée par GET /api/missions (seuls les champs utiles ici). */
export interface MissionChoix {
  id: string;
  intitule: string;
  statut: string;
}

const segment = (id: string) => encodeURIComponent(id);

/** Missions du client (GET /api/missions filtré) : une page au plafond de l'API (500), filtrée ensuite côté web. */
export function cheminMissionsClient(clientId: string): string {
  const q = new URLSearchParams({ client_id: clientId, limite: String(LIMITE_PAGE_MAX) });
  return `/api/missions?${q.toString()}`;
}

/** Missions sur lesquelles un rapport peut être généré : non clôturées, triées par intitulé. */
export function missionsGenerables<T extends MissionChoix>(missions: readonly T[]): T[] {
  return missions
    .filter((m) => m.statut !== "cloturee")
    .sort((a, b) => a.intitule.localeCompare(b.intitule, "fr"));
}

/** Entier de 1 à 5 dans une saisie ; null si la saisie n'est pas valide. */
export function lireExercices(saisie: string): number | null {
  const t = saisie.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= EXERCICES_MIN && n <= EXERCICES_MAX ? n : null;
}

export const MESSAGE_EXERCICES = `Indiquez un nombre entier d'exercices entre ${EXERCICES_MIN} et ${EXERCICES_MAX}.`;
export const MESSAGE_EXERCICES_EN = `Enter a whole number of fiscal years between ${EXERCICES_MIN} and ${EXERCICES_MAX}.`;

/** Longueur du commentaire telle que l'API la compte (caractères Unicode, pas unités UTF-16). */
export function longueurCommentaire(texte: string): number {
  return Array.from(texte).length;
}

/** Texte envoyé : vide ou espaces seuls = pas de commentaire (undefined) ; sinon tel quel. */
export function commentaireEnvoye(texte: string): string | undefined {
  return texte.trim() === "" ? undefined : texte;
}

export function erreurCommentaire(texte: string, langue: Langue = "fr"): string | null {
  return longueurCommentaire(texte) > COMMENTAIRE_MAX
    ? creerTraduire(langue)(
        `Le commentaire est limité à ${COMMENTAIRE_MAX} caractères.`,
        `The comment is limited to ${COMMENTAIRE_MAX} characters.`,
      )
    : null;
}

/** Compteur annoncé : « 12 / 4000 caractères ». */
export const compteurCommentaire = (texte: string, langue: Langue = "fr") =>
  `${longueurCommentaire(texte)} / ${COMMENTAIRE_MAX} ${langue === "en" ? "characters" : "caractères"}`;

export interface DemandeEtatFinancier {
  missionId: string;
  format: FormatEtatFinancier;
  exercices: string;
  commentaire: string;
}

export interface ErreursDemande {
  mission?: string;
  exercices?: string;
  commentaire?: string;
}

export type ResultatDemande =
  | { ok: true; chemin: string; corps: { commentaire: string } | undefined }
  | { ok: false; erreurs: ErreursDemande };

/** Valide la demande puis construit le chemin de POST et le corps. */
export function construireDemande(
  clientId: string,
  d: DemandeEtatFinancier,
  langue: Langue = "fr",
): ResultatDemande {
  const t = creerTraduire(langue);
  const erreurs: ErreursDemande = {};
  if (!d.missionId)
    erreurs.mission = t(
      "Choisissez la mission à laquelle rattacher le rapport.",
      "Choose the engagement to attach the report to.",
    );
  const n = lireExercices(d.exercices);
  if (n === null) erreurs.exercices = t(MESSAGE_EXERCICES, MESSAGE_EXERCICES_EN);
  const ec = erreurCommentaire(d.commentaire, langue);
  if (ec) erreurs.commentaire = ec;
  if (Object.keys(erreurs).length > 0 || n === null) return { ok: false, erreurs };
  const q = new URLSearchParams({
    format: d.format,
    mission_id: d.missionId,
    exercices: String(n),
  });
  const commentaire = commentaireEnvoye(d.commentaire);
  return {
    ok: true,
    chemin: `/api/dossiers/${segment(clientId)}/rapports/etat-financier?${q.toString()}`,
    corps: commentaire === undefined ? undefined : { commentaire },
  };
}

/** Rapports d'état financier parmi ceux d'une mission (tous modèles confondus). */
export const filtrerEtatsFinanciers = (rapports: readonly RapportMission[]): RapportMission[] =>
  rapports.filter((r) => r.modele === MODELE_ETAT_FINANCIER);

export const MESSAGE_AUCUN_ETAT_ACCEPTE =
  "Aucun état financier accepté dans ce dossier : acceptez au moins un état avant de générer le rapport.";

export const MESSAGE_AUCUN_ETAT_ACCEPTE_EN =
  "No accepted financial statement in this file: accept at least one statement before generating the report.";

/** Message français pour chaque refus de la génération d'un rapport d'état financier. */
export function messageEtatFinancier(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.code === "AUCUN_ETAT_ACCEPTE")
      return t(MESSAGE_AUCUN_ETAT_ACCEPTE, MESSAGE_AUCUN_ETAT_ACCEPTE_EN);
    if (e.statut === 400) {
      return t(
        "Demande refusée : la mission choisie n'appartient pas à ce client, ou un paramètre est invalide. Rechargez la page puis réessayez.",
        "Request refused: the chosen engagement does not belong to this client, or a parameter is invalid. Reload the page and try again.",
      );
    }
    if (e.statut === 403) {
      return t(
        "Votre rôle ne vous permet pas de générer ce rapport pour ce dossier et cette mission.",
        "Your role does not allow you to generate this report for this file and engagement.",
      );
    }
    if (e.statut === 404) {
      return t(
        "Ce dossier ou cette mission est introuvable ou ne vous est plus accessible.",
        "This file or engagement cannot be found or is no longer accessible to you.",
      );
    }
    if (e.statut === 409)
      return t(
        "La mission est clôturée : plus aucun rapport ne peut être généré.",
        "The engagement is closed: no more reports can be generated.",
      );
  }
  return messageRapport(e, langue);
}
