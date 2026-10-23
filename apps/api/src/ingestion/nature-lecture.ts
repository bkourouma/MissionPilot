import { contientNonVerifie, lireLecturesIa, nombresNonRetrouves } from "@missionpilot/engines";
import { contenuLectureSchema, type ElementLecture } from "@missionpilot/shared";
import { requeteInvalide } from "../errors.js";
import type { NatureExtractionApi } from "./natures.js";

/*
 * Nature « lecture_document » (DD-02, DD-10) : résumé et éléments d'un document de due diligence.
 *
 * - Le contenu est relu avec `contenuLectureSchema` (strict : 400 sinon) ; toute page citée doit exister
 *   dans le document.
 * - `verifie` de chaque élément est RECALCULÉ côté serveur à partir du texte de la page citée (jamais cru
 *   d'un client), par le MÊME moteur que la lecture de l'IA (`lireLecturesIa` : extrait de 8 caractères au
 *   moins retrouvé dans la page, nombres de l'extrait et de l'énoncé retrouvés aussi).
 * - Le RÉSUMÉ suit la même règle que la lecture de l'IA : un nombre de 3 chiffres ou plus introuvable dans la
 *   page citée est refusé (400), le résumé n'ayant pas d'acquittement par élément.
 * - PAS d'`appliquer` : valider un brouillon ne pousse RIEN ailleurs (ni verdicts, ni registre des preuves,
 *   ni rapport). Le brouillon validé reste une lecture consultable ; toute suite est un acte humain séparé.
 */

/**
 * Vérification d'un élément par le moteur de lecture, en lui présentant l'élément comme une ligne du
 * modèle. Un extrait contenant le séparateur « | » ne peut pas être transmis sous cette forme : il reste
 * non vérifié (choix prudent, l'acquittement humain est alors exigé).
 */
function elementVerifie(e: Omit<ElementLecture, "verifie">, texte: string): boolean {
  if (e.extrait.includes("|")) return false;
  const { contenu } = lireLecturesIa(
    [`${e.page} | ${e.type} | ${e.extrait} | ${e.enonce}`],
    [{ numero: e.page, texte }],
  );
  return contenu.elements[0]?.verifie === true;
}

export const natureLecture: NatureExtractionApi = {
  nature: "lecture_document",
  validerContenu(contenu, pages) {
    const lu = contenuLectureSchema.safeParse(contenu);
    if (!lu.success) throw requeteInvalide("Contenu de lecture invalide.");
    const textes = new Map<number, string>();
    for (const p of pages) if (!textes.has(p.numero)) textes.set(p.numero, p.texte);
    const { resume, elements, tronque } = lu.data;
    for (const cite of [...resume, ...elements]) {
      if (!textes.has(cite.page)) {
        throw requeteInvalide(`La page ${cite.page} n'existe pas dans le document.`);
      }
    }
    for (const r of resume) {
      if (nombresNonRetrouves(r.texte, textes.get(r.page) as string).length > 0) {
        throw requeteInvalide(`Le résumé cite un nombre introuvable dans la page ${r.page}.`);
      }
    }
    return {
      resume,
      elements: elements.map((e) => ({
        page: e.page,
        type: e.type,
        extrait: e.extrait,
        enonce: e.enonce,
        verifie: elementVerifie(e, textes.get(e.page) as string),
      })),
      tronque,
    };
  },
  contientNonVerifie(contenu) {
    return contientNonVerifie(contenu as { elements: { verifie: boolean }[] });
  },
};
