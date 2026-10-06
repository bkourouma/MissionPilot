/**
 * Balance âgée clients (FIN-09) à une date de référence donnée.
 *
 * L'âge d'une créance est le nombre de jours écoulés depuis sa date
 * d'échéance (par défaut) ou d'émission, à la date de référence. Tranches :
 * « non échu » (âge < 0, seulement en base échéance), 0-30, 31-60, 61-90 et
 * plus de 90 jours. Une créance soldée (solde nul) est ignorée ; un solde
 * négatif (avoir non imputé) est classé comme les autres et vient en déduction.
 */
import { joursEntre, type DateISO } from "./dates";
import { additionner, zero, type Devise, type Montant } from "./monnaie";

export interface Creance {
  readonly factureId: string;
  readonly clientId: string;
  readonly dateEmission: DateISO;
  readonly dateEcheance: DateISO;
  /** Reste à encaisser. */
  readonly solde: Montant;
}

export type TrancheAge = "nonEchu" | "j0a30" | "j31a60" | "j61a90" | "plus90";

export const TRANCHES_AGE: readonly TrancheAge[] = [
  "nonEchu",
  "j0a30",
  "j31a60",
  "j61a90",
  "plus90",
];

export type BalanceAgee = Readonly<Record<TrancheAge | "total", Montant>>;

export interface OptionsBalanceAgee {
  readonly dateReference: DateISO;
  readonly devise: Devise;
  readonly base?: "echeance" | "emission";
}

/** Tranche d'une créance d'âge `age` jours. */
export function trancheAge(age: number): TrancheAge {
  if (age < 0) return "nonEchu";
  if (age <= 30) return "j0a30";
  if (age <= 60) return "j31a60";
  if (age <= 90) return "j61a90";
  return "plus90";
}

function balanceVide(devise: Devise): Record<TrancheAge | "total", Montant> {
  const vide = zero(devise);
  return { nonEchu: vide, j0a30: vide, j31a60: vide, j61a90: vide, plus90: vide, total: vide };
}

/** Balance âgée globale. Les soldes doivent être dans `devise` (convertir avant). */
export function balanceAgee(
  creances: readonly Creance[],
  options: OptionsBalanceAgee,
): BalanceAgee {
  const balance = balanceVide(options.devise);
  for (const c of creances) {
    if (c.solde.valeur === 0) continue;
    const depart = options.base === "emission" ? c.dateEmission : c.dateEcheance;
    const tranche = trancheAge(joursEntre(depart, options.dateReference));
    balance[tranche] = additionner(balance[tranche], c.solde);
    balance.total = additionner(balance.total, c.solde);
  }
  return balance;
}

/** Balance âgée par client, triée par identifiant de client. */
export function balanceAgeeParClient(
  creances: readonly Creance[],
  options: OptionsBalanceAgee,
): { readonly clientId: string; readonly balance: BalanceAgee }[] {
  const clients = [...new Set(creances.map((c) => c.clientId))].sort();
  return clients.map((clientId) => ({
    clientId,
    balance: balanceAgee(
      creances.filter((c) => c.clientId === clientId),
      options,
    ),
  }));
}
