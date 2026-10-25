import type { DefinitionQuestionnaireDonnees } from "@missionpilot/shared";
import type { CleCompteCabinet } from "../cles.js";
import type { ContexteTenantDemo } from "../contexte.js";
import {
  CLIMAT_SOCIAL,
  DIAGNOSTIC_FINANCIER,
  SATISFACTION_CLIENT,
} from "./questionnaires-donnees.js";
import { exiger, existe, lire } from "./outils.js";

/*
 * Modèles de questionnaires du Tenant démo : versions rédigées par un consultant ou un chef de
 * mission, validées par un directeur de mission (route /questionnaires/versions/:id/valider), et
 * trois modèles proposés par l'IA (génération /questionnaires/generation-ia, fournisseur simulé :
 * gabarit déterministe, sans clé) dont l'historique « brouillon IA », « modifié », « validé »
 * remplit questionnaire_ia_historique. Idempotent : clé naturelle = code du modèle.
 */

interface DefModele {
  code: string;
  auteur: CleCompteCabinet;
  valideur: CleCompteCabinet;
  source:
    | { type: "gabarit"; gabarit: "notation_generique" | "preliminaire_dirigeants" }
    | { type: "definition"; definition: DefinitionQuestionnaireDonnees };
  titre?: string;
  /** Version 2 : rédigée par `auteur`, validée (ou laissée en brouillon si `valideur` est absent). */
  suite?: {
    auteur: CleCompteCabinet;
    valideur?: CleCompteCabinet;
    definition: (v1: DefinitionQuestionnaireDonnees) => DefinitionQuestionnaireDonnees;
  };
}

/** Version 2 du questionnaire de notation : même questions notées, plus un commentaire libre. */
function notationAvecCommentaire(
  v1: DefinitionQuestionnaireDonnees,
): DefinitionQuestionnaireDonnees {
  const sections = v1.sections.map((s, i) =>
    i === v1.sections.length - 1
      ? {
          ...s,
          questions: [
            ...s.questions,
            {
              id: "div.commentaires",
              type: "texte" as const,
              libelle:
                "Un point que le questionnaire n'a pas abordé et que vous souhaitez signaler ?",
              obligatoire: false,
              longueurMax: 1500,
            },
          ],
        }
      : s,
  );
  return { ...v1, sections };
}

const MODELES: readonly DefModele[] = [
  {
    code: "notation_generique",
    auteur: "chef.mission",
    valideur: "directeur.mission",
    source: { type: "gabarit", gabarit: "notation_generique" },
    suite: {
      auteur: "consultant",
      valideur: "directeur.mission.2",
      definition: notationAvecCommentaire,
    },
  },
  {
    code: "preliminaire_dirigeants",
    auteur: "chef.mission",
    valideur: "directeur.mission",
    source: { type: "gabarit", gabarit: "preliminaire_dirigeants" },
  },
  {
    code: "satisfaction-client",
    auteur: "consultant",
    valideur: "directeur.mission",
    source: { type: "definition", definition: SATISFACTION_CLIENT },
    suite: {
      auteur: "consultant.2",
      definition: (v1) => ({
        ...v1,
        titre: "Satisfaction du client en fin de mission (révision 2026)",
      }),
    },
  },
  {
    code: "climat-social",
    auteur: "chef.mission.2",
    valideur: "directeur.mission.2",
    source: { type: "definition", definition: CLIMAT_SOCIAL },
  },
  {
    code: "diagnostic-financier",
    auteur: "consultant.2",
    valideur: "directeur.mission",
    source: { type: "definition", definition: DIAGNOSTIC_FINANCIER },
  },
];

interface LigneVersion extends Record<string, unknown> {
  id: string;
  version: number;
  statut: string;
}

async function versions(ctx: ContexteTenantDemo, code: string): Promise<LigneVersion[]> {
  return lire<LigneVersion>(
    ctx,
    `SELECT v.id, v.version, v.statut FROM questionnaire_versions v
       JOIN questionnaire_modeles m ON m.id = v.modele_id AND m.cabinet_id = v.cabinet_id
      WHERE m.cabinet_id = $1 AND m.code = $2 ORDER BY v.version`,
    [ctx.cabinetId, code],
  );
}

/** Identifiant de la version `numero` du modèle `code` (erreur claire si elle n'existe pas). */
export async function versionDe(
  ctx: ContexteTenantDemo,
  code: string,
  numero: number,
): Promise<string> {
  const v = (await versions(ctx, code)).find((l) => l.version === numero);
  if (!v) throw new Error(`Version ${numero} du modèle « ${code} » introuvable.`);
  return v.id;
}

async function valider(
  ctx: ContexteTenantDemo,
  valideur: CleCompteCabinet,
  versionId: string,
  quoi: string,
  acquitte = false,
): Promise<void> {
  const r = await ctx
    .session(valideur)
    .post(
      `/api/questionnaires/versions/${versionId}/valider`,
      acquitte ? { acquitte_chiffres: true } : {},
    );
  exiger(r, 200, `Validation de ${quoi}`);
}

