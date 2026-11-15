/** Contenus du plan stratégique : responsables d'initiative et dépendances entre initiatives (PLA-05). */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { lireTexte } from "./plan-strategique";

// --- Responsables d'initiative ----------------------------------------------------------------

/** Personne désignable comme responsable (équipe de la mission ou référentiel du cabinet). */
export interface PersonnePlan {
  id: string;
  nom: string;
}

/**
 * Personnes proposées comme responsables : le référentiel du cabinet s'il est lisible
 * (`collaborateurs.lire`), sinon l'équipe de la mission ; l'utilisateur courant toujours
 * présent (« (vous) »). Triées par nom, sans doublon.
 */
export function personnesPlan(
  cabinet: readonly { utilisateur_id: string; nom: string }[],
  equipe: readonly { utilisateur_id: string; nom: string }[],
  moi: { id: string; nom: string },
  langue: Langue = "fr",
): PersonnePlan[] {
  const vous = langue === "en" ? "(you)" : "(vous)";
  const source = cabinet.length ? cabinet : equipe;
  const vus = new Set<string>();
  const liste: PersonnePlan[] = [];
  for (const p of source) {
    if (vus.has(p.utilisateur_id)) continue;
    vus.add(p.utilisateur_id);
    liste.push({
      id: p.utilisateur_id,
      nom: p.utilisateur_id === moi.id ? `${p.nom} ${vous}` : p.nom,
    });
  }
  if (!vus.has(moi.id)) liste.push({ id: moi.id, nom: `${moi.nom} ${vous}` });
  return liste.sort((a, b) => a.nom.localeCompare(b.nom, langue));
}

/** Nom affichable d'un responsable ; l'API accepte tout utilisateur interne actif. */
export function nomPersonnePlan(
  id: unknown,
  personnes: readonly PersonnePlan[],
  langue: Langue = "fr",
): string {
  const t = creerTraduire(langue);
  if (typeof id !== "string" || id === "") return t("Non désigné", "Not assigned");
  return (
    personnes.find((p) => p.id === id)?.nom ??
    t("Membre du cabinet (hors liste affichée)", "Firm member (not in the displayed list)")
  );
}

/**
 * Options du choix de responsable : « Non désigné », les personnes connues, et le
 * responsable actuel s'il n'en fait pas partie (pour ne pas le perdre en modifiant).
 */
export function optionsResponsables(
  personnes: readonly PersonnePlan[],
  actuel: string | null | undefined,
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  const t = creerTraduire(langue);
  const options = [
    { valeur: "", libelle: t("Non désigné", "Not assigned") },
    ...personnes.map((p) => ({ valeur: p.id, libelle: p.nom })),
  ];
  if (actuel && !personnes.some((p) => p.id === actuel)) {
    options.push({
      valeur: actuel,
      libelle: t(
        "Responsable actuel (hors liste affichée)",
        "Current owner (not in the displayed list)",
      ),
    });
  }
  return options;
}

// --- Dépendances d'une initiative (PLA-05) ----------------------------------------------------

/** Initiative du plan proposable comme prédécesseur. */
export interface OptionInitiative {
  id: string;
  titre: string;
  retire: boolean;
}

/** Initiatives du plan (titre de la version courante, retirées comprises pour l'affichage). */
export function initiativesDuPlan(
  elements: readonly {
    id: string;
    type: string;
    retire: boolean;
    donnees: Record<string, unknown>;
  }[],
): OptionInitiative[] {
  return elements
    .filter((e) => e.type === "initiative")
    .map((e) => ({
      id: e.id,
      titre: lireTexte(e.donnees, "titre") ?? "Initiative",
      retire: e.retire,
    }));
}

/**
 * Prédécesseurs proposés : autres initiatives ACTIVES du plan (l'API refuse une initiative
 * retirée), plus celles déjà choisies (pour pouvoir les décocher), triées par titre.
 */
export function optionsDependances(
  initiatives: readonly OptionInitiative[],
  soi: string | null,
  choisies: readonly string[],
  langue: Langue = "fr",
): { valeur: string; libelle: string }[] {
  const retiree = langue === "en" ? "(removed)" : "(retirée)";
  return initiatives
    .filter((i) => i.id !== soi && (!i.retire || choisies.includes(i.id)))
    .map((i) => ({ valeur: i.id, libelle: i.retire ? `${i.titre} ${retiree}` : i.titre }))
    .sort((a, b) => a.libelle.localeCompare(b.libelle, langue));
}

/** Titre d'une initiative pour l'affichage d'une dépendance. */
export function nomInitiative(
  id: string,
  initiatives: readonly OptionInitiative[],
  langue: Langue = "fr",
): string {
  const i = initiatives.find((x) => x.id === id);
  if (!i) return langue === "en" ? "Unknown initiative" : "Initiative inconnue";
  return i.retire ? `${i.titre} ${langue === "en" ? "(removed)" : "(retirée)"}` : i.titre;
}
