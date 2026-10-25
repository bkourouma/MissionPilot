import { ajouterJours } from "@missionpilot/engines";
import { ROLES_CLIENT } from "@missionpilot/shared";
import type pg from "pg";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { cleDeCompte, type MissionLue } from "./casting.js";
import type { RoleActeur } from "./collaboration-donnees-types.js";

/*
 * Outils communs du module COLLABORATION et PORTAIL de la phase `gestion` : acteurs par rôle dans
 * une mission, calcul des dates, et antidatage par SQL du propriétaire.
 *
 * Antidatage : les routes horodatent tout « maintenant ». Chaque écriture par une route est donc
 * encadrée par une FENÊTRE d'horloge réelle (lue dans la base) ; ses lignes de journal d'audit et
 * de notifications sont ensuite décalées à l'instant fictif voulu (même décalage pour toutes, donc
 * l'ordre interne est conservé). Les tables en ajout seul ou à champ figé (commentaires, tâches,
 * partages…) sont remontées par des requêtes LITTÉRALES, sans déclencheurs
 * (`session_replication_role = replica`, le temps d'une transaction) : jamais pour changer un
 * contenu, jamais de nom de table interpolé.
 */

export const heureISO = (jour: string, heure: number, minute: number): string =>
  `${jour}T${String(heure).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`;

/** Exécute `travail` dans une transaction du propriétaire, déclencheurs utilisateur désactivés. */
export async function sansDeclencheurs(
  ctx: ContexteTenantDemo,
  travail: (c: pg.Client) => Promise<void>,
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await travail(c);
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}

/** Instant courant de la base (horloge réelle) : borne de fenêtre, jamais une donnée métier. */
export async function maintenantBase(ctx: ContexteTenantDemo): Promise<Date> {
  const r = await ctx.proprietaire.query("SELECT clock_timestamp() AS t");
  return r.rows[0].t as Date;
}

export interface Fenetre {
  debut: Date;
  fin: Date;
}

/** Ouvre une fenêtre, exécute `action`, la referme et renvoie le résultat avec la fenêtre. */
export async function encadrer<T>(
  ctx: ContexteTenantDemo,
  action: () => Promise<T>,
): Promise<{ resultat: T; fenetre: Fenetre }> {
  const debut = await maintenantBase(ctx);
  const resultat = await action();
  return { resultat, fenetre: { debut, fin: await maintenantBase(ctx) } };
}

/**
 * Décale à `instant` (ISO complet) le journal d'audit et les notifications écrits pendant la
 * fenêtre ; `lues` marque ces notifications lues quelques heures après leur création.
 */
export async function ancrer(
  ctx: ContexteTenantDemo,
  fenetre: Fenetre,
  instant: string,
  lues: boolean,
): Promise<void> {
  await sansDeclencheurs(ctx, async (c) => {
    await c.query(
      `UPDATE journal_audit
          SET cree_le = $2::timestamptz + (cree_le - $3::timestamptz)
        WHERE cabinet_id = $1 AND cree_le >= $3 AND cree_le <= $4
          AND action NOT LIKE 'semis_tenant_demo%'`,
      [ctx.cabinetId, instant, fenetre.debut, fenetre.fin],
    );
    await c.query(
      `UPDATE notifications
          SET cree_le = $2::timestamptz + (cree_le - $3::timestamptz),
              lue_le = CASE WHEN $5::boolean
                            THEN $2::timestamptz + (cree_le - $3::timestamptz) + interval '3 hours'
                            ELSE lue_le END
        WHERE cabinet_id = $1 AND cree_le >= $3 AND cree_le <= $4`,
      [ctx.cabinetId, instant, fenetre.debut, fenetre.fin, lues],
    );
  });
}

/* ----- Dates ----- */

/** Période d'activité d'une mission, bornée à aujourd'hui (une mission signée non démarrée : dès sa signature). */
export function periode(ctx: ContexteTenantDemo, m: MissionLue): { debut: string; fin: string } {
  const auj = ctx.aujourdhui;
  const debut = m.debut && m.debut <= auj ? m.debut : (m.dateSignature ?? auj);
  const fin = m.fin && m.fin < auj ? m.fin : auj;
  return { debut: debut < fin ? debut : fin, fin };
}

