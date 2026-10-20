/**
 * Canaux externes SIMULÉS (lot 3c, ADR-008) : WhatsApp et SMS de repli, consentements, journal
 * d'envois, synthèse hebdomadaire du dirigeant, saisies de KPI reçues par message. Logique pure,
 * testée dans `canaux.test.ts`.
 *
 * Règle ferme : TOUT est simulé. Aucun message n'est réellement envoyé ; chaque écran qui décrit
 * un compte ou un envoi affiche « Simulé : aucun envoi réel » (`TEXTES_CANAUX.bandeauSimule`).
 * Le navigateur ne voit jamais un numéro de téléphone complet (masque seulement, fourni par
 * l'API), jamais un texte de message reçu, jamais un coût sans le droit financier (FIN-02 : champ
 * absent). Les droits testés ici sont un confort d'affichage ; l'API reste seule juge.
 */
import {
  aPermission,
  LIBELLES_CANAL,
  LIBELLES_CATEGORIE_ENVOI_CANAL,
  LIBELLES_CODE_GABARIT_CANAL,
  LIBELLES_CODE_REFUS_CANAL,
  LIBELLES_CONSENTEMENT_COURANT,
  LIBELLES_MOTIF_BLOCAGE_CANAL,
  LIBELLES_OBJET_ENVOI_CANAL,
  LIBELLES_ORIGINE_SAISIE_KPI,
  LIBELLES_SOURCE_CONSENTEMENT,
  LIBELLES_STATUT_ENVOI_CANAL,
  LIBELLES_STATUT_SAISIE_KPI,
  LIBELLES_VRAISEMBLANCE_SAISIE_KPI,
  MENTION_COURANTE,
  MENTIONS_CONSENTEMENT,
  OBJETS_ENVOI_CANAL,
  PLAFONDS_CANAUX,
  ROLE_LIBELLES,
  STATUTS_ENVOI_CANAL,
  STATUTS_SAISIE_KPI,
  TEXTES_CANAUX,
  type CanalMessagerie,
  type CompteCanalApi,
  type ConsentementCourantCanal,
  type DestinataireCanalApi,
  type EnvoiCanalApi,
  type MessageSimulateurApi,
  type ModeFournisseurCanal,
  type ObjetEnvoiCanal,
  type Role,
  type SaisieKpiApi,
  type StatutEnvoiCanal,
  type StatutSaisieKpi,
  type VersionMentionConsentement,
  type VraisemblanceSaisieKpi,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import {
  avecReconfirmation,
  messageReconfirmation,
  type SaisieConfirmation,
} from "./double-authentification";
import type { PageCurseur } from "./pagination";
import type { Resultat } from "./saisie";

export { PLAFONDS_CANAUX, TEXTES_CANAUX };
export type {
  CanalMessagerie,
  CompteCanalApi,
  ConsentementCourantCanal,
  DestinataireCanalApi,
  EnvoiCanalApi,
  MessageSimulateurApi,
  SaisieKpiApi,
};

// --- Chemins ---------------------------------------------------------------------------------

export const CHEMIN_PARAMETRES_CANAUX = "/parametres/canaux";
export const CHEMIN_CANAUX_DESTINATAIRES = `${CHEMIN_PARAMETRES_CANAUX}/destinataires`;
export const CHEMIN_CANAUX_JOURNAL = `${CHEMIN_PARAMETRES_CANAUX}/journal`;
export const CHEMIN_CANAUX_SAISIES = `${CHEMIN_PARAMETRES_CANAUX}/saisies`;
export const CHEMIN_CANAUX_SIMULATEUR = `${CHEMIN_PARAMETRES_CANAUX}/simulateur`;

export const API_CANAUX_COMPTES = "/api/canaux/comptes";
export const API_CANAUX_DESTINATAIRES = "/api/canaux/destinataires";
export const API_CANAUX_ENVOIS = "/api/canaux/envois";
export const API_CANAUX_APERCU_SYNTHESE = "/api/canaux/synthese-dirigeant/apercu";
export const API_CANAUX_SAISIES_KPI = "/api/canaux/saisies-kpi";
export const API_CANAUX_SIMULATEUR_BOITE = "/api/canaux/simulateur/boite";
export const API_CANAUX_SIMULATEUR_ENTRANT = "/api/canaux/simulateur/entrant";

const enc = encodeURIComponent;

/** `PUT /api/canaux/comptes/:canal`. */
export const cheminCompteCanal = (canal: CanalMessagerie) => `${API_CANAUX_COMPTES}/${enc(canal)}`;
/** `PUT /api/canaux/destinataires/:utilisateurId/:canal` (numéro dans le corps, jamais dans l'URL). */
export const cheminNumeroDestinataire = (utilisateurId: string, canal: CanalMessagerie) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(utilisateurId)}/${enc(canal)}`;
/** `POST /api/canaux/destinataires/:id/verification`. */
export const cheminVerificationDestinataire = (id: string) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(id)}/verification`;
/** `GET` et `POST /api/canaux/destinataires/:id/consentements`. */
export const cheminConsentementsDestinataire = (id: string) =>
  `${API_CANAUX_DESTINATAIRES}/${enc(id)}/consentements`;
