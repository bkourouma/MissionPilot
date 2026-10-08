import type { ArbitrageLigne, AssertionCourante, PreuveCourante } from "./donnees.js";

/*
 * Vues JSON du registre des preuves. Un verbatim nominatif dont la personne n'a pas donné son
 * accord est MASQUÉ (extrait, source précise et liens vers l'élément source) pour qui n'a pas le
 * droit de le voir (`peutVoirNominatif`, preuves/acces.ts). Le masquage est appliqué ici, en un
 * seul endroit, pour toutes les routes qui servent une preuve.
 */

export const TEXTE_MASQUE =
  "Verbatim nominatif masqué : l'accord de la personne n'est pas recueilli.";

export function vuePreuve(p: Omit<PreuveCourante, "cle_tri">, voirNominatif: boolean) {
  const masque = p.nominatif && !p.accord_nominatif && !voirNominatif;
  return {
    id: p.id,
    mission_id: p.mission_id,
    client_id: p.client_id,
    version: p.version,
    type_source: p.type_source,
    source_precise: masque ? "Source nominative masquée" : p.source_precise,
    date_preuve: p.date_preuve,
    auteur: { id: p.auteur_id, nom: p.auteur_nom },
    fiabilite: p.fiabilite,
    extrait: masque ? null : p.extrait,
    fichier_id: masque ? null : p.fichier_id,
    reponse_id: masque ? null : p.reponse_id,
    document_id: masque ? null : p.document_id,
    dimensions: p.dimensions,
    nominatif: p.nominatif,
    accord_nominatif: p.accord_nominatif,
    masque,
    motif: p.motif,
    cree_le: p.cree_le,
    version_cree_le: p.version_cree_le,
  };
}

export function vueAssertion(a: Omit<AssertionCourante, "cle_tri">) {
  return {
    id: a.id,
    mission_id: a.mission_id,
    version: a.version,
    enonce: a.enonce,
    rattachement:
      a.rattachement_type === null
        ? null
        : { type: a.rattachement_type, code: a.rattachement_code },
    livrable: a.livrable,
    classe_risque: a.classe_risque,
    statut: a.statut,
    avis_expert: a.avis_expert
      ? {
          motif: a.avis_expert_motif,
          signe: a.signe_par !== null,
          signe_par: a.signe_par === null ? null : { id: a.signe_par, nom: a.signe_par_nom },
          signe_le: a.signe_le,
        }
      : null,
    motif: a.motif,
    auteur: { id: a.cree_par, nom: a.cree_par_nom },
    cree_le: a.cree_le,
    version_cree_le: a.version_cree_le,
  };
}

export function vueArbitrage(a: ArbitrageLigne) {
  return {
    id: a.id,
    preuve_id: a.preuve_id,
    preuve_version: a.preuve_version,
    decision: a.decision,
    motif: a.motif,
    arbitre: { id: a.arbitre_par, nom: a.arbitre_nom },
    arbitre_le: a.arbitre_le,
  };
}
