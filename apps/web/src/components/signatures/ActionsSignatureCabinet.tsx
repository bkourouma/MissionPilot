"use client";

import { useState, type FormEvent } from "react";
import { useFocusInitial } from "./useFocusInitial";
import { useRafraichir } from "../formulaires/useRafraichir";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../lib/double-authentification";
import {
  avertissementSignatureSimulee,
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  // Le panneau se referme après succès : le message vit ici pour rester annoncé et visible.
  const [succes, setSucces] = useState<string | null>(null);
  const bascule = (p: Exclude<Panneau, null>) => {
    setSucces(null);
    setPanneau((c) => (c === p ? null : p));
  };
  const terminer = (message: string) => {
    setSucces(message);
    setPanneau(null);
  };

  async function envoyer(): Promise<boolean> {
    setErreurEnvoi(null);
    setSucces(null);
    try {
      await api.post(
        cheminApiActionSignature(signatureId, "envoyer"),
        {},
        { redirigerSi401: false },
      );
      setSucces(
        t(
          "Demande envoyée : les signataires sont invités.",
          "Request sent: the signatories have been invited.",
        ),
      );
      rafraichir();
      return true;
    } catch (e) {
      setErreurEnvoi(messageErreurSignature(e, "totp", langue));
      return false;
    }
  }

  if (!actions.envoyer && !actions.annuler && !actions.signer && !actions.refuser) return null;
  return (
    <div className="mp-pile">
      <div className="mp-canaux__actions-ligne">
        {actions.envoyer ? (
          <BoutonConfirmation
            libelle={t("Envoyer aux signataires", "Send to signatories")}
            question={t(
              "Envoyer la demande ? Le document sera partagé avec le client et les signataires seront invités.",
              "Send the request? The document will be shared with the client and the signatories will be invited.",
            )}
            libelleConfirmation={t("Oui, envoyer", "Yes, send")}
            variante="primaire"
            icone="envoyer"
            texteChargement={t("Envoi…", "Sending…")}
            action={envoyer}
          />
        ) : null}
        {actions.signer ? (
          <Bouton
            icone="signature"
            aria-expanded={panneau === "signer"}
            onClick={() => bascule("signer")}
          >
            {t("Signer", "Sign")}
          </Bouton>
        ) : null}
        {actions.refuser ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "refuser"}
            onClick={() => bascule("refuser")}
          >
            {t("Refuser de signer", "Decline to sign")}
          </Bouton>
        ) : null}
        {actions.annuler ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "annuler"}
            onClick={() => bascule("annuler")}
          >
            {t("Annuler la demande", "Cancel the request")}
          </Bouton>
        ) : null}
      </div>
      {erreurEnvoi ? (
        <Alerte tonalite="danger" titre={t("Envoi impossible", "Could not send")}>
          <p>{erreurEnvoi}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {panneau === "signer" ? (
        <FormulaireSignature
          signatureId={signatureId}
          tfaActive={tfaActive}
          onFin={() => setPanneau(null)}
          onSucces={terminer}
        />
      ) : null}
      {panneau === "refuser" ? (
        <FormulaireMotif
          signatureId={signatureId}
          action="refuser"
          onFin={() => setPanneau(null)}
          onSucces={terminer}
        />
      ) : null}
      {panneau === "annuler" ? (
        <FormulaireMotif
          signatureId={signatureId}
          action="annuler"
          onFin={() => setPanneau(null)}
          onSucces={terminer}
        />
      ) : null}
    </div>
  );
}

function FormulaireSignature({
  signatureId,
  tfaActive,
  onFin,
  onSucces,
}: {
  signatureId: string;
  tfaActive: boolean;
  onFin: () => void;
  onSucces: (message: string) => void;
}) {
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const f = useFormulaire<ChampConfirmation>();
  const t = useT();
  const langue = useLangue();
  useFocusInitial(f.refFormulaire);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSignature(confirmation, langue),
      (charge) =>
        api.post(cheminApiActionSignature(signatureId, "signer"), charge, {
          redirigerSi401: false,
        }),
      {
        messageSpecifique: (e) => messageErreurSignature(e, confirmation.facteur, langue),
        apres: () =>
          onSucces(
            t(
              "Signature enregistrée (simulée, sans valeur juridique).",
              "Signature saved (simulated, no legal value).",
            ),
          ),
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
      aria-label={t("Signer le document", "Sign the document")}
    >
      <Alerte tonalite="attention" annonce="aucune" titre={avertissementSignatureSimulee(langue)}>
        <p>
          {t(
            "Vous signez dans CabinetPilot, sous votre identité. Lisez d'abord le document : la lecture est inscrite dans le journal de preuves.",
            "You sign in CabinetPilot, under your identity. Read the document first: the reading is recorded in the evidence log.",
          )}
        </p>
      </Alerte>
      {!tfaActive ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Double authentification requise", "Two-factor authentication required")}
        >
          <p>
            {t(
              "Signer exige une double authentification active sur votre compte. Activez-la depuis « Sécurité du compte », puis revenez ici.",
              'Signing requires active two-factor authentication on your account. Enable it from "Account security", then come back here.',
            )}
          </p>
        </Alerte>
      ) : null}
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Signature impossible", "Could not sign")}
      />
      <ChampsReconfirmation
        saisie={confirmation}
        onChange={setConfirmation}
        erreurs={f.erreurs}
        motif="signer ce document"
        motifEn="sign this document"
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Signature…", "Signing…")}>
          {t("Signer le document", "Sign the document")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireMotif({
  signatureId,
  action,
  onFin,
  onSucces,
}: {
  signatureId: string;
  action: "refuser" | "annuler";
  onFin: () => void;
  onSucces: (message: string) => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const t = useT();
  const langue = useLangue();
  const annulation = action === "annuler";
  useFocusInitial(f.refFormulaire);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerMotifSignature(motif, annulation ? "annulation" : "refus", langue),
      (charge) =>
        api.post(cheminApiActionSignature(signatureId, action), charge, {
          redirigerSi401: false,
        }),
      {
        messageSpecifique: (e) => messageErreurSignature(e, "totp", langue),
        apres: () =>
          onSucces(
            annulation
              ? t("Demande annulée.", "Request canceled.")
              : t("Refus enregistré.", "Refusal recorded."),
          ),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={
        annulation
          ? t("Annuler la demande", "Cancel the request")
          : t("Refuser de signer", "Decline to sign")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={
          annulation
            ? t("Annulation impossible", "Could not cancel")
            : t("Refus impossible", "Could not decline")
        }
      />
      <ZoneTexte
        libelle={
          annulation
            ? t("Motif de l'annulation", "Reason for the cancellation")
            : t("Motif du refus", "Reason for the refusal")
        }
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
          texteChargement={t("Envoi…", "Sending…")}
        >
          {annulation
            ? t("Annuler la demande", "Cancel the request")
            : t("Refuser de signer", "Decline to sign")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Retour", "Back")}
        </Bouton>
      </div>
    </form>
  );
}
