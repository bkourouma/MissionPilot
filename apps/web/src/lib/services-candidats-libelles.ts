/** Services candidats : libellés et prix fixe (module extrait de `services-candidats.ts`). */
import { lireEntier } from "./services-candidats-outils";
import { NBSP, estDevise } from "./services-candidats-outils";
import type {
  ServiceCandidat,
  StatutRapprochement,
  VerdictCritere,
} from "./services-candidats-types";
import {
  OBJETS_FINANCEMENT,
  TYPES_GUICHET,
  type ObjetFinancement,
  type PrixFixe,
  type TypeGuichet,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { DEVISES, VALEUR_ABSENTE, formaterNombre, type Devise } from "./format";
import { remplacerCodesTechniques } from "./codes-lisibles";
import { texteOuNull, type Resultat } from "./saisie";

/** Rubriques d'évaluation des méthodes publiées des services candidats (code -> libellé). */
export const LIBELLES_RUBRIQUES_SERVICES: Readonly<Record<string, string>> = {
  solidite_plan_financement: "Solidité du plan de financement",
  maitrise_gestion: "Maîtrise de la gestion",
};

/** Message de cohérence de l'API en français : codes de rubrique remplacés par leur libellé. */
export const libelleMessageCoherence = (message: string): string =>
  remplacerCodesTechniques(message, LIBELLES_RUBRIQUES_SERVICES);

export const MENTION_A_VALIDER = "Contenu à valider par un expert";
export const MENTION_GUICHETS_A_VALIDER =
  "Les guichets saisis par le cabinet sont à valider par un expert : le rapprochement est indicatif.";
export const MESSAGE_AUCUN_GUICHET =
  "Aucun guichet : la liste est gérée par le cabinet, aucune source externe.";

export const SYMBOLES_DEVISE: Record<Devise, string> = {
  XOF: "FCFA",
  XAF: "FCFA",
  EUR: "€",
  USD: "$US",
};

export const OPTIONS_DEVISES_SERVICE = DEVISES.map((d) => ({
  valeur: d,
  libelle: d === "XOF" ? "XOF (FCFA UEMOA)" : d === "XAF" ? "XAF (FCFA CEMAC)" : d,
}));

export const TYPE_GUICHET_LIBELLES: Record<TypeGuichet, string> = {
  banque: "Banque",
  bailleur: "Bailleur de fonds",
  fonds_investissement: "Fonds d'investissement",
  programme_public: "Programme public",
  autre: "Autre",
};
export const OPTIONS_TYPES_GUICHET = TYPES_GUICHET.map((t) => ({
  valeur: t,
  libelle: TYPE_GUICHET_LIBELLES[t],
}));

export const OBJET_LIBELLES: Record<ObjetFinancement, string> = {
  creation: "Création",
  investissement: "Investissement",
  bfr: "Besoin en fonds de roulement",
  croissance: "Croissance",
  restructuration: "Restructuration",
  export: "Export",
};
export const OPTIONS_OBJETS = OBJETS_FINANCEMENT.map((o) => ({
  valeur: o,
  libelle: OBJET_LIBELLES[o],
}));

export const STATUT_RAPPROCHEMENT: Record<
  StatutRapprochement,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  compatible: { libelle: "Compatible", tonalite: "succes" },
  partiel: { libelle: "Partiel", tonalite: "attention" },
  exclu: { libelle: "Exclu", tonalite: "danger" },
};

export const VERDICT_LIBELLES: Record<VerdictCritere, string> = {
  ok: "Satisfait",
  ko: "Non satisfait",
  inconnu: "Inconnu",
  non_restreint: "Sans restriction",
};

export const CRITERE_LIBELLES: Record<string, string> = {
  actif: "Guichet actif",
  echeance: "Échéance",
  pays: "Pays",
  secteur: "Secteur",
  filiere: "Filière",
  taille: "Taille",
  objet: "Objet du financement",
  devise: "Devise",
  montant: "Montant",
};

export const libelleCritere = (c: string): string => CRITERE_LIBELLES[c] ?? c;
export const libelleStatut = (s: StatutRapprochement): string => STATUT_RAPPROCHEMENT[s].libelle;

// --- Prix fixe -----------------------------------------------------------------------

export const TEXTE_PRIX_A_FIXER = "À fixer par le cabinet";
export const MESSAGE_FIXER_PRIX_D_ABORD = "Fixez d'abord le prix.";

/** Alerte quand l'API n'a renvoyé que les N premiers guichets. */
export const messageListeTronquee = (n: number): string =>
  `La liste est tronquée : seuls les ${n} premiers guichets sont affichés.`;
/** Alerte quand le rapprochement n'a porté que sur une partie des guichets. */
export const messageRapprochementTronque = (n: number): string =>
  `La liste est tronquée : seuls les ${n} premiers guichets ont été rapprochés.`;

/** « 1 500 000 FCFA » ; sans montant : « À fixer par le cabinet » (prix requis) ou « Sur devis ». */
export function formaterPrixService(prix: ServiceCandidat["prix"]): string {
  const sans = prix.a_fixer ? TEXTE_PRIX_A_FIXER : "Sur devis";
  if (prix.montant === null) return sans;
  const nombre = formaterNombre(prix.montant, 0);
  if (nombre === VALEUR_ABSENTE) return sans;
  return `${nombre}${NBSP}${estDevise(prix.devise) ? SYMBOLES_DEVISE[prix.devise] : prix.devise}`;
}

/** Montant d'un prix ou d'une borne → texte modifiable (« 1500000 »). */
export const montantVersTexte = (montant: number | null): string =>
  montant === null ? "" : String(montant);

export type ChampPrix = "montant" | "devise" | "commentaire";

/**
 * Corps de PUT /api/services-candidats/:code/prix. Un montant vide signifie « à fixer » ou
 * « sur devis » ; une mention vide efface la mention existante.
 */
export function validerPrix(
  montant: string,
  devise: string,
  mention = "",
): Resultat<PrixFixe, ChampPrix> {
  const erreurs: Partial<Record<ChampPrix, string>> = {};
  const m = lireEntier(montant);
  if (m !== null && Number.isNaN(m))
    erreurs.montant =
      "Saisissez un montant entier, sans décimale (ex. 1 500 000), ou laissez vide.";
  else if (m !== null && m > 1_000_000_000_000) erreurs.montant = "Montant trop élevé.";
  if (!estDevise(devise)) erreurs.devise = "Choisissez une devise.";
  const commentaire = texteOuNull(mention);
  if (commentaire !== null && commentaire.length > 200)
    erreurs.commentaire = "200 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { montant: m, devise: devise as Devise, commentaire } };
}
