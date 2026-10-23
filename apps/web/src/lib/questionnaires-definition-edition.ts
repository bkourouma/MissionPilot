/** Sous-module de `questionnaires-definition.ts` : édition immuable de la définition. */
import {
  type Definition,
  type Section,
  type Question,
  type Condition,
  type ModeleQuestion,
} from "./questionnaires-definition-socle";
import {
  identifiantLibre,
  identifiantsQuestions,
  identifiantsSections,
  nouvelleQuestion,
  avecChamp,
  deplacer,
  remplacer,
  retirer,
} from "./questionnaires-definition-construction";

// --- Édition de la définition -------------------------------------------------------------------

export function majSection(def: Definition, si: number, f: (s: Section) => Section): Definition {
  const s = def.sections[si];
  return s ? { ...def, sections: remplacer(def.sections, si, f(s)) } : def;
}

export function majQuestion(
  def: Definition,
  si: number,
  qi: number,
  f: (q: Question) => Question,
): Definition {
  return majSection(def, si, (s) => {
    const q = s.questions[qi];
    return q ? { ...s, questions: remplacer(s.questions, qi, f(q)) } : s;
  });
}

export function ajouterSection(def: Definition): Definition {
  const n = def.sections.length + 1;
  const id = identifiantLibre(`section_${n}`, identifiantsSections(def));
  const q = identifiantLibre(`q${identifiantsQuestions(def).size + 1}`, identifiantsQuestions(def));
  return {
    ...def,
    sections: [
      ...def.sections,
      { id, titre: `Section ${n}`, questions: [nouvelleQuestion("oui_non", q)] },
    ],
  };
}

export function ajouterQuestion(
  def: Definition,
  si: number,
  modele: ModeleQuestion = "oui_non",
): Definition {
  const ids = identifiantsQuestions(def);
  const id = identifiantLibre(`q${ids.size + 1}`, ids);
  return majSection(def, si, (s) => ({
    ...s,
    questions: [...s.questions, nouvelleQuestion(modele, id)],
  }));
}

/** Une définition garde au moins une section (schéma) : la dernière ne se supprime pas. */
export function supprimerSection(def: Definition, si: number): Definition {
  if (def.sections.length <= 1) return def;
  return { ...def, sections: retirer(def.sections, si) };
}

/** Une section garde au moins une question (schéma) : la dernière ne se supprime pas. */
export function supprimerQuestion(def: Definition, si: number, qi: number): Definition {
  return majSection(def, si, (s) =>
    s.questions.length <= 1 ? s : { ...s, questions: retirer(s.questions, qi) },
  );
}

export function deplacerSection(def: Definition, si: number, sens: -1 | 1): Definition {
  return { ...def, sections: deplacer(def.sections, si, sens) };
}

export function deplacerQuestion(
  def: Definition,
  si: number,
  qi: number,
  sens: -1 | 1,
): Definition {
  return majSection(def, si, (s) => ({ ...s, questions: deplacer(s.questions, qi, sens) }));
}

/** Remplace la question citée `ancien` par `nouveau` dans une condition. */
export function renommerReferences(c: Condition, ancien: string, nouveau: string): Condition {
  switch (c.op) {
    case "et":
    case "ou":
      return {
        op: c.op,
        conditions: c.conditions.map((s) => renommerReferences(s, ancien, nouveau)),
      };
    case "non":
      return { op: "non", condition: renommerReferences(c.condition, ancien, nouveau) };
    default:
      return c.question === ancien ? { ...c, question: nouveau } : c;
  }
}

/**
 * Change l'identifiant d'une question et met à jour les conditions qui la citent. Si
 * l'identifiant est déjà pris, seules les références restent inchangées : le doublon sera
 * signalé (IDENTIFIANT_DOUBLON) par le moteur.
 */
export function renommerQuestion(
  def: Definition,
  si: number,
  qi: number,
  nouveau: string,
): Definition {
  const q = def.sections[si]?.questions[qi];
  if (!q || q.id === nouveau) return def;
  const ancien = q.id;
  const dejaPris = identifiantsQuestions(def).has(nouveau);
  const avecId = majQuestion(def, si, qi, (x) => ({ ...x, id: nouveau }));
  if (dejaPris) return avecId;
  const ren = (c: Condition | undefined) =>
    c ? renommerReferences(c, ancien, nouveau) : undefined;
  return {
    ...avecId,
    sections: avecId.sections.map((s) => ({
      ...avecChamp(s, "condition", ren(s.condition)),
      questions: s.questions.map((x) => avecChamp(x, "condition", ren(x.condition))),
    })),
  };
}
