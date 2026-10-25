import type { CleMission } from "./casting.js";
import { DONNEES_A } from "./facturation-donnees-a.js";
import { DONNEES_B } from "./facturation-donnees-b.js";
import { DONNEES_C } from "./facturation-donnees-c.js";

/*
 * Données du module FACTURATION du Tenant démo : échéanciers, factures, règlements et débours de
 * chaque mission du casting. Données pures (aucune règle de calcul : les montants sortent des
 * routes et des moteurs, les pourcentages ci-dessous sont des PARTS du budget d'honoraires).
 *
 * Dates : fictives, jamais postérieures à « aujourd'hui » (2026-10-24) pour ce qui est émis, payé
 * ou saisi ; les échéances à venir sont seulement planifiées. Un jour non ouvré est ramené au
 * jour ouvré voisin au moment de jouer l'événement (facturation-outils.ts).
 */

export type TypeEcheance = "acompte" | "jalon" | "avancement";

export interface EcheanceSpec {
  /** Clé stable dans la mission (sert à retrouver l'échéance et à construire les factures). */
  cle: string;
  libelle: string;
  type: TypeEcheance;
  /** Part du budget d'honoraires initial (en points). Absent : complément d'avenant. */
  pct?: number;
  /** Date prévue de l'échéance. */
  date: string;
  /** Libellé exact du jalon de la mission auquel l'échéance est rattachée. */
  jalon?: string;
}

export type EtatFacture = "emise" | "approuvee" | "a_approuver" | "brouillon";

export interface PaiementSpec {
  /** Délai après l'émission (15 à 60 jours). */
  jours: number;
  /** Part du net à payer (en points), ou « reste » pour solder. */
  part: number | "reste";
  mode: "virement" | "cheque" | "mobile_money";
  operateur?: "orange_money" | "mtn_momo" | "wave" | "moov_money";
  commentaire?: string;
}

export interface FactureSpec {
  cle: string;
  /** Échéances facturées (clés d'`EcheanceSpec`). */
  echeances: string[];
  /** Les débours refacturables validés et non encore facturés rejoignent cette facture. */
  debours?: boolean;
  /** Date d'émission (ou dernière étape pour une facture non émise). */
  date: string;
  objet: string;
  etat: EtatFacture;
  paiements?: PaiementSpec[];
}

export interface DeboursSpec {
  jour: string;
  categorie:
    | "transport"
    | "hebergement"
    | "restauration"
    | "per_diem"
    | "communication"
    | "fournitures"
    | "sous_traitance_locale"
    | "autre";
  libelle: string;
  montant: number;
  refacturable: boolean;
  /** Parcours du débours (par défaut : validé). */
  parcours?: "valide" | "soumis" | "rejete_puis_valide";
}

export interface MissionFacturation {
  echeances: EcheanceSpec[];
  /** Vrai : les échéances sont créées une à une (budget révisé ou régie) et non par la génération. */
  manuel: boolean;
  factures: FactureSpec[];
  debours: DeboursSpec[];
}

/** Facturation de chaque mission du casting (trois fichiers de données, cf. facturation-donnees-*.ts). */
export const FACTURATION: Partial<Record<CleMission, MissionFacturation>> = {
  ...DONNEES_A,
  ...DONNEES_B,
  ...DONNEES_C,
};

/** Mission dont le paiement du solde est remisé (avoirs) : voir facturation-avoirs.ts. */
export const REMISE_COMMERCIALE = {
  mission: "wouri-redressement" as CleMission,
  /** Factures annulées par avoir puis réémises en une seule. */
  annulees: ["F2", "F3"],
  date: "2025-11-28",
  /** Remise globale (en points) sur les deux étapes réunies : environ 20 % des honoraires. */
  pourcentage: 28.5714,
  motif:
    "Remise commerciale accordée au client en difficulté de trésorerie (accord du comité de pilotage)",
  reemission: {
    cle: "FR",
    objet: "Étapes 2 et solde du redressement, remise commerciale accordée",
    paiements: [
      { jours: 16, part: 50, mode: "virement", commentaire: "Premier versement après accord" },
      { jours: 44, part: "reste", mode: "virement" },
    ] as PaiementSpec[],
  },
};

/** Correction par avoir d'une facture de débours (mauvaise référence de commande). */
export const CORRECTION = {
  mission: "mboa-dd" as CleMission,
  facture: "FD",
  date: "2026-01-08",
  motif: "Référence du bon de commande du client erronée sur la facture : annulation et réémission",
  reemission: "FD2",
};

/** Facture en retard (échue depuis plus de 45 jours, non réglée) et ses deux relances manuelles. */
export const RETARD = {
  mission: "baobab-plan" as CleMission,
  facture: "F2",
  relances: [
    { date: "2026-09-03", niveau: 1, message: "Rappel amiable : facture échue depuis le 26 août." },
    {
      date: "2026-09-30",
      niveau: 2,
      message: "Deuxième relance : merci de confirmer la date de règlement.",
    },
  ],
};

/** Encaissement saisi avec un mauvais montant, contre-passé puis ressaisi. */
export const ERREUR_SAISIE = {
  mission: "teranga-flash" as CleMission,
  facture: "F1",
  /** Jour du virement reçu. */
  jour: "2026-10-02",
  /** Part du net saisie par erreur (zéro oublié). */
  partErreur: 10,
  demande: "2026-10-22",
  validation: "2026-10-23",
  motif: "Montant saisi par erreur (un zéro oublié) : le virement reçu couvre toute la facture",
};

/** Plan comptable du cabinet (SYSCOHADA révisé, comptes détaillés) et journaux. */
export const PLAN_COMPTABLE = {
  comptes: {
    clients: "411100",
    avances_clients: "419100",
    produits_prestations: "706100",
    produits_debours: "707100",
    tva_collectee: "443100",
    retenues_subies: "449200",
    banque: "521100",
    cheques: "513100",
    caisse: "571100",
    mobile_money: "552100",
  },
  journaux: {
    ventes: "VTE",
    banque: "BQ1",
    caisse: "CAI",
    mobile_money: "MM",
    operations_diverses: "OD",
  },
};

export const PARAMETRES_RELANCES = {
  delais_relance: [7, 15, 30],
  relances_actives: true,
  envoi_email_client: false,
  valeurs_validees: true,
};

/** Banques fictives des références de virement. */
export const BANQUES = ["SGBCI", "BICICI", "NSIA", "ECOBANK", "BOA"] as const;
