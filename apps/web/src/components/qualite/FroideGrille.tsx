"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  cheminEvaluations,
  messageFroide,
  NOTES_REVUE_FROIDE,
  type EvaluationCritere,
} from "../../lib/qualite-froide";
import {
  NOTE_SANS_OBJET,
  validerEvaluation,
  type SaisieEvaluation,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FroideGrilleProps {
  echantillonId: string;
  criteres: { code: string; libelle: string; poids: number }[];
  evaluations: EvaluationCritere[];
  /** Faux : revue terminée ou utilisateur non relecteur affecté (lecture seule). */
  modifiable: boolean;
}

const texteNote = (e: EvaluationCritere | undefined) =>
  e === undefined
    ? "Pas encore évalué"
    : e.note === null
      ? "Sans objet"
      : `${e.note} sur 5 (${NOTES_REVUE_FROIDE.find((n) => n.valeur === e.note)?.libelle ?? ""})`;

interface CritereProps {
  echantillonId: string;
  critere: { code: string; libelle: string; poids: number };
  evaluation: EvaluationCritere | undefined;
  modifiable: boolean;
}

function CritereGrille({ echantillonId, critere, evaluation, modifiable }: CritereProps) {
  const f = useFormulaire<"note" | "commentaire">();
  const [s, setS] = useState<SaisieEvaluation>({
    critere: critere.code,
    note: evaluation ? (evaluation.note === null ? NOTE_SANS_OBJET : String(evaluation.note)) : "",
    commentaire: evaluation?.commentaire ?? "",
  });
  const nom = `note-${critere.code}`;

  if (!modifiable) {
    return (
      <li className="mp-froide-critere">
        <p>
          <strong>{critere.libelle}</strong> (poids {critere.poids}) : {texteNote(evaluation)}
        </p>
        {evaluation?.commentaire ? (
          <p className="mp-texte-petit">{evaluation.commentaire}</p>
        ) : null}
      </li>
    );
  }
  return (
    <li>
      <form
        ref={f.refFormulaire}
        className="mp-froide-critere"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          await f.envoyer(
            validerEvaluation(s),
            (charge) => api.put(cheminEvaluations(echantillonId), charge),
            { succes: "Critère enregistré.", messageSpecifique: messageFroide },
          );
        }}
      >
        <fieldset
          className="mp-froide-notes"
          aria-invalid={f.erreurs.note ? true : undefined}
          aria-describedby={f.erreurs.note ? `${nom}-erreur` : undefined}
        >
          <legend>
            {critere.libelle} (poids {critere.poids})
          </legend>
          {NOTES_REVUE_FROIDE.map((n) => (
            <div key={n.valeur} className="mp-froide-note">
              <input
                type="radio"
                id={`${nom}-${n.valeur}`}
                name={nom}
                value={n.valeur}
                checked={s.note === String(n.valeur)}
                onChange={() => setS((x) => ({ ...x, note: String(n.valeur) }))}
              />
              <label htmlFor={`${nom}-${n.valeur}`}>
                {n.valeur} {n.libelle}
              </label>
            </div>
          ))}
          <div className="mp-froide-note">
            <input
              type="radio"
              id={`${nom}-so`}
              name={nom}
              value={NOTE_SANS_OBJET}
              checked={s.note === NOTE_SANS_OBJET}
              onChange={() => setS((x) => ({ ...x, note: NOTE_SANS_OBJET }))}
            />
            <label htmlFor={`${nom}-so`}>Sans objet</label>
          </div>
        </fieldset>
        {f.erreurs.note ? (
          <p className="mp-champ__erreur" id={`${nom}-erreur`}>
            {f.erreurs.note}
          </p>
        ) : null}
        <ZoneTexte
          libelle={`Commentaire sur « ${critere.libelle} »`}
          rows={2}
          maxLength={2000}
          required={s.note === NOTE_SANS_OBJET}
          value={s.commentaire}
          onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
          erreur={f.erreurs.commentaire}
          aide="Obligatoire pour un critère sans objet : expliquez pourquoi."
        />
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Critère non enregistré"
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            chargement={f.enCours}
            texteChargement="Enregistrement…"
          >
            Enregistrer ce critère
          </Bouton>
        </div>
      </form>
    </li>
  );
}

/** Grille de revue : un critère après l'autre, enregistré séparément, avec son retour propre. */
export function FroideGrille({
  echantillonId,
  criteres,
  evaluations,
  modifiable,
}: FroideGrilleProps) {
  return (
    <ul className="mp-froide__liste">
      {criteres.map((c) => (
        <CritereGrille
          key={c.code}
          echantillonId={echantillonId}
          critere={c}
          evaluation={evaluations.find((e) => e.critere === c.code)}
          modifiable={modifiable}
        />
      ))}
    </ul>
  );
}
