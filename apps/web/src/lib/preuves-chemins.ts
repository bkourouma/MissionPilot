/** Chemins d'API et liens des écrans du registre des preuves. */

// --- Chemins --------------------------------------------------------------------------------

export const cheminPreuvesMission = (missionId: string) => `/api/missions/${missionId}/preuves`;
export const cheminAssertionsMission = (missionId: string) =>
  `/api/missions/${missionId}/assertions`;
export const cheminPreuve = (id: string) => `/api/preuves/${id}`;
export const cheminVersionsPreuve = (id: string) => `/api/preuves/${id}/versions`;
export const cheminAssertion = (id: string) => `/api/assertions/${id}`;
export const cheminVersionsAssertion = (id: string) => `/api/assertions/${id}/versions`;
export const cheminLiensAssertion = (id: string) => `/api/assertions/${id}/liens`;
export const cheminLienAssertion = (id: string, preuveId: string) =>
  `/api/assertions/${id}/liens/${preuveId}`;
export const cheminArbitragesAssertion = (id: string) => `/api/assertions/${id}/arbitrages`;
export const cheminDimensions = (missionId: string) =>
  `${cheminPreuvesMission(missionId)}/dimensions`;
export const cheminDimension = (missionId: string, id: string) =>
  `${cheminDimensions(missionId)}/${id}`;
export const cheminTriangulation = (missionId: string) =>
  `${cheminPreuvesMission(missionId)}/triangulation`;
export const cheminContradictions = (missionId: string, resolues = false) =>
  `${cheminPreuvesMission(missionId)}/contradictions${resolues ? "?resolues=oui" : ""}`;
export const cheminControle = (missionId: string, livrable?: string | null) =>
  `${cheminPreuvesMission(missionId)}/controle${livrable ? `?livrable=${encodeURIComponent(livrable)}` : ""}`;
export const cheminAssertionsFragiles = (missionId: string) =>
  `${cheminAssertionsMission(missionId)}/fragiles`;

const base = (missionId: string) => `/missions/${missionId}/preuves`;
export const hrefRegistre = (missionId: string, requete = "") =>
  `${base(missionId)}${requete ? `?${requete}` : ""}`;
export const hrefNouvellePreuve = (missionId: string) => `${base(missionId)}/nouvelle`;
export const hrefPreuve = (missionId: string, id: string) => `${base(missionId)}/${id}`;
export const hrefAssertions = (missionId: string, requete = "") =>
  `${base(missionId)}/assertions${requete ? `?${requete}` : ""}`;
export const hrefNouvelleAssertion = (missionId: string) =>
  `${base(missionId)}/assertions/nouvelle`;
export const hrefAssertion = (missionId: string, id: string) =>
  `${base(missionId)}/assertions/${id}`;
export const hrefTriangulation = (missionId: string) => `${base(missionId)}/triangulation`;
export const hrefContradictions = (missionId: string) => `${base(missionId)}/contradictions`;

/** Sous-pages de l'onglet « Preuves » (l'onglet actif est celui dont le href est le plus long). */
export function sousPagesPreuves(missionId: string) {
  return [
    { id: "registre", libelle: "Registre", href: base(missionId) },
    { id: "assertions", libelle: "Assertions", href: hrefAssertions(missionId) },
    { id: "triangulation", libelle: "Triangulation", href: hrefTriangulation(missionId) },
    { id: "contradictions", libelle: "Contradictions", href: hrefContradictions(missionId) },
  ] as const;
}
