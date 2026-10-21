"use client";

import { useState } from "react";
import { STATUT_ACTION_FROIDE_LIBELLES, type StatutActionFroide } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminAction, messageFroide, statutsSuivants } from "../../lib/qualite-froide";
import {
  validerSuiviAction,
  type ChampSuiviAction,
  type SaisieSuiviAction,
} from "../../lib/qualite-froide-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FroideSuiviActionProps {
  action: {
    id: string;
    titre: string;
    statut: StatutActionFroide;
    responsable_id: string;
    echeance: string;
  };
  /** Associé : peut aussi changer le responsable et l'échéance. */
  peutGerer: boolean;
  responsables: { valeur: string; libelle: string }[];
}

/**
 * Suivi d'une action : statut et commentaire (obligatoire à la clôture) ; responsable et échéance
 * pour l'associé seulement. Les transitions permises et les droits sont jugés par l'API.
 */
export function FroideSuiviAction({ action, peutGerer, responsables }: FroideSuiviActionProps) {
  const f = useFormulaire<ChampSuiviAction>();
  const suivants = statutsSuivants(action.statut);
  const [s, setS] = useState<SaisieSuiviAction>({
    statut: "",
    responsable_id: action.responsable_id,
    echeance: action.echeance,
    commentaire: "",
  });
  const maj = (p: Partial<SaisieSuiviAction>) => setS((x) => ({ ...x, ...p }));
  const cloture = s.statut === "faite" || s.statut === "abandonnee";

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        await f.envoyer(
          validerSuiviAction(s, action),
          (charge) => api.patch(cheminAction(action.id), charge),
          {
            succes: "Action mise à jour.",
            messageSpecifique: messageFroide,
            apres: () => maj({ statut: "", commentaire: "" }),
          },
        );
      }}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Mise à jour refusée"
      />
      <div className="mp-grille-champs">
        <Select
          libelle={`Nouveau statut de l'action « ${action.titre} »`}
          value={s.statut}
          onChange={(e) => maj({ statut: e.target.value })}
          invite="Statut inchangé"
          options={suivants.map((v) => ({ valeur: v, libelle: STATUT_ACTION_FROIDE_LIBELLES[v] }))}
          erreur={f.erreurs.statut}
        />
        {peutGerer ? (
          <>
            <Select
              libelle="Responsable"
              value={s.responsable_id}
              onChange={(e) => maj({ responsable_id: e.target.value })}
              options={responsables}
              erreur={f.erreurs.responsable_id}
            />
            <Champ
              libelle="Échéance"
              type="date"
              value={s.echeance}
              onChange={(e) => maj({ echeance: e.target.value })}
              erreur={f.erreurs.echeance}
            />
          </>
        ) : null}
      </div>
      <ZoneTexte
        libelle="Commentaire"
        required={cloture}
        rows={2}
        maxLength={2000}
        value={s.commentaire}
        onChange={(e) => maj({ commentaire: e.target.value })}
        erreur={f.erreurs.commentaire}
        aide="Obligatoire pour clôturer l'action : résultat obtenu ou raison de l'abandon."
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Mettre à jour
        </Bouton>
      </div>
    </form>
  );
}
