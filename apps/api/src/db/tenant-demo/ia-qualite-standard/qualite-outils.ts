import { createHash } from "node:crypto";
import { ajouterJours } from "@missionpilot/engines";
import { evaluerGarde, type ClasseRisque, type EtapeGarde } from "@missionpilot/engines";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import { COMPTES_CABINET } from "../donnees-comptes.js";
import { estWeekEnd } from "../horloge.js";
import type { Alea } from "../horloge.js";
import { exigerMission, type CleMission, type MissionLot } from "./commun.js";

/*
 * Outils communs des modules « qualité » du Tenant démo : identifiants déterministes des
 * livrables, chronologie ouvrée, acteurs d'une mission et attribution des rôles de la garde
 * (séparation des tâches vérifiée par le MÊME moteur que l'API : `evaluerGarde`).
 */

export interface Acteur {
  cle: CleCompte;
  id: string;
  nom: string;
  role: string;
}

/** UUID déterministe (forme v5) d'un livrable du seed : la même clé redonne le même identifiant. */
export function uuidStable(...morceaux: string[]): string {
  const h = createHash("sha1").update(morceaux.join("|"), "utf8").digest("hex");
  const variante = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variante}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Acteur d'un compte du seed, ou une erreur claire. */
export function acteur(ctx: ContexteTenantDemo, cle: CleCompte): Acteur {
  const c = ctx.comptes[cle];
  if (!c) throw new Error(`Compte « ${cle} » introuvable dans le contexte.`);
  return { cle, id: c.utilisateurId, nom: c.nom, role: c.role };
}

/** Acteur correspondant à un identifiant d'utilisateur du cabinet (undefined s'il n'est pas du seed). */
export function acteurDe(
  ctx: ContexteTenantDemo,
  utilisateurId: string | null,
): Acteur | undefined {
  if (!utilisateurId) return undefined;
  for (const c of Object.values(ctx.comptes)) {
    if (c && c.utilisateurId === utilisateurId) return acteur(ctx, c.cle);
  }
  return undefined;
}

/** Vrai si le compte est arrivé dans le cabinet à la date donnée (`donnees-comptes.ts`). */
export function present(cle: CleCompte, date: string): boolean {
  const d = COMPTES_CABINET.find((c) => c.cle === cle);
  return d ? d.depuis <= date : true;
}

/* ----- Chronologie ouvrée ----- */

/** Prochain jour ouvré (la date elle-même si elle l'est). */
export function jourOuvre(date: string): string {
  let d = date;
  while (estWeekEnd(d)) d = ajouterJours(d, 1);
  return d;
}

/**
 * Curseur de temps d'un dossier : avance de jours ouvrés ou de minutes, sans jamais dépasser
 * « aujourd'hui » (erreur claire sinon : le jeu de données ne contient aucune date future).
 */
export class Chrono {
  private ms: number;
  constructor(
    date: string,
    private readonly alea: Alea,
    private readonly limite: string,
  ) {
    this.ms = Date.parse(`${jourOuvre(date)}T08:${String(30 + alea.entier(0, 29))}:00Z`);
    this.controler();
  }
  private controler(): void {
    if (this.date() > this.limite) {
      throw new Error(`Date future dans le seed qualité : ${this.iso()} (limite ${this.limite}).`);
    }
  }
  date(): string {
    return new Date(this.ms).toISOString().slice(0, 10);
  }
  iso(): string {
    return new Date(this.ms).toISOString();
  }
  /** Avance de `n` jours ouvrés, à une heure de bureau tirée au hasard. */
  jours(n: number): this {
    let d = this.date();
    for (let i = 0; i < n; i++) d = jourOuvre(ajouterJours(d, 1));
    this.ms = Date.parse(
      `${d}T${String(8 + this.alea.entier(0, 8)).padStart(2, "0")}:${String(this.alea.entier(0, 59)).padStart(2, "0")}:00Z`,
    );
    this.controler();
    return this;
  }
  minutes(n: number): this {
    this.ms += n * 60_000;
    this.controler();
    return this;
  }
  /** Instant décalé de `n` minutes (sans déplacer le curseur). */
  decale(n: number): string {
    return new Date(this.ms + n * 60_000).toISOString();
  }
}

/* ----- Acteurs d'une mission et rôles de la garde ----- */

export interface InfoMission {
  mission: MissionLot;
  cle: CleMission;
  directeur: Acteur;
  chef: Acteur;
  equipe: Acteur[];
  dateSignature: string | null;
  /** Rang de la mission dans le casting (alterne le second expert). */
  indice: number;
}

