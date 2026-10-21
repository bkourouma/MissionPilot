/**
 * Redressement, onglet « Diagnostic » : de la saisie d'un formulaire au corps d'API (réponses de
 * check-list, cartographie des causes, modèles de check-list). Contrôles de forme avec messages
 * en français ; l'API revalide tout. Aucun calcul métier. Logique pure, testée dans
 * `redressement-diagnostic-saisie.test.ts`.
 */
import {
  RED_CAUSE_DESCRIPTION_MAX,
  RED_CAUSE_LIBELLE_MAX,
  RED_CAUSES_CONTEXTE_MAX,
  RED_CAUSES_MAX,
  RED_CHECKLIST_AIDE_MAX,
  RED_CHECKLIST_COMMENTAIRE_MAX,
  RED_CHECKLIST_ITEMS_MAX,
  RED_CHECKLIST_LIBELLE_MAX,
  RED_CHECKLIST_MOTIF_CODE,
  RED_CHECKLIST_PLAFONDS,
  RED_CHECKLIST_REPONSES,
  RED_DOMAINES,
  RED_NIVEAUX_CONFIANCE_CAUSE,
  RED_SECTEURS,
  type RedCauseEntree,
  type RedCauseVue,
  type RedChecklistItem,
  type RedChecklistItemVue,
  type RedChecklistModeleCreation,
  type RedChecklistReponse,
  type RedChecklistReponseSaisie,
  type RedChecklistReponseVue,
  type RedDomaine,
  type RedNiveauConfianceCause,
  type RedSecteur,
} from "@missionpilot/shared";
import { texteOuNull, type Resultat } from "./saisie";

// --- Réponses d'une check-list ----------------------------------------------------------------------

export interface SaisieReponseItem {
  /** Vide : pas de réponse choisie. */
  reponse: RedChecklistReponse | "";
  commentaire: string;
}
export type SaisieReponses = Record<string, SaisieReponseItem>;

/** Saisie de départ : les réponses courantes de l'API, les autres items vides. */
export function saisieReponsesDepuis(
  items: readonly RedChecklistItemVue[],
  courantes: readonly RedChecklistReponseVue[],
): SaisieReponses {
  const parItem = new Map(courantes.map((r) => [r.item_id, r]));
  return Object.fromEntries(
    items.map((i) => {
      const c = parItem.get(i.id);
      return [i.id, { reponse: c?.reponse ?? "", commentaire: c?.commentaire ?? "" }];
    }),
  );
}

/** Découpe en lots du plafond de l'API (40 réponses par envoi). */
export function decouperEnLots<T>(liste: readonly T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}

export const MSG_AUCUNE_REPONSE_MODIFIEE = "Aucune réponse n'a changé : rien à enregistrer.";
export const MSG_COMMENTAIRE_SANS_REPONSE =
  "Choisissez une réponse avant de saisir un commentaire.";

/**
 * Réponses MODIFIÉES (nouvelle réponse ou nouveau commentaire) regroupées en lots d'au plus 40.
 * Les erreurs sont indexées par identifiant d'item ; la clé « global » porte l'absence de
 * changement.
 */
