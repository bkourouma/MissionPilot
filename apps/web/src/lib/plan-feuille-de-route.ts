/**
 * Feuille de route du plan stratégique (PLA-05) : types de la réponse de l'API, grille par
 * période, libellés des dépendances, du recalage et des conflits, chemins et messages. Logique
 * pure, testée dans `plan-feuille-de-route.test.ts`.
 *
 * RÈGLE : aucune date n'est recalculée ici. Le recalage (dépendances « fin → début »,
 * initiatives à lancer ou suspendues décalées, conflits des initiatives en cours ou terminées,
 * chemin critique) vient TEL QUEL du moteur de l'API ; ce module le met en forme.
 */
import { ErreurApi, messageErreur } from "./api";
import { formaterDate, formaterNombre } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export type PasFeuilleDeRoute = "trimestre" | "semestre";

export const PAS_FEUILLE_DE_ROUTE: readonly { valeur: PasFeuilleDeRoute; libelle: string }[] = [
  { valeur: "trimestre", libelle: "Par trimestre" },
  { valeur: "semestre", libelle: "Par semestre" },
];

export interface InitiativeFeuilleDeRoute {
  id: string;
  parent_id: string | null;
  titre: string;
  responsable_id: string | null;
  /** Dates saisies. */
  debut: string | null;
  echeance: string;
  /** Dates après recalage par le moteur (identiques sans décalage). */
  debut_recale: string | null;
  echeance_recalee: string;
  decalage_jours: number;
  recalee: boolean;
  dependances: string[];
  contrainte_par: string | null;
  conflits: string[];
  dependances_ignorees: string[];
  critique: boolean;
  statut: string;
  statut_libelle: string;
  statut_contenu: string;
  periode_debut: string;
  periode_fin: string;
}

export interface FeuilleDeRoute {
  plan_id: string;
  pas: PasFeuilleDeRoute;
  periodes: { periode: string; initiatives: string[] }[];
  initiatives: InitiativeFeuilleDeRoute[];
  recalage: {
    fin: string | null;
    chemin_critique: string[];
    nombre_recalees: number;
    nombre_conflits: number;
  };
}

export interface ResultatRecalage {
  plan_id: string;
  appliquees: {
    id: string;
    version: number;
    decalage_jours: number;
    debut: string | null;
    echeance: string;
  }[];
}

/** Pas lu dans l'URL (`?pas=semestre`) ; trimestre par défaut. */
export function lirePas(v: string | string[] | undefined): PasFeuilleDeRoute {
  const brut = Array.isArray(v) ? v[0] : v;
  return brut === "semestre" ? "semestre" : "trimestre";
}

/** « 2027-T1 » → « T1 2027 » ; « 2027-S2 » → « S2 2027 ». */
export function libellePeriodeFeuille(cle: string): string {
  const m = /^(\d{4})-([TS])(\d)$/.exec(cle);
  return m ? `${m[2]}${m[3]} ${m[1]}` : cle;
}

/** « +46 jours », « +1 jour », « aucun ». */
export function libelleDecalage(jours: number): string {
  if (jours <= 0) return "aucun";
  return `+${formaterNombre(jours, 0)} jour${jours > 1 ? "s" : ""}`;
}

/** Période affichée d'une initiative, aux dates recalées (« Du 16/04/2027 au 16/05/2027 »). */
export function periodeInitiative(
  i: Pick<InitiativeFeuilleDeRoute, "debut_recale" | "echeance_recalee">,
): string {
  return i.debut_recale
    ? `Du ${formaterDate(i.debut_recale)} au ${formaterDate(i.echeance_recalee)}`
    : `Jalon au ${formaterDate(i.echeance_recalee)}`;
}

/** Dates prévues d'une initiative recalée (« prévue du … au … »), null sans décalage. */
export function datesPrevues(
  i: Pick<InitiativeFeuilleDeRoute, "recalee" | "debut" | "echeance">,
): string | null {
  if (!i.recalee) return null;
  return i.debut
    ? `prévue du ${formaterDate(i.debut)} au ${formaterDate(i.echeance)}`
    : `prévue au ${formaterDate(i.echeance)}`;
}

/** Titre d'une initiative de la feuille de route, ou « initiative retirée du plan ». */
export function titreInitiative(id: string, f: Pick<FeuilleDeRoute, "initiatives">): string {
  return f.initiatives.find((i) => i.id === id)?.titre ?? "initiative retirée du plan";
}

