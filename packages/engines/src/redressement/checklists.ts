/**
 * Check-lists métier du redressement (RED-03) : listes de points de contrôle activables par
 * secteur, rattachées aux domaines de la grille d'urgence, que le cabinet peut configurer.
 *
 * Le moteur fournit (1) trois check-lists de DÉPART (industrie, services, commerce), (2) la
 * validation d'un modèle (bornes, doublons d'identifiant, domaine connu) et (3) l'évaluation pure
 * d'une check-list renseignée. L'évaluation est un constat de saisie : taux de complétude et de
 * conformité par domaine en points de base, listes d'items à traiter. Un item non renseigné n'est
 * jamais compté conforme. Aucun jugement juridique : une check-list n'établit pas une situation
 * de droit. Fonctions pures, arithmétique entière, aucune horloge.
 */
import { rapportPb } from "./commun";
import { ErreurRedressement } from "./erreurs";
import { DOMAINES_URGENCE, type DomaineUrgence } from "./urgence";

/** Version du moteur d'évaluation des check-lists (un changement de règle l'incrémente). */
export const VERSION_CHECKLISTS = 1;

/** Secteurs d'un modèle de cabinet : ceux des dossiers de redressement. */
export const SECTEURS_CHECKLIST = [
  "general",
  "industrie",
  "commerce",
  "services",
  "btp",
  "agriculture",
] as const;
export type SecteurChecklist = (typeof SECTEURS_CHECKLIST)[number];

/** Réponses : « oui » = conforme ; « partiel » vaut un demi-point ; « sans_objet » sort du dénominateur. */
export const REPONSES_CHECKLIST = ["oui", "non", "partiel", "sans_objet"] as const;
export type ReponseChecklist = (typeof REPONSES_CHECKLIST)[number];

/** Bornes d'un modèle (reprises à l'identique par les schémas partagés et la base). */
export const ITEMS_CHECKLIST_MIN = 1;
export const ITEMS_CHECKLIST_MAX = 40;
export const ITEM_ID_MAX = 40;
export const ITEM_LIBELLE_MAX = 300;
export const ITEM_AIDE_MAX = 600;
/** Identifiant d'item : minuscules, chiffres, tiret bas ou tiret, stable d'une version à l'autre. */
export const MOTIF_ITEM_ID = /^[a-z0-9][a-z0-9_-]*$/;

export interface ItemChecklist {
  /** Identifiant stable (MOTIF_ITEM_ID). */
  readonly id: string;
  /** Domaine de la grille d'urgence auquel l'item se rattache. */
  readonly domaine: DomaineUrgence;
  /** Français, formulé comme un point de contrôle (« oui » = en place). */
  readonly libelle: string;
  /** Aide de saisie facultative. */
  readonly aide?: string | null;
}

export interface ChecklistDepart {
  /** Code stable de la check-list de départ. */
  readonly code: string;
  readonly secteur: SecteurChecklist;
  readonly intitule: string;
  /** Toujours vrai : contenu de départ, à relire par un expert avant tout usage de référence. */
  readonly a_valider_par_un_expert: true;
  readonly items: readonly ItemChecklist[];
}

/** Version du contenu de départ (un changement de libellé l'incrémente). */
export const VERSION_CHECKLISTS_DEPART = 1;

const ITEM_PREVISIONNEL =
  "Un prévisionnel de trésorerie à 13 semaines existe-t-il et est-il mis à jour chaque semaine ?";
const ITEM_CONCENTRATION =
  "Les clients qui pèsent plus de 10 % du chiffre d'affaires sont-ils identifiés avec leur niveau de dépendance ?";
const ITEM_EMPRUNTS =
  "La liste des emprunts, lignes de crédit et garanties, avec leurs échéances, est-elle à jour ?";
const ITEM_ECHANGES =
  "Les échanges en cours avec les banques et les principaux créanciers sont-ils documentés ?";

/**
 * Check-lists de DÉPART : contenu PROVISOIRE, minimal, aux formulations neutres, À VALIDER PAR UN
 * EXPERT (SPEC-3a §13). Elles servent de point de départ ; le cabinet configure ses propres modèles.
 * Un « oui » signifie que le point de contrôle est en place ; aucun libellé ne qualifie la situation
 * juridique du client.
 */
