/**
 * Plan stratégique d'une mission (service #3, PLA-01 à PLA-05) : types des réponses de l'API,
 * statuts des contenus, droits d'affichage, structure (axes → objectifs → initiatives),
 * conditions du partage au client, messages et chemins. Logique pure, testée dans
 * `plan-strategique.test.ts`.
 *
 * L'IA propose, l'expert dispose : chaque contenu porte un statut (brouillon, brouillon IA,
 * modifié, validé) et un historique en ajout seul ; seul un plan dont TOUT le contenu est
 * validé (et la dernière version du modèle financier, s'il y en a une) peut être partagé au
 * client, et toute écriture ultérieure non validée retire ce partage (API, `plans/partage.ts`).
 *
 * Les droits ci-dessous sont un confort d'affichage (bouton proposé ou explication) : l'API
 * reste seule juge (`plans/acces.ts` : permissions, responsable de la mission, séparation des
 * tâches, mission clôturée). Rien n'est conservé dans le navigateur.
 */
import {
  aPermission,
  creerTraduire,
  HORIZON_PLAN,
  STATUT_INITIATIVE_LIBELLES,
  TYPE_ELEMENT_PLAN_LIBELLES,
  type Langue,
  type PerspectivePlan,
  type Role,
  type StatutContenuPlan,
  type StatutInitiative,
  type TypeElementPlan,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import { ErreurApi, messageErreur } from "./api";
import { formaterDateHeure, type Devise } from "./format";
import { STATUT_CONTENU_IA } from "./ia-contenu";
import type { ResumeModele } from "./plan-modele";
import type { Resultat } from "./saisie";

export { HORIZON_PLAN };

// --- Réponses de l'API ------------------------------------------------------------------------

export interface PlanResume {
  id: string;
  mission_id: string;
  titre: string;
  horizon: number;
  devise: Devise;
  partage_client: boolean;
  partage_par: string | null;
  partage_le: string | null;
  cree_par: string;
  cree_le: string;
}

export interface PagePlans {
  elements: PlanResume[];
  curseur_suivant: string | null;
}

/** Élément et sa version courante : `cree_le` date l'élément, `version_le` sa version. */
export interface ElementPlan {
  id: string;
  type: TypeElementPlan;
  parent_id: string | null;
  cree_par: string;
  cree_le: string;
  version: number;
  statut_contenu: StatutContenuPlan;
  retire: boolean;
  donnees: Record<string, unknown>;
  auteur_id: string;
  auteur_nom: string;
  version_le: string;
}

/** GET /api/plans/:id */
export interface PlanDetaille extends PlanResume {
  client_id: string;
  elements: ElementPlan[];
  modele: ResumeModele | null;
  pret_pour_client: boolean;
}

export interface VersionElementPlan {
  version: number;
  statut_contenu: StatutContenuPlan;
  retire: boolean;
  donnees: Record<string, unknown>;
  auteur_id: string;
  auteur_nom: string;
  cree_le: string;
}

export interface PageHistoriqueElement {
  element: { id: string; type: TypeElementPlan; parent_id: string | null };
  elements: VersionElementPlan[];
  curseur_suivant: string | null;
}

// --- Libellés ---------------------------------------------------------------------------------

export interface PresentationStatutPlan {
  libelle: string;
  tonalite: TonaliteStatut;
  icone: NomIcone;
  aide: string;
}

/**
 * Statut d'un contenu du plan : « brouillon » est propre au plan (rédigé par l'équipe, jamais
 * validé) ; les trois autres reprennent ceux des contenus IA (`STATUT_CONTENU_IA`).
 */
export const STATUT_CONTENU_PLAN: Record<StatutContenuPlan, PresentationStatutPlan> = {
  brouillon: {
    libelle: "Brouillon",
    tonalite: "neutre",
    icone: "neutre",
    aide: "Rédigé par l'équipe, jamais validé : à faire valider par un responsable de la mission.",
  },
  brouillon_ia: STATUT_CONTENU_IA.brouillon_ia,
  modifie: STATUT_CONTENU_IA.modifie,
  valide: STATUT_CONTENU_IA.valide,
};

const STATUT_CONTENU_PLAN_EN: Record<StatutContenuPlan, { libelle: string; aide: string }> = {
  brouillon: {
    libelle: "Draft",
    aide: "Written by the team, never approved: to be approved by an engagement lead.",
  },
  brouillon_ia: {
    libelle: "AI draft",
    aide: "Content proposed by the AI or a template: to be reviewed and approved before anything is sent to the client.",
  },
  modifie: { libelle: "Edited", aide: "Reviewed and corrected by a person, pending approval." },
  valide: { libelle: "Approved", aide: "Approved by a person: final content." },
};

/** Présentation d'un statut dans la langue demandée (tonalité et icône inchangées). */
export function presentationStatutPlan(
  statut: StatutContenuPlan,
  langue: Langue = "fr",
): PresentationStatutPlan {
  const base = STATUT_CONTENU_PLAN[statut];
  return langue === "en" ? { ...base, ...STATUT_CONTENU_PLAN_EN[statut] } : base;
}

export function libelleStatutContenu(statut: string, langue: Langue = "fr"): string {
  const connu = STATUT_CONTENU_PLAN[statut as StatutContenuPlan];
  if (!connu) return langue === "en" ? "Unknown status" : "Statut inconnu";
  return presentationStatutPlan(statut as StatutContenuPlan, langue).libelle;
}

export const PERSPECTIVE_LIBELLES: Record<PerspectivePlan, string> = {
  finances: "Finances",
  clients: "Clients",
  processus: "Processus internes",
  apprentissage: "Apprentissage et croissance",
};

const PERSPECTIVE_LIBELLES_EN: Record<PerspectivePlan, string> = {
  finances: "Finance",
  clients: "Customers",
  processus: "Internal processes",
  apprentissage: "Learning and growth",
};

const STATUT_INITIATIVE_LIBELLES_EN: Record<StatutInitiative, string> = {
  a_lancer: "To launch",
  en_cours: "In progress",
  terminee: "Completed",
  suspendue: "On hold",
  abandonnee: "Abandoned",
};

const TYPE_ELEMENT_PLAN_LIBELLES_EN: Record<TypeElementPlan, string> = {
  diagnostic: "Diagnostic",
  swot: "SWOT analysis",
  vision_mission: "Vision and mission",
  axe: "Strategic axis",
  objectif: "Objective",
  initiative: "Initiative",
};

export const libellePerspective = (p: unknown, langue: Langue = "fr") =>
  (langue === "en" ? PERSPECTIVE_LIBELLES_EN : PERSPECTIVE_LIBELLES)[p as PerspectivePlan] ??
  (langue === "en" ? "Perspective not specified" : "Perspective non précisée");

export const libelleStatutInitiative = (s: unknown, langue: Langue = "fr") =>
  (langue === "en" ? STATUT_INITIATIVE_LIBELLES_EN : STATUT_INITIATIVE_LIBELLES)[
    s as StatutInitiative
  ] ?? (langue === "en" ? "Status not specified" : "Statut non précisé");

export const libelleType = (t: TypeElementPlan, langue: Langue = "fr") =>
  (langue === "en" ? TYPE_ELEMENT_PLAN_LIBELLES_EN : TYPE_ELEMENT_PLAN_LIBELLES)[t] ?? t;

/** Nombre maximal de contenus par plan (API : 409 au-delà). */
export const ELEMENTS_PLAN_MAX = 300;

export const MESSAGE_ELEMENTS_MAX = `Ce plan compte ${ELEMENTS_PLAN_MAX} contenus, le maximum : retirez ou regroupez des contenus existants plutôt que d'en ajouter.`;

export const messageElementsMax = (langue: Langue = "fr") =>
  langue === "en"
    ? `This plan has ${ELEMENTS_PLAN_MAX} items, the maximum: remove or merge existing items rather than adding more.`
    : MESSAGE_ELEMENTS_MAX;

/** Types présents au plus une fois par plan (index unique de l'API). */
export const TYPES_UNIQUES: readonly TypeElementPlan[] = ["diagnostic", "swot", "vision_mission"];

export const DEVISES_PLAN: readonly { valeur: Devise; libelle: string }[] = [
  { valeur: "XOF", libelle: "Franc CFA (UEMOA, XOF)" },
  { valeur: "XAF", libelle: "Franc CFA (CEMAC, XAF)" },
  { valeur: "EUR", libelle: "Euro (EUR)" },
  { valeur: "USD", libelle: "Dollar américain (USD)" },
];

export const devisesPlan = (langue: Langue = "fr") =>
  langue === "en"
    ? [
        { valeur: "XOF" as Devise, libelle: "CFA franc (WAEMU, XOF)" },
        { valeur: "XAF" as Devise, libelle: "CFA franc (CEMAC, XAF)" },
        { valeur: "EUR" as Devise, libelle: "Euro (EUR)" },
        { valeur: "USD" as Devise, libelle: "US dollar (USD)" },
      ]
    : DEVISES_PLAN;

/** Horizons proposés à la création (DECISIONS.md, PLA-06) : 3 à 5 ans, 5 par défaut. */
export const OPTIONS_HORIZON = [3, 4, 5]
  .filter((h) => h >= HORIZON_PLAN.min && h <= HORIZON_PLAN.max)
  .map((h) => ({
    valeur: String(h),
    libelle: `${h} ans${h === HORIZON_PLAN.defaut ? " (par défaut)" : ""}`,
  }));

export function optionsHorizon(langue: Langue = "fr") {
  return [3, 4, 5]
    .filter((h) => h >= HORIZON_PLAN.min && h <= HORIZON_PLAN.max)
    .map((h) => ({
      valeur: String(h),
      libelle:
        langue === "en"
          ? `${h} years${h === HORIZON_PLAN.defaut ? " (default)" : ""}`
          : `${h} ans${h === HORIZON_PLAN.defaut ? " (par défaut)" : ""}`,
    }));
}

export type ChampCreationPlan = "titre" | "horizon" | "devise";

/** Création d'un plan : titre (200 caractères), horizon entier de 3 à 5, devise connue. */
export function validerCreationPlan(
  saisie: {
    titre: string;
    horizon: string;
    devise: string;
  },
  langue: Langue = "fr",
): Resultat<{ titre: string; horizon: number; devise: Devise }, ChampCreationPlan> {
  const t = creerTraduire(langue);
  const titre = saisie.titre.trim();
  const horizon = Number(saisie.horizon);
  const erreurs: Partial<Record<ChampCreationPlan, string>> = {};
  if (titre === "") erreurs.titre = t("Donnez un titre au plan.", "Give the plan a title.");
  else if (titre.length > 200)
    erreurs.titre = t("200 caractères au plus.", "200 characters at most.");
  if (!Number.isInteger(horizon) || horizon < HORIZON_PLAN.min || horizon > HORIZON_PLAN.max) {
    erreurs.horizon = t(
      `Horizon de ${HORIZON_PLAN.min} à ${HORIZON_PLAN.max} ans.`,
      `Horizon of ${HORIZON_PLAN.min} to ${HORIZON_PLAN.max} years.`,
    );
  }
  if (!DEVISES_PLAN.some((d) => d.valeur === saisie.devise)) {
    erreurs.devise = t("Choisissez une devise.", "Choose a currency.");
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { titre, horizon, devise: saisie.devise as Devise } };
}

/** Texte lu dans les données d'une version (chaîne non vide, sinon null). */
export function lireTexte(d: Record<string, unknown> | undefined, cle: string): string | null {
  const v = d?.[cle];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Liste de textes lue dans les données d'une version. */
export function lireListe(d: Record<string, unknown> | undefined, cle: string): string[] {
  const v = d?.[cle];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** « Axe stratégique « Croissance régionale » » ; « Diagnostic » pour un type sans titre. */
export function libelleElement(
  e: Pick<ElementPlan, "type" | "donnees" | "retire">,
  langue: Langue = "fr",
): string {
  const titre = lireTexte(e.donnees, "titre");
  const type = libelleType(e.type, langue);
  const guillemets = (x: string) => (langue === "en" ? `\u201c${x}\u201d` : `« ${x} »`);
  const base = titre ? `${type} ${guillemets(titre)}` : type;
  return e.retire ? `${base} ${langue === "en" ? "(removed)" : "(retiré)"}` : base;
}

/** « Version 3 · Validé · par Awa Koné · 12 janv. 2027 à 14:05 ». */
export function libelleVersionElement(
  v: Pick<VersionElementPlan, "version" | "statut_contenu" | "auteur_nom" | "cree_le">,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    return `Version ${v.version} · ${libelleStatutContenu(v.statut_contenu, langue)} · by ${v.auteur_nom} · ${formaterDateHeure(v.cree_le, undefined, langue)}`;
  }
  return `Version ${v.version} · ${libelleStatutContenu(v.statut_contenu)} · par ${v.auteur_nom} · ${formaterDateHeure(v.cree_le)}`;
}

// --- Droits d'affichage (l'API décide) --------------------------------------------------------

export interface ContextePlan {
  roles: readonly Role[];
  utilisateurId: string;
  mission: { directeur_id: string | null; chef_id: string | null; statut: string };
}

export interface DroitsPlan {
  /** Directeur, chef de la mission, ou droit de modifier toutes les missions. */
  responsable: boolean;
  /** Associé ou directeur de CETTE mission : dispensé de la séparation des tâches. */
  dispense: boolean;
  cloturee: boolean;
  creer: boolean;
  rediger: boolean;
  valider: boolean;
  partager: boolean;
}

export function droitsPlan(ctx: ContextePlan): DroitsPlan {
  const { roles, utilisateurId: moi, mission } = ctx;
  const responsable =
    aPermission(roles, "mission.modifier_toutes") ||
    mission.directeur_id === moi ||
    mission.chef_id === moi;
  const cloturee = mission.statut === "cloturee";
  const ouvert = !cloturee;
  return {
    responsable,
    dispense: roles.includes("associe") || mission.directeur_id === moi,
    cloturee,
    creer: aPermission(roles, "plan.ecrire") && responsable && ouvert,
    rediger: aPermission(roles, "plan.ecrire") && ouvert,
    valider: aPermission(roles, "plan.valider") && responsable && ouvert,
    partager: aPermission(roles, "portail.gerer") && responsable && ouvert,
  };
}

export const MESSAGE_MISSION_CLOTUREE =
  "La mission est clôturée : le plan reste consultable mais ne se modifie plus.";

export const messageMissionCloturee = (langue: Langue = "fr") =>
  langue === "en"
    ? "The engagement is closed: the plan can still be viewed but can no longer be edited."
    : MESSAGE_MISSION_CLOTUREE;

/** Pourquoi le formulaire de création n'est pas proposé (null s'il l'est). */
export function raisonCreationImpossible(ctx: ContextePlan, langue: Langue = "fr"): string | null {
  const t = creerTraduire(langue);
  const d = droitsPlan(ctx);
  if (d.creer) return null;
  if (d.cloturee) return messageMissionCloturee(langue);
  if (!aPermission(ctx.roles, "plan.ecrire")) {
    return t(
      "Votre rôle permet de consulter les plans stratégiques, pas d'en créer.",
      "Your role allows viewing strategic plans, not creating them.",
    );
  }
  return t(
    "Seul un responsable de la mission (directeur, chef de mission ou associé) crée un plan stratégique ; vous pourrez ensuite en rédiger les contenus.",
    "Only an engagement lead (director, engagement manager or partner) creates a strategic plan; you can then write its content.",
  );
}

export const RAISON_AUTEUR_CONTENU =
  "Vous avez rédigé la version courante de ce contenu : sa validation revient à un autre responsable de la mission (séparation des tâches).";

const RAISON_AUTEUR_CONTENU_EN =
  "You wrote the current version of this content: its approval falls to another engagement lead (segregation of duties).";

/**
 * Pourquoi « Valider » n'est pas proposé pour ce contenu (null : proposé, l'API tranche). Un
 * auteur d'une version plus ancienne depuis la dernière validation est aussi refusé par l'API
 * (403 VALIDATION_REQUISE, message affiché).
 */
export function raisonValidationElement(
  e: Pick<ElementPlan, "statut_contenu" | "auteur_id">,
  ctx: ContextePlan,
  langue: Langue = "fr",
): string | null {
  const d = droitsPlan(ctx);
  if (!d.valider || e.statut_contenu === "valide") return null;
  if (!d.dispense && e.auteur_id === ctx.utilisateurId) {
    return langue === "en" ? RAISON_AUTEUR_CONTENU_EN : RAISON_AUTEUR_CONTENU;
  }
  return null;
}

export const RAISON_AUTEUR_MODELE =
  "Vous avez calculé cette version du modèle : sa validation revient à un autre responsable de la mission (séparation des tâches).";

const RAISON_AUTEUR_MODELE_EN =
  "You computed this model version: its approval falls to another engagement lead (segregation of duties).";

export function raisonValidationModele(
  v: Pick<ResumeModele, "validation" | "cree_par">,
  ctx: ContextePlan,
  langue: Langue = "fr",
): string | null {
  const d = droitsPlan(ctx);
  if (!d.valider || v.validation) return null;
  if (!d.dispense && v.cree_par === ctx.utilisateurId) {
    return langue === "en" ? RAISON_AUTEUR_MODELE_EN : RAISON_AUTEUR_MODELE;
  }
  return null;
}

// --- Structure du plan ------------------------------------------------------------------------

export interface ObjectifStructure {
  objectif: ElementPlan;
  initiatives: ElementPlan[];
}

export interface AxeStructure {
  axe: ElementPlan;
  objectifs: ObjectifStructure[];
  /** Initiatives rattachées directement à l'axe. */
  initiatives: ElementPlan[];
}

export interface StructurePlan {
  diagnostic: ElementPlan | null;
  swot: ElementPlan | null;
  vision_mission: ElementPlan | null;
  axes: AxeStructure[];
  /** Objectifs ou initiatives dont le parent est introuvable (ne devrait pas arriver). */
  orphelins: ElementPlan[];
}

/** Range les éléments (ordre de création conservé) : axes → objectifs → initiatives. */
export function structurerPlan(elements: readonly ElementPlan[]): StructurePlan {
  const premier = (t: TypeElementPlan) => elements.find((e) => e.type === t) ?? null;
  const axes: AxeStructure[] = elements
    .filter((e) => e.type === "axe")
    .map((axe) => ({ axe, objectifs: [], initiatives: [] }));
  const parAxe = new Map(axes.map((a) => [a.axe.id, a]));
  const parObjectif = new Map<string, ObjectifStructure>();
  const orphelins: ElementPlan[] = [];
  for (const e of elements.filter((x) => x.type === "objectif")) {
    const axe = e.parent_id ? parAxe.get(e.parent_id) : undefined;
    if (!axe) {
      orphelins.push(e);
      continue;
    }
    const o = { objectif: e, initiatives: [] };
    axe.objectifs.push(o);
    parObjectif.set(e.id, o);
  }
  for (const e of elements.filter((x) => x.type === "initiative")) {
    const parent = e.parent_id ?? "";
    const objectif = parObjectif.get(parent);
    const axe = parAxe.get(parent);
    if (objectif) objectif.initiatives.push(e);
    else if (axe) axe.initiatives.push(e);
    else orphelins.push(e);
  }
  return {
    diagnostic: premier("diagnostic"),
    swot: premier("swot"),
    vision_mission: premier("vision_mission"),
    axes,
    orphelins,
  };
}

/** Décompte par statut (validés / à valider) pour l'en-tête du plan. */
export function decompteStatuts(elements: readonly Pick<ElementPlan, "statut_contenu">[]) {
  return {
    total: elements.length,
    valides: elements.filter((e) => e.statut_contenu === "valide").length,
    aValider: elements.filter((e) => e.statut_contenu !== "valide").length,
  };
}

// --- Partage au client ------------------------------------------------------------------------

/**
 * Ce qui empêche le partage (même règle que le déclencheur de l'API) : au moins un contenu,
 * la version courante de CHAQUE contenu validée (retirés compris), la dernière version du
 * modèle financier validée s'il y en a une. Liste vide : rien ne manque.
 */
export function manquesPartage(
  plan: Pick<PlanDetaille, "elements" | "modele">,
  langue: Langue = "fr",
): string[] {
  const t = creerTraduire(langue);
  const manques: string[] = [];
  if (plan.elements.length === 0) {
    manques.push(
      t(
        "Le plan ne contient encore aucun contenu (diagnostic, SWOT, axes…).",
        "The plan does not contain any content yet (diagnostic, SWOT, axes…).",
      ),
    );
  }
  for (const e of plan.elements) {
    if (e.statut_contenu !== "valide") {
      manques.push(
        langue === "en"
          ? `${libelleElement(e, langue)}: version ${e.version} with status \u201c${libelleStatutContenu(e.statut_contenu, langue)}\u201d, to be approved.`
          : `${libelleElement(e)} : version ${e.version} au statut « ${libelleStatutContenu(e.statut_contenu)} », à faire valider.`,
      );
    }
  }
  if (plan.modele && !plan.modele.validation) {
    manques.push(
      t(
        `Modèle financier : la dernière version (version ${plan.modele.version}) n'est pas validée.`,
        `Financial model: the latest version (version ${plan.modele.version}) is not approved.`,
      ),
    );
  }
  return manques;
}

export type NatureEcriture = "creation" | "version" | "retrait" | "retablissement" | "validation";

/** Message de réussite d'une écriture sur un contenu (réponse de l'API : version courante). */
export function messageEcriture(
  nature: NatureEcriture,
  e: Pick<ElementPlan, "version" | "statut_contenu">,
  partageRetire: boolean,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    const statutEn = libelleStatutContenu(e.statut_contenu, langue);
    const baseEn = {
      creation: `Content added (version ${e.version}, status \u201c${statutEn}\u201d): it must be approved by an engagement lead.`,
      version: `Version ${e.version} saved with status \u201c${statutEn}\u201d: it must be approved by an engagement lead.`,
      retrait: `Content removed from the plan (version ${e.version}): it stays in the history, and this removal must be approved.`,
      retablissement: `Content restored to the plan (version ${e.version}): to be approved.`,
      validation: `Version ${e.version} approved.`,
    }[nature];
    return partageRetire
      ? `${baseEn} Sharing with the client was withdrawn: have everything approved, then share again.`
      : baseEn;
  }
  const statut = libelleStatutContenu(e.statut_contenu);
  const base = {
    creation: `Contenu ajouté (version ${e.version}, statut « ${statut} ») : il doit être validé par un responsable de la mission.`,
    version: `Version ${e.version} enregistrée au statut « ${statut} » : elle doit être validée par un responsable de la mission.`,
    retrait: `Contenu retiré du plan (version ${e.version}) : il reste dans l'historique, et ce retrait doit être validé.`,
    retablissement: `Contenu rétabli dans le plan (version ${e.version}) : à faire valider.`,
    validation: `Version ${e.version} validée.`,
  }[nature];
  return partageRetire
    ? `${base} Le partage au client a été retiré : faites tout valider, puis partagez de nouveau.`
    : base;
}

export const AVERTISSEMENT_PARTAGE =
  "Ce plan est partagé au client. Toute modification (nouveau contenu, nouvelle version, retrait, nouvelle version du modèle financier) retire immédiatement ce partage : il faudra tout faire valider puis le partager de nouveau.";

export const AVERTISSEMENT_PARTAGE_EN =
  "This plan is shared with the client. Any change (new content, new version, removal, new financial model version) immediately withdraws this sharing: everything must be approved and then shared again.";

export const avertissementPartage = (langue: Langue = "fr") =>
  langue === "en" ? AVERTISSEMENT_PARTAGE_EN : AVERTISSEMENT_PARTAGE;

// --- Messages d'erreur ------------------------------------------------------------------------

export const MESSAGE_INTROUVABLE_PLAN =
  "Ce plan ou ce contenu n'est plus accessible (supprimé de votre visibilité ou d'un autre cabinet). Actualisez la page.";

const MESSAGE_INTROUVABLE_PLAN_EN =
  "This plan or content is no longer accessible (removed from your visibility or belongs to another firm). Refresh the page.";

export type ActionPlan = "creer" | "rediger" | "valider" | "partager" | "lire";

const REFUS_403: Record<ActionPlan, string> = {
  creer:
    "Seul un responsable de la mission (directeur, chef de mission ou associé) crée un plan stratégique.",
  rediger: "Votre rôle ne vous permet pas de rédiger ce plan.",
  valider:
    "Seul un responsable de la mission (directeur, chef de mission ou associé) valide un contenu du plan.",
  partager:
    "Seul un responsable de la mission disposant du droit de gérer le portail client partage un plan.",
  lire: "Votre rôle ne vous permet pas de consulter ce plan.",
};

/** Message français d'une erreur d'action sur le plan (400, 403, 404, 409). */
const REFUS_403_EN: Record<ActionPlan, string> = {
  creer:
    "Only an engagement lead (director, engagement manager or partner) creates a strategic plan.",
  rediger: "Your role does not allow you to write this plan.",
  valider:
    "Only an engagement lead (director, engagement manager or partner) approves plan content.",
  partager: "Only an engagement lead with the right to manage the client portal shares a plan.",
  lire: "Your role does not allow you to view this plan.",
};

export function messagePlan(
  e: unknown,
  action: ActionPlan = "rediger",
  langue: Langue = "fr",
): string {
  const en = langue === "en";
  if (e instanceof ErreurApi) {
    if (e.code === "VALIDATION_REQUISE") {
      return en ? `Segregation of duties: ${e.message}` : `Séparation des tâches : ${e.message}`;
    }
    if (e.code === "CONTENU_NON_VALIDE") {
      return en
        ? `${e.message} Have each item (and the latest financial model version) approved before sharing.`
        : `${e.message} Faites valider chaque contenu (et la dernière version du modèle financier) avant de partager.`;
    }
    if (e.statut === 404) return en ? MESSAGE_INTROUVABLE_PLAN_EN : MESSAGE_INTROUVABLE_PLAN;
    if (e.statut === 409) return e.message;
    if (e.statut === 403) return (en ? REFUS_403_EN : REFUS_403)[action];
    if (e.code === "REQUETE_INVALIDE" && e.message !== "Données invalides.") return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatPlanChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);

// --- Chemins ----------------------------------------------------------------------------------

const seg = (id: string) => encodeURIComponent(id);

export const hrefPlans = (missionId: string) => `/missions/${seg(missionId)}/plan`;
export const hrefPlan = (missionId: string, planId: string) =>
  `${hrefPlans(missionId)}/${seg(planId)}`;

export function hrefModele(
  missionId: string,
  planId: string,
  q: {
    version?: number | null;
    curseur?: string | null;
    de?: number;
    a?: number;
    /** Retour d'un enregistrement : la page annonce la version créée. */
    enregistree?: boolean;
    partageRetire?: boolean;
  } = {},
): string {
  const p = new URLSearchParams();
  if (q.version) p.set("version", String(q.version));
  if (q.curseur) p.set("curseur", q.curseur);
  if (q.de && q.a) {
    p.set("de", String(q.de));
    p.set("a", String(q.a));
  }
  if (q.enregistree) p.set("enregistree", "1");
  if (q.partageRetire) p.set("partage_retire", "1");
  const s = p.toString();
  return `${hrefPlan(missionId, planId)}/modele${s ? `?${s}` : ""}`;
}

export function cheminPlansMission(missionId: string, limite: number, curseur: string | null) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `/api/missions/${seg(missionId)}/plans?${q.toString()}`;
}

export const cheminCreationPlan = (missionId: string) => `/api/missions/${seg(missionId)}/plans`;
export const cheminPlan = (planId: string) => `/api/plans/${seg(planId)}`;
export const cheminPartage = (planId: string) => `${cheminPlan(planId)}/partage`;
export const cheminElements = (planId: string) => `${cheminPlan(planId)}/elements`;
export const cheminVersionsElement = (planId: string, elementId: string) =>
  `${cheminElements(planId)}/${seg(elementId)}/versions`;
export const cheminValidationElement = (planId: string, elementId: string) =>
  `${cheminElements(planId)}/${seg(elementId)}/validation`;

export function cheminHistorique(
  planId: string,
  elementId: string,
  limite: number,
  curseur: string | null,
) {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${cheminElements(planId)}/${seg(elementId)}/historique?${q.toString()}`;
}

/** Curseur lu dans l'URL (chaîne bornée), sinon null. */
export function lireCurseur(v: string | string[] | undefined): string | null {
  const brut = Array.isArray(v) ? v[0] : v;
  return typeof brut === "string" && brut !== "" && brut.length <= 500 ? brut : null;
}
