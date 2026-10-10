import { redirect } from "next/navigation";
import { droitsAppelsOffres, type FicheAo } from "./appels-offres";
import { chargerServeur } from "./api-serveur";
import { choixCv, choixFiches, type ChoixListe, type CvResume } from "./banque-ao";
import { chargerToutesLesPages } from "./pagination";
import { obtenirSession, type Session } from "./session";

/**
 * Garde serveur des écrans d'appels d'offres : consulter exige `ao.lire` (comme l'API) ; les
 * actions sont proposées selon `droitsAppelsOffres` et jugées par l'API. À n'importer que côté
 * serveur.
 */
export async function exigerLectureAo(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsAppelsOffres(session.utilisateur.roles).lire) redirect("/acces-refuse");
  return session;
}

/** Chemins et plafonds de `limite` des listes de choix (API : 100 au plus par page). */
const LIMITE_LISTE_AO = 100;

/**
 * Listes de choix de l'offre technique : CV de la banque et fiches d'appels d'offres, toutes les
 * pages (plafond de page 100, celui des deux routes). Une liste en échec reste vide : le
 * formulaire se règle sur ce qui est disponible. À n'importer que côté serveur.
 */
export async function chargerChoixOffreTechnique(): Promise<{
  cv: ChoixListe[];
  fiches: ChoixListe[];
}> {
  const [cv, fiches] = await Promise.all([
    chargerToutesLesPages<CvResume>(
      async (chemin) => {
        const r = await chargerServeur<{ elements: CvResume[]; curseur_suivant: string | null }>(
          chemin,
        );
        return r.ok
          ? {
              ok: true,
              donnees: { elements: r.donnees.elements, suivant: r.donnees.curseur_suivant },
            }
          : r;
      },
      "/api/banque-ao/cv",
      { limiteMax: LIMITE_LISTE_AO },
    ),
    chargerToutesLesPages<FicheAo>(chargerServeur, "/api/appels-offres", {
      limiteMax: LIMITE_LISTE_AO,
    }),
  ]);
  return {
    cv: cv.ok ? choixCv(cv.donnees.elements) : [],
    fiches: fiches.ok ? choixFiches(fiches.donnees.elements) : [],
  };
}