export const CHECKLISTS_DEPART: readonly ChecklistDepart[] = [
  {
    code: "depart_industrie",
    secteur: "industrie",
    intitule: "Industrie : points de contrôle de départ",
    a_valider_par_un_expert: true,
    items: [
      { id: "ind_tre_01", domaine: "tresorerie", libelle: ITEM_PREVISIONNEL },
      {
        id: "ind_tre_02",
        domaine: "tresorerie",
        libelle:
          "Les échéances fiscales et sociales à venir sont-elles recensées avec leurs dates et leurs montants ?",
      },
      {
        id: "ind_act_01",
        domaine: "activite",
        libelle: "Le carnet de commandes et les marges par produit sont-ils suivis régulièrement ?",
      },
      { id: "ind_act_02", domaine: "activite", libelle: ITEM_CONCENTRATION },
      {
        id: "ind_exp_01",
        domaine: "exploitation",
        libelle:
          "Les stocks (matières, en-cours, produits finis) ont-ils été inventoriés récemment ?",
      },
      {
        id: "ind_exp_02",
        domaine: "exploitation",
        libelle:
          "L'état des équipements et les arrêts de production des derniers mois sont-ils documentés ?",
      },
      {
        id: "ind_exp_03",
        domaine: "exploitation",
        libelle:
          "Les approvisionnements critiques et les fournisseurs de remplacement sont-ils identifiés ?",
      },
      {
        id: "ind_soc_01",
        domaine: "social",
        libelle:
          "Les effectifs, les compétences clés et les départs prévus sont-ils recensés par atelier ou service ?",
      },
      { id: "ind_fin_01", domaine: "financement", libelle: ITEM_EMPRUNTS },
      { id: "ind_fin_02", domaine: "financement", libelle: ITEM_ECHANGES },
    ],
  },
  {
    code: "depart_services",
    secteur: "services",
    intitule: "Services : points de contrôle de départ",
    a_valider_par_un_expert: true,
    items: [
      { id: "srv_tre_01", domaine: "tresorerie", libelle: ITEM_PREVISIONNEL },
      {
        id: "srv_tre_02",
        domaine: "tresorerie",
        libelle:
          "Les factures émises et leurs dates d'encaissement attendues sont-elles suivies client par client ?",
      },
      {
        id: "srv_act_01",
        domaine: "activite",
        libelle: "Le portefeuille de contrats et leurs dates de renouvellement sont-ils listés ?",
      },
      { id: "srv_act_02", domaine: "activite", libelle: ITEM_CONCENTRATION },
      {
        id: "srv_exp_01",
        domaine: "exploitation",
        libelle:
          "Le taux d'occupation des équipes et le temps non facturé sont-ils mesurés chaque mois ?",
      },
      {
        id: "srv_exp_02",
        domaine: "exploitation",
        libelle: "Les travaux en cours non encore facturés sont-ils recensés et valorisés ?",
      },
      {
        id: "srv_soc_01",
        domaine: "social",
        libelle: "Les personnes clés, leurs engagements et les départs prévus sont-ils recensés ?",
      },
      { id: "srv_fin_01", domaine: "financement", libelle: ITEM_EMPRUNTS },
      { id: "srv_fin_02", domaine: "financement", libelle: ITEM_ECHANGES },
    ],
  },
  {
    code: "depart_commerce",
    secteur: "commerce",
    intitule: "Commerce : points de contrôle de départ",
    a_valider_par_un_expert: true,
    items: [
      { id: "com_tre_01", domaine: "tresorerie", libelle: ITEM_PREVISIONNEL },
      {
        id: "com_tre_02",
        domaine: "tresorerie",
        libelle:
          "Les échéances fournisseurs, fiscales et sociales à venir sont-elles recensées avec leurs dates ?",
      },
      {
        id: "com_act_01",
        domaine: "activite",
        libelle:
          "Les ventes et la marge sont-elles suivies par famille de produits ou par point de vente ?",
      },
      {
        id: "com_act_02",
        domaine: "activite",
        libelle:
          "Les remises, les retours et les ventes à crédit sont-ils suivis et rapprochés des encaissements ?",
      },
      {
        id: "com_exp_01",
        domaine: "exploitation",
        libelle:
          "Les stocks ont-ils été inventoriés récemment, avec repérage des articles à rotation lente ?",
      },
      {
        id: "com_exp_02",
        domaine: "exploitation",
        libelle:
          "Les conditions de paiement négociées avec les principaux fournisseurs sont-elles documentées ?",
      },
      {
        id: "com_soc_01",
        domaine: "social",
        libelle:
          "Les effectifs par point de vente, les horaires et les départs prévus sont-ils recensés ?",
      },
      { id: "com_fin_01", domaine: "financement", libelle: ITEM_EMPRUNTS },
      {
        id: "com_fin_02",
        domaine: "financement",
        libelle:
          "Les échanges en cours avec les banques, les bailleurs et les principaux créanciers sont-ils documentés ?",
      },
    ],
  },
];

