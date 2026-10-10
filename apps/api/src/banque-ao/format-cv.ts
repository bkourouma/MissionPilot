import { anneesExperience, rangMois } from "@missionpilot/engines";
import {
  LIBELLES_NIVEAU_DIPLOME,
  LIBELLES_NIVEAU_LANGUE,
  type CvContenu,
  type CvExperience,
} from "@missionpilot/shared";
import { liste, paragraphe, section } from "../rapports/outils.js";
import type { Bloc, Section } from "../rapports/modele.js";
import type { GabaritCv } from "./cv.js";

/*
 * Mise au format d'un CV selon le gabarit d'un bailleur (AO-04) : MISE EN FORME seulement,
 * déterministe. Le résultat est un modèle de rapport (rapports/modele.ts), validé, nettoyé puis
 * rendu en Word ou en PDF par l'infrastructure de rapports existante (`rendreRapport`), qui
 * échappe tout texte. Les années d'expérience viennent du moteur `banque-cv`.
 */

export interface ProfilCv {
  nom: string;
  version: number;
}

export interface OptionsFormatCv {
  emetteur: string;
  /** Date de génération AAAA-MM-JJ. */
  genereLe: string;
  /** Mois de référence AAAA-MM du calcul des années d'expérience et du filtre des expériences. */
  reference: string;
}

const NON_RENSEIGNE = "—";

function moisAffiche(mois: string | null): string {
  if (mois === null) return "en cours";
  return `${mois.slice(5, 7)}/${mois.slice(0, 4)}`;
}

/** Expériences retenues par le gabarit : récentes d'abord ou dans l'ordre, fenêtre facultative. */
export function experiencesRetenues(
  experiences: readonly CvExperience[],
  gabarit: Pick<GabaritCv, "ordre_experiences" | "experiences_annees_max">,
  reference: string,
): CvExperience[] {
  const limite =
    gabarit.experiences_annees_max === null
      ? null
      : rangMois(reference) - gabarit.experiences_annees_max * 12;
  const fin = (e: CvExperience) => (e.fin === null ? rangMois(reference) : rangMois(e.fin));
  const retenues = experiences.filter((e) => limite === null || fin(e) >= limite);
  const signe = gabarit.ordre_experiences === "antechronologique" ? -1 : 1;
  return [...retenues].sort(
    (a, b) => signe * (rangMois(a.debut) - rangMois(b.debut)) || signe * (fin(a) - fin(b)),
  );
}

function blocsIdentite(profil: ProfilCv, contenu: CvContenu, reference: string): Bloc[] {
  const annees = anneesExperience(contenu.experiences, reference);
  return [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Nom", valeur: profil.nom },
        { libelle: "Titre ou poste proposé", valeur: contenu.titre },
        { libelle: "Nationalité", valeur: contenu.nationalite ?? NON_RENSEIGNE },
        { libelle: "Expérience professionnelle", valeur: `${annees} an(s)` },
      ],
    },
  ];
}

function blocsFormations(contenu: CvContenu): Bloc[] {
  if (contenu.diplomes.length === 0) return [paragraphe("Aucun diplôme renseigné.")];
  const tries = [...contenu.diplomes].sort((a, b) => b.annee - a.annee);
  return [
    {
      type: "tableau",
      colonnes: ["Année", "Diplôme", "Niveau", "Domaine", "Établissement"],
      lignes: tries.map((d) => [
        String(d.annee),
        d.intitule,
        LIBELLES_NIVEAU_DIPLOME[d.niveau],
        d.domaine,
        d.etablissement ?? NON_RENSEIGNE,
      ]),
    },
  ];
}

function blocsLangues(contenu: CvContenu): Bloc[] {
  if (contenu.langues.length === 0) return [paragraphe("Aucune langue renseignée.")];
  return [
    {
      type: "tableau",
      colonnes: ["Langue", "Niveau"],
      lignes: contenu.langues.map((l) => [l.langue, LIBELLES_NIVEAU_LANGUE[l.niveau]]),
    },
  ];
}

function blocsExperiences(contenu: CvContenu, gabarit: GabaritCv, reference: string): Bloc[] {
  const retenues = experiencesRetenues(contenu.experiences, gabarit, reference);
  if (retenues.length === 0) return [paragraphe("Aucune expérience retenue.")];
  return [
    {
      type: "tableau",
      colonnes: ["Période", "Poste", "Employeur", "Pays", "Bailleur", "Description"],
      lignes: retenues.map((e) => [
        `${moisAffiche(e.debut)} – ${moisAffiche(e.fin)}`,
        e.intitule,
        e.employeur,
        e.pays ?? NON_RENSEIGNE,
        e.bailleur ?? NON_RENSEIGNE,
        (e.description ?? NON_RENSEIGNE).slice(0, 300),
      ]),
    },
  ];
}

function blocsSection(
  nom: string,
  profil: ProfilCv,
  contenu: CvContenu,
  gabarit: GabaritCv,
  reference: string,
): Bloc[] {
  switch (nom) {
    case "identite":
      return blocsIdentite(profil, contenu, reference);
    case "resume":
      return [paragraphe(contenu.resume ?? NON_RENSEIGNE)];
    case "formations":
      return blocsFormations(contenu);
    case "langues":
      return blocsLangues(contenu);
    case "experiences":
      return blocsExperiences(contenu, gabarit, reference);
    case "competences":
      return contenu.competences.length > 0
        ? [liste(contenu.competences)]
        : [paragraphe(NON_RENSEIGNE)];
    default:
      return contenu.secteurs.length > 0 ? [liste(contenu.secteurs)] : [paragraphe(NON_RENSEIGNE)];
  }
}

/** CV au format du gabarit : modèle de rapport (non encore validé : `rendreRapport` le valide). */
export function cvEnRapport(
  profil: ProfilCv,
  contenu: CvContenu,
  gabarit: GabaritCv,
  options: OptionsFormatCv,
) {
  const sections: Section[] = gabarit.sections.map((s) =>
    section(s.titre, blocsSection(s.section, profil, contenu, gabarit, options.reference)),
  );
  return {
    titre: `Curriculum vitae — ${profil.nom}`.slice(0, 200),
    sous_titre: `${gabarit.libelle} (version ${profil.version} du CV)`.slice(0, 200),
    emetteur: options.emetteur.slice(0, 200),
    statut: "valide" as const,
    genere_le: options.genereLe,
    confidentiel: false,
    sections,
  };
}
