/** Gestion du portail : contact principal, résumé, erreurs et politique 2FA (module extrait de `portail-gestion.ts`). */
import type { PartagesClient } from "./portail-gestion-types";
import { CODE_TFA_A_CONFIGURER, ErreurApi, messageErreur } from "./api";
import {
  messageReconfirmation,
  validerConfirmation,
  validerReconfirmation,
  type ChampConfirmation,
  type ChargeFacteur,
  type FacteurSaisi,
  type SaisieConfirmation,
} from "./double-authentification";
import { optionsPersonnes, type Personne } from "./personnes";
import { type Resultat } from "./saisie";

// --- Contact principal -----------------------------------------------------------------------

/** Personnes proposables comme contact principal, plus le contact actuel s'il n'y figure pas. */
export function optionsContactPrincipal(
  personnes: readonly Personne[],
  actuel: { id: string; nom: string } | null,
): { valeur: string; libelle: string }[] {
  const options = optionsPersonnes(personnes);
  if (actuel && !options.some((o) => o.valeur === actuel.id)) {
    options.unshift({ valeur: actuel.id, libelle: actuel.nom });
  }
  return options;
}

// --- Résumé « ce que voit votre client » --------------------------------------------------------

export interface ResumeMissionPartagee {
  id: string;
  intitule: string;
  jalons: boolean;
  factures: boolean;
  documents: number;
}

export interface ResumePartagesClient {
  /** Aucune mission partagée : le client ne voit rien de vos missions. */
  rien: boolean;
  contact: string | null;
  missions: ResumeMissionPartagee[];
  documents: number;
}

export function resumePartages(p: PartagesClient): ResumePartagesClient {
  const parMission = new Map<string, number>();
  for (const d of p.documents)
    parMission.set(d.mission_id, (parMission.get(d.mission_id) ?? 0) + 1);
  const missions = [...p.missions]
    .sort((a, b) => a.intitule.localeCompare(b.intitule, "fr"))
    .map((m) => ({
      id: m.mission_id,
      intitule: m.intitule,
      jalons: m.jalons,
      factures: m.factures,
      documents: parMission.get(m.mission_id) ?? 0,
    }));
  return {
    rien: missions.length === 0,
    contact: p.contact_principal?.nom ?? null,
    missions,
    documents: p.documents.length,
  };
}

export const pluriel = (n: number, singulier: string, plurielForme: string) =>
  `${n} ${n > 1 ? plurielForme : singulier}`;

/** Ce que le client voit d'une mission partagée, en une phrase. */
export function detailMissionPartagee(m: ResumeMissionPartagee): string {
  const elements = ["intitulé, statut et dates"];
  if (m.jalons) elements.push("jalons");
  if (m.factures) elements.push("factures émises");
  if (m.documents > 0) elements.push(pluriel(m.documents, "document", "documents"));
  return elements.join(" · ");
}

/** Phrase de synthèse annoncée après l'enregistrement des partages. */
export function phraseResume(r: ResumePartagesClient): string {
  if (r.rien) return "Votre client ne voit plus aucune mission.";
  return `Votre client voit ${pluriel(r.missions.length, "mission", "missions")} et ${pluriel(r.documents, "document", "documents")}.`;
}

// --- Erreurs ---------------------------------------------------------------------------------

export type ActionPortail =
  "invitation" | "revocation" | "desactivation" | "reactivation" | "partages";

export const MESSAGE_CLIENT_NON_GERE =
  "Vous ne gérez pas le portail de ce client : il faut être associé, directeur de mission, ou diriger l'une de ses missions (directeur ou chef de mission).";

/** Message français d'un refus de l'API sur une action de gestion du portail. */
export function messageErreurPortailGestion(e: unknown, action: ActionPortail): string {
  if (!(e instanceof ErreurApi) || e.code === CODE_TFA_A_CONFIGURER) return messageErreur(e);
  if (e.statut === 403) {
    return action === "partages"
      ? "Une mission cochée n'est pas sous votre responsabilité : seuls son directeur, son chef de mission ou un associé en modifient les partages. Rechargez la page."
      : MESSAGE_CLIENT_NON_GERE;
  }
  if (e.statut === 404) {
    if (action === "revocation")
      return "Cette invitation n'est plus en attente : elle a été acceptée, a expiré ou a déjà été révoquée. Rechargez la page.";
    if (action === "desactivation" || action === "reactivation")
      return "Cet utilisateur du portail est introuvable. Rechargez la page.";
    return "Ce client est introuvable.";
  }
  if (e.code === "PORTAIL_PARTAGE_INVALIDE")
    return "Un élément coché n'est plus partageable (document remplacé ou contenu IA non validé). Rechargez la page.";
  return messageErreur(e);
}

// --- Politique de double authentification du portail ---------------------------------------

export const estRefusTfaInactive = (e: unknown) =>
  e instanceof ErreurApi && e.code === "TFA_INACTIVE";

export type ChargePolitiquePortail = {
  tfa_obligatoire: boolean;
  mot_de_passe: string;
} & Partial<ChargeFacteur>;

/**
 * Corps de `PUT /api/portail/parametres` : action à fort impact, mot de passe ET second
 * facteur. Sans 2FA active, le mot de passe seul part et l'API répond 409 TFA_INACTIVE.
 */
export function validerPolitiquePortail(
  tfaObligatoire: boolean,
  s: SaisieConfirmation,
  tfaActive: boolean,
): Resultat<ChargePolitiquePortail, ChampConfirmation> {
  const c = tfaActive ? validerConfirmation(s) : validerReconfirmation(s);
  if (!c.ok) return { ok: false, erreurs: c.erreurs };
  return { ok: true, charge: { tfa_obligatoire: tfaObligatoire, ...c.charge } };
}

/** Message d'un refus de la politique du portail (identité, 2FA de l'auteur inactive). */
export function messagePolitiquePortail(e: unknown, facteur: FacteurSaisi): string | null {
  return messageReconfirmation(e, facteur);
}

export const libellePolitiquePortail = (tfaObligatoire: boolean) =>
  tfaObligatoire ? "Exigée" : "Facultative";
