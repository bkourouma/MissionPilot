"use client";

import { useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import { api } from "../../lib/api";
import {
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../lib/double-authentification";
import {
  AVERTISSEMENT_SIGNATURE_SIMULEE,
  cheminApiActionSignature,
  messageErreurSignature,
  validerMotifSignature,
  validerSignature,
  type ActionsDemande,
} from "../../lib/signatures";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useFormulaire } from "../formulaires/useFormulaire";
import { ChampsReconfirmation } from "../securite/ChampsReconfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import "../canaux/canaux.css";

export interface ActionsSignatureCabinetProps {
  signatureId: string;
  actions: ActionsDemande;
  /** Double authentification active sur le compte (exigée pour signer). */
  tfaActive: boolean;
}

type Panneau = "signer" | "refuser" | "annuler" | null;

/**
 * Actions du cabinet sur une demande : Envoyer, Annuler (motif), Signer (reconfirmation du mot
 * de passe et du code de double authentification), Refuser (motif). Signature simulée.
 */
export function ActionsSignatureCabinet({
  signatureId,
  actions,
  tfaActive,
}: ActionsSignatureCabinetProps) {
  const { rafraichir } = useRafraichir();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const bascule = (p: Exclude<Panneau, null>) => setPanneau((c) => (c === p ? null : p));

  async function envoyer(): Promise<boolean> {
    setErreurEnvoi(null);
    try {
      await api.post(
        cheminApiActionSignature(signatureId, "envoyer"),
        {},
        { redirigerSi401: false },
      );
      rafraichir();
      return true;
    } catch (e) {
      setErreurEnvoi(messageErreurSignature(e));
      return false;
    }
  }

  if (!actions.envoyer && !actions.annuler && !actions.signer && !actions.refuser) return null;
  return (
    <div className="mp-pile">
      <div className="mp-canaux__actions-ligne">
        {actions.envoyer ? (
          <BoutonConfirmation
            libelle="Envoyer aux signataires"
            question="Envoyer la demande ? Le document sera partagé avec le client et les signataires seront invités."
            libelleConfirmation="Oui, envoyer"
            variante="primaire"
            icone="envoyer"
            texteChargement="Envoi…"
            action={envoyer}
          />
        ) : null}
        {actions.signer ? (
          <Bouton
            icone="signature"
            aria-expanded={panneau === "signer"}
            onClick={() => bascule("signer")}
          >
            Signer
          </Bouton>
        ) : null}
        {actions.refuser ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "refuser"}
            onClick={() => bascule("refuser")}
          >
            Refuser de signer
          </Bouton>
        ) : null}
        {actions.annuler ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "annuler"}
            onClick={() => bascule("annuler")}
          >
            Annuler la demande
          </Bouton>
        ) : null}
      </div>
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre="Envoi impossible">
          <p>{erreurEnvoi}</p>
        </Alerte>
      ) : null}
      {panneau === "signer" ? (
        <FormulaireSignature
          signatureId={signatureId}
          tfaActive={tfaActive}
          onFin={() => setPanneau(null)}
        />
      ) : null}
      {panneau === "refuser" ? (
        <FormulaireMotif
          signatureId={signatureId}
          action="refuser"
          onFin={() => setPanneau(null)}
        />
      ) : null}
      {panneau === "annuler" ? (
        <FormulaireMotif
          signatureId={signatureId}
          action="annuler"
          onFin={() => setPanneau(null)}
        />
      ) : null}
    </div>
  );
}

function FormulaireSignature({
  signatureId,
  tfaActive,
  onFin,
}: {
  signatureId: string;
  tfaActive: boolean;
  onFin: () => void;
}) {
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const f = useFormulaire<ChampConfirmation>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSignature(confirmation),
      (charge) =>
        api.post(cheminApiActionSignature(signatureId, "signer"), charge, {
          redirigerSi401: false,
        }),
      {
        succes: "Signature enregistrée (simulée, sans valeur juridique).",
        messageSpecifique: (e) => messageErreurSignature(e, confirmation.facteur),
        apres: onFin,
      },
    );
    // Jamais de mot de passe ni de code conservé après un essai.
    setConfirmation((c) => ({ ...c, motDePasse: "", code: "" }));
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label="Signer le document"
    >
      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_SIGNATURE_SIMULEE}>
        <p>
          Vous signez dans MissionPilot, sous votre identité. Lisez d&apos;abord le document : la
          lecture est inscrite dans le journal de preuves.
        </p>
      </Alerte>
      {!tfaActive ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Double authentification requise">
          <p>
            Signer exige une double authentification active sur votre compte. Activez-la depuis «
            Sécurité du compte », puis revenez ici.
          </p>
        </Alerte>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Signature impossible"
      />
      <ChampsReconfirmation
        saisie={confirmation}
        onChange={setConfirmation}
        erreurs={f.erreurs}
        motif="signer ce document"
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Signature…">
          Signer le document
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireMotif({
  signatureId,
  action,
  onFin,
}: {
  signatureId: string;
  action: "refuser" | "annuler";
  onFin: () => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const annulation = action === "annuler";

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerMotifSignature(motif, annulation ? "annulation" : "refus"),
      (charge) =>
        api.post(cheminApiActionSignature(signatureId, action), charge, {
          redirigerSi401: false,
        }),
      {
        succes: annulation ? "Demande annulée." : "Refus enregistré.",
        messageSpecifique: (e) => messageErreurSignature(e),
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
      aria-label={annulation ? "Annuler la demande" : "Refuser de signer"}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={annulation ? "Motif de l'annulation" : "Motif du refus"}
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Envoi…">
          {annulation ? "Annuler la demande" : "Refuser de signer"}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Retour
        </Bouton>
      </div>
    </form>
  );
}