export function corpsReponses(
  items: readonly RedChecklistItemVue[],
  saisie: SaisieReponses,
  courantes: readonly RedChecklistReponseVue[],
): Resultat<{ reponses: RedChecklistReponseSaisie[] }[]> {
  const parItem = new Map(courantes.map((r) => [r.item_id, r]));
  const erreurs: Record<string, string> = {};
  const modifiees: RedChecklistReponseSaisie[] = [];
  for (const item of items) {
    const s = saisie[item.id];
    if (!s) continue;
    const commentaire = texteOuNull(s.commentaire);
    if (s.reponse === "") {
      if (commentaire !== null) erreurs[item.id] = MSG_COMMENTAIRE_SANS_REPONSE;
      continue;
    }
    if (!(RED_CHECKLIST_REPONSES as readonly string[]).includes(s.reponse)) {
      erreurs[item.id] = "Réponse inconnue.";
      continue;
    }
    if (commentaire !== null && commentaire.length > RED_CHECKLIST_COMMENTAIRE_MAX) {
      erreurs[item.id] =
        `Commentaire trop long (${RED_CHECKLIST_COMMENTAIRE_MAX} caractères au plus).`;
      continue;
    }
    const c = parItem.get(item.id);
    if (c && c.reponse === s.reponse && (c.commentaire ?? null) === commentaire) continue;
    modifiees.push({
      item_id: item.id,
      reponse: s.reponse,
      ...(commentaire !== null ? { commentaire } : {}),
    });
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  if (modifiees.length === 0)
    return { ok: false, erreurs: { global: MSG_AUCUNE_REPONSE_MODIFIEE } };
  return {
    ok: true,
    charge: decouperEnLots(modifiees, RED_CHECKLIST_PLAFONDS.reponses_par_lot).map((reponses) => ({
      reponses,
    })),
  };
}

// --- Cartographie des causes ------------------------------------------------------------------------

export interface SaisieCause {
  /** Identifiant « cNN » d'une cause existante ; absent pour une cause ajoutée. */
  id?: string;
  domaine: RedDomaine;
  libelle: string;
  description: string;
  confiance: RedNiveauConfianceCause | "";
}

export const saisieCausesDepuis = (causes: readonly RedCauseVue[]): SaisieCause[] =>
  causes.map((c) => ({
    id: c.id,
    domaine: c.domaine,
    libelle: c.libelle,
    description: c.description,
    confiance: c.confiance ?? "",
  }));

export const causeVide = (): SaisieCause => ({
  domaine: RED_DOMAINES[0],
  libelle: "",
  description: "",
  confiance: "",
});

/** Cartographie complète (elle remplace la précédente) ; erreurs « <index>.<champ> » ou « global ». */
export function corpsCauses(
  saisie: readonly SaisieCause[],
): Resultat<{ causes: RedCauseEntree[] }> {
  const erreurs: Record<string, string> = {};
  if (saisie.length === 0) erreurs.global = "Ajoutez au moins une cause.";
  if (saisie.length > RED_CAUSES_MAX) {
    erreurs.global = `Une cartographie compte ${RED_CAUSES_MAX} causes au plus.`;
  }
  const causes: RedCauseEntree[] = [];
  saisie.forEach((s, i) => {
    const libelle = s.libelle.trim();
    const description = s.description.trim();
    if (libelle === "") erreurs[`${i}.libelle`] = "Le libellé est obligatoire.";
    else if (libelle.length > RED_CAUSE_LIBELLE_MAX) {
      erreurs[`${i}.libelle`] = `Libellé trop long (${RED_CAUSE_LIBELLE_MAX} caractères au plus).`;
    }
    if (description === "") erreurs[`${i}.description`] = "La description est obligatoire.";
    else if (description.length > RED_CAUSE_DESCRIPTION_MAX) {
      erreurs[`${i}.description`] =
        `Description trop longue (${RED_CAUSE_DESCRIPTION_MAX} caractères au plus).`;
    }
    if (!(RED_DOMAINES as readonly string[]).includes(s.domaine)) {
      erreurs[`${i}.domaine`] = "Domaine inconnu.";
    }
    if (
      s.confiance !== "" &&
      !(RED_NIVEAUX_CONFIANCE_CAUSE as readonly string[]).includes(s.confiance)
    ) {
      erreurs[`${i}.confiance`] = "Niveau de confiance inconnu.";
    }
    causes.push({
      ...(s.id ? { id: s.id } : {}),
      domaine: s.domaine,
      libelle,
      description,
      confiance: s.confiance === "" ? null : s.confiance,
    });
  });
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { causes } };
}

/** Corps de la demande de proposition : le contexte libre est facultatif. */
export function corpsGenerationCauses(contexte: string): Resultat<{ contexte?: string }> {
  const t = texteOuNull(contexte);
  if (t !== null && t.length > RED_CAUSES_CONTEXTE_MAX) {
    return {
      ok: false,
      erreurs: { contexte: `Contexte trop long (${RED_CAUSES_CONTEXTE_MAX} caractères au plus).` },
    };
  }
  return { ok: true, charge: t === null ? {} : { contexte: t } };
}

// --- Modèles de check-list --------------------------------------------------------------------------

export interface SaisieItemModele {
  /** Identifiant stable : conservé d'une version à l'autre, attribué automatiquement pour un ajout. */
  id: string;
  domaine: RedDomaine;
  libelle: string;
  aide: string;
}

export const saisieItemsDepuis = (items: readonly RedChecklistItemVue[]): SaisieItemModele[] =>
  items.map((i) => ({ id: i.id, domaine: i.domaine, libelle: i.libelle, aide: i.aide ?? "" }));

/** Plus petit « iNN » libre. */
export function prochainIdItem(items: readonly { id: string }[]): string {
  const pris = new Set(items.map((i) => i.id));
  for (let n = 1; n <= RED_CHECKLIST_ITEMS_MAX + items.length; n += 1) {
    const id = `i${String(n).padStart(2, "0")}`;
    if (!pris.has(id)) return id;
  }
  return `i${items.length + 1}`;
}

