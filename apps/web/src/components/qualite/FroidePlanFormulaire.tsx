"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { cheminActionsCampagne, messageFroide } from "../../lib/qualite-froide";
import {
  validerAction,
  type ChampAction,
  type SaisieAction,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FroidePlanFormulaireProps {
  campagneId: string;
  responsables: { valeur: string; libelle: string }[];
  /** Constats des revues terminées, proposés comme origine facultative de l'action. */
  constats: { valeur: string; libelle: string }[];
}

const VIDE: SaisieAction = {
  titre: "",
  description: "",
  constat_id: "",
  responsable_id: "",
  echeance: "",
};

/** Ajout d'une action au plan d'amélioration de la campagne. */
export function FroidePlanFormulaire({
  campagneId,
  responsables,
  constats,
}: FroidePlanFormulaireProps) {
  const f = useFormulaire<ChampAction>();
  const [s, setS] = useState<SaisieAction>(VIDE);
  const maj = (p: Partial<SaisieAction>) => setS((x) => ({ ...x, ...p }));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerAction(s),
          (charge) => api.post(cheminActionsCampagne(campagneId), charge),
          {
            succes: "Action ajoutée au plan d'amélioration.",
            messageSpecifique: messageFroide,
            apres: () => setS(VIDE),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Action non ajoutée"
      />
      <Champ
        libelle="Titre de l'action"
        required
        maxLength={200}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <ZoneTexte
        libelle="Description"
        rows={3}
        maxLength={2000}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Constat à l'origine de l'action"
          value={s.constat_id}
          onChange={(e) => maj({ constat_id: e.target.value })}
          invite="Aucun constat lié"
          options={constats}
          erreur={f.erreurs.constat_id}
          aide={constats.length === 0 ? "Aucun constat enregistré pour l'instant." : undefined}
        />
        <Select
          libelle="Responsable"
          required
          value={s.responsable_id}
          onChange={(e) => maj({ responsable_id: e.target.value })}
          invite="Choisir un responsable"
          options={responsables}
          erreur={f.erreurs.responsable_id}
          aide={
            responsables.length === 0
              ? "La liste des personnes n'a pas pu être chargée."
              : undefined
          }
        />
        <Champ
          libelle="Échéance"
          type="date"
          required
          value={s.echeance}
          onChange={(e) => maj({ echeance: e.target.value })}
          erreur={f.erreurs.echeance}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter l&apos;action
        </Bouton>
      </div>
    </form>
  );
}
