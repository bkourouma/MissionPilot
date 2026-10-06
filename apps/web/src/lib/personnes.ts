/**
 * Personnes désignables (directeur, chef de mission, responsable, membre d'équipe) : les
 * collaborateurs du cabinet qui ont un compte utilisateur. Logique pure, testée dans
 * `personnes.test.ts`.
 */

/** Collaborateur réduit au strict nécessaire pour un choix de personne (aucune donnée financière). */
export interface Personne {
  utilisateur_id: string;
  nom: string;
  grade_libelle: string | null;
}

interface CollaborateurLu {
  utilisateur_id: string | null;
  nom: string;
  grade_libelle?: string | null;
  actif?: boolean;
}

/** Garde les collaborateurs actifs liés à un compte, triés par nom, sans doublon. */
export function personnesDepuisCollaborateurs(liste: readonly CollaborateurLu[]): Personne[] {
  const vus = new Set<string>();
  const personnes: Personne[] = [];
  for (const c of liste) {
    if (!c.utilisateur_id || c.actif === false || vus.has(c.utilisateur_id)) continue;
    vus.add(c.utilisateur_id);
    personnes.push({
      utilisateur_id: c.utilisateur_id,
      nom: c.nom,
      grade_libelle: c.grade_libelle ?? null,
    });
  }
  return personnes.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export function optionsPersonnes(personnes: readonly Personne[]) {
  return personnes.map((p) => ({
    valeur: p.utilisateur_id,
    libelle: p.grade_libelle ? `${p.nom} (${p.grade_libelle})` : p.nom,
  }));
}

/** Nom affichable d'un utilisateur ; « — » si non désigné, libellé neutre s'il est inconnu. */
export function nomPersonne(id: string | null | undefined, personnes: readonly Personne[]): string {
  if (!id) return "—";
  return personnes.find((p) => p.utilisateur_id === id)?.nom ?? "Utilisateur du cabinet";
}