/** Check-list de départ d'un code, ou `undefined`. */
export function checklistDepart(code: string): ChecklistDepart | undefined {
  return CHECKLISTS_DEPART.find((c) => c.code === code);
}

function exigerTexte(valeur: unknown, max: number, nom: string): void {
  if (typeof valeur !== "string" || valeur.trim().length === 0 || valeur.length > max) {
    throw new ErreurRedressement(
      "ENTREE_INVALIDE",
      `${nom} : texte de 1 à ${max} caractères attendu.`,
    );
  }
}

/**
 * Valide les items d'un modèle : de 1 à 40 items, identifiant bien formé et unique, domaine de la
 * grille d'urgence, libellé de 1 à 300 caractères, aide facultative de 600 caractères au plus. Les
 * messages ne recopient aucune valeur saisie ; l'identifiant fautif est rendu dans `manquants`.
 */
export function validerModeleChecklist(items: readonly ItemChecklist[]): void {
  if (
    !Array.isArray(items) ||
    items.length < ITEMS_CHECKLIST_MIN ||
    items.length > ITEMS_CHECKLIST_MAX
  ) {
    throw new ErreurRedressement(
      "ENTREE_INVALIDE",
      `Une check-list compte de ${ITEMS_CHECKLIST_MIN} à ${ITEMS_CHECKLIST_MAX} items.`,
    );
  }
  const vus = new Set<string>();
  items.forEach((item, rang) => {
    const repere = `#${rang + 1}`;
    if (typeof item !== "object" || item === null) {
      throw new ErreurRedressement("ENTREE_INVALIDE", "Item de check-list mal formé.", [repere]);
    }
    const id = item.id;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > ITEM_ID_MAX ||
      !MOTIF_ITEM_ID.test(id)
    ) {
      throw new ErreurRedressement("ENTREE_INVALIDE", "Identifiant d'item invalide.", [repere]);
    }
    if (vus.has(id)) {
      throw new ErreurRedressement("ENTREE_INVALIDE", "Identifiant d'item en double.", [id]);
    }
    vus.add(id);
    if (!(DOMAINES_URGENCE as readonly string[]).includes(item.domaine)) {
      throw new ErreurRedressement("ENTREE_INVALIDE", "Domaine d'item inconnu.", [id]);
    }
    exigerTexte(item.libelle, ITEM_LIBELLE_MAX, `Libellé de l'item ${repere}`);
    if (item.aide !== undefined && item.aide !== null) {
      exigerTexte(item.aide, ITEM_AIDE_MAX, `Aide de l'item ${repere}`);
    }
  });
}

/** Comptes et taux d'un ensemble d'items (un domaine, ou la check-list entière). */
export interface BilanChecklist {
  readonly total: number;
  readonly oui: number;
  readonly non: number;
  readonly partiel: number;
  readonly sans_objet: number;
  readonly non_renseignes: number;
  /** Items hors « sans objet » : le dénominateur de la conformité. */
  readonly applicables: number;
  /** Items renseignés (« sans objet » compris) sur le total, en points de base ; null sans item. */
  readonly completude_pb: number | null;
  /** (2 × oui + partiel) sur 2 × applicables, en points de base ; null sans item applicable. */
  readonly conformite_pb: number | null;
}