export const itemVide = (existants: readonly { id: string }[]): SaisieItemModele => ({
  id: prochainIdItem(existants),
  domaine: RED_DOMAINES[0],
  libelle: "",
  aide: "",
});

function itemsDepuisSaisie(
  saisie: readonly SaisieItemModele[],
  erreurs: Record<string, string>,
): RedChecklistItem[] {
  if (saisie.length === 0) erreurs.global = "Ajoutez au moins un item.";
  if (saisie.length > RED_CHECKLIST_ITEMS_MAX) {
    erreurs.global = `Un modèle compte ${RED_CHECKLIST_ITEMS_MAX} items au plus.`;
  }
  const items: RedChecklistItem[] = [];
  saisie.forEach((s, i) => {
    const libelle = s.libelle.trim();
    const aide = texteOuNull(s.aide);
    if (libelle === "") erreurs[`${i}.libelle`] = "Le libellé est obligatoire.";
    else if (libelle.length > RED_CHECKLIST_LIBELLE_MAX) {
      erreurs[`${i}.libelle`] =
        `Libellé trop long (${RED_CHECKLIST_LIBELLE_MAX} caractères au plus).`;
    }
    if (aide !== null && aide.length > RED_CHECKLIST_AIDE_MAX) {
      erreurs[`${i}.aide`] = `Aide trop longue (${RED_CHECKLIST_AIDE_MAX} caractères au plus).`;
    }
    items.push({ id: s.id, domaine: s.domaine, libelle, ...(aide !== null ? { aide } : {}) });
  });
  return items;
}

/** Nouvelle version (brouillon) d'un modèle existant. */
export function corpsVersionModele(
  saisie: readonly SaisieItemModele[],
  motif: string,
): Resultat<{ items: RedChecklistItem[]; motif?: string }> {
  const erreurs: Record<string, string> = {};
  const items = itemsDepuisSaisie(saisie, erreurs);
  const m = texteOuNull(motif);
  if (m !== null && m.length > 500) erreurs.motif = "Motif trop long (500 caractères au plus).";
  return Object.keys(erreurs).length > 0
    ? { ok: false, erreurs }
    : { ok: true, charge: { items, ...(m !== null ? { motif: m } : {}) } };
}

export interface SaisieNouveauModele {
  code: string;
  intitule: string;
  secteur: RedSecteur;
  motif: string;
}

/** Nouveau modèle du cabinet. */
export function corpsNouveauModele(
  entete: SaisieNouveauModele,
  saisie: readonly SaisieItemModele[],
): Resultat<RedChecklistModeleCreation> {
  const erreurs: Record<string, string> = {};
  const code = entete.code.trim();
  const intitule = entete.intitule.trim();
  if (!RED_CHECKLIST_MOTIF_CODE.test(code)) {
    erreurs.code =
      "Code de 2 à 40 caractères : minuscules, chiffres, tiret ou tiret bas (ex. commerce-2026).";
  }
  if (intitule === "") erreurs.intitule = "L'intitulé est obligatoire.";
  else if (intitule.length > 200) erreurs.intitule = "Intitulé trop long (200 caractères au plus).";
  if (!(RED_SECTEURS as readonly string[]).includes(entete.secteur)) {
    erreurs.secteur = "Secteur inconnu.";
  }
  const items = itemsDepuisSaisie(saisie, erreurs);
  const m = texteOuNull(entete.motif);
  if (m !== null && m.length > 500) erreurs.motif = "Motif trop long (500 caractères au plus).";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { code, intitule, secteur: entete.secteur, items, ...(m !== null ? { motif: m } : {}) },
  };
}

// --- Activation dans un dossier ---------------------------------------------------------------------

/** Valeur d'option « depart:<code> » ou « modele:<id> » → corps d'activation ; vide ou inconnue → erreur. */
export function corpsActivation(choix: string):
  | {
      ok: true;
      charge: { origine: "depart"; code: string } | { origine: "modele"; modele_id: string };
    }
  | { ok: false; erreur: string } {
  const [origine, ...reste] = choix.split(":");
  const valeur = reste.join(":");
  if (origine === "depart" && valeur !== "") {
    return { ok: true, charge: { origine: "depart", code: valeur } };
  }
  if (origine === "modele" && valeur !== "") {
    return { ok: true, charge: { origine: "modele", modele_id: valeur } };
  }
  return { ok: false, erreur: "Choisissez une check-list à activer." };
}
