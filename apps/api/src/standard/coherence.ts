import { ErreurModulation, validerReglesModulation } from "@missionpilot/engines";
import {
  CODES_MOTEURS_STANDARD,
  type ClasseRisque,
  type NiveauAutonomie,
} from "@missionpilot/shared";
import { executerCas, reglesDe, referentielVersion, type FacteurLigne } from "./modulation.js";
import type { ContenuMethode } from "./types.js";

/*
 * Contrôle de cohérence d'une version (STD-05, STD-11) avant publication :
 * - règles de modulation : `validerReglesModulation` du moteur, contre le
 *   référentiel de la version (facteurs visibles, briques, items, cibles) ;
 * - cas types : tous doivent passer (`executerCasTypes`) ;
 * - structure : au moins une brique, étapes non vides (avertissement),
 *   moteur connu (`MOTEURS_STANDARD`), niveau d'autonomie compatible avec la
 *   classe de risque (une brique R2 ou R3, livrable client ou engageant,
 *   garde une validation humaine : N2 au plus ; N3 réservé à R0 et R1 ; N4,
 *   exécution vers le client, à R0 seulement — PRD complémentaire §7.1).
 * Une anomalie de gravité « erreur » bloque la publication.
 */

export interface AnomalieVersion {
  code: string;
  gravite: "erreur" | "avertissement";
  regle: string | null;
  chemin: string;
  message: string;
}

const RANG_NIVEAU: Record<NiveauAutonomie, number> = { N0: 0, N1: 1, N2: 2, N3: 3, N4: 4 };
const NIVEAU_MAX_PAR_CLASSE: Record<ClasseRisque, NiveauAutonomie> = {
  R0: "N4",
  R1: "N3",
  R2: "N2",
  R3: "N2",
};

function anomaliesStructure(contenu: ContenuMethode): AnomalieVersion[] {
  const anomalies: AnomalieVersion[] = [];
  if (contenu.briques.length === 0) {
    anomalies.push({
      code: "VERSION_SANS_BRIQUE",
      gravite: "erreur",
      regle: null,
      chemin: "briques",
      message: "Une méthode compte au moins une brique.",
    });
  }
  for (const e of contenu.etapes) {
    if (!contenu.briques.some((b) => b.etape_code === e.code)) {
      anomalies.push({
        code: "ETAPE_SANS_BRIQUE",
        gravite: "avertissement",
        regle: null,
        chemin: `etapes.${e.code}`,
        message: `L'étape « ${e.libelle} » ne contient aucune brique.`,
      });
    }
  }
  for (const b of contenu.briques) {
    if (b.moteur && !(CODES_MOTEURS_STANDARD as readonly string[]).includes(b.moteur)) {
      anomalies.push({
        code: "MOTEUR_INCONNU",
        gravite: "erreur",
        regle: null,
        chemin: `briques.${b.code}.moteur`,
        message: `Moteur inconnu : ${b.moteur}.`,
      });
    }
    const max = NIVEAU_MAX_PAR_CLASSE[b.classe_risque];
    if (RANG_NIVEAU[b.niveau_autonomie_max] > RANG_NIVEAU[max]) {
      anomalies.push({
        code: "AUTONOMIE_INCOMPATIBLE",
        gravite: "erreur",
        regle: null,
        chemin: `briques.${b.code}.niveau_autonomie_max`,
        message: `Brique « ${b.libelle} » de classe ${b.classe_risque} : autonomie ${max} au plus.`,
      });
    }
  }
  return anomalies;
}

export interface ValidationVersion {
  valide: boolean;
  anomalies: AnomalieVersion[];
  cas_types: ReturnType<typeof executerCas> | null;
}

/** Valide une version : structure, règles et cas types. Ne lève pas. */
export function validerVersion(
  contenu: ContenuMethode,
  facteurs: readonly FacteurLigne[],
): ValidationVersion {
  const anomalies: AnomalieVersion[] = [...anomaliesStructure(contenu)];
  const regles = validerReglesModulation(reglesDe(contenu), referentielVersion(contenu, facteurs));
  anomalies.push(
    ...regles.anomalies.map((a) => ({
      code: a.code,
      gravite: a.gravite,
      regle: a.regle,
      chemin: a.chemin,
      message: a.message,
    })),
  );
  let cas: ValidationVersion["cas_types"] = null;
  if (contenu.regles.length > 0 && contenu.cas_types.length === 0) {
    anomalies.push({
      code: "AUCUN_CAS_TYPE",
      gravite: "avertissement",
      regle: null,
      chemin: "cas_types",
      message: "Aucun cas type ne teste les règles de modulation.",
    });
  }
  if (regles.valide && contenu.cas_types.length > 0) {
    try {
      cas = executerCas(contenu);
      for (const c of cas.cas.filter((x) => !x.reussi)) {
        anomalies.push({
          code: "CAS_TYPE_ECHOUE",
          gravite: "erreur",
          regle: null,
          chemin: `cas_types.${c.code}`,
          message: `Le cas type « ${c.code} » ne donne pas le résultat attendu.`,
        });
      }
    } catch (e) {
      if (!(e instanceof ErreurModulation)) throw e;
      anomalies.push({
        code: e.code,
        gravite: "erreur",
        regle: null,
        chemin: e.chemin || "cas_types",
        message: e.message,
      });
    }
  }
  return { valide: anomalies.every((a) => a.gravite !== "erreur"), anomalies, cas_types: cas };
}