/** Jour situé à la part `q` (0 à 1) de la période. */
export function jourSur(p: { debut: string; fin: string }, q: number): string {
  const jours = Math.round((Date.parse(p.fin) - Date.parse(p.debut)) / 86_400_000);
  return ajouterJours(p.debut, Math.round(jours * Math.min(1, Math.max(0, q))));
}

/** Ramène un samedi ou un dimanche au lundi suivant (jamais au-delà de `max`). */
export function ouvre(jour: string, max: string): string {
  const d = new Date(`${jour}T12:00:00Z`).getUTCDay();
  const decale = d === 6 ? ajouterJours(jour, 2) : d === 0 ? ajouterJours(jour, 1) : jour;
  return decale > max ? max : decale;
}

/* ----- Acteurs ----- */

export interface Acteur {
  cle: CleCompte;
  id: string;
  nom: string;
  roles: string[];
  /** Jour de création du compte : aucune écriture avant. */
  depuis: string;
}

export interface Equipe {
  parRole: Record<RoleActeur, Acteur>;
}

/** Comptes du cabinet (hors portail) qui ont une clé dans le contexte, par identifiant. */
export async function lireActeurs(ctx: ContexteTenantDemo): Promise<Map<string, Acteur>> {
  const r = await ctx.proprietaire.query(
    `SELECT id, nom, roles, (cree_le AT TIME ZONE 'UTC')::date::text AS depuis
       FROM utilisateurs WHERE cabinet_id = $1 AND actif AND NOT (roles && $2::text[])`,
    [ctx.cabinetId, [...ROLES_CLIENT]],
  );
  const acteurs = new Map<string, Acteur>();
  for (const u of r.rows) {
    const cle = cleDeCompte(ctx, u.id as string) as CleCompte | undefined;
    if (!cle) continue;
    acteurs.set(u.id as string, {
      cle,
      id: u.id as string,
      nom: u.nom as string,
      roles: u.roles as string[],
      depuis: u.depuis as string,
    });
  }
  return acteurs;
}

const parNom = (a: Acteur, b: Acteur): number => a.nom.localeCompare(b.nom, "fr");

/** Équipe d'une mission résolue par rôle (repli sur le chef, puis le directeur, si un rôle manque). */
export async function equipeDe(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  acteurs: Map<string, Acteur>,
): Promise<Equipe> {
  const membres = (
    await ctx.proprietaire.query(
      "SELECT utilisateur_id FROM mission_equipe WHERE cabinet_id = $1 AND mission_id = $2",
      [ctx.cabinetId, m.id],
    )
  ).rows
    .map((l) => acteurs.get(l.utilisateur_id as string))
    .filter((a): a is Acteur => !!a);
  const dir = m.directeurId ? acteurs.get(m.directeurId) : undefined;
  const chef = m.chefId ? acteurs.get(m.chefId) : undefined;
  const compte = (cle: CleCompte): Acteur => {
    const id = ctx.utilisateurs[cle];
    const a = id ? acteurs.get(id) : undefined;
    if (!a) throw new Error(`Compte « ${cle} » introuvable parmi les acteurs.`);
    return a;
  };
  const base = chef ?? dir ?? compte("associe");
  const avec = (role: string) => membres.filter((a) => a.roles.includes(role)).sort(parNom);
  const consultants = avec("consultant");
  const choisir = (i: number): Acteur =>
    consultants.length > 0 ? (consultants[i % consultants.length] as Acteur) : base;
  const experts = [...avec("expert_metier"), ...avec("expert_externe")];
  return {
    parRole: {
      dir: dir ?? base,
      chef: chef ?? base,
      assoc: avec("associe")[0] ?? compte("associe"),
      c1: choisir(0),
      c2: choisir(1),
      c3: choisir(2),
      exp: experts[0] ?? base,
      gest: compte("gestionnaire"),
      res: compte("ressources"),
    },
  };
}

/** Session d'un acteur (compte du cabinet). */
export const sessionDe = (ctx: ContexteTenantDemo, a: Acteur): SessionDemo => ctx.session(a.cle);

/** Instant le plus tardif de deux jours ISO. */
export const plusTard = (a: string, b: string): string => (a > b ? a : b);

/** DELETE avec le cookie d'une session (la session de démonstration n'expose pas `delete`). */
export function supprimerAvec(ctx: ContexteTenantDemo, s: SessionDemo, url: string) {
  return ctx.app.inject({ method: "DELETE", url, headers: { cookie: s.cookie } });
}
