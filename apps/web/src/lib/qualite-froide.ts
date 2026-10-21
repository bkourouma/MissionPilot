/**
 * Revue à froid des missions clôturées (QUA-05) : types des réponses de l'API, droits
 * d'affichage, libellés, chemins et messages d'erreur. Les validations de saisie sont dans
 * `qualite-froide-saisie.ts`. Logique pure, testée dans `qualite-froide.test.ts`.
 *
 * RÈGLE : le tirage, l'indépendance du relecteur, le score, la couverture, la conclusion et les
 * indicateurs du plan d'amélioration sont calculés par l'API (moteurs `packages/engines`), jamais
 * par le web ni par un modèle de langage. Ce module met en forme ce que l'API renvoie ; les droits
 * ci-dessous sont un confort d'affichage, l'API reste seule juge.
 */
import {
  aPermission,
  CONCLUSION_REVUE_FROIDE_LIBELLES,
  CRITERES_REVUE_FROIDE,
  GRAVITE_CONSTAT_FROID_LIBELLES,
  STATUT_ACTION_FROIDE_LIBELLES,
  STATUT_CAMPAGNE_FROIDE_LIBELLES,
  STATUT_ECHANTILLON_FROID_LIBELLES,
  STATUTS_ACTION_FROIDE,
  type ConclusionRevueFroide,
  type GraviteConstatFroid,
  type Role,
  type StatutActionFroide,
  type StatutCampagneFroide,
  type StatutEchantillonFroid,
  type StrateEchantillon,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi, messageErreur } from "./api";
import type { PageCurseur } from "./pagination";
import { formaterJours, formaterMontantMineur, formaterPourcentage } from "./format";

export type * from "./qualite-froide-types";
import type { ActionFroide, BudgetDossier, ViolationIndependance } from "./qualite-froide-types";

// --- Droits d'affichage ----------------------------------------------------------------------

export interface DroitsQualiteFroide {
  /** Tirer, affecter, clore, piloter le plan (associé). */
  gerer: boolean;
  /** Être relecteur indépendant. */
  relire: boolean;
  /** Voir « Revue à froid » : gérer ou relire. */
  acces: boolean;
}

export function droitsQualiteFroide(roles: readonly Role[]): DroitsQualiteFroide {
  const gerer = aPermission(roles, "qualite.froide.gerer");
  const relire = aPermission(roles, "qualite.froide.relire");
  return { gerer, relire, acces: gerer || relire };
}

// --- Libellés et tonalités -------------------------------------------------------------------

export const NOTES_REVUE_FROIDE: readonly { valeur: number; libelle: string }[] = [
  { valeur: 1, libelle: "insuffisant" },
  { valeur: 2, libelle: "à améliorer" },
  { valeur: 3, libelle: "satisfaisant" },
  { valeur: 4, libelle: "bon" },
  { valeur: 5, libelle: "exemplaire" },
];

export const STRATES_LIBELLES: Record<StrateEchantillon, string> = {
  type_mission: "Par type de mission",
  directeur: "Par directeur de mission",
};

const LIBELLE_VIOLATION: Record<string, string> = {
  DIRECTEUR: "directeur de la mission",
  CHEF: "chef de la mission",
  EQUIPE: "équipe de la mission",
  AFFECTE: "affecté à la mission dans le planning",
  CREATEUR: "créateur de la mission",
  CLOTURE: "a clôturé la mission",
  SIGNATAIRE: "a signé la mission",
  INTERVENANT_QUALITE: "intervenu dans les suivis qualité de la mission",
};

/** Raison courte d'inéligibilité ; le message complet de l'API sert de repli. */
export const libelleViolationIndependance = (v: ViolationIndependance) =>
  LIBELLE_VIOLATION[v.code] ?? v.message;

export const libelleStatutCampagne = (s: StatutCampagneFroide) =>
  STATUT_CAMPAGNE_FROIDE_LIBELLES[s] ?? s;
