"use client";

import { useState, type FormEvent } from "react";
import type { RedDossierVue, RedSecteur, RedStatutDossier } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminDossierRed,
  cheminStatutDossier,
  messageRedressement,
  optionsSecteurs,
} from "../../lib/redressement";
import {
  corpsCloture,
  corpsDossierDepuisFormulaire,
  type ChampDossier,
  type ChampStatutDossier,
} from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampDossier>();
  const [intitule, setIntitule] = useState(intituleInitial);
  const [secteur, setSecteur] = useState<RedSecteur>(secteurInitial);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsDossierDepuisFormulaire({ intitule, secteur }, langue),
      (charge) => api.patch<RedDossierVue>(cheminDossierRed(dossierId), charge),
      {
        succes: t("Dossier modifié.", "File updated."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Modifier le dossier", "Edit the file")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Modification refusée", "Edit refused")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Intitulé du dossier", "File title")}
          required
          maxLength={200}
          autoComplete="off"
          value={intitule}
          onChange={(e) => setIntitule(e.target.value)}
          erreur={f.erreurs.intitule}
        />
        <Select
          libelle={t("Secteur d'activité", "Business sector")}
          value={secteur}
          onChange={(e) => setSecteur(e.target.value as RedSecteur)}
          options={optionsSecteurs(langue)}
          aide={t(
            "Un changement de secteur ne modifie jamais les scores déjà calculés.",
            "Changing the sector never alters scores already computed.",
          )}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer", "Save")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampStatutDossier>();
  const [motif, setMotif] = useState("");

  async function clore(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCloture(motif, langue),
      (charge) => api.post<RedDossierVue>(cheminStatutDossier(dossierId), charge),
      {
        succes: t("Dossier clos.", "File closed."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  if (statut === "clos") return null;
  return (
    <div className="mp-red-section">
      {peutEcrire && statut === "plan_valide" ? (
        <BoutonActionRed
          libelle={t("Passer en mise en œuvre", "Move to implementation")}
          chemin={cheminStatutDossier(dossierId)}
          corps={{ statut: "mise_en_oeuvre" }}
          succes={t("Le dossier est en mise en œuvre.", "The file is now in implementation.")}
          variante="primaire"
          confirmation={{
            question: t("Passer le dossier en mise en œuvre ?", "Move the file to implementation?"),
            libelleConfirmation: t("Oui, passer en mise en œuvre", "Yes, move to implementation"),
          }}
        />
      ) : null}
      {peutValider ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={clore}
          aria-label={t("Clore le dossier", "Close the file")}
        >
          <RetourFormulaire
            erreur={f.erreurGlobale}
            succes={f.succes}
            refAlerte={f.refAlerte}
            titreErreur={t("Clôture impossible", "Could not close")}
          />
          <ZoneTexte
            libelle={t("Motif de clôture", "Closing reason")}
            required
            maxLength={1000}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
            aide={t(
              "Au moins 10 caractères. Un dossier clos ne reçoit plus d'écriture et ne se rouvre pas.",
              "At least 10 characters. A closed file accepts no more entries and cannot be reopened.",
            )}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="danger"
              chargement={f.enCours}
              texteChargement={t("Clôture…", "Closing…")}
            >
              {t("Clore le dossier", "Close the file")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
