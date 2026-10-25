import type { CleCompte } from "../cles.js";
import type { CleMissionCasting } from "./outils.js";

/*
 * Données du module « canaux » : contacts de messagerie, KPI alimentés par message, scénarios de
 * messages entrants. TOUT est fictif et SIMULÉ : les numéros sont les seuls numéros de TEST du
 * simulateur (`+22500000000NN`) ; les derniers chiffres commandent son comportement (`00` :
 * non joignable ; `95` à `99` : cas d'erreur, évités ici).
 */

export const MARQUE_CANAUX = "DÉMONSTRATION";

/** Date d'activation du compte WhatsApp simulé du cabinet. */
export const DATE_ACTIVATION_CANAL = "2026-03-02";

export interface ContactCanal {
  /** Compte (cabinet ou portail) propriétaire du numéro. */
  cle: CleCompte;
  numero: string;
  /** Jour d'enregistrement et de vérification du numéro. */
  jour: string;
  /** Numéro vérifié ? (sinon : code envoyé, jamais saisi). */
  verifie: boolean;
  /** Source du consentement : la personne elle-même (portail) ou recueilli par le cabinet. */
  consentement: "portail" | "cabinet" | "aucun";
  /** Référence de la preuve d'un consentement recueilli par le cabinet. */
  reference?: string;
}

/**
 * Les 8 contacts. Les comptes « investisseur » n'ont pas de numéro : la base les refuse (MPH12,
 * `controler_canal_destinataire`). Les responsables internes reçoivent les alertes de KPI.
 */
export const CONTACTS_CANAUX: readonly ContactCanal[] = [
  {
    cle: "dirigeant.client",
    numero: "+2250000000012",
    jour: "2026-03-04",
    verifie: true,
    consentement: "portail",
  },
  {
    cle: "contributeur.client",
    numero: "+2250000000013",
    jour: "2026-03-05",
    verifie: true,
    consentement: "cabinet",
    reference: `${MARQUE_CANAUX} : formulaire fictif signé, référence DEMO-CONS-0101`,
  },
  {
    cle: "dirigeant.client.2",
    numero: "+2250000000014",
    jour: "2026-04-08",
    verifie: true,
    consentement: "portail",
  },
  {
    cle: "contributeur.client.2",
    numero: "+2250000000000",
    jour: "2026-04-09",
    verifie: true,
    consentement: "cabinet",
    reference: `${MARQUE_CANAUX} : formulaire fictif signé, référence DEMO-CONS-0102`,
  },
  {
    cle: "associe",
    numero: "+2250000000021",
    jour: "2026-03-03",
    verifie: true,
    consentement: "portail",
  },
  {
    cle: "directeur.mission",
    numero: "+2250000000022",
    jour: "2026-03-03",
    verifie: true,
    consentement: "portail",
  },
  {
    cle: "chef.mission",
    numero: "+2250000000023",
    jour: "2026-03-03",
    verifie: true,
    consentement: "portail",
  },
  {
    cle: "consultant.junior",
    numero: "+2250000000024",
    jour: "2026-09-14",
    verifie: false,
    consentement: "aucun",
  },
];

export interface KpiMessagerie {
  libelle: string;
  mission: CleMissionCasting;
  unite: string;
  sens: "plus_haut_mieux" | "plus_bas_mieux";
  cible: number;
  alerteBas?: number;
  alerteHaut?: number;
  /** Mesures mensuelles de janvier à août 2026 (historique de la vraisemblance). */
  historique: readonly number[];
  /** Contributeurs du portail désignés pour ce KPI. */
  contributeurs: readonly CleCompte[];
}

/** KPI dont la mesure arrive par message. Libellés distinctifs : clé d'idempotence. */
export const KPI_MESSAGERIE: readonly KpiMessagerie[] = [
  {
    libelle: "KPI messagerie — Volume de cacao collecté",
    mission: "planSicafe",
    unite: "tonnes",
    sens: "plus_haut_mieux",
    cible: 1300,
    alerteBas: 1000,
    historique: [1180, 1215, 1240, 1262, 1290, 1275, 1310, 1325],
    contributeurs: ["contributeur.client", "dirigeant.client"],
  },
  {
    libelle: "KPI messagerie — Délai moyen de livraison",
    mission: "planSicafe",
    unite: "jours",
    sens: "plus_bas_mieux",
    cible: 6,
    alerteHaut: 12,
    historique: [8, 7, 7, 8, 6, 7, 6, 6],
    contributeurs: ["contributeur.client", "dirigeant.client"],
  },
  {
    libelle: "KPI messagerie — Encours de crédit PME",
    mission: "notationBanqueSahel",
    unite: "M FCFA",
    sens: "plus_haut_mieux",
    cible: 4500,
    alerteBas: 3500,
    historique: [3900, 3980, 4050, 4120, 4200, 4260, 4310, 4380],
    contributeurs: ["dirigeant.client.2", "contributeur.client.2"],
  },
];

export interface EntrantCanal {
  /** Expéditeur (compte du portail). */
  de: CleCompte;
  /** Texte reçu. */
  texte: string;
  /** Suite : confirmation OUI, ou reprise/rejet par le cabinet. */
  suite?: "oui" | "reprendre" | "rejeter";
  motif?: string;
  /**
   * Période de la mesure reprise. Les alertes de seuil ne portent que sur la dernière période CLOSE :
   * une valeur reçue en octobre pour septembre peut donc déclencher l'alerte sortante.
   */
  dateMesure?: string;
}

/**
 * Messages entrants dans l'ordre. L'analyse (KPI reconnu, vraisemblance) est faite par du code
 * déterministe ; l'issue attendue est indiquée en commentaire.
 */
export const ENTRANTS_CANAUX: readonly EntrantCanal[] = [
  // Reprise : valeur dans la norme, confirmée par OUI puis reprise par le cabinet.
  {
    de: "contributeur.client",
    texte: "volume cacao 1340",
    suite: "reprendre",
    dateMesure: "2026-09-30",
  },
  // Rejet du cabinet : confirmée par OUI, mais déjà saisie au portail.
  {
    de: "dirigeant.client",
    texte: "delai livraison 6",
    suite: "rejeter",
    motif: `Valeur déjà saisie au portail pour la période (${MARQUE_CANAUX}).`,
  },
  // Rejet automatique : ordre de grandeur invraisemblable (saisie refusée, aucune confirmation).
  { de: "contributeur.client", texte: "volume cacao 13400" },
  // Reprise sous le seuil d'alerte : déclenche l'alerte de KPI sortante vers les responsables.
  {
    de: "dirigeant.client.2",
    texte: "encours credit 3100",
    suite: "reprendre",
    dateMesure: "2026-09-30",
  },
  // En attente de confirmation : jamais confirmée.
  { de: "dirigeant.client", texte: "volume cacao 1290" },
  // Numéro non joignable (`…00`) : la réponse du service échoue, l'envoi reste « échec » au journal.
  { de: "contributeur.client.2", texte: "encours credit 3650" },
];
