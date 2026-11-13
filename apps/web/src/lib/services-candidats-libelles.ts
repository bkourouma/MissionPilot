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
  creerTraduire,
  type Langue,
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

export const LIBELLES_RUBRIQUES_SERVICES_EN: Readonly<Record<string, string>> = {
  solidite_plan_financement: "Strength of the financing plan",
  maitrise_gestion: "Management control",
};

/** Message de cohérence de l'API : codes de rubrique remplacés par leur libellé. */
export const libelleMessageCoherence = (message: string, langue: Langue = "fr"): string =>
  remplacerCodesTechniques(
    message,
    langue === "en" ? LIBELLES_RUBRIQUES_SERVICES_EN : LIBELLES_RUBRIQUES_SERVICES,
  );

export const MENTION_A_VALIDER = "Contenu à valider par un expert";
export const MENTION_GUICHETS_A_VALIDER =
  "Les guichets saisis par le cabinet sont à valider par un expert : le rapprochement est indicatif.";
export const MESSAGE_AUCUN_GUICHET =
  "Aucun guichet : la liste est gérée par le cabinet, aucune source externe.";

export const mentionAValider = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(MENTION_A_VALIDER, "Content pending expert approval");
export const mentionGuichetsAValider = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(
    MENTION_GUICHETS_A_VALIDER,
    "Funding sources entered by the firm are pending expert approval: the matching is indicative.",
  );
export const messageAucunGuichet = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(
    MESSAGE_AUCUN_GUICHET,
    "No funding source: the list is managed by the firm, with no external source.",
  );

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

/** Devises proposées, libellées dans la langue de l'interface. */
export const optionsDevisesService = (langue: Langue = "fr") =>
  DEVISES.map((d) => ({
    valeur: d,
    libelle:
      d === "XOF"
        ? langue === "en"
          ? "XOF (FCFA WAEMU)"
          : "XOF (FCFA UEMOA)"
        : d === "XAF"
          ? "XAF (FCFA CEMAC)"
          : d,
  }));

export const TYPE_GUICHET_LIBELLES: Record<TypeGuichet, string> = {
  banque: "Banque",
  bailleur: "Bailleur de fonds",
  fonds_investissement: "Fonds d'investissement",
  programme_public: "Programme public",
  autre: "Autre",
};
export const TYPE_GUICHET_LIBELLES_EN: Record<TypeGuichet, string> = {
  banque: "Bank",
  bailleur: "Donor",
  fonds_investissement: "Investment fund",
  programme_public: "Public program",
  autre: "Other",
};
export const libelleTypeGuichet = (t: TypeGuichet, langue: Langue = "fr"): string =>
  (langue === "en" ? TYPE_GUICHET_LIBELLES_EN : TYPE_GUICHET_LIBELLES)[t];
export const OPTIONS_TYPES_GUICHET = TYPES_GUICHET.map((t) => ({
  valeur: t,
  libelle: TYPE_GUICHET_LIBELLES[t],
}));
export const optionsTypesGuichet = (langue: Langue = "fr") =>
  TYPES_GUICHET.map((t) => ({ valeur: t, libelle: libelleTypeGuichet(t, langue) }));

export const OBJET_LIBELLES: Record<ObjetFinancement, string> = {
  creation: "Création",
  investissement: "Investissement",
  bfr: "Besoin en fonds de roulement",
  croissance: "Croissance",
  restructuration: "Restructuration",
  export: "Export",
};
export const OBJET_LIBELLES_EN: Record<ObjetFinancement, string> = {
  creation: "Start-up",
  investissement: "Investment",
  bfr: "Working capital",
  croissance: "Growth",
  restructuration: "Restructuring",
  export: "Export",
};
export const libelleObjet = (o: ObjetFinancement, langue: Langue = "fr"): string =>
  (langue === "en" ? OBJET_LIBELLES_EN : OBJET_LIBELLES)[o];
export const OPTIONS_OBJETS = OBJETS_FINANCEMENT.map((o) => ({
  valeur: o,
  libelle: OBJET_LIBELLES[o],
}));
export const optionsObjets = (langue: Langue = "fr") =>
  OBJETS_FINANCEMENT.map((o) => ({ valeur: o, libelle: libelleObjet(o, langue) }));

export const STATUT_RAPPROCHEMENT: Record<
  StatutRapprochement,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  compatible: { libelle: "Compatible", tonalite: "succes" },
  partiel: { libelle: "Partiel", tonalite: "attention" },
  exclu: { libelle: "Exclu", tonalite: "danger" },
};

