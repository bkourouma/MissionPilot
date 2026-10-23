import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ajouterEcheances,
  creerDebloqueur,
  ECART_FUSION_MS,
  estRessourceDeRendu,
  PAS_DEBLOCAGE_MS,
  type Horloge,
} from "./debloqueur";

const ORIGINE = "http://127.0.0.1:3110";

describe("estRessourceDeRendu", () => {
  it("retient les réponses RSC de la même origine", () => {
    expect(estRessourceDeRendu(`${ORIGINE}/appels-offres/veille?_rsc=UvcEd`, ORIGINE)).toBe(true);
    expect(estRessourceDeRendu(`${ORIGINE}/missions/1?onglet=a&_rsc=x1`, ORIGINE)).toBe(true);
  });

  it("retient les morceaux JavaScript de Next (composants client chargés à la navigation)", () => {
    expect(estRessourceDeRendu(`${ORIGINE}/_next/static/chunks/45951-205f.js`, ORIGINE)).toBe(true);
  });

  it("ignore les appels d'API, les feuilles de style, les images et les autres origines", () => {
    expect(estRessourceDeRendu(`${ORIGINE}/api/appels-offres/veille/avis`, ORIGINE)).toBe(false);
    expect(estRessourceDeRendu(`${ORIGINE}/_next/static/css/0cade.css`, ORIGINE)).toBe(false);
    expect(estRessourceDeRendu(`${ORIGINE}/icon.svg`, ORIGINE)).toBe(false);
    expect(estRessourceDeRendu("https://exemple.test/page?_rsc=1", ORIGINE)).toBe(false);
    // Paramètre voisin dont le nom contient « _rsc » : pas une réponse RSC.
    expect(estRessourceDeRendu(`${ORIGINE}/page?x_rsc=1`, ORIGINE)).toBe(false);
  });

  it("ignore un nom illisible sans lever d'erreur", () => {
    expect(estRessourceDeRendu("http://[mal-forme", ORIGINE)).toBe(false);
  });
});

describe("ajouterEcheances", () => {
  it("programme une échéance par pas, triées", () => {
    expect(ajouterEcheances([], 1000, [40, 150, 400])).toEqual([1040, 1150, 1400]);
  });

  it("fusionne les échéances trop proches d'une existante (rafale de préchargements)", () => {
    const premiere = ajouterEcheances([], 1000, [40, 150]);
    // 10 ms plus tard : 1050 et 1160 sont à moins de 25 ms de 1040 et 1150.
    expect(ajouterEcheances(premiere, 1010, [40, 150], 25)).toEqual([1040, 1150]);
    // 100 ms plus tard : 1140 est fusionnée avec 1150, 1250 est nouvelle.
    expect(ajouterEcheances(premiere, 1100, [40, 150], 25)).toEqual([1040, 1150, 1250]);
  });

  it("ne modifie pas la liste reçue", () => {
    const liste = [5];
    ajouterEcheances(liste, 0, [40]);
    expect(liste).toEqual([5]);
  });
});

describe("creerDebloqueur", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("relance aux pas par défaut après une réponse, puis plus rien", () => {
    const relancer = vi.fn();
    const d = creerDebloqueur(relancer);
    d.signaler();
    const instants: number[] = [];
    relancer.mockImplementation(() => instants.push(Date.now()));
    vi.advanceTimersByTime(10_000);
    expect(instants).toEqual([...PAS_DEBLOCAGE_MS]);
    expect(relancer).toHaveBeenCalledTimes(PAS_DEBLOCAGE_MS.length);
  });

  it("borne les relances d'une rafale de signaux par la fusion des échéances", () => {
    const relancer = vi.fn();
    const d = creerDebloqueur(relancer, { pas: [40, 150, 400] });
    // Dix préchargements en 50 ms.
    for (let i = 0; i < 10; i++) {
      d.signaler();
      vi.advanceTimersByTime(5);
    }
    vi.advanceTimersByTime(10_000);
    // Sans fusion : 30 relances. Avec une fusion à 25 ms : au plus 2 par pas.
    expect(relancer.mock.calls.length).toBeLessThanOrEqual(6);
    expect(relancer.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("une seule relance quand plusieurs échéances sont échues ensemble", () => {
    const relancer = vi.fn();
    let maintenant = 0;
    const planifiees: { action: () => void; t: number }[] = [];
    const horloge: Horloge = {
      maintenant: () => maintenant,
      planifier: (action, delai) => {
        const p = { action, t: maintenant + delai };
        planifiees.push(p);
        return p;
      },
      annuler: (p) => {
        const i = planifiees.indexOf(p as (typeof planifiees)[number]);
        if (i >= 0) planifiees.splice(i, 1);
      },
    };
    const d = creerDebloqueur(relancer, { pas: [40, 150], horloge });
    d.signaler();
    // La minuterie de 40 ms part très en retard (onglet chargé) : 40 et 150 sont échues.
    maintenant = 500;
    const p = planifiees.shift();
    p?.action();
    expect(relancer).toHaveBeenCalledTimes(1);
    expect(planifiees).toHaveLength(0);
  });

  it("n'appelle plus rien une fois arrêté (démontage)", () => {
    const relancer = vi.fn();
    const d = creerDebloqueur(relancer);
    d.signaler();
    vi.advanceTimersByTime(PAS_DEBLOCAGE_MS[0] ?? 0);
    expect(relancer).toHaveBeenCalledTimes(1);
    d.arreter();
    vi.advanceTimersByTime(10_000);
    expect(relancer).toHaveBeenCalledTimes(1);
  });

  it("un signal reçu après les relances en reprogramme une série complète", () => {
    const relancer = vi.fn();
    const d = creerDebloqueur(relancer, { pas: [40, 150] });
    d.signaler();
    vi.advanceTimersByTime(1000);
    expect(relancer).toHaveBeenCalledTimes(2);
    d.signaler();
    vi.advanceTimersByTime(1000);
    expect(relancer).toHaveBeenCalledTimes(4);
  });

  it("garde des pas courts : la première relance part en moins de 100 ms", () => {
    expect(PAS_DEBLOCAGE_MS[0]).toBeLessThan(100);
    expect(ECART_FUSION_MS).toBeLessThan(PAS_DEBLOCAGE_MS[0] ?? 0);
  });
});
