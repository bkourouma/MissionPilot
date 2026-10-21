import { synthetiserApercu, type SyntheseApercu } from "@missionpilot/engines";
import type { ContexteModulationApi } from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { lireContenu, sansIdentifiants } from "./contenu.js";
import { appliquer, exigerContexteValide, lireFacteurs, resultatApi } from "./modulation.js";
import { resoudreMethode, type MethodeEffective } from "./resolution.js";

/*
 * Aperçu de la mission générée par une version de méthode pour un contexte donné (STD-11).
 * N'écrit RIEN : mêmes règles (`appliquer`) et même résolution (`resoudreMethode`, sans
 * dérogation) que la méthode effective d'une mission liée à cette version avec ce contexte.
 * Visible pour un brouillon, une version du cabinet ou une version du standard.
 */

export interface ApercuMission {
  version: {
    id: string;
    version: number;
    statut: string;
    methode_id: string;
    methode_libelle: string;
  };
  contexte: ContexteModulationApi;
  regles_declenchees: string[];
  conflits: ReturnType<typeof resultatApi>["conflits"];
  journal: ReturnType<typeof resultatApi>["journal"];
  methode: MethodeEffective;
  synthese: SyntheseApercu;
}

export async function apercuMission(
  db: Db,
  versionId: string,
  contexte: ContexteModulationApi,
): Promise<ApercuMission> {
  const stocke = await lireContenu(db, versionId);
  const valide = exigerContexteValide(await lireFacteurs(db), contexte);
  const contenu = sansIdentifiants(stocke);
  const resultat = resultatApi(appliquer(contenu, valide));
  const methode = resoudreMethode(contenu, resultat, []);
  const briques = methode.etapes.flatMap((e) =>
    e.briques.map((b) => ({
      code: b.code,
      etape_code: e.code,
      active: b.active,
      classe_risque: b.classe_risque,
      temps_type_jours: b.temps_type_jours,
    })),
  );
  const elements = methode.elements.map((el) => ({ type: el.type, actif: el.actif }));
  return {
    version: {
      id: stocke.version.id,
      version: stocke.version.version,
      statut: stocke.version.statut,
      methode_id: stocke.methode.id,
      methode_libelle: stocke.methode.libelle,
    },
    contexte,
    regles_declenchees: [...resultat.regles_declenchees],
    conflits: resultat.conflits,
    journal: resultat.journal,
    methode,
    synthese: synthetiserApercu(briques, elements),
  };
}
