"use client";

import { useState, type FormEvent } from "react";
import type { RedDossierVue, RedSecteur, RedStatutDossier } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminDossierRed,
  cheminStatutDossier,
  messageRedressement,
  OPTIONS_SECTEURS,
} from "../../lib/redressement";
import {
  corpsCloture,
  corpsDossierDepuisFormulaire,
  type ChampDossier,
  type ChampStatutDossier,
} from "../../lib/redressement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionRed } from "./BoutonActionRed";

/** Modification de l'intitulé et du secteur du dossier (droit d'écriture). */
export function FormulaireDossier({
  dossierId,
  intitule: intituleInitial,
  secteur: secteurInitial,
}: {
  dossierId: string;
  intitule: string;
  secteur: RedSecteur;
}) {
  const f = useFormulaire<ChampDossier>();
  const [intitule, setIntitule] = useState(intituleInitial);
  const [secteur, setSecteur] = useState<RedSecteur>(secteurInitial);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsDossierDepuisFormulaire({ intitule, secteur }),
      (charge) => api.patch<RedDossierVue>(cheminDossierRed(dossierId), charge),
      { succes: "Dossier modifié.", messageSpecifique: messageRedressement },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Modifier le dossier"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Modification refusée"
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
          value={secteur}
          onChange={(e) => setSecteur(e.target.value as RedSecteur)}
          options={OPTIONS_SECTEURS}
          aide="Un changement de secteur ne modifie jamais les scores déjà calculés."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement="Enregistrement…"
        >
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Changements de statut du dossier : « Passer en mise en œuvre » (statut « Plan validé » ; droit
 * d'écriture) et « Clore le dossier » (droit de validation, motif obligatoire). Les propositions
 * suivent le statut affiché ; l'API refuse toute transition non admise.
 */
export function ActionsStatutDossier({
  dossierId,
  statut,
  peutEcrire,
  peutValider,
}: {
  dossierId: string;
  statut: RedStatutDossier;
  peutEcrire: boolean;
  peutValider: boolean;
}) {
  const f = useFormulaire<ChampStatutDossier>();
  const [motif, setMotif] = useState("");

  async function clore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCloture(motif),
      (charge) => api.post<RedDossierVue>(cheminStatutDossier(dossierId), charge),
      { succes: "Dossier clos.", messageSpecifique: messageRedressement },
    );
  }

  if (statut === "clos") return null;
  return (
    <div className="mp-red-section">
      {peutEcrire && statut === "plan_valide" ? (
        <BoutonActionRed
          libelle="Passer en mise en œuvre"
          chemin={cheminStatutDossier(dossierId)}
          corps={{ statut: "mise_en_oeuvre" }}
          succes="Le dossier est en mise en œuvre."
          variante="primaire"
          confirmation={{
            question: "Passer le dossier en mise en œuvre ?",
            libelleConfirmation: "Oui, passer en mise en œuvre",
          }}
        />
      ) : null}
      {peutValider ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={clore}
          aria-label="Clore le dossier"
        >
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={f.succes}
            refAlerte={f.refAlerte}
            titreErreur="Clôture impossible"
          />
          <ZoneTexte
            libelle="Motif de clôture"
            required
            maxLength={1000}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide="Au moins 10 caractères. Un dossier clos ne reçoit plus d'écriture et ne se rouvre pas."
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement="Clôture…"
            >
              Clore le dossier
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