/** `POST /api/canaux/saisies-kpi/:id/reprendre` ou `/rejeter`. */
export const cheminSaisieKpi = (id: string, action: "reprendre" | "rejeter") =>
  `${API_CANAUX_SAISIES_KPI}/${enc(id)}/${action === "reprendre" ? "reprendre" : "rejeter"}`;
/** Écran d'aperçu de la synthèse d'un client (cabinet). */
export const cheminSyntheseClient = (clientId: string) => `/clients/${enc(clientId)}/synthese`;

/** Plafond de `limite` des routes de ce lot (`PLAFONDS_CANAUX.listeLimiteMax`) : `limiteMax` des boucles. */
export const LIMITE_LISTE_CANAUX = PLAFONDS_CANAUX.listeLimiteMax;

// --- Formes de réponse tolérantes ------------------------------------------------------------

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Liste rendue par l'API : un tableau, ou une enveloppe `{ elements: [...] }`. Toute autre forme
 * donne une liste vide (jamais une exception dans une page).
 */
export function listeDepuis<T>(corps: unknown): T[] {
  if (Array.isArray(corps)) return corps as T[];
  if (estObjet(corps) && Array.isArray(corps.elements)) return corps.elements as T[];
  return [];
}

/**
 * Page paginée par curseur, vers la forme de `chargerToutesLesPages` (`suivant`). L'API de ce lot
 * rend `curseur_suivant` (`PageCanaux`) ; `suivant` est aussi accepté.
 */
export function pageDepuis<T>(corps: unknown): PageCurseur<T> {
  const suivant =
    estObjet(corps) && typeof corps.curseur_suivant === "string"
      ? corps.curseur_suivant
      : estObjet(corps) && typeof corps.suivant === "string"
        ? corps.suivant
        : null;
  return { elements: listeDepuis<T>(corps), suivant };
}

// --- Dates -----------------------------------------------------------------------------------

/** « JJ/MM/AAAA » (heure d'Abidjan) ; « — » si la date manque ou est illisible. */
export function dateCourte(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Africa/Abidjan",
  }).format(d);
}

/** « JJ/MM/AAAA à HH:MM » (heure d'Abidjan). */
export function dateHeureCourte(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  const d = new Date(valeur);
  if (Number.isNaN(d.getTime())) return "—";
  const heure = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Abidjan",
  }).format(d);
  return `${dateCourte(valeur)} à ${heure}`;
}

/** Date de mesure « AAAA-MM-JJ » → « JJ/MM/AAAA » (jour calendaire, sans décalage de fuseau). */
export function dateJourCourte(valeur: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valeur ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

// --- Libellés et tonalités -------------------------------------------------------------------

/** Mode fournisseur : seul « simulé » existe dans ce lot ; tout le reste est signalé comme tel. */
export function estSimule(mode: ModeFournisseurCanal | string | null | undefined): boolean {
  return mode === "simule";
}

/** Texte du bandeau : toujours « Simulé : aucun envoi réel » (le mode « réel » n'existe pas ici). */
export const BANDEAU_SIMULE = TEXTES_CANAUX.bandeauSimule;

const libelleDe = (table: Record<string, string>, cle: string | null | undefined): string =>
  (cle ? table[cle] : undefined) ?? "—";

export const libelleCanal = (c: string | null | undefined) => libelleDe(LIBELLES_CANAL, c);
export const libelleStatutEnvoi = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_ENVOI_CANAL, s);
export const libelleMotifBlocage = (m: string | null | undefined) =>
  libelleDe(LIBELLES_MOTIF_BLOCAGE_CANAL, m);
export const libelleCodeRefus = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CODE_REFUS_CANAL, c);
/** Réponses de service du simulateur (hors des onze gabarits métier) : jamais « — » à l'écran. */
const LIBELLES_GABARIT_SERVICE: Record<string, string> = { reponse_session: "Réponse de service" };
export const libelleGabarit = (g: string | null | undefined) =>
  libelleDe({ ...LIBELLES_CODE_GABARIT_CANAL, ...LIBELLES_GABARIT_SERVICE }, g);

/** Motif du contrôle de vraisemblance d'une saisie (codes du moteur), en français. */
export const LIBELLES_MOTIF_VRAISEMBLANCE: Record<string, string> = {
  negatif_inhabituel: "Valeur négative inhabituelle",
  historique_insuffisant: "Historique insuffisant pour juger la valeur",
  zero: "Valeur nulle à vérifier",
  ordre_de_grandeur: "Ordre de grandeur très éloigné de l'historique",
  ecart_median: "Écart important avec la valeur habituelle",
  dans_la_norme: "Dans la norme de l'historique",
  origine_vocale: "Message vocal : confirmation demandée",
};
export const libelleMotifVraisemblance = (m: string | null | undefined): string =>
  (m ? LIBELLES_MOTIF_VRAISEMBLANCE[m] : undefined) ?? m ?? "—";
