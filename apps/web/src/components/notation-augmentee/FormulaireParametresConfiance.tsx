"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CHEMIN_PARAMETRES_NOTATION,
  REPONDANTS_CIBLE_MAX,
  REPONDANTS_CIBLE_PLANCHER,
  SEUIL_CONFIANCE_PLANCHER,
  formaterSeuil,
  messageNotationAugmentee,
  saisieParametres,
  validerParametres,
  type ParametresNotation,
  type SaisieParametresNotation,
} from "../../lib/notation-augmentee";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

/**
 * Seuil de confiance et cible de répondants du cabinet (NOT-11, PUT /api/notation/parametres).
 * Planchers (seuil 0,3 ; 2 répondants) expliqués et contrôlés ici avant l'envoi, puis par l'API,
 * qui refuse en plus (403, séparation des tâches) un compte cumulant le rôle d'expert métier : son
 * message est affiché tel quel.
 */
export function FormulaireParametresConfiance({
  parametres,
  avertissement,
}: {
  parametres: ParametresNotation;
  /** Mise en garde affichée avant l'envoi (compte cumulant expert métier), sinon `null`. */
  avertissement: string | null;
}) {
  const f = useFormulaire<"seuil_confiance" | "repondants_cible">();
  const [saisie, setSaisie] = useState<SaisieParametresNotation>(() =>
    saisieParametres(parametres),
  );

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerParametres(saisie),
      (charge) => api.put<ParametresNotation>(CHEMIN_PARAMETRES_NOTATION, charge),
      {
        succes: "Paramètres de confiance enregistrés.",
        messageSpecifique: messageNotationAugmentee,
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {avertissement ? (
        <Alerte tonalite="attention" titre="Séparation des tâches" annonce="aucune">
          <p>{avertissement}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle="Seuil de confiance"
          required
          inputMode="decimal"
          value={saisie.seuil}
          onChange={(e) => setSaisie((s) => ({ ...s, seuil: e.target.value }))}
          erreur={f.erreurs.seuil_confiance}
          aide={`Entre ${formaterSeuil(SEUIL_CONFIANCE_PLANCHER)} (plancher) et 1, quatre décimales au plus. Sous ce seuil, une notation ne se publie pas.`}
        />
        <Champ
          libelle="Répondants cibles"
          required
          inputMode="numeric"
          value={saisie.repondants}
          onChange={(e) => setSaisie((s) => ({ ...s, repondants: e.target.value }))}
          erreur={f.erreurs.repondants_cible}
          aide={`Au moins ${REPONDANTS_CIBLE_PLANCHER} (plancher), au plus ${REPONDANTS_CIBLE_MAX}. Un nombre de jeux de réponses inférieur à la cible abaisse l'indice de confiance.`}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer les paramètres
        </Bouton>
      </div>
    </form>
  );
}
