/** Gestion du portail : contact principal, résumé, erreurs et politique 2FA (module extrait de `portail-gestion.ts`). */
import { creerTraduire, type Langue } from "@missionpilot/shared";
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
export function detailMissionPartagee(m: ResumeMissionPartagee, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  const elements = [t("intitulé, statut et dates", "title, status and dates")];
  if (m.jalons) elements.push(t("jalons", "milestones"));
  if (m.factures) elements.push(t("factures émises", "issued invoices"));
  if (m.documents > 0)
    elements.push(
      langue === "en"
        ? `${m.documents} document${m.documents > 1 ? "s" : ""}`
        : pluriel(m.documents, "document", "documents"),
    );
  return elements.join(" · ");
}

/** Phrase de synthèse annoncée après l'enregistrement des partages. */
export function phraseResume(r: ResumePartagesClient, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (r.rien)
    return t(
      "Votre client ne voit plus aucune mission.",
      "Your client no longer sees any engagement.",
    );
  const nm = r.missions.length;
  return t(
    `Votre client voit ${pluriel(nm, "mission", "missions")} et ${pluriel(r.documents, "document", "documents")}.`,
    `Your client sees ${nm} engagement${nm > 1 ? "s" : ""} and ${r.documents} document${r.documents > 1 ? "s" : ""}.`,
  );
}

// --- Erreurs ---------------------------------------------------------------------------------

export type ActionPortail =
  "invitation" | "revocation" | "desactivation" | "reactivation" | "partages";

export const MESSAGE_CLIENT_NON_GERE =
  "Vous ne gérez pas le portail de ce client : il faut être associé, directeur de mission, ou diriger l'une de ses missions (directeur ou chef de mission).";

export const MESSAGE_CLIENT_NON_GERE_EN =
  "You do not manage this client's portal: you must be a partner, an engagement director, or lead one of its engagements (director or engagement manager).";

/** Message d'un refus de l'API sur une action de gestion du portail. */
export function messageErreurPortailGestion(
  e: unknown,
  action: ActionPortail,
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (!(e instanceof ErreurApi) || e.code === CODE_TFA_A_CONFIGURER)
    return messageErreur(e, langue);
  if (e.statut === 403) {
    return action === "partages"
      ? t(
          "Une mission cochée n'est pas sous votre responsabilité : seuls son directeur, son chef de mission ou un associé en modifient les partages. Rechargez la page.",
          "A checked engagement is not under your responsibility: only its director, its engagement manager or a partner can change its sharing. Reload the page.",
        )
      : t(MESSAGE_CLIENT_NON_GERE, MESSAGE_CLIENT_NON_GERE_EN);
  }
  if (e.statut === 404) {
    if (action === "revocation")
      return t(
        "Cette invitation n'est plus en attente : elle a été acceptée, a expiré ou a déjà été révoquée. Rechargez la page.",
        "This invitation is no longer pending: it was accepted, has expired or was already revoked. Reload the page.",
      );
    if (action === "desactivation" || action === "reactivation")
      return t(
        "Cet utilisateur du portail est introuvable. Rechargez la page.",
        "This portal user cannot be found. Reload the page.",
      );
    return t("Ce client est introuvable.", "This client cannot be found.");
  }
  if (e.code === "PORTAIL_PARTAGE_INVALIDE")
    return t(
      "Un élément coché n'est plus partageable (document remplacé ou contenu IA non validé). Rechargez la page.",
      "A checked item can no longer be shared (document replaced or AI content not approved). Reload the page.",
    );
  return messageErreur(e, langue);
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
  langue: Langue = "fr",
): Resultat<ChargePolitiquePortail, ChampConfirmation> {
  const c = tfaActive ? validerConfirmation(s, langue) : validerReconfirmation(s, langue);
  if (!c.ok) return { ok: false, erreurs: c.erreurs };
  return { ok: true, charge: { tfa_obligatoire: tfaObligatoire, ...c.charge } };
}

/** Message d'un refus de la politique du portail (identité, 2FA de l'auteur inactive). */
export function messagePolitiquePortail(
  e: unknown,
  facteur: FacteurSaisi,
  langue: Langue = "fr",
): string | null {
  return messageReconfirmation(e, facteur, langue);
}

export const libellePolitiquePortail = (tfaObligatoire: boolean, langue: Langue = "fr") =>
  tfaObligatoire
    ? creerTraduire(langue)("Exigée", "Required")
    : creerTraduire(langue)("Facultative", "Optional");
