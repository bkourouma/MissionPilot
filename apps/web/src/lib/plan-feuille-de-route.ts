/**
 * Feuille de route du plan stratégique (PLA-05) : types de la réponse de l'API, grille par
 * période, libellés des dépendances, du recalage et des conflits, chemins et messages. Logique
 * pure, testée dans `plan-feuille-de-route.test.ts`.
 *
 * RÈGLE : aucune date n'est recalculée ici. Le recalage (dépendances « fin → début »,
 * initiatives à lancer ou suspendues décalées, conflits des initiatives en cours ou terminées,
 * chemin critique) vient TEL QUEL du moteur de l'API ; ce module le met en forme.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { formaterDate, formaterNombre } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";

export type PasFeuilleDeRoute = "trimestre" | "semestre";

export const PAS_FEUILLE_DE_ROUTE: readonly { valeur: PasFeuilleDeRoute; libelle: string }[] = [
  { valeur: "trimestre", libelle: "Par trimestre" },
  { valeur: "semestre", libelle: "Par semestre" },
];

export const optionsPasFeuilleDeRoute = (langue: Langue = "fr") =>
  langue === "en"
    ? [
        { valeur: "trimestre" as PasFeuilleDeRoute, libelle: "By quarter" },
        { valeur: "semestre" as PasFeuilleDeRoute, libelle: "By half-year" },
      ]
    : PAS_FEUILLE_DE_ROUTE;

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
export function libellePeriodeFeuille(cle: string, langue: Langue = "fr"): string {
  const m = /^(\d{4})-([TS])(\d)$/.exec(cle);
  if (!m) return cle;
  const lettre = langue === "en" ? (m[2] === "T" ? "Q" : "H") : m[2];
  return `${lettre}${m[3]} ${m[1]}`;
}

/** « +46 jours », « +1 jour », « aucun ». */
export function libelleDecalage(jours: number, langue: Langue = "fr"): string {
  if (langue === "en") {
    return jours <= 0 ? "none" : `+${formaterNombre(jours, 0, langue)} day${jours > 1 ? "s" : ""}`;
  }
  if (jours <= 0) return "aucun";
  return `+${formaterNombre(jours, 0)} jour${jours > 1 ? "s" : ""}`;
}

/** Période affichée d'une initiative, aux dates recalées (« Du 16/04/2027 au 16/05/2027 »). */
export function periodeInitiative(
  i: Pick<InitiativeFeuilleDeRoute, "debut_recale" | "echeance_recalee">,
  langue: Langue = "fr",
): string {
  if (langue === "en") {
    return i.debut_recale
      ? `From ${formaterDate(i.debut_recale, "UTC", langue)} to ${formaterDate(i.echeance_recalee, "UTC", langue)}`
      : `Milestone on ${formaterDate(i.echeance_recalee, "UTC", langue)}`;
  }
  return i.debut_recale
    ? `Du ${formaterDate(i.debut_recale)} au ${formaterDate(i.echeance_recalee)}`
    : `Jalon au ${formaterDate(i.echeance_recalee)}`;
}

/** Dates prévues d'une initiative recalée (« prévue du … au … »), null sans décalage. */
export function datesPrevues(
  i: Pick<InitiativeFeuilleDeRoute, "recalee" | "debut" | "echeance">,
  langue: Langue = "fr",
): string | null {
  if (!i.recalee) return null;
  if (langue === "en") {
    return i.debut
      ? `planned from ${formaterDate(i.debut, "UTC", langue)} to ${formaterDate(i.echeance, "UTC", langue)}`
      : `planned on ${formaterDate(i.echeance, "UTC", langue)}`;
  }
  return i.debut
    ? `prévue du ${formaterDate(i.debut)} au ${formaterDate(i.echeance)}`
    : `prévue au ${formaterDate(i.echeance)}`;
}

/** Titre d'une initiative de la feuille de route, ou « initiative retirée du plan ». */
export function titreInitiative(
  id: string,
  f: Pick<FeuilleDeRoute, "initiatives">,
  langue: Langue = "fr",
): string {
  return (
    f.initiatives.find((i) => i.id === id)?.titre ??
    (langue === "en" ? "initiative removed from the plan" : "initiative retirée du plan")
  );
}

