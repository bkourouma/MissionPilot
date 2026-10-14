"use client";

import { useState, type FormEvent } from "react";
import type { RedDossierVue, RedSecteur } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminDossierMission,
  messageRedressement,
  OPTIONS_SECTEURS,
} from "../../lib/redressement";
import { corpsDossierDepuisFormulaire, type ChampDossier } from "../../lib/redressement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Ouverture du dossier de redressement d'une mission (directeur, chef ou « modifier toutes les
 * missions »). La devise du dossier est celle de la mission ; l'API juge les droits.
 */
export function FormulaireOuvertureDossier({
  missionId,
  intituleInitial,
}: {
  missionId: string;
  intituleInitial: string;
}) {
  const f = useFormulaire<ChampDossier>();
  const [intitule, setIntitule] = useState(intituleInitial);
  const [secteur, setSecteur] = useState<RedSecteur>("general");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsDossierDepuisFormulaire({ intitule, secteur }),
      (charge) => api.post<RedDossierVue>(cheminDossierMission(missionId), charge),
      { succes: "Dossier de redressement ouvert.", messageSpecifique: messageRedressement },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Ouvrir le dossier de redressement"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ouverture impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Intitulé du dossier"
          required
          maxLength={200}
          autoComplete="off"
          value={intitule}
          onChange={(e) => setIntitule(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle="Secteur d'activité"
          required
          value={secteur}
          onChange={(e) => setSecteur(e.target.value as RedSecteur)}
          options={OPTIONS_SECTEURS}
          aide="Les seuils d'alerte précoce dépendent du secteur."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ouverture…">
          Ouvrir le dossier de redressement
        </Bouton>
      </div>
    </form>
  );
}