export const libelleCategorieEnvoi = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CATEGORIE_ENVOI_CANAL, c);
export const libelleObjetEnvoi = (o: string | null | undefined) =>
  libelleDe(LIBELLES_OBJET_ENVOI_CANAL, o);
export const libelleConsentement = (c: string | null | undefined) =>
  libelleDe(LIBELLES_CONSENTEMENT_COURANT, c);
export const libelleSourceConsentement = (s: string | null | undefined) =>
  libelleDe(LIBELLES_SOURCE_CONSENTEMENT, s);
export const libelleStatutSaisie = (s: string | null | undefined) =>
  libelleDe(LIBELLES_STATUT_SAISIE_KPI, s);
export const libelleVraisemblance = (v: string | null | undefined) =>
  libelleDe(LIBELLES_VRAISEMBLANCE_SAISIE_KPI, v);
export const libelleOrigineSaisie = (o: string | null | undefined) =>
  libelleDe(LIBELLES_ORIGINE_SAISIE_KPI, o);

/** Rôle d'un destinataire en français ; un rôle inconnu de cette version reste lisible. */
export function libelleRole(role: string): string {
  return (ROLE_LIBELLES as Record<string, string>)[role] ?? "Utilisateur";
}

export function tonaliteStatutEnvoi(s: StatutEnvoiCanal | string): TonaliteStatut {
  switch (s) {
    case "livre":
    case "lu":
    case "accepte":
      return "succes";
    case "echec":
      return "danger";
    case "bloque":
    case "incertain":
      return "attention";
    default:
      return "neutre";
  }
}

export function tonaliteConsentement(c: ConsentementCourantCanal | string): TonaliteStatut {
  if (c === "accorde") return "succes";
  if (c === "retire") return "danger";
  return "neutre";
}

export function tonaliteVraisemblance(v: VraisemblanceSaisieKpi | string): TonaliteStatut {
  if (v === "ok") return "succes";
  if (v === "a_verifier") return "attention";
  if (v === "invraisemblable") return "danger";
  return "neutre";
}

export function tonaliteStatutSaisie(s: StatutSaisieKpi | string): TonaliteStatut {
  if (s === "reprise") return "succes";
  if (s === "confirmee" || s === "a_confirmer") return "attention";
  if (s === "rejetee_vraisemblance" || s === "rejetee_cabinet" || s === "refusee") return "danger";
  return "neutre";
}

// --- Droits (confort d'affichage) ------------------------------------------------------------

export interface DroitsCanaux {
  /** Voir les comptes, destinataires et le journal (`canaux.lire`). */
  lire: boolean;
  /** Numéros, consentements recueillis, retraits, désactivation d'un canal (`canaux.gerer`). */
  gerer: boolean;
  /** Activer un compte, options, simulateur : associé seul (`canaux.configurer`). */
  configurer: boolean;
  /** Reprendre ou rejeter une saisie de KPI reçue (`kpi.saisir`). */
  saisirKpi: boolean;
}

export function droitsCanaux(roles: readonly Role[]): DroitsCanaux {
  return {
    lire: aPermission(roles, "canaux.lire"),
    gerer: aPermission(roles, "canaux.gerer"),
    configurer: aPermission(roles, "canaux.configurer"),
    saisirKpi: aPermission(roles, "kpi.saisir"),
  };
}

// --- Comptes ---------------------------------------------------------------------------------

export const CHAMPS_OPTIONS_COMPTE = [
  "repli_sms",
  "relance_questionnaire_j10",
  "synthese_hebdo",
  "saisie_kpi",
  "alerte_kpi",
] as const;
export type ChampOptionCompte = (typeof CHAMPS_OPTIONS_COMPTE)[number];

export const LIBELLES_OPTIONS_COMPTE: Record<ChampOptionCompte, { libelle: string; aide: string }> =
  {
    repli_sms: {
      libelle: "Repli par SMS",
      aide: "Si WhatsApp refuse un message, un SMS simulé est tenté (sous réserve du consentement SMS séparé de la personne).",
    },
    relance_questionnaire_j10: {
      libelle: "Relance J+10 des questionnaires",
      aide: "Dix jours après l'envoi d'un questionnaire sans réponse, un message renvoie vers le portail.",
    },
    synthese_hebdo: {
      libelle: "Synthèse hebdomadaire du dirigeant",
      aide: "Chaque lundi, deux compteurs et un lien vers le portail ; rien n'est envoyé s'il n'y a rien à signaler.",
    },
    saisie_kpi: {
      libelle: "Saisie des KPI par message",
      aide: "Une proposition de saisie n'entre dans un indicateur qu'après reprise par un utilisateur du cabinet.",
    },
    alerte_kpi: {
      libelle: "Alertes de KPI aux responsables du cabinet",
      aide: "Un message sans valeur chiffrée prévient les responsables d'un indicateur (alerte ou mesure en retard), s'ils ont un numéro vérifié et un consentement.",
    },
  };

