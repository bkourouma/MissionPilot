/**
 * Taux de vente négociés par client et par grade (FIN-02) : logique pure, testée dans
 * `taux-clients.test.ts`. Grille de taux confidentielle : rien n'est demandé, rendu ni
 * envoyé sans « finance.lire » ET « taux.gerer » (miroir de `routes/taux-clients.ts`).
 */
import { aPermission, type Role } from "@missionpilot/shared";
import { DEVISES, type Devise } from "./format";
import { estDateIso } from "./semaine";
import { lireMontant, montantVersSaisie, type Resultat } from "./saisie";

export interface TauxClient {
  id: string;
  client_id: string;
  grade_id: string;
  grade_code: string;
  grade_libelle: string;
  taux: number;
  devise: Devise;
  valide_du: string | null;
  valide_au: string | null;
  cree_le: string;
  modifie_le: string;
}

export const voitTauxNegocies = (roles: readonly Role[]) =>
  aPermission(roles, "finance.lire") && aPermission(roles, "taux.gerer");

/** Onglets de la fiche client : les taux négociés n'apparaissent qu'avec ces deux droits. */
export function ongletsClient(id: string, roles: readonly Role[]) {
  return [
    { id: "fiche", libelle: "Fiche", href: `/clients/${id}` },
    ...(voitTauxNegocies(roles)
      ? [{ id: "taux", libelle: "Taux négociés", href: `/clients/${id}/taux` }]
      : []),
  ];
}

export interface SaisieTaux {
  grade_id: string;
  taux: string;
  devise: string;
  valide_du: string;
  valide_au: string;
}

export type ChampTaux = keyof SaisieTaux;

export const saisieTauxVide = (devise: Devise): SaisieTaux => ({
  grade_id: "",
  taux: "",
  devise,
  valide_du: "",
  valide_au: "",
});

export function saisieDepuisTaux(t: TauxClient): SaisieTaux {
  return {
    grade_id: t.grade_id,
    taux: montantVersSaisie(t.taux, t.devise),
    devise: t.devise,
    valide_du: t.valide_du ?? "",
    valide_au: t.valide_au ?? "",
  };
}

const dateOuVide = (d: string) =>
  d === "" || (estDateIso(d) && d >= "2000-01-01" && d <= "2100-12-31");

function verifierValidite(s: SaisieTaux, erreurs: Partial<Record<ChampTaux, string>>) {
  if (!dateOuVide(s.valide_du)) erreurs.valide_du = "Date invalide.";
  if (!dateOuVide(s.valide_au)) erreurs.valide_au = "Date invalide.";
  if (!erreurs.valide_du && !erreurs.valide_au && s.valide_du && s.valide_au)
    if (s.valide_au < s.valide_du) erreurs.valide_au = "La fin de validité précède son début.";
}

/** Nouveau taux : grade, montant journalier (unités mineures), devise, validité facultative. */
export function validerTaux(s: SaisieTaux): Resultat<
  {
    grade_id: string;
    taux: number;
    devise: Devise;
    valide_du: string | null;
    valide_au: string | null;
  },
  ChampTaux
> {
  const erreurs: Partial<Record<ChampTaux, string>> = {};
  if (s.grade_id === "") erreurs.grade_id = "Choisissez le grade.";
  const devise = (DEVISES as readonly string[]).includes(s.devise) ? (s.devise as Devise) : null;
  if (!devise) erreurs.devise = "Choisissez la devise.";
  const taux = devise ? lireMontant(s.taux, devise) : null;
  if (taux === null || Number.isNaN(taux)) erreurs.taux = "Taux journalier positif ou nul.";
  verifierValidite(s, erreurs);
  if (Object.keys(erreurs).length > 0 || !devise) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      grade_id: s.grade_id,
      taux: taux as number,
      devise,
      valide_du: s.valide_du || null,
      valide_au: s.valide_au || null,
    },
  };
}

/** Modification : taux et validité (grade et devise sont figés). */
export function validerModificationTaux(
  s: SaisieTaux,
  devise: Devise,
): Resultat<{ taux: number; valide_du: string | null; valide_au: string | null }, ChampTaux> {
  const erreurs: Partial<Record<ChampTaux, string>> = {};
  const taux = lireMontant(s.taux, devise);
  if (taux === null || Number.isNaN(taux)) erreurs.taux = "Taux journalier positif ou nul.";
  verifierValidite(s, erreurs);
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      taux: taux as number,
      valide_du: s.valide_du || null,
      valide_au: s.valide_au || null,
    },
  };
}
