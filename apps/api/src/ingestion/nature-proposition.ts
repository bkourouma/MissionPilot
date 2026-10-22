import { contientDonneeFinanciere } from "@missionpilot/engines";
import { aPermission, contenuPropositionSchema } from "@missionpilot/shared";
import { AppError, interdit, requeteInvalide } from "../errors.js";
import type { NatureExtractionApi } from "./natures.js";
import { appliquerProposition } from "./standard-application.js";

/*
 * Nature « standard_proposition » (STD-13, ADR-009 décision 10) : étapes, briques, éléments et rubriques
 * proposés pour un brouillon de méthode du cabinet.
 *
 * - Relecture (`validerContenu`) : schéma strict, bornes, page citée présente dans le document, codes
 *   uniques par famille (éléments : tous types confondus). Une proposition ne porte aucun chiffre :
 *   `contientNonVerifie` est toujours faux. FIN-02 : aucune entrée (libellé, objet, description, niveau, code) ne
 *   peut porter un taux ni des honoraires (`contientDonneeFinanciere`, moteur) : 400, y compris pour une
 *   correction humaine.
 * - Application (`appliquer`, à la validation, dans la transaction) : voir `standard-application.ts`. La
 *   version cible doit être encore un brouillon du cabinet (409 sinon, rien n'est appliqué). La publication
 *   de la méthode reste l'acte séparé de l'éditeur.
 */

export const natureProposition: NatureExtractionApi = {
  nature: "standard_proposition",

  validerContenu(contenu, pages) {
    const lu = contenuPropositionSchema.safeParse(contenu);
    if (!lu.success) {
      const chemin = lu.error.issues[0]?.path.join(".") ?? "";
      throw requeteInvalide(
        `Proposition de standard invalide${chemin ? ` (${chemin.slice(0, 60)})` : ""}.`,
      );
    }
    const numeros = new Set(pages.map((p) => p.numero));
    const c = lu.data;
    const citees = [
      ...c.etapes.map((x) => x.page),
      ...c.briques.map((x) => x.page),
      ...c.elements.map((x) => x.page),
      ...c.rubriques.map((x) => x.page),
    ];
    if (citees.some((p) => !numeros.has(p))) {
      throw requeteInvalide(
        "Proposition de standard : une page citée n'existe pas dans le document.",
      );
    }
    // Textes libres ET codes (code, etape_code, brique_code) : un identifiant « taux-journalier-500 » est
    // une donnée de gestion déguisée.
    const textes = [
      ...c.etapes.flatMap((x) => [x.libelle, x.code]),
      ...c.briques.flatMap((x) => [x.libelle, x.objet, x.code, x.etape_code]),
      ...c.elements.flatMap((x) => [x.libelle, x.description ?? "", x.code, x.brique_code ?? ""]),
      ...c.rubriques.flatMap((x) => [x.libelle, x.code, ...x.niveaux]),
    ];
    if (textes.some((t) => contientDonneeFinanciere(t))) {
      throw requeteInvalide(
        "Proposition de standard : une entrée (texte ou code) contient un taux ou des honoraires, données de gestion qui n'ont pas leur place dans le standard.",
      );
    }
    const unique = (liste: { code: string }[]) =>
      new Set(liste.map((x) => x.code)).size === liste.length;
    if (!unique(c.etapes) || !unique(c.briques) || !unique(c.elements) || !unique(c.rubriques)) {
      throw requeteInvalide(
        "Proposition de standard : un code est en double dans une même famille.",
      );
    }
    return c;
  },

  contientNonVerifie(): boolean {
    return false;
  },

  async appliquer(db, auth, extraction, document) {
    if (!aPermission(auth.roles, "standard.gerer")) throw interdit();
    if (document.usage !== "standard_historique" || document.version_methode_id === null) {
      throw new AppError(409, "CONFLIT", "Ce document ne cible aucune version de méthode.");
    }
    const lu = contenuPropositionSchema.safeParse(extraction.contenu);
    if (!lu.success) throw requeteInvalide("Proposition de standard invalide.");
    return appliquerProposition(db, auth, document.version_methode_id, lu.data);
  },
};
