"use client";

import { useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import type { AccuseSignatureApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { dateHeureCourte } from "../../lib/canaux";
import {
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../lib/double-authentification";
import {
  cheminApiActionSignaturePortail,
  hrefDocumentSignaturePortail,
  messageErreurSignaturePortail,
} from "../../lib/portail-canaux";
import {
  avertissementSignatureSimulee,
  empreinteLisible,
  validerMotifSignature,
  validerSignature,
} from "../../lib/signatures";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { ChampsReconfirmation } from "../securite/ChampsReconfirmation";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Icone } from "../ui/Icone";
import { ZoneTexte } from "../ui/ZoneTexte";
import "../canaux/canaux.css";

export interface SignaturePortailProps {
  signatureId: string;
  /** Une demande ouverte dont la personne est invitée à signer. */
  peutSigner: boolean;
  /** Faux tant que le signataire n'est pas invité : l'API répond 404 pour le document. */
  peutLire?: boolean;
}

type Panneau = "signer" | "refuser" | null;

/**
 * Signature depuis l'espace client : lire le document, « Signer » (reconfirmation du mot de passe
 * et du code de double authentification) ou « Refuser » (motif). Signature SIMULÉE, sans valeur
 * juridique. L'accusé ne montre que le statut, la date et l'empreinte du document.
 */
export function SignaturePortail({
  signatureId,
  peutSigner,
  peutLire = true,
}: SignaturePortailProps) {
  const t = useT();
  const langue = useLangue();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [accuse, setAccuse] = useState<AccuseSignatureApi | null>(null);

  return (
    <div className="mp-pile">
      {peutLire ? (
        <p>
          <a
            className="mp-lien-action"
            href={hrefDocumentSignaturePortail(signatureId)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icone nom="oeil" taille={18} />
            <span>{t("Lire le document (nouvel onglet)", "Read the document (new tab)")}</span>
          </a>{" "}
          <a className="mp-lien-action" href={hrefDocumentSignaturePortail(signatureId)} download>
            <span>{t("Télécharger", "Download")}</span>
          </a>
        </p>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Le document sera disponible dès que ce sera votre tour de signer.",
            "The document will be available as soon as it is your turn to sign.",
          )}
        </p>
      )}
      {accuse ? (
        <Alerte
          tonalite="succes"
          annonce="status"
          titre={t("Signature enregistrée", "Signature saved")}
        >
          <p>
            {t(
              `Signée le ${dateHeureCourte(accuse.signe_le)}.`,
              `Signed on ${dateHeureCourte(accuse.signe_le, "en")}.`,
            )}
          </p>
          <p className="mp-canaux__empreinte">{`${t("Empreinte du document", "Document fingerprint")} : ${empreinteLisible(accuse.empreinte_document)}`}</p>
          <p>{avertissementSignatureSimulee(langue)}.</p>
        </Alerte>
      ) : null}
      {peutSigner && !accuse ? (
        <>
          <div className="mp-canaux__actions-ligne">
            <Bouton
              icone="signature"
              aria-expanded={panneau === "signer"}
              onClick={() => setPanneau(panneau === "signer" ? null : "signer")}
            >
              {t("Signer", "Sign")}
            </Bouton>
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "refuser"}
              onClick={() => setPanneau(panneau === "refuser" ? null : "refuser")}
            >
              {t("Refuser", "Decline")}
            </Bouton>
          </div>
          {panneau === "signer" ? (
            <FormulaireSignaturePortail signatureId={signatureId} onAccuse={setAccuse} />
          ) : null}
          {panneau === "refuser" ? (
            <FormulaireRefusPortail signatureId={signatureId} onFin={() => setPanneau(null)} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FormulaireSignaturePortail({
  signatureId,
  onAccuse,
}: {
  signatureId: string;
  onAccuse: (a: AccuseSignatureApi) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const f = useFormulaire<ChampConfirmation>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSignature(confirmation, langue),
      (charge) =>
        api.post<AccuseSignatureApi>(
          cheminApiActionSignaturePortail(signatureId, "signer"),
          charge,
          {
            redirigerSi401: false,
          },
        ),
      {
        rafraichir: false,
        messageSpecifique: (e) => messageErreurSignaturePortail(e, langue),
        apres: (a) => {
          if (a && typeof a.signe_le === "string") onAccuse(a);
          rafraichir();
        },
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
            "Lisez d'abord le document. Pour signer, confirmez votre identité : mot de passe et code de votre application de double authentification.",
            "Read the document first. To sign, confirm your identity: password and code from your two-factor authentication app.",
          )}
        </p>
      </Alerte>
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
      </div>
    </form>
  );
}

function FormulaireRefusPortail({
  signatureId,
  onFin,
}: {
  signatureId: string;
  onFin: () => void;
}) {
  const [motif, setMotif] = useState("");
  const f = useFormulaire<"motif">();
  const t = useT();
  const langue = useLangue();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerMotifSignature(motif, "refus", langue),
      (charge) =>
        api.post(cheminApiActionSignaturePortail(signatureId, "refuser"), charge, {
          redirigerSi401: false,
        }),
      {
        succes: t("Votre refus est enregistré.", "Your refusal has been recorded."),
        messageSpecifique: (e) => messageErreurSignaturePortail(e, langue),
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
      aria-label={t("Refuser de signer", "Decline to sign")}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle={t("Motif du refus", "Reason for the refusal")}
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
          {t("Refuser de signer", "Decline to sign")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