export interface ResultatDomaineChecklist extends BilanChecklist {
  readonly domaine: DomaineUrgence;
}

export interface ResultatChecklist {
  /** VERSION_CHECKLISTS. */
  readonly version: number;
  /** Ordre de DOMAINES_URGENCE ; un domaine sans item a un total nul et des taux null. */
  readonly domaines: readonly ResultatDomaineChecklist[];
  readonly global: BilanChecklist;
  /** Items répondus « non ». */
  readonly non_conformes: readonly string[];
  /** Items répondus « partiel ». */
  readonly partiels: readonly string[];
  /** Items sans réponse : jamais comptés conformes. */
  readonly non_renseignes: readonly string[];
  /** Tous les items sont renseignés. */
  readonly complete: boolean;
}

interface Comptes {
  oui: number;
  non: number;
  partiel: number;
  sans_objet: number;
  total: number;
}

function bilan(c: Comptes): BilanChecklist {
  const renseignes = c.oui + c.non + c.partiel + c.sans_objet;
  const applicables = c.total - c.sans_objet;
  return {
    total: c.total,
    oui: c.oui,
    non: c.non,
    partiel: c.partiel,
    sans_objet: c.sans_objet,
    non_renseignes: c.total - renseignes,
    applicables,
    completude_pb: c.total === 0 ? null : rapportPb(BigInt(renseignes), BigInt(c.total)),
    conformite_pb:
      applicables === 0 ? null : rapportPb(BigInt(2 * c.oui + c.partiel), BigInt(2 * applicables)),
  };
}

/**
 * Évalue une check-list renseignée. `reponses` associe un identifiant d'item à sa réponse COURANTE ;
 * un identifiant absent des items lève `QUESTION_INCONNUE`, une réponse hors liste `REPONSE_INVALIDE`.
 * Les items sont revalidés (`validerModeleChecklist`).
 */
export function evaluerChecklist(
  items: readonly ItemChecklist[],
  reponses: Readonly<Record<string, ReponseChecklist>>,
): ResultatChecklist {
  validerModeleChecklist(items);
  const ids = new Set(items.map((i) => i.id));
  for (const [id, reponse] of Object.entries(reponses)) {
    if (!ids.has(id)) {
      throw new ErreurRedressement("QUESTION_INCONNUE", "Item inconnu dans les réponses.", [id]);
    }
    if (!(REPONSES_CHECKLIST as readonly string[]).includes(reponse)) {
      throw new ErreurRedressement("REPONSE_INVALIDE", "Réponse invalide.", [id]);
    }
  }
  const vide = (): Comptes => ({ oui: 0, non: 0, partiel: 0, sans_objet: 0, total: 0 });
  const global = vide();
  const parDomaine = new Map<DomaineUrgence, Comptes>(DOMAINES_URGENCE.map((d) => [d, vide()]));
  const nonConformes: string[] = [];
  const partiels: string[] = [];
  const nonRenseignes: string[] = [];
  for (const item of items) {
    const comptes = parDomaine.get(item.domaine) as Comptes;
    comptes.total += 1;
    global.total += 1;
    const reponse = Object.hasOwn(reponses, item.id) ? reponses[item.id] : undefined;
    if (reponse === undefined) {
      nonRenseignes.push(item.id);
      continue;
    }
    comptes[reponse] += 1;
    global[reponse] += 1;
    if (reponse === "non") nonConformes.push(item.id);
    if (reponse === "partiel") partiels.push(item.id);
  }
  return {
    version: VERSION_CHECKLISTS,
    domaines: DOMAINES_URGENCE.map((domaine) => ({
      domaine,
      ...bilan(parDomaine.get(domaine) as Comptes),
    })),
    global: bilan(global),
    non_conformes: nonConformes,
    partiels,
    non_renseignes: nonRenseignes,
    complete: nonRenseignes.length === 0,
  };
}
