import { cache } from "react";
import { aPermission, type Role } from "@missionpilot/shared";
import { chargerServeur, type Chargement } from "./api-serveur";
import {
  aplatirDossier,
  cheminDossier,
  type DossierBrut,
  cheminListesExclusion,
  cheminTaxonomie,
  LIMITE_LISTE_DD,
  type AssertionChoix,
  type DossierDetail,
  type EntreeTaxonomie,
  type ListeExclusion,
  type PageDd,
  type PreuveChoix,
} from "./due-diligence";
import type { Mission } from "./missions";
import {
  chargerToutesLesPages,
  LIMITE_PAGE_MAX,
  type ChargementPage,
  type PageCurseur,
} from "./pagination";

/**
 * Chargements côté serveur des écrans de la due diligence (listes de choix, taxonomies, dossier).
 * Toute liste paginée par curseur déclare le plafond de sa route (`limiteMax`, SPEC-3b §10.2) : une
 * `limite` au-delà du plafond donnerait un 400 et une liste vide en silence. À n'importer que côté
 * serveur (dépend de `next/headers`).
 */

/** Dossier chargé une seule fois par requête (mise en page du dossier et page affichée). */
export const chargerDossier = cache(async (id: string): Promise<Chargement<DossierDetail>> => {
  const r = await chargerServeur<DossierBrut>(cheminDossier(id));
  return r.ok ? { ok: true, donnees: aplatirDossier(r.donnees) } : r;
});

/** Adapte une page `{ elements, curseur_suivant }` de l'API à la forme de `chargerToutesLesPages`. */
export async function chargerPageCurseur<T>(
  chemin: string,
): Promise<ChargementPage<PageCurseur<T>>> {
  const r = await chargerServeur<PageDd<T>>(chemin);
  return r.ok
    ? { ok: true, donnees: { elements: r.donnees.elements, suivant: r.donnees.curseur_suivant } }
    : r;
}

/** Toutes les entrées d'une taxonomie (plafond de page de la route : 100). */
export async function chargerTaxonomie(
  taxonomie: "secteur" | "filiere" | "pays",
): Promise<Chargement<EntreeTaxonomie[]>> {
  const r = await chargerToutesLesPages<EntreeTaxonomie>(
    chargerPageCurseur,
    cheminTaxonomie(taxonomie),
    { limiteMax: LIMITE_LISTE_DD },
  );
  return r.ok ? { ok: true, donnees: r.donnees.elements } : r;
}

export interface Taxonomies {
  secteurs: EntreeTaxonomie[];
  filieres: EntreeTaxonomie[];
  pays: EntreeTaxonomie[];
  /** Message si l'une des taxonomies n'a pas pu être chargée (les listes de choix sont alors partielles). */
  erreur: string | null;
}

/** Secteurs, filières et pays : une requête par taxonomie (`standard.lire`). */
export async function chargerTaxonomies(): Promise<Taxonomies> {
  const [secteurs, filieres, pays] = await Promise.all([
    chargerTaxonomie("secteur"),
    chargerTaxonomie("filiere"),
    chargerTaxonomie("pays"),
  ]);
  const premiereErreur = [secteurs, filieres, pays].find((r) => !r.ok);
  return {
    secteurs: secteurs.ok ? secteurs.donnees : [],
    filieres: filieres.ok ? filieres.donnees : [],
    pays: pays.ok ? pays.donnees : [],
    erreur: premiereErreur && !premiereErreur.ok ? premiereErreur.message : null,
  };
}

interface AssertionApi {
  id: string;
  enonce: string;
  statut: string;
}

/** Assertions de la mission (registre des preuves), hors assertions abandonnées. */
export async function chargerAssertionsMission(
  missionId: string,
): Promise<Chargement<AssertionChoix[]>> {
  const r = await chargerToutesLesPages<AssertionApi>(
    chargerPageCurseur,
    `/api/missions/${encodeURIComponent(missionId)}/assertions`,
    { limiteMax: LIMITE_LISTE_DD },
  );
  if (!r.ok) return r;
  return {
    ok: true,
    donnees: r.donnees.elements
      .filter((a) => a.statut !== "abandonnee")
      .map((a) => ({ id: a.id, enonce: a.enonce, statut: a.statut })),
  };
}

interface PreuveApi {
  id: string;
  source_precise: string;
  date_preuve: string;
}

/** Preuves de la mission, proposées comme source d'un paramètre de dimensionnement (par libellé). */
export async function chargerPreuvesMission(missionId: string): Promise<Chargement<PreuveChoix[]>> {
  const r = await chargerToutesLesPages<PreuveApi>(
    chargerPageCurseur,
    `/api/missions/${encodeURIComponent(missionId)}/preuves`,
    { limiteMax: LIMITE_LISTE_DD },
  );
  return r.ok
    ? {
        ok: true,
        donnees: r.donnees.elements.map((p) => ({
          id: p.id,
          source_precise: p.source_precise,
          date_preuve: p.date_preuve,
        })),
      }
    : r;
}

