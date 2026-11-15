"use client";

import { useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  cheminApiActionTranscription,
  cheminApiTexteTranscription,
  enteteIfMatch,
  messageErreurTranscription,
  PLAFONDS_TRANSCRIPTION,
  validerCorrectionTexte,
  validerRejetTranscription,
  type ActionsTranscription as DroitsTranscription,
} from "../../lib/transcriptions";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import "../canaux/canaux.css";

export interface ActionsTranscriptionProps {
  transcriptionId: string;
  /** Texte de la version courante (point de départ de la correction). */
  texte: string;
  /** Numéro de la version courante : envoyé en `If-Match` (409 si quelqu'un a corrigé entre-temps). */
  versionNumero: number;
  droits: DroitsTranscription;
}

/**
 * Relecture d'une transcription : correction du texte (nouvelle version humaine), validation par
 * une autre personne que le dernier correcteur (sauf associé), rejet motivé.
 */
export function ActionsTranscription({
  transcriptionId,
  texte,
  versionNumero,
  droits,
}: ActionsTranscriptionProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [rejet, setRejet] = useState(false);
  const [erreurValidation, setErreurValidation] = useState<string | null>(null);

  async function valider(): Promise<boolean> {
    setErreurValidation(null);
    try {
      await api.post(
        cheminApiActionTranscription(transcriptionId, "valider"),
        {},
        { redirigerSi401: false },
      );
      rafraichir();
      return true;
    } catch (e) {
      setErreurValidation(messageErreurTranscription(e, langue));
      return false;
    }
  }

  return (
    <div className="mp-pile">
      {droits.corriger ? (
        <FormulaireCorrection
          transcriptionId={transcriptionId}
          texte={texte}
          versionNumero={versionNumero}
        />
      ) : null}
      {droits.motifValidationImpossible ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{droits.motifValidationImpossible}</p>
        </Alerte>
      ) : null}
      {erreurValidation ? (
        <Alerte tonalite="danger" titre={t("Validation impossible", "Could not approve")}>
          <p>{erreurValidation}</p>
        </Alerte>
      ) : null}
      {droits.valider || droits.rejeter ? (
        <div className="mp-canaux__actions-ligne">
          {droits.valider ? (
            <BoutonConfirmation
              libelle={t("Valider la transcription", "Approve the transcription")}
              question={t(
                "Valider ce texte ? Il deviendra la version de référence de la transcription.",
                "Approve this text? It will become the reference version of the transcription.",
              )}
              libelleConfirmation={t("Oui, valider", "Yes, approve")}
              variante="primaire"
              icone="succes"
              texteChargement={t("Validation…", "Approving…")}
              action={valider}
            />
          ) : null}
          {droits.rejeter ? (
            <Bouton variante="secondaire" aria-expanded={rejet} onClick={() => setRejet((r) => !r)}>
              {t("Rejeter", "Reject")}
            </Bouton>
          ) : null}
        </div>
      ) : null}
      {rejet ? (
        <FormulaireRejet transcriptionId={transcriptionId} onFin={() => setRejet(false)} />
      ) : null}
    </div>
  );
}

function FormulaireCorrection({
  transcriptionId,
  texte,
  versionNumero,
}: {
  transcriptionId: string;
  texte: string;
  versionNumero: number;
}) {
  const [valeur, setValeur] = useState(texte);
  const f = useFormulaire<"texte">();
  const t = useT();
  const langue = useLangue();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (valeur === texte) {
      await f.envoyer(
        {
          ok: false,
          erreurs: { texte: t("Aucune correction à enregistrer.", "No correction to save.") },
        },
        async () => null,
      );
      return;
    }
    await f.envoyer(
      validerCorrectionTexte(valeur, langue),
      (charge) =>
        api.put(cheminApiTexteTranscription(transcriptionId), charge, {
          redirigerSi401: false,
          entetes: { "If-Match": enteteIfMatch(versionNumero) },
        }),
      {
        succes: t(
          "Correction enregistrée : une nouvelle version humaine a été ajoutée.",
          "Correction saved: a new human version was added.",
        ),
        messageSpecifique: (e) => messageErreurTranscription(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Corriger le texte", "Correct the text")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Texte à corriger", "Text to correct")}
        rows={10}
        maxLength={PLAFONDS_TRANSCRIPTION.texteMaxCaracteres}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        erreur={f.erreurs.texte}
        aide={t(
          "Chaque enregistrement ajoute une version ; les versions précédentes restent consultables.",
          "Each save adds a version; previous versions remain available.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correction", "Save the correction")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireRejet({
  transcriptionId,
  onFin,
}: {
  transcriptionId: string;
  onFin: () => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const t = useT();
  const langue = useLangue();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRejetTranscription(motif, langue),
      (charge) =>
        api.post(cheminApiActionTranscription(transcriptionId, "rejeter"), charge, {
          redirigerSi401: false,
        }),
      {
        succes: t("Transcription rejetée.", "Transcription rejected."),
        messageSpecifique: (e) => messageErreurTranscription(e, langue),
        apres: onFin,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Rejeter la transcription", "Reject the transcription")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Motif du rejet", "Reason for the rejection")}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement={t("Rejet…", "Rejecting…")}
        >
          {t("Rejeter la transcription", "Reject the transcription")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