/** Valeurs modifiables d'un compte (état du formulaire d'une carte). */
export interface EtatCompteEditable {
  actif: boolean;
  repli_sms: boolean;
  relance_questionnaire_j10: boolean;
  synthese_hebdo: boolean;
  saisie_kpi: boolean;
  alerte_kpi: boolean;
}

export function etatEditableDepuisCompte(c: CompteCanalApi): EtatCompteEditable {
  return {
    actif: c.actif,
    repli_sms: c.repli_sms,
    relance_questionnaire_j10: c.relance_questionnaire_j10,
    synthese_hebdo: c.synthese_hebdo,
    saisie_kpi: c.saisie_kpi,
    alerte_kpi: c.alerte_kpi,
  };
}

/** Les options ne concernent que le compte WhatsApp (SMS : seulement « Activé »). */
export const canalAvecOptions = (canal: CanalMessagerie) => canal === "whatsapp";

export function libelleEtatCompte(c: Pick<CompteCanalApi, "actif">): string {
  return c.actif ? "Activé" : "Désactivé";
}

/** Corps de `PUT /api/canaux/comptes/:canal` (champs modifiés seulement, reconfirmation éventuelle). */
export type ChargeCompte = Partial<EtatCompteEditable> & {
  mot_de_passe?: string;
  code?: string;
  code_secours?: string;
};

/** L'activation d'un compte exige la reconfirmation d'identité (`canal_activation`). */
export const exigeReconfirmationCompte = (
  avant: Pick<EtatCompteEditable, "actif">,
  apres: Pick<EtatCompteEditable, "actif">,
) => !avant.actif && apres.actif;

export type ChampCompte = "aucun" | "mot_de_passe" | "code";

/**
 * Charge d'enregistrement d'une carte de compte : ne contient que les champs modifiés. Un titulaire
 * de `canaux.gerer` seul (pas de `canaux.configurer`) ne peut que DÉSACTIVER (`{ actif: false }`
 * seul, coupe-circuit sans reconfirmation) ; activer ou changer une option exige l'associé.
 */
export function chargeModificationCompte(
  avant: EtatCompteEditable,
  apres: EtatCompteEditable,
  droits: Pick<DroitsCanaux, "gerer" | "configurer">,
  confirmation: SaisieConfirmation | null,
): Resultat<ChargeCompte, ChampCompte> {
  const changes: Partial<EtatCompteEditable> = {};
  for (const champ of ["actif", ...CHAMPS_OPTIONS_COMPTE] as const) {
    if (avant[champ] !== apres[champ]) changes[champ] = apres[champ];
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, erreurs: { aucun: "Aucune modification à enregistrer." } };
  }
  const desactivationSeule = Object.keys(changes).length === 1 && changes.actif === false;
  if (!droits.configurer) {
    if (!(droits.gerer && desactivationSeule)) {
      return {
        ok: false,
        erreurs: {
          aucun:
            "Seul un associé peut activer un canal ou changer ses options ; vous pouvez seulement le désactiver.",
        },
      };
    }
    return { ok: true, charge: { actif: false } };
  }
  if (desactivationSeule) return { ok: true, charge: { actif: false } };
  if (!exigeReconfirmationCompte(avant, apres)) return { ok: true, charge: changes };
  const v = avecReconfirmation<ChargeCompte, ChampCompte>(
    { ok: true, charge: changes },
    confirmation ?? { motDePasse: "", code: "", facteur: "totp" },
  );
  return v;
}

// --- Numéros, codes, consentements -----------------------------------------------------------

/** Numéro de test attendu par le simulateur (aucune donnée réelle de personne n'entre). */
export const EXEMPLE_NUMERO_TEST = "+2250000000012";
export const AIDE_NUMERO_SIMULE = `Numéro de test seulement (par exemple ${EXEMPLE_NUMERO_TEST}) : aucun numéro réel n'est accepté en mode simulé. Il n'est jamais réaffiché en entier.`;

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/;

export function validerNumeroSaisi(saisie: string): Resultat<{ numero: string }, "numero"> {
  const numero = saisie.trim();
  if (numero === "") return { ok: false, erreurs: { numero: "Saisissez le numéro de téléphone." } };
  if (numero.length < 5 || numero.length > 40 || CONTROLES.test(numero)) {
    return {
      ok: false,
      erreurs: { numero: "Numéro invalide : saisissez-le avec l'indicatif (ex. +225…)." },
    };
  }
  return { ok: true, charge: { numero } };
}

/** Code de vérification : six chiffres (espaces tolérés). */
export function validerCodeVerification(saisie: string): Resultat<{ code: string }, "code"> {
  const code = saisie.replace(/\s/g, "");
  if (code === "") return { ok: false, erreurs: { code: "Saisissez le code reçu." } };
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, erreurs: { code: "Le code comporte exactement 6 chiffres." } };
  }
  return { ok: true, charge: { code } };
}