/** Listes d'exclusion du cabinet (toutes les pages, plafond de la route : 100). */
export async function chargerListesExclusion(
  clientId?: string,
): Promise<Chargement<ListeExclusion[]>> {
  const r = await chargerToutesLesPages<ListeExclusion>(
    chargerPageCurseur,
    cheminListesExclusion(clientId ? `client_id=${encodeURIComponent(clientId)}` : ""),
    { limiteMax: LIMITE_LISTE_DD },
  );
  return r.ok ? { ok: true, donnees: r.donnees.elements } : r;
}

// --- Liens du plan des 100 jours vers un plan stratégique et un indicateur ---------------------

/** Au plus ce nombre de missions du client et de plans sont parcourus (listes de choix bornées). */
export const MISSIONS_LIENS_MAX = 10;
export const PLANS_LIENS_MAX = 6;

export interface ChoixLien {
  valeur: string;
  libelle: string;
}

export interface ChoixLiensPlan {
  initiatives: ChoixLien[];
  indicateurs: ChoixLien[];
  /** Vrai si le parcours a été borné ou si une lecture a échoué : la liste peut être incomplète. */
  partiel: boolean;
}

interface PlanApi {
  id: string;
  titre: string;
}
interface InitiativeApi {
  id: string;
  titre: string;
}
interface KpiApi {
  id: string;
  libelle: string;
}

/**
 * Initiatives de plan et indicateurs des missions du MÊME client (la liaison est vérifiée par
 * l'API, `MPZ30`). Chaque lecture exige la permission (`plan.lire`, `kpi.lire`) et la visibilité de
 * la mission : ce que l'appelant ne voit pas n'est simplement pas proposé.
 */
export async function chargerChoixLiensPlan(
  clientId: string,
  roles: readonly Role[],
): Promise<ChoixLiensPlan> {
  const resultat: ChoixLiensPlan = { initiatives: [], indicateurs: [], partiel: false };
  const peutPlan = aPermission(roles, "plan.lire");
  const peutKpi = aPermission(roles, "kpi.lire");
  if (!peutPlan && !peutKpi) return resultat;

  const missions = await chargerToutesLesPages<Mission>(
    chargerServeur,
    `/api/missions?client_id=${encodeURIComponent(clientId)}`,
    { limiteMax: LIMITE_PAGE_MAX },
  );
  if (!missions.ok) return { ...resultat, partiel: true };
  const retenues = missions.donnees.elements.slice(0, MISSIONS_LIENS_MAX);
  if (missions.donnees.elements.length > MISSIONS_LIENS_MAX || missions.donnees.tronquee) {
    resultat.partiel = true;
  }

  const plans: { id: string; titre: string }[] = [];
  await Promise.all(
    retenues.map(async (m) => {
      if (peutPlan) {
        const p = await chargerServeur<PageDd<PlanApi>>(
          `/api/missions/${encodeURIComponent(m.id)}/plans?limite=${PLANS_LIENS_MAX}`,
        );
        if (p.ok) plans.push(...p.donnees.elements.map((x) => ({ id: x.id, titre: x.titre })));
        else resultat.partiel = true;
      }
      if (peutKpi) {
        const k = await chargerServeur<{ elements: KpiApi[] }>(
          `/api/missions/${encodeURIComponent(m.id)}/kpi`,
        );
        if (k.ok) {
          resultat.indicateurs.push(
            ...k.donnees.elements.map((x) => ({
              valeur: x.id,
              libelle: `${x.libelle} (${m.intitule})`,
            })),
          );
        } else resultat.partiel = true;
      }
    }),
  );

  if (plans.length > PLANS_LIENS_MAX) resultat.partiel = true;
  await Promise.all(
    plans.slice(0, PLANS_LIENS_MAX).map(async (plan) => {
      const f = await chargerServeur<{ initiatives: InitiativeApi[] }>(
        `/api/plans/${encodeURIComponent(plan.id)}/feuille-de-route`,
      );
      if (f.ok) {
        resultat.initiatives.push(
          ...f.donnees.initiatives.map((i) => ({
            valeur: i.id,
            libelle: `${i.titre} (${plan.titre})`,
          })),
        );
      } else resultat.partiel = true;
    }),
  );
  resultat.initiatives.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  resultat.indicateurs.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr"));
  return resultat;
}

interface ClientApi {
  id: string;
  raison_sociale: string;
}

/**
 * Investisseurs proposés pour une liste d'exclusion (clients du cabinet). La lecture exige
 * `clients.lire` : sans ce droit, seule la liste générale est proposée (aucun appel, donc aucun
 * refus). Plafond de page de la route des clients : 100.
 */
export async function chargerInvestisseurs(roles: readonly Role[]): Promise<ChoixLien[]> {
  if (!aPermission(roles, "clients.lire")) return [];
  const r = await chargerToutesLesPages<ClientApi>(chargerPageCurseur, "/api/clients", {
    limiteMax: LIMITE_LISTE_DD,
  });
  return r.ok ? r.donnees.elements.map((c) => ({ valeur: c.id, libelle: c.raison_sociale })) : [];
}