/** Phrases d'explication d'une initiative : contrainte, conflits, dépendances ignorées. */
export function explicationsInitiative(
  i: InitiativeFeuilleDeRoute,
  f: Pick<FeuilleDeRoute, "initiatives">,
  langue: Langue = "fr",
): string[] {
  const lignes: string[] = [];
  if (langue === "en") {
    const nomEn = (id: string) => `\u201c${titreInitiative(id, f, langue)}\u201d`;
    if (i.recalee && i.contrainte_par) {
      lignes.push(
        `Rescheduled by ${libelleDecalage(i.decalage_jours, langue)}: it waits for ${nomEn(i.contrainte_par)} to finish.`,
      );
    }
    if (i.conflits.length) {
      lignes.push(
        `Conflict: ${i.conflits.map(nomEn).join(", ")} ${i.conflits.length > 1 ? "end" : "ends"} after its start; its dates are not rescheduled because it is ${i.statut_libelle.toLowerCase()}.`,
      );
    }
    if (i.dependances_ignorees.length) {
      lignes.push(
        `Dependenc${i.dependances_ignorees.length > 1 ? "ies" : "y"} with no effect (initiative removed or abandoned): ${i.dependances_ignorees.map(nomEn).join(", ")}.`,
      );
    }
    return lignes;
  }
  const nom = (id: string) => `« ${titreInitiative(id, f)} »`;
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
export function resumeRecalage(f: Pick<FeuilleDeRoute, "recalage">, langue: Langue = "fr"): string {
  const r = f.recalage;
  if (langue === "en") {
    const recaleesEn =
      r.nombre_recalees === 0
        ? "No initiatives to reschedule"
        : `${r.nombre_recalees} initiative${r.nombre_recalees > 1 ? "s" : ""} to reschedule`;
    const conflitsEn =
      r.nombre_conflits === 0
        ? "no conflicts"
        : `${r.nombre_conflits} conflict${r.nombre_conflits > 1 ? "s" : ""}`;
    const finEn = r.fin ? `; initiatives end on ${formaterDate(r.fin, "UTC", langue)}` : "";
    return `${recaleesEn}, ${conflitsEn}${finEn}.`;
  }
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
export function messageRecalage(
  r: ResultatRecalage,
  partage: boolean,
  langue: Langue = "fr",
): string {
  const n = r.appliquees.length;
  if (langue === "en") {
    const baseEn = `${n} initiative${n > 1 ? "s" : ""} rescheduled: new version${n > 1 ? "s" : ""} to be approved.`;
    return partage ? `${baseEn} Sharing with the client was withdrawn.` : baseEn;
  }
  const base = `${n} initiative${n > 1 ? "s" : ""} recalée${n > 1 ? "s" : ""} : nouvelle${n > 1 ? "s" : ""} version${n > 1 ? "s" : ""} à faire valider.`;
  return partage ? `${base} Le partage au client a été retiré.` : base;
}

/** Message français d'un refus de recalage. */
export function messageFeuilleDeRoute(e: unknown, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.statut === 409) {
      return t(
        "La feuille de route a changé depuis son affichage : rechargez la page puis réessayez.",
        "The roadmap has changed since it was displayed: reload the page and try again.",
      );
    }
    if (e.statut === 403) {
      return t(
        "Votre rôle ne vous permet pas de modifier ce plan.",
        "Your role does not allow you to edit this plan.",
      );
    }
    if (e.statut === 404) {
      return t(
        "Ce plan est introuvable ou ne vous est plus accessible.",
        "This plan cannot be found or is no longer accessible to you.",
      );
    }
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const hrefFeuilleDeRoute = (missionId: string, planId: string, pas?: PasFeuilleDeRoute) =>
  `${hrefPlan(missionId, planId)}/feuille-de-route${pas && pas !== "trimestre" ? `?pas=${pas}` : ""}`;

export const cheminFeuilleDeRoute = (planId: string, pas: PasFeuilleDeRoute) =>
  `${cheminPlan(planId)}/feuille-de-route?pas=${seg(pas)}`;

export const cheminRecalage = (planId: string) => `${cheminPlan(planId)}/feuille-de-route/recalage`;