/** Référence de la preuve d'un consentement recueilli hors ligne : 10 à 500 caractères. */
export function validerReferencePreuve(
  saisie: string,
): Resultat<{ statut: "accorde"; reference_preuve: string }, "reference_preuve"> {
  const reference = saisie.trim();
  if (reference.length < 10) {
    return {
      ok: false,
      erreurs: {
        reference_preuve:
          "Décrivez la preuve du consentement en 10 caractères au moins (ex. formulaire signé le 12/03/2027, dossier n° 24).",
      },
    };
  }
  if (reference.length > 500) {
    return {
      ok: false,
      erreurs: { reference_preuve: "La référence ne doit pas dépasser 500 caractères." },
    };
  }
  return { ok: true, charge: { statut: "accorde", reference_preuve: reference } };
}

/** Texte intégral de la mention en vigueur pour un canal (la version est celle envoyée au serveur). */
export function mentionPourCanal(canal: CanalMessagerie): {
  version: VersionMentionConsentement;
  texte: string;
} {
  const version = MENTION_COURANTE[canal];
  return { version, texte: MENTIONS_CONSENTEMENT[version].texte };
}

/** Ce que le cabinet peut faire d'un destinataire (la source de vérité reste l'API). */
export interface ActionsDestinataire {
  enregistrerNumero: boolean;
  saisirCode: boolean;
  enregistrerConsentement: boolean;
  /** Pourquoi le cabinet ne peut pas redonner l'accord (STOP), sinon `null`. */
  motifConsentementImpossible: string | null;
  retirer: boolean;
}

export function actionsDestinataire(
  d: Pick<
    DestinataireCanalApi,
    "numero_masque" | "verifie" | "consentement" | "consentement_source"
  >,
  droits: Pick<DroitsCanaux, "gerer">,
): ActionsDestinataire {
  const aUnNumero = d.numero_masque !== null;
  const apresStop = d.consentement === "retire" && d.consentement_source === "message_stop";
  let motif: string | null = null;
  if (aUnNumero && d.verifie && apresStop) {
    motif =
      "Cette personne a répondu STOP : seule elle peut redonner son accord, depuis son espace du portail.";
  } else if (aUnNumero && !d.verifie) {
    motif = "Le numéro doit d'abord être vérifié par le code reçu.";
  }
  return {
    enregistrerNumero: droits.gerer,
    saisirCode: droits.gerer && aUnNumero && !d.verifie,
    enregistrerConsentement:
      droits.gerer && aUnNumero && d.verifie && d.consentement !== "accorde" && !apresStop,
    motifConsentementImpossible: d.consentement === "accorde" ? null : motif,
    retirer: droits.gerer && d.consentement === "accorde",
  };
}

export function libelleNumero(d: Pick<DestinataireCanalApi, "numero_masque" | "verifie">): string {
  if (d.numero_masque === null) return "Aucun numéro";
  return d.verifie ? `${d.numero_masque} (vérifié)` : `${d.numero_masque} (à vérifier)`;
}

/** Message affichable pour un refus de l'API sur les numéros, codes, consentements et comptes. */
export function messageErreurCanaux(e: unknown, facteur: "totp" | "secours" = "totp"): string {
  if (e instanceof ErreurApi) {
    switch (e.code) {
      case "NUMERO_INVALIDE":
        return "Numéro invalide : saisissez-le avec l'indicatif du pays (ex. +225…).";
      case "NUMERO_REEL_REFUSE_EN_SIMULE":
        return `Les canaux sont simulés : seuls les numéros de test sont acceptés (par exemple ${EXEMPLE_NUMERO_TEST}). Aucune donnée réelle de personne n'entre.`;
      case "CODE_INVALIDE":
        return "Code incorrect. Vérifiez-le ou demandez-en un nouveau en enregistrant à nouveau le numéro.";
      case "CODE_EXPIRE":
        return "Ce code a expiré (10 minutes). Enregistrez à nouveau le numéro pour en recevoir un nouveau.";
      case "MENTION_PERIMEE":
        return "La mention de consentement a changé. Rechargez la page pour lire la version en vigueur.";
      case "CANAL_NON_ACTIF":
        return "Ce canal n'est pas activé par le cabinet : rien ne sera envoyé.";
      case "CONSENTEMENT_REQUIS":
        return "Un consentement est requis avant cette action.";
      case "TROP_DE_TENTATIVES":
        return "Trop de tentatives. Patientez avant de réessayer.";
      case "TROP_DE_REQUETES":
        return "Trop de demandes en peu de temps. Patientez quelques instants avant de réessayer.";
      default:
        break;
    }
    const reconfirmation = messageReconfirmation(e, facteur);
    if (reconfirmation) return reconfirmation;
  }
  return messageErreur(e);
}

