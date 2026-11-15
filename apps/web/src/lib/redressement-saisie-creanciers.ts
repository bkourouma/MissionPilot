/** Redressement (saisie) : créanciers, créances, événements de négociation et paiements. */
import {
  creerTraduire,
  RED_ECHEANCES_MAX,
  type Langue,
  type RedCategorieCreancier,
  type RedCreanceCreation,
  type RedCreancierCreation,
  type RedEvenementNegociation,
} from "@missionpilot/shared";
import type { Devise } from "./format";
import { dateValide } from "./periode";
import { texteOuNull, type Resultat } from "./saisie";
import {
  type Erreurs,
  msgDate,
  msgMontant,
  lireMontantRed,
  lireEntier,
} from "./redressement-saisie-base";

// --- Créanciers -------------------------------------------------------------------------------------------

export interface SaisieCreancier {
  nom: string;
  categorie: RedCategorieCreancier;
  garanti: boolean;
  reference: string;
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
}
export type ChampCreancier = keyof SaisieCreancier;

function lireCreance(
  s: Pick<
    SaisieCreancier,
    "principal" | "interets" | "date_arrete" | "echeance_initiale" | "nature"
  >,
  devise: Devise,
  erreurs: Erreurs<ChampCreancier>,
  langue: Langue,
): {
  principal: number;
  interets: number;
  date_arrete: string;
  echeance_initiale: string | null;
  nature: string | null;
} {
  const t = creerTraduire(langue);
  const principal = lireMontantRed(s.principal, devise);
  if (principal === null) {
    erreurs.principal = t("Saisissez le montant principal.", "Enter the principal amount.");
  } else if (Number.isNaN(principal)) erreurs.principal = msgMontant(devise, langue);
  const interets = s.interets.trim() === "" ? 0 : lireMontantRed(s.interets, devise);
  if (interets === null || Number.isNaN(interets)) erreurs.interets = msgMontant(devise, langue);
  if (dateValide(s.date_arrete) === null) erreurs.date_arrete = msgDate(langue);
  const echeance = texteOuNull(s.echeance_initiale);
  if (echeance !== null && dateValide(echeance) === null) {
    erreurs.echeance_initiale = msgDate(langue);
  }
  const nature = texteOuNull(s.nature);
  if (nature !== null && nature.length > 200) {
    erreurs.nature = t(
      "La nature compte 200 caractères au plus.",
      "The nature is 200 characters at most.",
    );
  }
  return {
    principal: principal ?? 0,
    interets: interets ?? 0,
    date_arrete: s.date_arrete,
    echeance_initiale: echeance,
    nature,
  };
}