export async function infoMission(
  ctx: ContexteTenantDemo,
  cle: CleMission,
  indice: number,
): Promise<InfoMission> {
  const mission = await exigerMission(ctx, cle);
  const m = await ctx.proprietaire.query<{
    directeur_id: string | null;
    chef_id: string | null;
    date_signature: string | null;
  }>("SELECT directeur_id, chef_id, date_signature::text FROM missions WHERE id = $1", [
    mission.id,
  ]);
  const ligne = m.rows[0];
  const directeur = acteurDe(ctx, ligne?.directeur_id ?? null);
  const chef = acteurDe(ctx, ligne?.chef_id ?? null);
  if (!directeur || !chef) {
    throw new Error(
      `Mission « ${mission.intitule} » : directeur ou chef absent des comptes du seed.`,
    );
  }
  const eq = await ctx.proprietaire.query<{ utilisateur_id: string }>(
    "SELECT utilisateur_id FROM mission_equipe WHERE mission_id = $1 ORDER BY ajoute_le, utilisateur_id",
    [mission.id],
  );
  const equipe = eq.rows
    .map((l) => acteurDe(ctx, l.utilisateur_id))
    .filter((a): a is Acteur => a !== undefined);
  return {
    mission,
    cle,
    directeur,
    chef,
    equipe,
    dateSignature: ligne?.date_signature ?? null,
    indice,
  };
}

export type RoleGardeSeed = EtapeGarde | "auteur" | "ouvreur";
export type Distribution = Record<RoleGardeSeed, Acteur>;

/**
 * Attribue les rôles d'un livrable de classe `classe` à la date `date` : auteur membre de la
 * mission (consultant de l'équipe, à défaut le chef), relecture par le chef (ou le directeur s'il
 * est l'auteur), second expert hors équipe (associé n° 2 ou directeur n° 2, en alternance),
 * signature par le directeur de la mission (à défaut un associé). Jette si le moteur de garde
 * relève une violation : le jeu de données respecte la séparation des tâches.
 */
export function distribuer(
  ctx: ContexteTenantDemo,
  info: InfoMission,
  classe: ClasseRisque,
  date: string,
): Distribution {
  const ok = (a: Acteur | undefined, interdits: Acteur[]): a is Acteur =>
    a !== undefined && present(a.cle, date) && !interdits.some((i) => i.id === a.id);
  const premier = (
    candidats: (Acteur | undefined)[],
    interdits: Acteur[],
    quoi: string,
  ): Acteur => {
    const a = candidats.find((c) => ok(c, interdits));
    if (!a)
      throw new Error(
        `Mission « ${info.mission.intitule} » : aucun acteur disponible pour ${quoi}.`,
      );
    return a;
  };
  const associe = acteur(ctx, "associe");
  const associe2 = acteur(ctx, "associe.2");
  const directeur2 = acteur(ctx, "directeur.mission.2");
  const consultants = info.equipe.filter((a) => a.role === "consultant");
  const auteur = premier([...consultants, info.chef], [], "l'auteur");
  const relecteur = premier([info.chef, info.directeur, associe], [auteur], "la relecture du chef");
  const seconds = info.indice % 2 === 0 ? [associe2, directeur2] : [directeur2, associe2];
  const second = premier(seconds, [auteur, relecteur], "le second expert");
  const signataire = premier(
    [info.directeur, associe, associe2],
    [auteur, relecteur, second],
    "la signature",
  );
  const ouvreur = premier([info.chef, info.directeur], [], "l'ouverture");
  const d: Distribution = {
    auteur,
    ouvreur,
    validation_auteur: auteur,
    validation_consultant: auteur,
    relecture_chef_mission: relecteur,
    revue_second_expert: second,
    signature_directeur_mission: signataire,
  };
  // Même contrôle que l'API : le moteur de garde ne doit relever aucune violation.
  const evaluation = evaluerGarde(
    classe,
    (
      [
        "validation_auteur",
        "validation_consultant",
        "relecture_chef_mission",
        "revue_second_expert",
        "signature_directeur_mission",
      ] as const
    ).map((etape) => ({ etape, acteur: d[etape].id })),
    { auteur: auteur.id },
  );
  if (evaluation.violations.length > 0) {
    throw new Error(
      `Garde ${classe} de « ${info.mission.intitule} » : ${evaluation.violations.map((v) => v.code).join(", ")}.`,
    );
  }
  return d;
}

/** Exécute `corps` dans une transaction du rôle propriétaire (annulée en cas d'erreur). */
export async function transaction<T>(ctx: ContexteTenantDemo, corps: () => Promise<T>): Promise<T> {
  await ctx.proprietaire.query("BEGIN");
  try {
    const r = await corps();
    await ctx.proprietaire.query("COMMIT");
    return r;
  } catch (e) {
    await ctx.proprietaire.query("ROLLBACK");
    throw e;
  }
}