// --- Journal des envois ----------------------------------------------------------------------

export interface ParametresJournal {
  statut: StatutEnvoiCanal | null;
  objet_type: ObjetEnvoiCanal | null;
  destinataire_id: string | null;
  curseur: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function un(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Lecture sûre des paramètres d'URL du journal : une valeur hors liste est ignorée. */
export function lireParametresJournal(
  p: Record<string, string | string[] | undefined>,
): ParametresJournal {
  const statut = un(p.statut);
  const objet = un(p.objet_type);
  const destinataire = un(p.destinataire_id);
  const curseur = un(p.curseur);
  return {
    statut: (STATUTS_ENVOI_CANAL as readonly string[]).includes(statut)
      ? (statut as StatutEnvoiCanal)
      : null,
    objet_type: (OBJETS_ENVOI_CANAL as readonly string[]).includes(objet)
      ? (objet as ObjetEnvoiCanal)
      : null,
    destinataire_id: UUID.test(destinataire) ? destinataire : null,
    curseur:
      curseur !== "" && curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : null,
  };
}

/** Taille d'une page du journal (affichage). */
export const TAILLE_PAGE_JOURNAL = 30;

/** Requête de `GET /api/canaux/envois`. */
export function requeteJournal(p: ParametresJournal): string {
  const r = new URLSearchParams({ limite: String(TAILLE_PAGE_JOURNAL) });
  if (p.statut) r.set("statut", p.statut);
  if (p.objet_type) r.set("objet_type", p.objet_type);
  if (p.destinataire_id) r.set("destinataire_id", p.destinataire_id);
  if (p.curseur) r.set("curseur", p.curseur);
  return `${API_CANAUX_ENVOIS}?${r.toString()}`;
}

/** Lien vers une page du journal (mêmes filtres, curseur donné). */
export function hrefJournal(p: ParametresJournal, curseur: string | null = null): string {
  const r = new URLSearchParams();
  if (p.statut) r.set("statut", p.statut);
  if (p.objet_type) r.set("objet_type", p.objet_type);
  if (p.destinataire_id) r.set("destinataire_id", p.destinataire_id);
  if (curseur) r.set("curseur", curseur);
  const q = r.toString();
  return q ? `${CHEMIN_CANAUX_JOURNAL}?${q}` : CHEMIN_CANAUX_JOURNAL;
}

export const OPTIONS_STATUT_ENVOI = STATUTS_ENVOI_CANAL.map((s) => ({
  valeur: s,
  libelle: LIBELLES_STATUT_ENVOI_CANAL[s],
}));
export const OPTIONS_OBJET_ENVOI = OBJETS_ENVOI_CANAL.map((o) => ({
  valeur: o,
  libelle: LIBELLES_OBJET_ENVOI_CANAL[o],
}));

/** Précision sous le statut : motif du blocage ou du refus, sinon rien. Jamais un contenu. */
export function precisionEnvoi(
  e: Pick<EnvoiCanalApi, "statut" | "motif_blocage" | "code_refus">,
): string | null {
  if (e.motif_blocage) return libelleMotifBlocage(e.motif_blocage);
  if (e.code_refus) return libelleCodeRefus(e.code_refus);
  return null;
}

/** Libellé de l'objet lié : « Questionnaire », « Demande de signature »… */
export const objetLie = (e: Pick<EnvoiCanalApi, "objet_type">) => libelleObjetEnvoi(e.objet_type);

/** Un coût estimé n'existe qu'avec le droit financier : champ absent sinon (FIN-02). */
export function aUnCoutEstime(e: Pick<EnvoiCanalApi, "cout_estime_micro_usd">): boolean {
  return e.cout_estime_micro_usd !== undefined;
}

// --- Saisies de KPI reçues par message -------------------------------------------------------

/**
 * Valeur décimale exacte de l'API (« 12.500000 ») → « 12,5 » : opérations sur le TEXTE, jamais
 * de conversion en nombre à virgule flottante (la valeur vient du moteur et de l'API).
 */
export function formaterValeurSaisie(valeur: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(valeur.trim());
  if (!m) return valeur;
  const entier = (m[2] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const decimales = (m[3] ?? "").replace(/0+$/, "");
  return `${m[1]}${entier}${decimales ? `,${decimales}` : ""}`;
}

export const peutReprendreSaisie = (s: Pick<SaisieKpiApi, "statut">) => s.statut === "confirmee";
export const peutRejeterSaisie = (s: Pick<SaisieKpiApi, "statut">) => s.statut === "confirmee";

/** Date de mesure « AAAA-MM-JJ » saisie (champ date) : facultative, borne 2000 à 2100 comme l'API. */
export function validerRepriseSaisie(saisie: {
  date_mesure: string;
  commentaire: string;
}): Resultat<{ date_mesure?: string; commentaire?: string }, "date_mesure" | "commentaire"> {
  const erreurs: Partial<Record<"date_mesure" | "commentaire", string>> = {};
  const date = saisie.date_mesure.trim();
  const commentaire = saisie.commentaire.trim();
  if (date !== "") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const annee = m ? Number(m[1]) : 0;
    if (!m || annee < 2000 || annee > 2100) {
      erreurs.date_mesure = "Date invalide : choisissez un jour entre 2000 et 2100.";
    }
  }
  if (commentaire.length > 500) {
    erreurs.commentaire = "Le commentaire ne doit pas dépasser 500 caractères.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(date !== "" ? { date_mesure: date } : {}),
      ...(commentaire !== "" ? { commentaire } : {}),
    },
  };
}

export function validerRejetSaisie(motif: string): Resultat<{ motif: string }, "motif"> {
  const t = motif.trim();
  if (t === "") return { ok: false, erreurs: { motif: "Indiquez le motif du rejet." } };
  if (t.length > 500) {
    return { ok: false, erreurs: { motif: "Le motif ne doit pas dépasser 500 caractères." } };
  }
  return { ok: true, charge: { motif: t } };
}

// --- Simulateur (développement) --------------------------------------------------------------

export type TypeEntrantSimule = "texte" | "vocal" | "statut";

export const OPTIONS_TYPE_ENTRANT: readonly { valeur: TypeEntrantSimule; libelle: string }[] = [
  { valeur: "texte", libelle: "Message écrit" },
  { valeur: "vocal", libelle: "Message vocal de test" },
  { valeur: "statut", libelle: "Statut d'un message envoyé" },
];

export const STATUTS_RECUS_SIMULES = [
  { valeur: "envoye", libelle: "Envoyé" },
  { valeur: "livre", libelle: "Livré" },
  { valeur: "lu", libelle: "Lu" },
  { valeur: "echec", libelle: "Échec" },
] as const;

export interface SaisieEntrantSimule {
  type: TypeEntrantSimule;
  numero: string;
  texte: string;
  idExterne: string;
  statut: string;
}

export type ChampEntrantSimule = "numero" | "texte" | "idExterne" | "statut";

export type ChargeEntrantSimule =
  | { type: "message"; numero: string; texte: string }
  | { type: "message"; numero: string; audio_texte: string }
  | { type: "statut"; id_externe: string; statut: string };

/** Corps de `POST /api/canaux/simulateur/entrant` (aucun vrai audio : conteneur de test fabriqué par l'API). */
export function validerEntrantSimule(
  s: SaisieEntrantSimule,
): Resultat<ChargeEntrantSimule, ChampEntrantSimule> {
  const erreurs: Partial<Record<ChampEntrantSimule, string>> = {};
  if (s.type === "statut") {
    const id = s.idExterne.trim();
    if (id === "" || id.length > 100) {
      erreurs.idExterne = "Choisissez le message envoyé concerné.";
    }
    if (!STATUTS_RECUS_SIMULES.some((x) => x.valeur === s.statut)) {
      erreurs.statut = "Choisissez un statut.";
    }
    if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
    return { ok: true, charge: { type: "statut", id_externe: id, statut: s.statut } };
  }
  const numero = validerNumeroSaisi(s.numero);
  if (!numero.ok) erreurs.numero = numero.erreurs.numero;
  const texte = s.texte.trim();
  const limite = s.type === "texte" ? 4096 : 2000;
  if (texte === "") erreurs.texte = "Saisissez le contenu du message.";
  else if (texte.length > limite) {
    erreurs.texte = `Le message ne doit pas dépasser ${limite} caractères.`;
  }
  if (!numero.ok || Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return s.type === "texte"
    ? { ok: true, charge: { type: "message", numero: numero.charge.numero, texte } }
    : { ok: true, charge: { type: "message", numero: numero.charge.numero, audio_texte: texte } };
}

/** Messages « envoyés » du simulateur, du plus récent au plus ancien. */
export function messagesSimulateur(corps: unknown): MessageSimulateurApi[] {
  return [...listeDepuis<MessageSimulateurApi>(corps)].sort((a, b) =>
    a.instant < b.instant ? 1 : a.instant > b.instant ? -1 : 0,
  );
}

/** Le simulateur n'existe qu'en mode simulé local : 404 de l'API = « non disponible ». */
export const simulateurIndisponible = (e: { statut: number }) => e.statut === 404;

// --- Navigation de la rubrique ---------------------------------------------------------------

export interface OngletCanaux {
  id: string;
  libelle: string;
  href: string;
}

/** Onglets de `/parametres/canaux` selon les droits et le mode (simulateur : associé, mode simulé). */
export function ongletsCanaux(droits: DroitsCanaux, options: { simule: boolean }): OngletCanaux[] {
  const onglets: OngletCanaux[] = [];
  if (droits.lire) {
    onglets.push(
      { id: "comptes", libelle: "Comptes", href: CHEMIN_PARAMETRES_CANAUX },
      {
        id: "destinataires",
        libelle: "Destinataires et consentements",
        href: CHEMIN_CANAUX_DESTINATAIRES,
      },
      { id: "journal", libelle: "Journal des envois", href: CHEMIN_CANAUX_JOURNAL },
    );
  }
  if (droits.lire && droits.saisirKpi) {
    onglets.push({ id: "saisies", libelle: "Saisies reçues", href: CHEMIN_CANAUX_SAISIES });
  }
  if (droits.configurer && options.simule) {
    onglets.push({
      id: "simulateur",
      libelle: "Simulateur (développement)",
      href: CHEMIN_CANAUX_SIMULATEUR,
    });
  }
  return onglets;
}

/**
 * État d'une carte de compte après un enregistrement : la réponse de l'API quand elle décrit le
 * compte, sinon les valeurs envoyées (l'enregistrement a réussi).
 */
export function etatApresEnregistrement(
  reponse: unknown,
  repli: EtatCompteEditable,
): EtatCompteEditable {
  if (estObjet(reponse) && typeof reponse.actif === "boolean") {
    const lit = (cle: ChampOptionCompte) =>
      typeof reponse[cle] === "boolean" ? (reponse[cle] as boolean) : repli[cle];
    return {
      actif: reponse.actif,
      repli_sms: lit("repli_sms"),
      relance_questionnaire_j10: lit("relance_questionnaire_j10"),
      synthese_hebdo: lit("synthese_hebdo"),
      saisie_kpi: lit("saisie_kpi"),
      alerte_kpi: lit("alerte_kpi"),
    };
  }
  return repli;
}

// --- Liste des saisies reçues ----------------------------------------------------------------

export interface ParametresSaisies {
  statut: StatutSaisieKpi;
  curseur: string | null;
}

/** Par défaut : les propositions confirmées par la personne, qui attendent une reprise. */
export const STATUT_SAISIES_DEFAUT: StatutSaisieKpi = "confirmee";

export const OPTIONS_STATUT_SAISIE = STATUTS_SAISIE_KPI.map((s) => ({
  valeur: s,
  libelle: LIBELLES_STATUT_SAISIE_KPI[s],
}));

export function lireParametresSaisies(
  p: Record<string, string | string[] | undefined>,
): ParametresSaisies {
  const statut = un(p.statut);
  const curseur = un(p.curseur);
  return {
    statut: (STATUTS_SAISIE_KPI as readonly string[]).includes(statut)
      ? (statut as StatutSaisieKpi)
      : STATUT_SAISIES_DEFAUT,
    curseur:
      curseur !== "" && curseur.length <= 500 && /^[A-Za-z0-9_-]+$/.test(curseur) ? curseur : null,
  };
}

/** Requête de `GET /api/canaux/saisies-kpi`. */
export function requeteSaisies(p: ParametresSaisies): string {
  const r = new URLSearchParams({ statut: p.statut, limite: String(TAILLE_PAGE_JOURNAL) });
  if (p.curseur) r.set("curseur", p.curseur);
  return `${API_CANAUX_SAISIES_KPI}?${r.toString()}`;
}

export function hrefSaisies(p: ParametresSaisies, curseur: string | null = null): string {
  const r = new URLSearchParams();
  if (p.statut !== STATUT_SAISIES_DEFAUT) r.set("statut", p.statut);
  if (curseur) r.set("curseur", curseur);
  const q = r.toString();
  return q ? `${CHEMIN_CANAUX_SAISIES}?${q}` : CHEMIN_CANAUX_SAISIES;
}

// --- Aperçu de la synthèse du dirigeant ------------------------------------------------------

/** `GET /api/canaux/synthese-dirigeant/apercu` : n'envoie rien et ne crée aucune ligne d'envoi. */
export function requeteApercuSynthese(clientId: string, destinataireId: string): string {
  const r = new URLSearchParams({ client_id: clientId, destinataire_id: destinataireId });
  return `${API_CANAUX_APERCU_SYNTHESE}?${r.toString()}`;
}

/**
 * Destinataires proposés pour l'aperçu : les dirigeants du client sur WhatsApp (la synthèse ne
 * part qu'à eux), un par personne. La valeur est l'IDENTIFIANT DE L'UTILISATEUR (le paramètre
 * `destinataire_id` de l'API le désigne ainsi, SPEC-3c §10.2) et non la ligne
 * `canaux_destinataires`, qui n'existe pas tant qu'aucun numéro n'est enregistré : l'aperçu
 * reste possible pour un dirigeant sans numéro.
 */
export function dirigeantsApercu(
  destinataires: readonly DestinataireCanalApi[],
): { valeur: string; libelle: string }[] {
  const vus = new Set<string>();
  return destinataires
    .filter((d) => d.role === "client_dirigeant" && d.canal === "whatsapp")
    .filter((d) => (vus.has(d.utilisateur_id) ? false : (vus.add(d.utilisateur_id), true)))
    .map((d) => ({ valeur: d.utilisateur_id, libelle: d.utilisateur_nom }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
}
