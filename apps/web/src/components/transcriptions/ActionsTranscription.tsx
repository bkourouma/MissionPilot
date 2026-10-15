"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
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
  const router = useRouter();
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
      router.refresh();
      return true;
    } catch (e) {
      setErreurValidation(messageErreurTranscription(e));
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
        <Alerte tonalite="danger" titre="Validation impossible">
          <p>{erreurValidation}</p>
        </Alerte>
      ) : null}
      {droits.valider || droits.rejeter ? (
        <div className="mp-canaux__actions-ligne">
          {droits.valider ? (
            <BoutonConfirmation
              libelle="Valider la transcription"
              question="Valider ce texte ? Il deviendra la version de référence de la transcription."
              libelleConfirmation="Oui, valider"
              variante="primaire"
              icone="succes"
              texteChargement="Validation…"
              action={valider}
            />
          ) : null}
          {droits.rejeter ? (
            <Bouton variante="secondaire" aria-expanded={rejet} onClick={() => setRejet((r) => !r)}>
              Rejeter
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

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (valeur === texte) {
      await f.envoyer(
        { ok: false, erreurs: { texte: "Aucune correction à enregistrer." } },
        async () => null,
      );
      return;
    }
    await f.envoyer(
      validerCorrectionTexte(valeur),
      (charge) =>
        api.put(cheminApiTexteTranscription(transcriptionId), charge, {
          redirigerSi401: false,
          entetes: { "If-Match": enteteIfMatch(versionNumero) },
        }),
      {
        succes: "Correction enregistrée : une nouvelle version humaine a été ajoutée.",
        messageSpecifique: (e) => messageErreurTranscription(e),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Corriger le texte"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Texte à corriger"
        rows={10}
        maxLength={PLAFONDS_TRANSCRIPTION.texteMaxCaracteres}
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        erreur={f.erreurs.texte}
        aide="Chaque enregistrement ajoute une version ; les versions précédentes restent consultables."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correction
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

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRejetTranscription(motif),
      (charge) =>
        api.post(cheminApiActionTranscription(transcriptionId, "rejeter"), charge, {
          redirigerSi401: false,
        }),
      {
        succes: "Transcription rejetée.",
        messageSpecifique: (e) => messageErreurTranscription(e),
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
      aria-label="Rejeter la transcription"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Motif du rejet"
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Rejet…">
          Rejeter la transcription
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
