/**
 * Noyau pur du débloqueur de rendu (lot 13a, anomalies A-04 et R-02 ; voir
 * `docs/workflows/notes-lots/lot-13a.md`).
 *
 * Cause démontrée : avec le React embarqué par Next 15.5 (19.2.0-canary-0bdb9206), une
 * transition du routeur (`router.refresh()`, navigation par `<Link>`) qui suspend sous une
 * frontière `<Suspense>` déjà affichée (les `loading.tsx`) sur un morceau du flux RSC arrivé
 * entre-temps (statut Flight `resolved_model`) perd son « ping » : `then()` initialise le
 * morceau et rappelle React de façon synchrone pendant le rendu, React ignore ce rappel (rendu
 * déjà marqué « suspendu avec délai ») puis marque la voie suspendue. Les données sont là, mais
 * plus rien ne relance le rendu : l'ancien écran reste affiché jusqu'à la prochaine mise à jour
 * d'état, quelle qu'elle soit (frappe, minuterie de 8 s, cloche des notifications à 60 s).
 *
 * Contournement : après chaque réponse susceptible d'alimenter un rendu du routeur (flux RSC
 * `?_rsc=`, morceau JavaScript de `/_next/static/chunks/`), provoquer quelques mises à jour
 * d'état minuscules et non transitoires. Chacune efface l'état « suspendu » de la racine : React
 * reprend la transition en attente, qui aboutit puisque les données sont arrivées. Aucune
 * requête n'est émise ; sans transition bloquée, React ne fait que re-rendre un composant vide.
 */

/** Délais (ms) des relances après chaque réponse observée. */
export const PAS_DEBLOCAGE_MS: readonly number[] = [40, 150, 400, 1000];

/** Deux échéances plus proches que cet écart sont fusionnées (rafales de préchargements). */
export const ECART_FUSION_MS = 25;

/**
 * Vrai pour une ressource dont l'arrivée peut terminer un rendu du routeur : réponse RSC de la
 * même origine (`?_rsc=` ou `&_rsc=`) ou morceau JavaScript de Next (`/_next/static/chunks/`).
 */
export function estRessourceDeRendu(nom: string, origine: string): boolean {
  let url: URL;
  try {
    url = new URL(nom, origine);
  } catch {
    return false;
  }
  if (url.origin !== origine) return false;
  return url.searchParams.has("_rsc") || url.pathname.startsWith("/_next/static/chunks/");
}

/**
 * Ajoute les échéances `maintenant + pas` à la liste triée `echeances`, sans doublon à moins de
 * `ecart` ms d'une échéance existante. Rend une nouvelle liste triée.
 */
export function ajouterEcheances(
  echeances: readonly number[],
  maintenant: number,
  pas: readonly number[] = PAS_DEBLOCAGE_MS,
  ecart: number = ECART_FUSION_MS,
): number[] {
  const resultat = [...echeances];
  for (const p of pas) {
    const t = maintenant + p;
    if (!resultat.some((e) => Math.abs(e - t) < ecart)) resultat.push(t);
  }
  return resultat.sort((a, b) => a - b);
}

export interface Horloge {
  maintenant: () => number;
  planifier: (action: () => void, delaiMs: number) => unknown;
  annuler: (poignee: unknown) => void;
}

const horlogeNavigateur: Horloge = {
  maintenant: () => Date.now(),
  planifier: (action, delaiMs) => setTimeout(action, delaiMs),
  annuler: (poignee) => clearTimeout(poignee as ReturnType<typeof setTimeout>),
};

export interface Debloqueur {
  /** Une ressource de rendu vient d'arriver : programme les relances. */
  signaler: () => void;
  /** Annule toute relance programmée. */
  arreter: () => void;
}

/**
 * Programme `relancer` à chaque échéance (une seule minuterie active, échéances fusionnées) ;
 * une échéance atteinte appelle `relancer` une fois, même si plusieurs sont échues ensemble.
 */
export function creerDebloqueur(
  relancer: () => void,
  options: { pas?: readonly number[]; ecart?: number; horloge?: Horloge } = {},
): Debloqueur {
  const horloge = options.horloge ?? horlogeNavigateur;
  const pas = options.pas ?? PAS_DEBLOCAGE_MS;
  const ecart = options.ecart ?? ECART_FUSION_MS;
  let echeances: number[] = [];
  let poignee: unknown = null;
  let prochaine: number | null = null;

  const armer = () => {
    const premiere = echeances[0];
    if (premiere === undefined) return;
    if (prochaine === premiere && poignee !== null) return;
    if (poignee !== null) horloge.annuler(poignee);
    prochaine = premiere;
    poignee = horloge.planifier(
      () => {
        poignee = null;
        prochaine = null;
        const t = horloge.maintenant();
        // Tout ce qui est échu part ensemble : une seule relance.
        echeances = echeances.filter((e) => e > t);
        relancer();
        armer();
      },
      Math.max(0, premiere - horloge.maintenant()),
    );
  };

  return {
    signaler: () => {
      echeances = ajouterEcheances(echeances, horloge.maintenant(), pas, ecart);
      armer();
    },
    arreter: () => {
      if (poignee !== null) horloge.annuler(poignee);
      poignee = null;
      prochaine = null;
      echeances = [];
    },
  };
}
