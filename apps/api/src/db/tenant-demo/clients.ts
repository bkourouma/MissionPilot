import { ajouterJours } from "@missionpilot/engines";
import { antidater, attendre, type ContexteTenantDemo, type SessionDemo } from "./contexte.js";
import type { CleClient } from "./cles.js";
import { CLIENTS, type DefClient } from "./donnees-clients.js";
import { CONTACTS } from "./donnees-contacts.js";
import {
  ETATS,
  GRADES_TAUX,
  lignesEtat,
  PARTICIPATIONS,
  TAUX_CLIENTS,
  tauxNegocie,
  versUnitesMineures,
  type DefTauxClient,
} from "./donnees-dossiers.js";
import { FAITS } from "./donnees-faits.js";

/*
 * Clients du cabinet « Tenant démo », par les VRAIES routes (session de l'associé : seul rôle,
 * avec les gestionnaires, à lire et écrire les taux, FIN-02 ; et seul à enregistrer des faits
 * déjà confirmés). Tout est idempotent par clé naturelle : raison sociale, e-mail du contact,
 * (grade, devise, début de validité) du taux, (détenteur, filiale, part, date) de la
 * participation, (catégorie, clé) du fait, exercice de l'état financier.
 *
 * Remplit `ctx.clients[cle]` et `ctx.dossiers[cle]` (le dossier a l'identifiant du client).
 * Le hasard vient du seul flux `ctx.alea.deriver("clients")`.
 */

type Elements<T> = { elements: T[] };

async function lire<T>(s: SessionDemo, url: string): Promise<T[]> {
  const r = await s.get(url);
  attendre(200, r, `lecture ${url}`);
  return (r.json() as Elements<T>).elements;
}

/** Identifiants de grade par code : la liste du cabinet d'abord, `ctx.grades` en repli. */
async function resoudreGrades(
  ctx: ContexteTenantDemo,
  associe: SessionDemo,
): Promise<Record<string, string>> {
  const liste = await lire<{ code: string; id: string }>(associe, "/api/grades");
  return { ...ctx.grades, ...Object.fromEntries(liste.map((g) => [g.code, g.id])) };
}

async function assurerClient(
  ctx: ContexteTenantDemo,
  associe: SessionDemo,
  existants: Map<string, string>,
  def: DefClient,
): Promise<string> {
  let id = existants.get(def.raison_sociale.toLowerCase());
  if (!id) {
    const r = await associe.post("/api/clients", {
      raison_sociale: def.raison_sociale,
      forme_juridique: def.forme_juridique,
      rccm: def.rccm,
      compte_contribuable: def.compte_contribuable,
      secteur: def.secteur,
      pays: def.pays,
      taille: def.taille,
      adresse: def.adresse,
    });
    attendre(201, r, `client ${def.raison_sociale}`);
    id = r.json().id as string;
    ctx.journal(`Client créé : ${def.raison_sociale}.`);
  }
  await antidater(ctx, "clients", id, def.entree);
  return id;
}

async function assurerContacts(
  ctx: ContexteTenantDemo,
  associe: SessionDemo,
  id: string,
  def: DefClient,
): Promise<void> {
  const presents = await lire<{ email: string | null; principal: boolean }>(
    associe,
    `/api/clients/${id}/contacts`,
  );
  const emails = new Set(presents.map((c) => (c.email ?? "").toLowerCase()));
  const aPrincipal = presents.some((c) => c.principal);
  for (const c of CONTACTS[def.cle]) {
    if (emails.has(c.email.toLowerCase())) continue;
    const r = await associe.post(`/api/clients/${id}/contacts`, {
      ...c,
      principal: c.principal && !aPrincipal,
    });
    attendre(201, r, `contact ${c.email}`);
    await antidater(ctx, "contacts_client", r.json().id as string, def.entree);
  }
}

/** Barème négocié d'un client : un taux par grade, avec une éventuelle révision datée. */
async function assurerTaux(
  associe: SessionDemo,
  id: string,
  def: DefClient,
  taux: DefTauxClient,
  grades: Record<string, string>,
): Promise<void> {
  const presents = await lire<{ grade_id: string; devise: string; valide_du: string | null }>(
    associe,
    `/api/clients/${id}/taux`,
  );
  const cles = new Set(presents.map((t) => `${t.grade_id}|${t.devise}|${t.valide_du ?? ""}`));
  const periodes = taux.revision
    ? [
        {
          pourcentage: taux.pourcentage,
          valide_du: taux.valide_du,
          valide_au: ajouterJours(taux.revision.depuis, -1),
        },
        {
          pourcentage: taux.revision.pourcentage,
          valide_du: taux.revision.depuis,
          valide_au: null,
        },
      ]
    : [{ pourcentage: taux.pourcentage, valide_du: taux.valide_du, valide_au: null }];
  for (const p of periodes) {
    for (const grade of GRADES_TAUX) {
      const gradeId = grades[grade];
      if (!gradeId) throw new Error(`Grade « ${grade} » introuvable : catalogue non semé ?`);
      if (cles.has(`${gradeId}|${def.devise}|${p.valide_du}`)) continue;
      const r = await associe.post(`/api/clients/${id}/taux`, {
        grade_id: gradeId,
        taux: tauxNegocie(def.devise, grade, p.pourcentage),
        devise: def.devise,
        valide_du: p.valide_du,
        valide_au: p.valide_au,
      });
      attendre(201, r, `taux ${grade} ${def.cle}`);
    }
  }
}