export const libelleStatutEchantillon = (s: StatutEchantillonFroid) =>
  STATUT_ECHANTILLON_FROID_LIBELLES[s] ?? s;
export const libelleStatutAction = (s: StatutActionFroide) => STATUT_ACTION_FROIDE_LIBELLES[s] ?? s;
export const libelleGravite = (g: GraviteConstatFroid) => GRAVITE_CONSTAT_FROID_LIBELLES[g] ?? g;
export const libelleConclusion = (c: ConclusionRevueFroide | null) =>
  c ? (CONCLUSION_REVUE_FROIDE_LIBELLES[c] ?? c) : "Pas encore de conclusion";

const CRITERES_PAR_CODE = new Map<string, string>(
  CRITERES_REVUE_FROIDE.map((c) => [c.code, c.libelle]),
);
export const libelleCritere = (code: string | null) =>
  code === null ? "Revue dans son ensemble" : (CRITERES_PAR_CODE.get(code) ?? code);

export function tonaliteConclusion(c: ConclusionRevueFroide | null): TonaliteStatut {
  if (c === "conforme") return "succes";
  if (c === "reserves") return "attention";
  return c === "non_conforme" ? "danger" : "neutre";
}

export function tonaliteStatutEchantillon(s: StatutEchantillonFroid): TonaliteStatut {
  if (s === "terminee") return "succes";
  return s === "a_affecter" ? "attention" : "neutre";
}

export function tonaliteStatutAction(
  a: Pick<ActionFroide, "statut" | "en_retard">,
): TonaliteStatut {
  if (a.en_retard) return "danger";
  if (a.statut === "faite") return "succes";
  return a.statut === "abandonnee" ? "neutre" : "attention";
}

export const tonaliteGravite = (g: GraviteConstatFroid): TonaliteStatut =>
  g === "critique" ? "danger" : g === "majeur" ? "attention" : "neutre";

/** « 3 sur 8 » : progression telle que l'API la compte (revues terminées, critères notés). */
export const texteProgression = (fait: number, total: number, unite: string) =>
  `${fait} sur ${total} ${unite}`;

/** Score sur 100 du moteur, « 72,5 sur 100 » ; absence → « — ». */
export function formaterScore(score: number | null): string {
  if (score === null) return "—";
  return `${String(score).replace(".", ",")} sur 100`;
}

/** Couverture du moteur (0 à 1) → « 75 % ». Mise en forme seulement. */
export const formaterCouverture = (c: number) => formaterPourcentage(c, 0);

/** Taux de réalisation du moteur (0 à 100) → « 62,5 % ». */
export const formaterTauxRealisation = (t: number) => `${String(t).replace(".", ",")} %`;

/** Une ligne par clé PRÉSENTE du budget (FIN-02) : aucune clé absente n'est évoquée. */
export function lignesBudget(b: BudgetDossier | undefined): { libelle: string; valeur: string }[] {
  if (!b) return [];
  const devise = b.devise ?? "XOF";
  const montant = (v: number | null | undefined) => formaterMontantMineur(v, devise);
  const lignes: [string, boolean, string][] = [
    ["Jours vendus", "budget_jours" in b, formaterJours(b.budget_jours)],
    ["Honoraires", "honoraires" in b, montant(b.honoraires)],
    ["Débours refacturables", "debours_refacturables" in b, montant(b.debours_refacturables)],
    [
      "Débours non refacturables",
      "debours_non_refacturables" in b,
      montant(b.debours_non_refacturables),
    ],
    ["Coûts internes", "couts_internes" in b, montant(b.couts_internes)],
    ["Sous-traitance", "sous_traitance" in b, montant(b.sous_traitance)],
    ["Marge", "marge" in b, montant(b.marge)],
    ["Taux de marge", "taux_marge" in b, formaterPourcentage(b.taux_marge)],
  ];
  return lignes
    .filter(([, present]) => present)
    .map(([libelle, , valeur]) => ({ libelle, valeur }));
}

