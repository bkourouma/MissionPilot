import {
  jeuEssaiCreationSchema,
  NIVEAUX_AUTONOMIE,
  type ClasseRisque,
  type JeuEssaiCreation,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import type { Resultat } from "./saisie";

/** Lecture et validation des saisies des écrans « Agents IA ». */

/* ----- Lecture des saisies ----- */

export function lireDecisionAutonomie(s: {
  niveau: string;
  motif: string;
}): Resultat<{ niveau: NiveauAutonomie; motif: string }, "niveau" | "motif"> {
  const erreurs: Partial<Record<"niveau" | "motif", string>> = {};
  const niveau = s.niveau as NiveauAutonomie;
  if (!NIVEAUX_AUTONOMIE.includes(niveau)) erreurs.niveau = "Choisissez un niveau.";
  const motif = s.motif.trim();
  if (motif === "") erreurs.motif = "Le motif est obligatoire.";
  else if (motif.length > 2000) erreurs.motif = "2 000 caractères au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { niveau, motif } };
}

export function lireIncident(s: {
  gravite: string;
  description: string;
}): Resultat<{ gravite: "mineur" | "majeur"; description: string }, "gravite" | "description"> {
  const erreurs: Partial<Record<"gravite" | "description", string>> = {};
  if (s.gravite !== "mineur" && s.gravite !== "majeur") erreurs.gravite = "Choisissez la gravité.";
  const description = s.description.trim();
  if (description === "") erreurs.description = "Décrivez l'incident.";
  else if (description.length > 2000) erreurs.description = "2 000 caractères au plus.";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : {
        ok: true,
        charge: { gravite: s.gravite as "mineur" | "majeur", description },
      };
}

export function lireMotif(motif: string, max = 1000): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif: "Le motif est obligatoire." } };
  if (m.length > max) return { ok: false, erreurs: { motif: `${max} caractères au plus.` } };
  return { ok: true, charge: { motif: m } };
}

const CODE_BRIQUE = /^[a-z0-9_.-]{1,120}$/;

export function lireBrique(s: {
  brique_code: string;
  agent_code: string;
  classe_risque: string;
  niveau_max: string;
}): Resultat<
  {
    brique_code: string;
    agent_code: string;
    classe_risque: ClasseRisque;
    niveau_max: NiveauAutonomie;
  },
  "brique_code" | "agent_code" | "classe_risque" | "niveau_max"
> {
  const erreurs: Partial<
    Record<"brique_code" | "agent_code" | "classe_risque" | "niveau_max", string>
  > = {};
  const code = s.brique_code.trim();
  if (!CODE_BRIQUE.test(code)) {
    erreurs.brique_code = "Code : minuscules, chiffres, « _ », « . » et « - ».";
  }
  if (s.agent_code === "") erreurs.agent_code = "Choisissez un agent.";
  if (!["R0", "R1", "R2", "R3"].includes(s.classe_risque)) {
    erreurs.classe_risque = "Choisissez une classe.";
  }
  if (!NIVEAUX_AUTONOMIE.includes(s.niveau_max as NiveauAutonomie)) {
    erreurs.niveau_max = "Choisissez un niveau.";
  } else if (s.niveau_max === "N4" && s.classe_risque !== "R0") {
    erreurs.niveau_max = "N4 est réservé aux briques de classe R0.";
  }
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : {
        ok: true,
        charge: {
          brique_code: code,
          agent_code: s.agent_code,
          classe_risque: s.classe_risque as ClasseRisque,
          niveau_max: s.niveau_max as NiveauAutonomie,
        },
      };
}

/** Jeu d'essai saisi en JSON (tableau de cas) : contrôle par le schéma partagé, messages français. */
export function lireJeuEssai(s: {
  prompt_nom: string;
  description: string;
  cas: string;
}): Resultat<JeuEssaiCreation, "prompt_nom" | "cas"> {
  let cas: unknown;
  try {
    cas = JSON.parse(s.cas);
  } catch {
    return { ok: false, erreurs: { cas: "Les cas doivent être un tableau JSON valide." } };
  }
  const r = jeuEssaiCreationSchema.safeParse({
    prompt_nom: s.prompt_nom.trim(),
    description: s.description,
    cas,
  });
  if (r.success) return { ok: true, charge: r.data };
  const erreurs: Partial<Record<"prompt_nom" | "cas", string>> = {};
  for (const issue of r.error.issues) {
    if (issue.path[0] === "prompt_nom") {
      erreurs.prompt_nom = "Nom de prompt : minuscules, chiffres et tiret bas.";
    } else {
      erreurs.cas ??=
        "Cas invalides : de 1 à 50 cas, chacun avec un code unique, ses variables et ses critères.";
    }
  }
  return { ok: false, erreurs };
}