interface Detention {
  detenteur: { id?: string };
  filiale: { id?: string };
  points_base: number;
  date_effet: string;
}

/** Groupes : participations en ajout seul (la part de sicafe dans sicafe-export passe de 75 à 80 %). */
async function assurerParticipations(ctx: ContexteTenantDemo, associe: SessionDemo): Promise<void> {
  for (const p of PARTICIPATIONS) {
    const filiale = ctx.client(p.filiale);
    const detenteur = ctx.client(p.detenteur);
    const histo = await lire<Detention>(associe, `/api/dossiers/${filiale}/participations`);
    const existe = histo.some(
      (h) =>
        h.detenteur.id === detenteur &&
        h.filiale.id === filiale &&
        h.points_base === p.points_base &&
        h.date_effet === p.date_effet,
    );
    if (existe) continue;
    const r = await associe.post(`/api/dossiers/${filiale}/participations`, {
      detenteur_id: detenteur,
      filiale_id: filiale,
      points_base: p.points_base,
      date_effet: p.date_effet,
      ...(p.motif ? { motif: p.motif } : {}),
    });
    attendre(201, r, `participation ${p.detenteur} -> ${p.filiale}`);
  }
}

async function assurerFaits(associe: SessionDemo, cle: CleClient, id: string): Promise<void> {
  const presents = await lire<{ categorie: string; cle: string }>(
    associe,
    `/api/dossiers/${id}/faits?vue=tous`,
  );
  const cles = new Set(presents.map((f) => `${f.categorie}/${f.cle}`));
  for (const fait of FAITS[cle]) {
    if (cles.has(`${fait.categorie}/${fait.cle}`)) continue;
    const r = await associe.post(`/api/dossiers/${id}/faits`, fait);
    attendre(201, r, `fait ${cle} ${fait.cle}`);
  }
}

/** États financiers 2024 et 2025 de quelques gros clients (saisie structurée, contrôles du moteur). */
async function assurerEtats(ctx: ContexteTenantDemo, associe: SessionDemo): Promise<void> {
  const flux = ctx.alea.deriver("clients");
  for (const e of ETATS) {
    const id = ctx.client(e.cle);
    const def = CLIENTS.find((c) => c.cle === e.cle);
    if (!def) throw new Error(`Client inconnu : ${e.cle}`);
    const url = `/api/dossiers/${id}/etats-financiers`;
    const presents = await lire<{ exercice: number }>(associe, url);
    if (presents.some((p) => p.exercice === e.exercice)) continue;
    const r = await associe.post(url, {
      exercice: e.exercice,
      date_cloture: `${e.exercice}-12-31`,
      devise: def.devise,
      source_libelle: `États financiers ${e.exercice} remis par le client`,
      // EUR et USD en centimes (montantSchema) ; `lignesEtat` produit des unités majeures.
      lignes: lignesEtat(e, flux.deriver(`etat-${e.cle}-${e.exercice}`)).map((l) => ({
        ...l,
        montant: versUnitesMineures(def.devise, l.montant),
      })),
    });
    attendre(201, r, `état financier ${e.cle} ${e.exercice}`);
  }
}

export async function assurerClients(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const grades = await resoudreGrades(ctx, associe);
  const liste = await lire<{ id: string; raison_sociale: string }>(
    associe,
    "/api/clients?limite=100",
  );
  const existants = new Map(liste.map((c) => [c.raison_sociale.toLowerCase(), c.id]));

  for (const def of CLIENTS) {
    const id = await assurerClient(ctx, associe, existants, def);
    ctx.clients[def.cle] = id;
    ctx.dossiers[def.cle] = id;
    await assurerContacts(ctx, associe, id, def);
  }
  for (const taux of TAUX_CLIENTS) {
    const def = CLIENTS.find((c) => c.cle === taux.cle);
    if (!def) throw new Error(`Client inconnu : ${taux.cle}`);
    await assurerTaux(associe, ctx.client(taux.cle), def, taux, grades);
  }
  await assurerParticipations(ctx, associe);
  for (const def of CLIENTS) await assurerFaits(associe, def.cle, ctx.client(def.cle));
  await assurerEtats(ctx, associe);
  ctx.journal(`Clients : ${CLIENTS.length} clients, contacts, taux, groupes et dossiers prêts.`);
}
