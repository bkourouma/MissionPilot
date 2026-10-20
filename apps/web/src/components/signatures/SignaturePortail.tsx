"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AccuseSignatureApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
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
  AVERTISSEMENT_SIGNATURE_SIMULEE,
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
            <span>Lire le document (nouvel onglet)</span>
          </a>
        </p>
      ) : (
        <p className="mp-texte-doux">
          Le document sera disponible dès que ce sera votre tour de signer.
        </p>
      )}
      {accuse ? (
        <Alerte tonalite="succes" annonce="status" titre="Signature enregistrée">
          <p>{`Signée le ${dateHeureCourte(accuse.signe_le)}.`}</p>
          <p className="mp-canaux__empreinte">{`Empreinte du document : ${empreinteLisible(accuse.empreinte_document)}`}</p>
          <p>{AVERTISSEMENT_SIGNATURE_SIMULEE}.</p>
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
              Signer
            </Bouton>
            <Bouton
              variante="secondaire"
              aria-expanded={panneau === "refuser"}
              onClick={() => setPanneau(panneau === "refuser" ? null : "refuser")}
            >
              Refuser
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
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const f = useFormulaire<ChampConfirmation>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSignature(confirmation),
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
        messageSpecifique: (e) => messageErreurSignaturePortail(e),
        apres: (a) => {
          if (a && typeof a.signe_le === "string") onAccuse(a);
          router.refresh();
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
      aria-label="Signer le document"
    >
      <Alerte tonalite="attention" annonce="aucune" titre={AVERTISSEMENT_SIGNATURE_SIMULEE}>
        <p>
          Lisez d&apos;abord le document. Pour signer, confirmez votre identité : mot de passe et
          code de votre application de double authentification.
        </p>
      </Alerte>
      <RetourFormulaire
        erreur={f.erreurGlobale}
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

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerMotifSignature(motif, "refus"),
      (charge) =>
        api.post(cheminApiActionSignaturePortail(signatureId, "refuser"), charge, {
          redirigerSi401: false,
        }),
      {
        succes: "Votre refus est enregistré.",
        messageSpecifique: (e) => messageErreurSignaturePortail(e),
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
      aria-label="Refuser de signer"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ZoneTexte
        libelle="Motif du refus"
        required
        maxLength={500}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="danger" chargement={f.enCours} texteChargement="Envoi…">
          Refuser de signer
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
