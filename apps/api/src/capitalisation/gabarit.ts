import { formaterCentiemesJours, formaterPourMille } from "@missionpilot/engines";
import { LONGUEUR_SECTION_RETOUR_MAX, type RetourVersion } from "@missionpilot/shared";
import type { FaitsRetour } from "./donnees.js";

/*
 * Gabarit DÉTERMINISTE du retour d'expérience (CAP-01) : quatre sections rédigées par code depuis
 * les faits de la mission (moteur `capitalisation` pour toute valeur chiffrée). Sert de brouillon
 * à l'ouverture et de repli quand l'IA est indisponible ; le chef de mission complète les leçons
 * et valide. Aucun nombre n'est inventé : chaque chiffre vient de `FaitsRetour`.
 */

const LIGNES_MAX = 30;

export const NATURE_LIBELLES: Record<string, string> = {
  retirer_brique: "retrait",
  activer_brique: "activation",
  adapter_brique: "adaptation",
};
const STATUT_DEROGATION: Record<string, string> = {
  demandee: "en attente",
  approuvee: "approuvée",
  refusee: "refusée",
};

const dateFr = (d: string | null) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : null;

function borner(lignes: readonly string[]): string {
  const l = lignes.filter((x) => x !== "");
  const gardees =
    l.length > LIGNES_MAX
      ? [...l.slice(0, LIGNES_MAX), `… (${l.length - LIGNES_MAX} lignes de plus)`]
      : l;
  return gardees.join("\n").slice(0, LONGUEUR_SECTION_RETOUR_MAX);
}

function valeurContexte(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "oui" : "non";
  return String(v);
}

function sectionContexte(f: FaitsRetour): string {
  const m = f.mission;
  const periode =
    m.date_debut || m.date_fin
      ? `Période : du ${dateFr(m.date_debut) ?? "?"} au ${dateFr(m.date_fin) ?? "?"}.`
      : "";
  const facteurs = Object.entries(f.contexte)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `– ${k} : ${valeurContexte(v)}`);
  return borner([
    `Mission « ${m.intitule} » pour ${m.client}${m.type_mission ? ` (${m.type_mission})` : ""}.`,
    periode,
    m.secteur ? `Secteur : ${m.secteur}.` : "",
    m.activite ? `Activité : ${m.activite}.` : "",
    facteurs.length > 0 ? "Facteurs de contexte retenus pour la méthode :" : "",
    ...facteurs,
  ]);
}

function sectionMethode(f: FaitsRetour): string {
  if (!f.methode) {
    return "Aucune méthode du référentiel n'était liée à la mission : la méthode suivie est à décrire.";
  }
  const actives = f.methode.briques.filter((b) => b.active);
  const retirees = f.methode.briques.filter((b) => !b.active).map((b) => b.libelle);
  const derog = f.derogations.map(
    (d) =>
      `– ${d.brique_code} (${NATURE_LIBELLES[d.nature] ?? d.nature}, ${STATUT_DEROGATION[d.statut] ?? d.statut}) : ${d.motif}`,
  );
  return borner([
    `Méthode « ${f.methode.libelle} », version ${f.methode.version}.`,
    `Briques actives : ${actives.length} sur ${f.methode.briques.length}.`,
    retirees.length > 0 ? `Briques non retenues : ${retirees.join(", ")}.` : "",
    f.derogations.length > 0
      ? `Dérogations demandées : ${f.derogations.length}.`
      : "Aucune dérogation.",
    ...derog,
  ]);
}

function sectionEcarts(f: FaitsRetour): string {
  const t = f.ecarts.total;
  const relatif = t.ecart_pour_mille === null ? "" : ` (${formaterPourMille(t.ecart_pour_mille)})`;
  const lignes = f.ecarts.briques.map((b) => {
    const ref =
      b.reference === null || b.reference_centiemes === null
        ? "sans référence"
        : `référence ${formaterCentiemesJours(b.reference_centiemes)} (${b.reference === "budget" ? "budget" : "temps type"})`;
    const ecart =
      b.ecart_pour_mille === null ? "" : `, écart ${formaterPourMille(b.ecart_pour_mille)}`;
    return `– ${b.brique_code} : réel ${formaterCentiemesJours(b.realise_centiemes)}, ${ref}${ecart}`;
  });
  return borner([
    `Temps réel validé : ${formaterCentiemesJours(t.realise_centiemes)} pour un budget de ${formaterCentiemesJours(t.budget_centiemes)}${relatif}.`,
    `Tâches rattachées à une brique : ${f.temps.taches_rattachees} sur ${f.temps.taches}.`,
    f.temps.taches_rattachees === 0
      ? "Aucune tâche n'est rattachée à une brique : la base d'estimation ne sera pas alimentée par cette mission."
      : "Écarts par brique :",
    ...lignes,
  ]);
}

function sectionLecons(f: FaitsRetour): string {
  const parCode = new Map(f.ecarts.briques.map((b) => [b.brique_code, b]));
  const pm = (code: string) => formaterPourMille(parCode.get(code)?.ecart_pour_mille ?? 0);
  const lecons = [
    ...f.ecarts.depassements.map(
      (c) =>
        `– La brique « ${c} » a dépassé sa référence (${pm(c)}) : revoir son temps type ou les conditions de la mission.`,
    ),
    ...f.ecarts.sous_consommations.map(
      (c) =>
        `– La brique « ${c} » a consommé nettement moins que sa référence (${pm(c)}) : vérifier si elle a été allégée.`,
    ),
    ...f.derogations
      .filter((d) => d.statut === "approuvee")
      .map(
        (d) =>
          `– Dérogation retenue sur « ${d.brique_code} » (${NATURE_LIBELLES[d.nature] ?? d.nature}) : à signaler au comité méthode si elle se répète.`,
      ),
  ];
  return borner([
    ...(lecons.length > 0
      ? ["Constats tirés des données :", ...lecons]
      : ["Aucun écart marquant n'est relevé par les données."]),
    "À compléter par le chef de mission : ce qui a bien fonctionné, ce qui est à reproduire, ce qui est à éviter.",
  ]);
}

export function gabaritRetour(f: FaitsRetour): RetourVersion {
  return {
    contexte: sectionContexte(f),
    methode: sectionMethode(f),
    ecarts: sectionEcarts(f),
    lecons: sectionLecons(f),
  };
}

/** Faits conservés avec la version (trace des chiffres cités). */
export function donneesVersion(f: FaitsRetour): Record<string, unknown> {
  return {
    methode: f.methode ? { code: f.methode.code, version: f.methode.version } : null,
    temps: {
      realise_centiemes: f.temps.realise_centiemes,
      budget_centiemes: f.temps.budget_centiemes,
      taches: f.temps.taches,
      taches_rattachees: f.temps.taches_rattachees,
    },
    ecarts: f.ecarts,
    derogations: f.derogations.length,
  };
}
