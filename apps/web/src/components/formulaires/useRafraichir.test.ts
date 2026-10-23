import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attenteAffichee,
  autoriserRelance,
  DELAI_RELANCE_MS,
  DELAI_SECOURS_MS,
  planifierRelance,
  rafraichirEnTransition,
  reinitialiserRelances,
} from "./useRafraichir";

describe("rafraichirEnTransition", () => {
  it("n'appelle router.refresh() qu'à l'intérieur de la transition", () => {
    const refresh = vi.fn();
    let dansTransition = false;
    const demarrer = vi.fn((action: () => void) => {
      dansTransition = true;
      action();
      dansTransition = false;
    });
    refresh.mockImplementation(() => expect(dansTransition).toBe(true));
    rafraichirEnTransition(demarrer, { refresh });
    expect(demarrer).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("planifierRelance", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("relance une fois à 1,5 s puis lève l'attente à 8 s", () => {
    const relancer = vi.fn();
    const abandonner = vi.fn();
    planifierRelance({ relancer, abandonner });
    vi.advanceTimersByTime(DELAI_RELANCE_MS - 1);
    expect(relancer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(relancer).toHaveBeenCalledTimes(1);
    expect(abandonner).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAI_SECOURS_MS);
    expect(relancer).toHaveBeenCalledTimes(1);
    expect(abandonner).toHaveBeenCalledTimes(1);
  });

  it("n'agit plus une fois annulée (données arrivées)", () => {
    const relancer = vi.fn();
    const abandonner = vi.fn();
    const annuler = planifierRelance({ relancer, abandonner });
    annuler();
    vi.advanceTimersByTime(DELAI_SECOURS_MS * 2);
    expect(relancer).not.toHaveBeenCalled();
    expect(abandonner).not.toHaveBeenCalled();
  });
});

describe("attenteAffichee", () => {
  const base = { suivi: false, attenteCle: false, enTransition: true, abandonne: false };

  it("sans clé : suit la transition, levée à l'abandon (plafond de 8 s)", () => {
    expect(attenteAffichee(base)).toBe(true);
    expect(attenteAffichee({ ...base, abandonne: true })).toBe(false);
    expect(attenteAffichee({ ...base, enTransition: false })).toBe(false);
  });

  it("avec clé : attente demandée ou transition en cours", () => {
    expect(attenteAffichee({ ...base, suivi: true, enTransition: false, attenteCle: true })).toBe(
      true,
    );
    expect(attenteAffichee({ ...base, suivi: true, enTransition: false })).toBe(false);
  });
});

describe("autoriserRelance", () => {
  beforeEach(() => reinitialiserRelances());

  it("une seule relance par fenêtre pour toutes les instances du hook", () => {
    expect(autoriserRelance(10_000)).toBe(true);
    expect(autoriserRelance(10_003)).toBe(false);
    expect(autoriserRelance(10_499)).toBe(false);
    expect(autoriserRelance(10_500)).toBe(true);
  });
});