async function semerModelesManuels(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of MODELES) {
    let lignes = await versions(ctx, def.code);
    if (lignes.length === 0) {
      const r = await ctx.session(def.auteur).post("/api/questionnaires/modeles", {
        code: def.code,
        ...(def.titre ? { titre: def.titre } : {}),
        source: def.source,
      });
      exiger(r, 201, `Modèle ${def.code}`);
      lignes = await versions(ctx, def.code);
    }
    const v1 = lignes.find((l) => l.version === 1);
    if (v1?.statut === "brouillon") await valider(ctx, def.valideur, v1.id, `${def.code} v1`);
    if (def.suite && !lignes.some((l) => l.version === 2)) {
      const r1 = await ctx.session(def.auteur).get(`/api/questionnaires/versions/${v1?.id}`);
      exiger(r1, 200, `Lecture de ${def.code} v1`);
      const base = r1.json().definition as DefinitionQuestionnaireDonnees;
      const r = await ctx
        .session(def.suite.auteur)
        .post(`/api/questionnaires/modeles/${await modeleId(ctx, def.code)}/versions`, {
          definition: def.suite.definition(base),
        });
      exiger(r, 201, `Version 2 de ${def.code}`);
      if (def.suite.valideur) {
        await valider(ctx, def.suite.valideur, r.json().id as string, `${def.code} v2`);
      }
    }
  }
  // Copie d'un modèle existant : nouveau modèle en brouillon (origine « copie »).
  if (
    !(await existe(ctx, "SELECT 1 FROM questionnaire_modeles WHERE cabinet_id = $1 AND code = $2", [
      ctx.cabinetId,
      "satisfaction-client-flash",
    ]))
  ) {
    const r = await ctx.session("consultant.2").post("/api/questionnaires/modeles", {
      code: "satisfaction-client-flash",
      titre: "Satisfaction client — version flash (diagnostics courts)",
      source: { type: "copie", modele_id: await modeleId(ctx, "satisfaction-client") },
    });
    exiger(r, 201, "Copie du modèle de satisfaction");
  }
}

async function modeleId(ctx: ContexteTenantDemo, code: string): Promise<string> {
  const l = await lire<{ id: string }>(
    ctx,
    "SELECT id FROM questionnaire_modeles WHERE cabinet_id = $1 AND code = $2",
    [ctx.cabinetId, code],
  );
  if (!l[0]) throw new Error(`Modèle « ${code} » introuvable.`);
  return l[0].id;
}

/* ----- Modèles proposés par l'IA (SOC-11) ----- */

interface DefModeleIa {
  code: string;
  generateur: CleCompteCabinet;
  service: string;
  population: string;
  theme: string;
  nombre_questions: number;
  termes_sensibles: string[];
  /** Retouche par un consultant (rang « modifié »). */
  retouche?: CleCompteCabinet;
  /** Validation par un autre consultant (rang « validé »). */
  valideur?: CleCompteCabinet;
}

const MODELES_IA: readonly DefModeleIa[] = [
  {
    code: "diagnostic-execution-ia",
    generateur: "consultant",
    service: "Plan stratégique",
    population: "Comité de direction d'une compagnie d'assurance",
    theme: "Capacité d'exécution de la stratégie et conduite du changement",
    nombre_questions: 12,
    termes_sensibles: ["Baobab Assurances"],
    retouche: "chef.mission",
    valideur: "directeur.mission",
  },
  {
    code: "climat-equipes-ia",
    generateur: "consultant.2",
    service: "Diagnostic flash",
    population: "Responsables d'équipe d'une entreprise de logistique",
    theme: "Organisation du travail et climat dans les équipes",
    nombre_questions: 10,
    termes_sensibles: ["Teranga Logistique"],
  },
  {
    code: "maturite-numerique-ia",
    generateur: "chef.mission.2",
    service: "Notation financière",
    population: "Dirigeants de PME clientes d'une banque",
    theme: "Maturité numérique et dépendance aux outils de gestion",
    nombre_questions: 8,
    termes_sensibles: [],
    retouche: "chef.mission.2",
  },
];

async function semerModelesIa(ctx: ContexteTenantDemo): Promise<void> {
  for (const def of MODELES_IA) {
    if (
      !(await existe(
        ctx,
        "SELECT 1 FROM questionnaire_modeles WHERE cabinet_id = $1 AND code = $2",
        [ctx.cabinetId, def.code],
      ))
    ) {
      const r = await ctx.session(def.generateur).post("/api/questionnaires/generation-ia", {
        code: def.code,
        service: def.service,
        population: def.population,
        theme: def.theme,
        nombre_questions: def.nombre_questions,
        termes_sensibles: def.termes_sensibles,
      });
      exiger(r, 201, `Génération IA ${def.code}`);
    }
    const v1 = (await versions(ctx, def.code)).find((l) => l.version === 1);
    if (!v1 || v1.statut === "valide") continue;
    const rangs = await lire<{ statut_contenu: string }>(
      ctx,
      "SELECT statut_contenu FROM questionnaire_ia_historique WHERE version_id = $1 ORDER BY rang",
      [v1.id],
    );
    const dernier = rangs[rangs.length - 1]?.statut_contenu;
    if (def.retouche && dernier === "brouillon_ia") {
      const lu = await ctx.session(def.retouche).get(`/api/questionnaires/versions/${v1.id}`);
      exiger(lu, 200, `Lecture de ${def.code}`);
      const definition = lu.json().definition as DefinitionQuestionnaireDonnees;
      const retouchee = {
        ...definition,
        titre: `${definition.titre} (relu et reformulé par le cabinet)`,
      };
      const r = await ctx
        .session(def.retouche)
        .put(`/api/questionnaires/versions/${v1.id}`, { definition: retouchee });
      exiger(r, 200, `Retouche de ${def.code}`);
    }
    if (def.valideur && dernier !== "valide") {
      const lu = await ctx.session(def.valideur).get(`/api/questionnaires/versions/${v1.id}`);
      exiger(lu, 200, `Lecture de ${def.code}`);
      const acquitte = lu.json().ia?.chiffres_non_verifies === true;
      await valider(ctx, def.valideur, v1.id, `${def.code} (contenu IA)`, acquitte);
    }
  }
}

export async function semerModeles(ctx: ContexteTenantDemo): Promise<void> {
  await semerModelesManuels(ctx);
  await semerModelesIa(ctx);
}