/** Statuts proposés depuis l'état actuel (confort d'affichage ; l'API juge la transition). */
export function statutsSuivants(actuel: StatutActionFroide): StatutActionFroide[] {
  if (actuel === "faite" || actuel === "abandonnee") return [];
  return STATUTS_ACTION_FROIDE.filter((s) => s !== actuel);
}

export const estClotureAction = (s: string) => s === "faite" || s === "abandonnee";

// --- Chemins ---------------------------------------------------------------------------------

const segment = (id: string) => encodeURIComponent(id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export const estUuid = (v: string) => UUID.test(v);

const RACINE_API = "/api/qualite/revue-froide";
export const HREF_REVUE_FROIDE = "/qualite/revue-froide";
export const HREF_MES_ACTIONS = "/qualite/revue-froide/actions";
export const hrefCampagne = (id: string) => `${HREF_REVUE_FROIDE}/${segment(id)}`;
export const hrefEchantillon = (id: string) => `${HREF_REVUE_FROIDE}/echantillons/${segment(id)}`;

export const cheminCreationCampagne = () => `${RACINE_API}/campagnes`;
export const cheminCampagnes = (curseur = "") =>
  `${RACINE_API}/campagnes?limite=30${curseur ? `&curseur=${segment(curseur)}` : ""}`;
export const cheminCampagne = (id: string) => `${RACINE_API}/campagnes/${segment(id)}`;
export const cheminVerification = (id: string) => `${cheminCampagne(id)}/verification`;
export const cheminClotureCampagne = (id: string) => `${cheminCampagne(id)}/cloture`;
export const cheminActionsCampagne = (id: string) => `${cheminCampagne(id)}/actions`;
export const cheminPlan = (id: string) => `${cheminCampagne(id)}/plan`;
export const cheminMesRevues = () => `${RACINE_API}/mes-revues`;
/** Plafond de `limite` de « mes revues » côté API. */
export const LIMITE_MES_REVUES = 100;
/** Page de « mes revues » telle que l'API la renvoie (`curseur_suivant`) vers la forme `suivant`. */
export function pageMesRevues<T>(page: {
  elements: T[];
  curseur_suivant: string | null;
}): PageCurseur<T> {
  return { elements: page.elements, suivant: page.curseur_suivant };
}
export const cheminEchantillon = (id: string) => `${RACINE_API}/echantillons/${segment(id)}`;
export const cheminDossier = (id: string) => `${cheminEchantillon(id)}/dossier`;
export const cheminEligibles = (id: string) => `${cheminEchantillon(id)}/relecteurs-eligibles`;
export const cheminAffectation = (id: string) => `${cheminEchantillon(id)}/affectation`;
export const cheminEvaluations = (id: string) => `${cheminEchantillon(id)}/evaluations`;
export const cheminConstats = (id: string) => `${cheminEchantillon(id)}/constats`;
export const cheminConstat = (id: string, constatId: string) =>
  `${cheminConstats(id)}/${segment(constatId)}`;
export const cheminTerminer = (id: string) => `${cheminEchantillon(id)}/terminer`;
export const cheminAction = (id: string) => `${RACINE_API}/actions/${segment(id)}`;

export interface FiltresActions {
  statut: StatutActionFroide | "";
  enRetard: boolean;
  campagne: string;
  curseur: string;
}

export function lireFiltresActions(
  p: Record<string, string | string[] | undefined>,
): FiltresActions {
  const s = un(p.statut) ?? "";
  const c = un(p.curseur) ?? "";
  const camp = un(p.campagne) ?? "";
  return {
    statut: (STATUTS_ACTION_FROIDE as readonly string[]).includes(s)
      ? (s as StatutActionFroide)
      : "",
    enRetard: un(p.en_retard) === "true",
    campagne: UUID.test(camp) ? camp : "",
    curseur: /^[A-Za-z0-9_-]{1,500}$/.test(c) ? c : "",
  };
}

function requeteActions(f: Partial<FiltresActions>, limite?: number): URLSearchParams {
  const r = new URLSearchParams();
  if (limite) r.set("limite", String(limite));
  if (f.campagne) r.set("campagne_id", f.campagne);
  if (f.statut) r.set("statut", f.statut);
  if (f.enRetard) r.set("en_retard", "true");
  if (f.curseur) r.set("curseur", f.curseur);
  return r;
}

export const cheminActions = (f: Partial<FiltresActions>) =>
  `${RACINE_API}/actions?${requeteActions(f, 30).toString()}`;

export function hrefActions(f: Partial<FiltresActions> = {}): string {
  const r = requeteActions({ ...f });
  if (f.campagne) {
    r.delete("campagne_id");
    r.set("campagne", f.campagne);
  }
  const s = r.toString();
  return s ? `${HREF_MES_ACTIONS}?${s}` : HREF_MES_ACTIONS;
}

// --- Erreurs ---------------------------------------------------------------------------------

/** Codes de l'API dont le message (français, explicite) est affiché tel quel. */
const CODES_MESSAGE_API = new Set([
  "RELECTEUR_NON_INDEPENDANT",
  "RELECTEUR_NON_HABILITE",
  "REVUE_FROIDE_TERMINEE",
  "REAFFECTATION_EN_REVUE",
  "FROIDE_CAMPAGNE_FIGEE",
  "FROIDE_HISTORIQUE_IMMUABLE",
  "MISSION_TIREE_INVALIDE",
  "ACTION_TRANSITION_IMPOSSIBLE",
  "RESPONSABLE_INVALIDE",
  "PLAFOND_ATTEINT",
  "REVUES_NON_TERMINEES",
  "GRILLE_SANS_NOTE",
]);

export const MESSAGE_INTROUVABLE_FROIDE = "Cet élément n'est plus accessible. Actualisez la page.";

function detailsDe(e: unknown): Record<string, unknown> {
  if (!(e instanceof ErreurApi)) return {};
  return typeof e.details === "object" && e.details !== null
    ? (e.details as Record<string, unknown>)
    : {};
}

/** Critères restant à noter, joints à un refus 409 `GRILLE_INCOMPLETE`. */
export function criteresManquants(e: unknown): string[] {
  if (!(e instanceof ErreurApi) || e.code !== "GRILLE_INCOMPLETE") return [];
  const m = detailsDe(e).manquants;
  return Array.isArray(m) ? m.filter((c): c is string => typeof c === "string") : [];
}

/** Raisons d'inéligibilité jointes à un refus 409 `RELECTEUR_NON_INDEPENDANT`. */
export function violationsIndependance(e: unknown): ViolationIndependance[] {
  if (!(e instanceof ErreurApi) || e.code !== "RELECTEUR_NON_INDEPENDANT") return [];
  const v = detailsDe(e).violations;
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is ViolationIndependance =>
      typeof x === "object" &&
      x !== null &&
      typeof (x as { code?: unknown }).code === "string" &&
      typeof (x as { message?: unknown }).message === "string",
  );
}

export function messageFroide(e: unknown): string {
  if (e instanceof ErreurApi) {
    const manquants = criteresManquants(e);
    if (manquants.length > 0) {
      return `La grille doit être complète. Il reste à évaluer : ${manquants.map(libelleCritere).join(" ; ")}.`;
    }
    if (CODES_MESSAGE_API.has(e.code)) return e.message;
    if (e.statut === 404) return MESSAGE_INTROUVABLE_FROIDE;
    if (e.statut === 409) return e.message;
  }
  return messageErreur(e);
}

/** Après ce refus, l'état affiché est probablement périmé : rafraîchir la page. */
export const etatFroideChange = (e: unknown) =>
  e instanceof ErreurApi && (e.statut === 404 || e.statut === 409);
