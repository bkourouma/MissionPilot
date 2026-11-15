"use client";

import { useState } from "react";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminEvaluations,
  libelleCritere,
  messageFroide,
  notesRevueFroide,
  type EvaluationCritere,
} from "../../lib/qualite-froide";
import {
  NOTE_SANS_OBJET,
  validerEvaluation,
  type SaisieEvaluation,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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

const texteNote = (e: EvaluationCritere | undefined, langue: Langue) => {
  const t = creerTraduire(langue);
  if (e === undefined) return t("Pas encore évalué", "Not yet assessed");
  if (e.note === null) return t("Sans objet", "Not applicable");
  const libelle = notesRevueFroide(langue).find((n) => n.valeur === e.note)?.libelle ?? "";
  return t(`${e.note} sur 5 (${libelle})`, `${e.note} out of 5 (${libelle})`);
};

interface CritereProps {
  echantillonId: string;
  critere: { code: string; libelle: string; poids: number };
  evaluation: EvaluationCritere | undefined;
  modifiable: boolean;
}

function CritereGrille({ echantillonId, critere, evaluation, modifiable }: CritereProps) {
  const t = useT();
  const langue = useLangue();
  const libelleCrit = libelleCritere(critere.code, langue);
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
          <strong>{libelleCrit}</strong> ({t("poids", "weight")} {critere.poids}) :{" "}
          {texteNote(evaluation, langue)}
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
            validerEvaluation(s, langue),
            (charge) => api.put(cheminEvaluations(echantillonId), charge),
            {
              succes: t("Critère enregistré.", "Criterion saved."),
              messageSpecifique: (e) => messageFroide(e, langue),
            },
          );
        }}
      >
        <fieldset
          className="mp-froide-notes"
          aria-invalid={f.erreurs.note ? true : undefined}
          aria-describedby={f.erreurs.note ? `${nom}-erreur` : undefined}
        >
          <legend>
            {libelleCrit} ({t("poids", "weight")} {critere.poids})
          </legend>
          {notesRevueFroide(langue).map((n) => (
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
            <label htmlFor={`${nom}-so`}>{t("Sans objet", "Not applicable")}</label>
          </div>
        </fieldset>
        {f.erreurs.note ? (
          <p className="mp-champ__erreur" id={`${nom}-erreur`}>
            {f.erreurs.note}
          </p>
        ) : null}
        <ZoneTexte
          libelle={t(`Commentaire sur « ${libelleCrit} »`, `Comment on "${libelleCrit}"`)}
          rows={2}
          maxLength={2000}
          required={s.note === NOTE_SANS_OBJET}
          value={s.commentaire}
          onChange={(e) => setS((x) => ({ ...x, commentaire: e.target.value }))}
          erreur={f.erreurs.commentaire}
          aide={t(
            "Obligatoire pour un critère sans objet : expliquez pourquoi.",
            "Required for a criterion marked not applicable: explain why.",
          )}
        />
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Critère non enregistré", "Criterion not saved")}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            chargement={f.enCours}
            texteChargement={t("Enregistrement…", "Saving…")}
          >
            {t("Enregistrer ce critère", "Save this criterion")}
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
