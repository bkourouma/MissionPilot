/** Services candidats : saisie et résultat du rapprochement (module extrait de `services-candidats.ts`). */
import { UUID, estDevise, lireEntier } from "./services-candidats-outils";
import type { ResultatRapprochement, StatutRapprochement } from "./services-candidats-types";
import { OBJETS_FINANCEMENT, type ObjetFinancement } from "@missionpilot/shared";
import { type Devise } from "./format";
import { decouperListe, texteOuNull, type Resultat } from "./saisie";

export interface SaisieRapprochement {
  client_id: string;
  pays: string;
  secteur: string;
  filieres: string;
  taille: string;
  objet: string;
  montant: string;
  devise: string;
}
export type ChampRapprochement = keyof SaisieRapprochement;

export const SAISIE_RAPPROCHEMENT_VIDE: SaisieRapprochement = {
  client_id: "",
  pays: "",
  secteur: "",
  filieres: "",
  taille: "",
  objet: "",
  montant: "",
  devise: "",
};

export interface CorpsRapprochement {
  client_id?: string;
  profil?: {
    pays?: string;
    secteur?: string;
    filieres?: string[];
    taille?: string;
    objet?: ObjetFinancement;
    montant?: number;
    devise?: Devise;
  };
}

/** Corps de POST /api/guichets-financement/rapprochement : seules les surcharges renseignées. */
export function validerRapprochement(
  s: SaisieRapprochement,
): Resultat<CorpsRapprochement, ChampRapprochement> {
  const erreurs: Partial<Record<ChampRapprochement, string>> = {};
  if (s.client_id !== "" && !UUID.test(s.client_id))
    erreurs.client_id = "Choisissez dans la liste.";
  const profil: NonNullable<CorpsRapprochement["profil"]> = {};
  const pays = texteOuNull(s.pays);
  const secteur = texteOuNull(s.secteur);
  const taille = texteOuNull(s.taille);
  for (const [champ, v] of [
    ["pays", pays],
    ["secteur", secteur],
    ["taille", taille],
  ] as const) {
    if (v && v.length > 80) erreurs[champ] = "80 caractères au plus.";
  }
  if (pays) profil.pays = pays;
  if (secteur) profil.secteur = secteur;
  if (taille) profil.taille = taille;
  const filieres = decouperListe(s.filieres);
  if (filieres.length > 50 || filieres.some((f) => f.length > 80))
    erreurs.filieres = "50 éléments de 80 caractères au plus.";
  if (filieres.length > 0) profil.filieres = filieres;
  if (s.objet !== "") {
    if (!(OBJETS_FINANCEMENT as readonly string[]).includes(s.objet))
      erreurs.objet = "Choisissez un objet dans la liste.";
    else profil.objet = s.objet as ObjetFinancement;
  }
  const montant = lireEntier(s.montant);
  if (montant !== null) {
    if (Number.isNaN(montant)) erreurs.montant = "Montant entier positif attendu.";
    else profil.montant = montant;
  }
  if (s.devise !== "" && !estDevise(s.devise)) erreurs.devise = "Choisissez une devise.";
  else if (s.devise !== "") profil.devise = s.devise as Devise;
  if (montant !== null && !Number.isNaN(montant) && s.devise === "")
    erreurs.devise = "Précisez la devise du montant.";
  if (Object.keys(erreurs).length === 0 && s.client_id === "" && Object.keys(profil).length === 0) {
    erreurs.client_id = "Choisissez un client ou renseignez au moins un critère.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      ...(s.client_id !== "" ? { client_id: s.client_id } : {}),
      ...(Object.keys(profil).length > 0 ? { profil } : {}),
    },
  };
}

/** Nombre de résultats par statut, pour le résumé du rapprochement. */
export function compterParStatut(
  resultats: readonly Pick<ResultatRapprochement, "statut">[],
): Record<StatutRapprochement, number> {
  const c: Record<StatutRapprochement, number> = { compatible: 0, partiel: 0, exclu: 0 };
  for (const r of resultats) c[r.statut] += 1;
  return c;
}
