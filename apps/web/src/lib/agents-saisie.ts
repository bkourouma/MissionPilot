import {
  creerTraduire,
  jeuEssaiCreationSchema,
  NIVEAUX_AUTONOMIE,
  type ClasseRisque,
  type JeuEssaiCreation,
  type Langue,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import type { Resultat } from "./saisie";

/** Lecture et validation des saisies des écrans « Agents IA ». */

/* ----- Lecture des saisies ----- */

export function lireDecisionAutonomie(
  s: {
    niveau: string;
    motif: string;
  },
  langue: Langue = "fr",
): Resultat<{ niveau: NiveauAutonomie; motif: string }, "niveau" | "motif"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"niveau" | "motif", string>> = {};
  const niveau = s.niveau as NiveauAutonomie;
  if (!NIVEAUX_AUTONOMIE.includes(niveau)) {
    erreurs.niveau = t("Choisissez un niveau.", "Choose a level.");
  }
  const motif = s.motif.trim();
  if (motif === "") erreurs.motif = t("Le motif est obligatoire.", "The reason is required.");
  else if (motif.length > 2000) {
    erreurs.motif = t("2 000 caractères au plus.", "2,000 characters maximum.");
  }
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { niveau, motif } };
}

export function lireIncident(
  s: {
    gravite: string;
    description: string;
  },
  langue: Langue = "fr",
): Resultat<{ gravite: "mineur" | "majeur"; description: string }, "gravite" | "description"> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<"gravite" | "description", string>> = {};
  if (s.gravite !== "mineur" && s.gravite !== "majeur") {
    erreurs.gravite = t("Choisissez la gravité.", "Choose the severity.");
  }
  const description = s.description.trim();
  if (description === "") erreurs.description = t("Décrivez l'incident.", "Describe the incident.");
  else if (description.length > 2000) {
    erreurs.description = t("2 000 caractères au plus.", "2,000 characters maximum.");
  }
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : {
        ok: true,
        charge: { gravite: s.gravite as "mineur" | "majeur", description },
      };
}

export function lireMotif(
  motif: string,
  max = 1000,
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const t = creerTraduire(langue);
  const m = motif.trim();
  if (m === "") {
    return {
      ok: false,
      erreurs: { motif: t("Le motif est obligatoire.", "The reason is required.") },
    };
  }
  if (m.length > max) {
    return {
      ok: false,
      erreurs: { motif: t(`${max} caractères au plus.`, `${max} characters maximum.`) },
    };
  }
  return { ok: true, charge: { motif: m } };
}

const CODE_BRIQUE = /^[a-z0-9_.-]{1,120}$/;

export function lireBrique(
  s: {
    brique_code: string;
    agent_code: string;
    classe_risque: string;
    niveau_max: string;
  },
  langue: Langue = "fr",
): Resultat<
  {
    brique_code: string;
    agent_code: string;
    classe_risque: ClasseRisque;
    niveau_max: NiveauAutonomie;
  },
  "brique_code" | "agent_code" | "classe_risque" | "niveau_max"
> {
  const t = creerTraduire(langue);
  const erreurs: Partial<
    Record<"brique_code" | "agent_code" | "classe_risque" | "niveau_max", string>
  > = {};
  const code = s.brique_code.trim();
  if (!CODE_BRIQUE.test(code)) {
    erreurs.brique_code = t(
      "Code : minuscules, chiffres, « _ », « . » et « - ».",
      'Code: lowercase letters, digits, "_", "." and "-".',
    );
  }
  if (s.agent_code === "") erreurs.agent_code = t("Choisissez un agent.", "Choose an agent.");
  if (!["R0", "R1", "R2", "R3"].includes(s.classe_risque)) {
    erreurs.classe_risque = t("Choisissez une classe.", "Choose a class.");
  }
  if (!NIVEAUX_AUTONOMIE.includes(s.niveau_max as NiveauAutonomie)) {
    erreurs.niveau_max = t("Choisissez un niveau.", "Choose a level.");
  } else if (s.niveau_max === "N4" && s.classe_risque !== "R0") {
    erreurs.niveau_max = t(
      "N4 est réservé aux briques de classe R0.",
      "N4 is reserved for class R0 building blocks.",
    );
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
export function lireJeuEssai(
  s: {
    prompt_nom: string;
    description: string;
    cas: string;
  },
  langue: Langue = "fr",
): Resultat<JeuEssaiCreation, "prompt_nom" | "cas"> {
  const t = creerTraduire(langue);
  let cas: unknown;
  try {
    cas = JSON.parse(s.cas);
  } catch {
    return {
      ok: false,
      erreurs: {
        cas: t(
          "Les cas doivent être un tableau JSON valide.",
          "The cases must be a valid JSON array.",
        ),
      },
    };
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
      erreurs.prompt_nom = t(
        "Nom de prompt : minuscules, chiffres et tiret bas.",
        "Prompt name: lowercase letters, digits and underscore.",
      );
    } else {
      erreurs.cas ??= t(
        "Cas invalides : de 1 à 50 cas, chacun avec un code unique, ses variables et ses critères.",
        "Invalid cases: 1 to 50 cases, each with a unique code, its variables and its criteria.",
      );
    }
  }
  return { ok: false, erreurs };
}