export const STATUT_RAPPROCHEMENT_EN: Record<
  StatutRapprochement,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  compatible: { libelle: "Compatible", tonalite: "succes" },
  partiel: { libelle: "Partial", tonalite: "attention" },
  exclu: { libelle: "Excluded", tonalite: "danger" },
};
export const statutRapprochement = (s: StatutRapprochement, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_RAPPROCHEMENT_EN : STATUT_RAPPROCHEMENT)[s];

export const VERDICT_LIBELLES: Record<VerdictCritere, string> = {
  ok: "Satisfait",
  ko: "Non satisfait",
  inconnu: "Inconnu",
  non_restreint: "Sans restriction",
};
export const VERDICT_LIBELLES_EN: Record<VerdictCritere, string> = {
  ok: "Met",
  ko: "Not met",
  inconnu: "Unknown",
  non_restreint: "No restriction",
};
export const libelleVerdict = (v: VerdictCritere, langue: Langue = "fr"): string =>
  (langue === "en" ? VERDICT_LIBELLES_EN : VERDICT_LIBELLES)[v];

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

export const CRITERE_LIBELLES_EN: Record<string, string> = {
  actif: "Active funding source",
  echeance: "Deadline",
  pays: "Country",
  secteur: "Sector",
  filiere: "Value chain",
  taille: "Size",
  objet: "Purpose of the financing",
  devise: "Currency",
  montant: "Amount",
};

export const libelleCritere = (c: string, langue: Langue = "fr"): string =>
  (langue === "en" ? CRITERE_LIBELLES_EN : CRITERE_LIBELLES)[c] ?? c;
export const libelleStatut = (s: StatutRapprochement, langue: Langue = "fr"): string =>
  statutRapprochement(s, langue).libelle;

// --- Prix fixe -----------------------------------------------------------------------

export const TEXTE_PRIX_A_FIXER = "À fixer par le cabinet";
export const MESSAGE_FIXER_PRIX_D_ABORD = "Fixez d'abord le prix.";

export const textePrixAFixer = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(TEXTE_PRIX_A_FIXER, "To be set by the firm");
export const messageFixerPrixDAbord = (langue: Langue = "fr"): string =>
  creerTraduire(langue)(MESSAGE_FIXER_PRIX_D_ABORD, "Set the price first.");

/** Alerte quand l'API n'a renvoyé que les N premiers guichets. */
export const messageListeTronquee = (n: number, langue: Langue = "fr"): string =>
  creerTraduire(langue)(
    `La liste est tronquée : seuls les ${n} premiers guichets sont affichés.`,
    `The list is truncated: only the first ${n} funding sources are shown.`,
  );
/** Alerte quand le rapprochement n'a porté que sur une partie des guichets. */
export const messageRapprochementTronque = (n: number, langue: Langue = "fr"): string =>
  creerTraduire(langue)(
    `La liste est tronquée : seuls les ${n} premiers guichets ont été rapprochés.`,
    `The list is truncated: only the first ${n} funding sources were matched.`,
  );

/** « 1 500 000 FCFA » ; sans montant : « À fixer par le cabinet » (prix requis) ou « Sur devis ». */
export function formaterPrixService(prix: ServiceCandidat["prix"], langue: Langue = "fr"): string {
  const sans = prix.a_fixer
    ? textePrixAFixer(langue)
    : creerTraduire(langue)("Sur devis", "On quote");
  if (prix.montant === null) return sans;
  const nombre = formaterNombre(prix.montant, 0, langue);
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
  langue: Langue = "fr",
): Resultat<PrixFixe, ChampPrix> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampPrix, string>> = {};
  const m = lireEntier(montant);
  if (m !== null && Number.isNaN(m))
    erreurs.montant = t(
      "Saisissez un montant entier, sans décimale (ex. 1 500 000), ou laissez vide.",
      "Enter a whole amount, no decimals (e.g. 1,500,000), or leave empty.",
    );
  else if (m !== null && m > 1_000_000_000_000)
    erreurs.montant = t("Montant trop élevé.", "Amount too high.");
  if (!estDevise(devise)) erreurs.devise = t("Choisissez une devise.", "Choose a currency.");
  const commentaire = texteOuNull(mention);
  if (commentaire !== null && commentaire.length > 200)
    erreurs.commentaire = t("200 caractères au plus.", "200 characters at most.");
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { montant: m, devise: devise as Devise, commentaire } };
}
