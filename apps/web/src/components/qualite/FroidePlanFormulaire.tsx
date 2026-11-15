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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
          validerAction(s, langue),
          (charge) => api.post(cheminActionsCampagne(campagneId), charge),
          {
            succes: t(
              "Action ajoutée au plan d'amélioration.",
              "Action added to the improvement plan.",
            ),
            messageSpecifique: (e) => messageFroide(e, langue),
            apres: () => setS(VIDE),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Action non ajoutée", "Action not added")}
      />
      <Champ
        libelle={t("Titre de l'action", "Action title")}
        required
        maxLength={200}
        value={s.titre}
        onChange={(e) => maj({ titre: e.target.value })}
        erreur={f.erreurs.titre}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={3}
        maxLength={2000}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Constat à l'origine de l'action", "Finding behind the action")}
          value={s.constat_id}
          onChange={(e) => maj({ constat_id: e.target.value })}
          invite={t("Aucun constat lié", "No linked finding")}
          options={constats}
          erreur={f.erreurs.constat_id}
          aide={
            constats.length === 0
              ? t("Aucun constat enregistré pour l'instant.", "No findings recorded yet.")
              : undefined
          }
        />
        <Select
          libelle={t("Responsable", "Owner")}
          required
          value={s.responsable_id}
          onChange={(e) => maj({ responsable_id: e.target.value })}
          invite={t("Choisir un responsable", "Choose an owner")}
          options={responsables}
          erreur={f.erreurs.responsable_id}
          aide={
            responsables.length === 0
              ? t(
                  "La liste des personnes n'a pas pu être chargée.",
                  "The list of people could not be loaded.",
                )
              : undefined
          }
        />
        <Champ
          libelle={t("Échéance", "Due date")}
          type="date"
          required
          value={s.echeance}
          onChange={(e) => maj({ echeance: e.target.value })}
          erreur={f.erreurs.echeance}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ajout…", "Adding…")}>
          {t("Ajouter l'action", "Add action")}
        </Bouton>
      </div>
    </form>
  );
}