export function corpsCreancierDepuisFormulaire(
  s: SaisieCreancier,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<RedCreancierCreation, ChampCreancier> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampCreancier> = {};
  const nom = s.nom.trim();
  if (nom === "") erreurs.nom = t("Saisissez le nom du créancier.", "Enter the creditor's name.");
  else if (nom.length > 200) {
    erreurs.nom = t("Le nom compte 200 caractères au plus.", "The name is 200 characters at most.");
  }
  const reference = texteOuNull(s.reference);
  if (reference !== null && reference.length > 120) {
    erreurs.reference = t(
      "La référence compte 120 caractères au plus.",
      "The reference is 120 characters at most.",
    );
  }
  const c = lireCreance(s, devise, erreurs, langue);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge: RedCreancierCreation = {
    nom,
    categorie: s.categorie,
    garanti: s.garanti,
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (reference !== null) charge.reference = reference;
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  return { ok: true, charge };
}

export interface SaisieCreance {
  principal: string;
  interets: string;
  date_arrete: string;
  echeance_initiale: string;
  nature: string;
  commentaire: string;
}
export type ChampCreance = keyof SaisieCreance;

export function corpsCreanceDepuisFormulaire(
  s: SaisieCreance,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<RedCreanceCreation, ChampCreance> {
  const erreurs: Erreurs<ChampCreancier> = {};
  const c = lireCreance(s, devise, erreurs, langue);
  const commentaire = texteOuNull(s.commentaire);
  const e: Erreurs<ChampCreance> = { ...erreurs };
  if (commentaire !== null && commentaire.length > 1000) {
    e.commentaire = creerTraduire(langue)(
      "Le commentaire compte 1 000 caractères au plus.",
      "The comment is 1,000 characters at most.",
    );
  }
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  const charge: RedCreanceCreation = {
    principal: c.principal,
    interets: c.interets,
    date_arrete: c.date_arrete,
  };
  if (c.echeance_initiale !== null) charge.echeance_initiale = c.echeance_initiale;
  if (c.nature !== null) charge.nature = c.nature;
  if (commentaire !== null) charge.commentaire = commentaire;
  return { ok: true, charge };
}

export interface SaisieLigneEcheance {
  cle: string;
  date: string;
  montant: string;
}
export interface SaisieEvenement {
  type: RedEvenementNegociation["type"];
  date_evenement: string;
  montant: string;
  conditions: string;
  accord_id: string;
  /** « » : paiement non rattaché à une échéance. */
  echeance_rang: string;
  mode: "regulier" | "explicite";
  nombre_echeances: string;
  date_premiere: string;
  periodicite_mois: string;
  lignes: SaisieLigneEcheance[];
}
export type ChampEvenement =
  | "date_evenement"
  | "montant"
  | "conditions"
  | "accord_id"
  | "echeance_rang"
  | "nombre_echeances"
  | "date_premiere"
  | "periodicite_mois"
  | "lignes";

export const evenementVide = (aujourdhui: string, accordId = ""): SaisieEvenement => ({
  type: "note",
  date_evenement: aujourdhui,
  montant: "",
  conditions: "",
  accord_id: accordId,
  echeance_rang: "",
  mode: "regulier",
  nombre_echeances: "12",
  date_premiere: aujourdhui,
  periodicite_mois: "1",
  lignes: [],
});

/** Corps de la route 28 selon le type d'événement ; l'imputation des paiements est celle de l'API. */
export function corpsEvenementDepuisFormulaire(
  s: SaisieEvenement,
  devise: Devise,
  langue: Langue = "fr",
): Resultat<RedEvenementNegociation, ChampEvenement> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampEvenement> = {};
  if (dateValide(s.date_evenement) === null) erreurs.date_evenement = msgDate(langue);
  const conditions = texteOuNull(s.conditions);
  if (conditions !== null && conditions.length > 2000) {
    erreurs.conditions = t(
      "Les conditions comptent 2 000 caractères au plus.",
      "The terms are 2,000 characters at most.",
    );
  }
  const montantTexte = s.montant;
  const montant = lireMontantRed(montantTexte, devise);
  if (montant !== null && Number.isNaN(montant)) erreurs.montant = msgMontant(devise, langue);
  const positif = () => {
    if (montant === null) erreurs.montant = t("Saisissez le montant.", "Enter the amount.");
    else if (!Number.isNaN(montant) && montant < 1) {
      erreurs.montant = t(
        "Le montant doit être supérieur à zéro.",
        "The amount must be greater than zero.",
      );
    }
  };

  if (s.type === "accord") {
    positif();
    let echeancier: Extract<RedEvenementNegociation, { type: "accord" }>["echeancier"] | null =
      null;
    if (s.mode === "regulier") {
      const n = lireEntier(s.nombre_echeances, 1, RED_ECHEANCES_MAX);
      if (n === null || Number.isNaN(n)) {
        erreurs.nombre_echeances = t(
          `Nombre d'échéances : entier de 1 à ${RED_ECHEANCES_MAX}.`,
          `Number of installments: whole number from 1 to ${RED_ECHEANCES_MAX}.`,
        );
      }
      if (dateValide(s.date_premiere) === null) erreurs.date_premiere = msgDate(langue);
      const p = lireEntier(s.periodicite_mois, 1, 12);
      if (p === null || Number.isNaN(p)) {
        erreurs.periodicite_mois = t(
          "Périodicité : entier de 1 à 12 mois.",
          "Frequency: whole number from 1 to 12 months.",
        );
      }
      if (!erreurs.nombre_echeances && !erreurs.date_premiere && !erreurs.periodicite_mois) {
        echeancier = {
          mode: "regulier",
          nombre_echeances: n as number,
          date_premiere: s.date_premiere,
          periodicite_mois: p as number,
        };
      }
    } else {
      const lignes: { date: string; montant: number }[] = [];
      if (s.lignes.length === 0) {
        erreurs.lignes = t("Ajoutez au moins une échéance.", "Add at least one installment.");
      } else if (s.lignes.length > RED_ECHEANCES_MAX) {
        erreurs.lignes = t(
          `${RED_ECHEANCES_MAX} échéances au plus.`,
          `${RED_ECHEANCES_MAX} installments at most.`,
        );
      }
      s.lignes.forEach((l, i) => {
        if (erreurs.lignes) return;
        if (dateValide(l.date) === null) {
          erreurs.lignes = `${t("Échéance", "Installment")} ${i + 1} : ${msgDate(langue)}`;
          return;
        }
        const m = lireMontantRed(l.montant, devise);
        if (m === null || Number.isNaN(m) || m < 1) {
          erreurs.lignes = t(
            `Échéance ${i + 1} : saisissez un montant supérieur à zéro.`,
            `Installment ${i + 1}: enter an amount greater than zero.`,
          );
          return;
        }
        lignes.push({ date: l.date, montant: m });
      });
      if (!erreurs.lignes) echeancier = { mode: "explicite", lignes };
    }
    if (Object.keys(erreurs).length > 0 || echeancier === null || montant === null) {
      return { ok: false, erreurs };
    }
    const charge: RedEvenementNegociation = {
      type: "accord",
      date_evenement: s.date_evenement,
      montant,
      echeancier,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (s.type === "paiement") {
    positif();
    if (s.accord_id === "") {
      erreurs.accord_id = t(
        "Aucun accord en vigueur : enregistrez d'abord un accord.",
        "No agreement in force: record an agreement first.",
      );
    }
    const rang =
      s.echeance_rang.trim() === "" ? null : lireEntier(s.echeance_rang, 1, RED_ECHEANCES_MAX);
    if (rang !== null && Number.isNaN(rang)) {
      erreurs.echeance_rang = t(
        "Choisissez une échéance de la liste.",
        "Choose an installment from the list.",
      );
    }
    if (Object.keys(erreurs).length > 0 || montant === null) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "paiement",
      date_evenement: s.date_evenement,
      montant: montant as number,
      accord_id: s.accord_id,
    };
    if (rang !== null) charge.echeance_rang = rang;
    return { ok: true, charge };
  }

  if (s.type === "rupture") {
    if (s.accord_id === "") {
      erreurs.accord_id = t("Aucun accord en vigueur à rompre.", "No agreement in force to break.");
    }
    if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
    const charge: RedEvenementNegociation = {
      type: "rupture",
      date_evenement: s.date_evenement,
      accord_id: s.accord_id,
    };
    if (conditions !== null) charge.conditions = conditions;
    return { ok: true, charge };
  }

  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const charge = {
    type: s.type,
    date_evenement: s.date_evenement,
    ...(montant !== null ? { montant } : {}),
    ...(conditions !== null ? { conditions } : {}),
  } as RedEvenementNegociation;
  return { ok: true, charge };
}

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Corps de l'annulation d'un paiement : l'événement vise le paiement par son identifiant. */
export function corpsAnnulationPaiement(
  paiementId: string,
  dateEvenement: string,
  langue: Langue = "fr",
): Resultat<
  Extract<RedEvenementNegociation, { type: "annulation_paiement" }>,
  "paiement_annule_id" | "date_evenement"
> {
  const erreurs: Erreurs<"paiement_annule_id" | "date_evenement"> = {};
  if (!FORMAT_UUID.test(paiementId)) {
    erreurs.paiement_annule_id = creerTraduire(langue)(
      "Paiement à annuler inconnu.",
      "Unknown payment to cancel.",
    );
  }
  if (dateValide(dateEvenement) === null) erreurs.date_evenement = msgDate(langue);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      type: "annulation_paiement",
      date_evenement: dateEvenement,
      paiement_annule_id: paiementId,
    },
  };
}