/** Phrases d'explication d'une initiative : contrainte, conflits, dépendances ignorées. */
export function explicationsInitiative(
  i: InitiativeFeuilleDeRoute,
  f: Pick<FeuilleDeRoute, "initiatives">,
): string[] {
  const nom = (id: string) => `« ${titreInitiative(id, f)} »`;
  const lignes: string[] = [];
  if (i.recalee && i.contrainte_par) {
    lignes.push(
      `Recalée de ${libelleDecalage(i.decalage_jours)} : elle attend la fin de ${nom(i.contrainte_par)}.`,
    );
  }
  if (i.conflits.length) {
    lignes.push(
      `Conflit : ${i.conflits.map(nom).join(", ")} se termine${i.conflits.length > 1 ? "nt" : ""} après son début ; ses dates ne sont pas recalées car elle est ${i.statut_libelle.toLowerCase()}.`,
    );
  }
  if (i.dependances_ignorees.length) {
    lignes.push(
      `Dépendance${i.dependances_ignorees.length > 1 ? "s" : ""} sans effet (initiative retirée ou abandonnée) : ${i.dependances_ignorees.map(nom).join(", ")}.`,
    );
  }
  return lignes;
}

/** Grille : pour chaque initiative (ordre de l'API), présence sur chaque période. */
export function grilleFeuilleDeRoute(
  f: Pick<FeuilleDeRoute, "periodes" | "initiatives">,
): { initiative: InitiativeFeuilleDeRoute; cases: boolean[] }[] {
  const presence = f.periodes.map((p) => new Set(p.initiatives));
  return f.initiatives.map((initiative) => ({
    initiative,
    cases: presence.map((s) => s.has(initiative.id)),
  }));
}

/** Identifiants des initiatives que le moteur propose de recaler. */
export function initiativesARecaler(f: Pick<FeuilleDeRoute, "initiatives">): string[] {
  return f.initiatives.filter((i) => i.recalee).map((i) => i.id);
}

/** Résumé du recalage (« 2 initiatives recalées, 1 conflit ; fin du plan au 17/05/2027 »). */
export function resumeRecalage(f: Pick<FeuilleDeRoute, "recalage">): string {
  const r = f.recalage;
  const recalees =
    r.nombre_recalees === 0
      ? "Aucune initiative à recaler"
      : `${r.nombre_recalees} initiative${r.nombre_recalees > 1 ? "s" : ""} à recaler`;
  const conflits =
    r.nombre_conflits === 0
      ? "aucun conflit"
      : `${r.nombre_conflits} conflit${r.nombre_conflits > 1 ? "s" : ""}`;
  const fin = r.fin ? ` ; fin des initiatives au ${formaterDate(r.fin)}` : "";
  return `${recalees}, ${conflits}${fin}.`;
}

/** Message d'un recalage appliqué. */
export function messageRecalage(r: ResultatRecalage, partage: boolean): string {
  const n = r.appliquees.length;
  const base = `${n} initiative${n > 1 ? "s" : ""} recalée${n > 1 ? "s" : ""} : nouvelle${n > 1 ? "s" : ""} version${n > 1 ? "s" : ""} à faire valider.`;
  return partage ? `${base} Le partage au client a été retiré.` : base;
}

/** Message français d'un refus de recalage. */
export function messageFeuilleDeRoute(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.statut === 409) {
      return "La feuille de route a changé depuis son affichage : rechargez la page puis réessayez.";
    }
    if (e.statut === 403) return "Votre rôle ne vous permet pas de modifier ce plan.";
    if (e.statut === 404) return "Ce plan est introuvable ou ne vous est plus accessible.";
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const hrefFeuilleDeRoute = (missionId: string, planId: string, pas?: PasFeuilleDeRoute) =>
  `${hrefPlan(missionId, planId)}/feuille-de-route${pas && pas !== "trimestre" ? `?pas=${pas}` : ""}`;

export const cheminFeuilleDeRoute = (planId: string, pas: PasFeuilleDeRoute) =>
  `${cheminPlan(planId)}/feuille-de-route?pas=${seg(pas)}`;

export const cheminRecalage = (planId: string) => `${cheminPlan(planId)}/feuille-de-route/recalage`;
