import { aPermission, type Role } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import type { TypeMission } from "./catalogue";
import type { Client, PageListe } from "./clients";
import type { Collaborateur, Grade } from "./collaborateurs";
import { personnesDepuisCollaborateurs, type Personne } from "./personnes";

/**
 * Listes de choix chargées côté serveur pour les formulaires du cycle commercial et des
 * missions. Chaque liste n'est demandée que si le rôle a la permission de lecture (un 403
 * redirigerait vers « Accès refusé ») ; une liste indisponible devient une liste vide que le
 * formulaire signale. Aucune donnée financière n'est chargée ici.
 */

export interface OptionChoix {
  valeur: string;
  libelle: string;
}

export interface OptionType extends OptionChoix {
  mode: TypeMission["mode_facturation"];
}

export async function chargerClientsActifs(roles: readonly Role[]): Promise<OptionChoix[]> {
  if (!aPermission(roles, "clients.lire")) return [];
  const r = await chargerServeur<PageListe<Client>>("/api/clients?actif=true&limite=100");
  return r.ok ? r.donnees.elements.map((c) => ({ valeur: c.id, libelle: c.raison_sociale })) : [];
}

export async function chargerTypesActifs(roles: readonly Role[]): Promise<OptionType[]> {
  if (!aPermission(roles, "catalogue.lire")) return [];
  const r = await chargerServeur<{ elements: TypeMission[] }>("/api/types-mission?actif=true");
  return r.ok
    ? r.donnees.elements.map((t) => ({
        valeur: t.id,
        libelle: t.libelle,
        mode: t.mode_facturation,
      }))
    : [];
}

/** Personnes désignables (collaborateurs liés à un compte) ; vide sans « collaborateurs.lire ». */
export async function chargerPersonnes(roles: readonly Role[]): Promise<Personne[]> {
  if (!aPermission(roles, "collaborateurs.lire")) return [];
  const r = await chargerServeur<PageListe<Collaborateur>>(
    "/api/collaborateurs?actif=true&limite=200",
  );
  return r.ok ? personnesDepuisCollaborateurs(r.donnees.elements) : [];
}

/** Grades actifs dans l'ordre du cabinet ; vide sans « catalogue.lire ». */
export async function chargerGradesActifs(roles: readonly Role[]): Promise<Grade[]> {
  if (!aPermission(roles, "catalogue.lire")) return [];
  const r = await chargerServeur<{ elements: Grade[] }>("/api/grades");
  return r.ok ? r.donnees.elements.filter((g) => g.actif).sort((a, b) => a.ordre - b.ordre) : [];
}
