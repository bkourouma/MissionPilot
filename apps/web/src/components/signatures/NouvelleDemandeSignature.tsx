"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useRafraichir } from "../formulaires/useRafraichir";
import type { ObjetSignature } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import type { VersionDocument } from "../../lib/documents";
import {
  cheminApiSignatures,
  documentsSignables,
  hrefSignature,
  libelleDocumentSignable,
  libellePartie,
  messageErreurSignature,
  optionsObjetSignature,
  optionsOrdreSignature,
  PLAFONDS_SIGNATURES,
  validerDemandeSignature,
  type ChampDemandeSignature,
  type SignatairePropose,
} from "../../lib/signatures";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import "../canaux/canaux.css";

export interface NouvelleDemandeSignatureProps {
  missionId: string;
  /** Documents de la mission (versions) ; seuls les PDF du type attendu sont proposés. */
  documents: readonly VersionDocument[];
  /** Personnes proposées comme signataires (cabinet et client). */
  proposes: readonly SignatairePropose[];
  /** Pourquoi la liste des signataires du client est vide, le cas échéant. */
  noteClient: string | null;
}

/**
 * « Demander une signature » : un PDF de la mission, l'objet, l'ordre, la durée de validité et les
 * signataires. La demande naît en brouillon ; elle n'est envoyée aux signataires qu'à l'étape
 * « Envoyer » de son détail. Signature simulée, sans valeur juridique.
 */
export function NouvelleDemandeSignature({
  missionId,
  documents,
  proposes,
  noteClient,
}: NouvelleDemandeSignatureProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [objet, setObjet] = useState<ObjetSignature>("lettre_mission");
  const [documentId, setDocumentId] = useState("");
  const [ordre, setOrdre] = useState("parallele");
  const [jours, setJours] = useState(String(PLAFONDS_SIGNATURES.validiteJoursDefaut));
  const [choisis, setChoisis] = useState<string[]>([]);
  const f = useFormulaire<ChampDemandeSignature>();
  const signables = documentsSignables(documents, objet);

  if (!ouvert) {
    return (
      <div>
        <Bouton icone="signature" onClick={() => setOuvert(true)}>
          {t("Demander une signature", "Request a signature")}
        </Bouton>
      </div>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerDemandeSignature(
        { document_id: documentId, objet, ordre, expire_jours: jours, signataires: choisis },
        proposes,
        langue,
      ),
      (charge) =>
        api.post<{ id?: string }>(cheminApiSignatures(missionId), charge, {
          redirigerSi401: false,
        }),
      {
        rafraichir: false,
        succes: t(
          "Demande créée en brouillon. Ouvrez-la pour l'envoyer aux signataires.",
          "Request created as a draft. Open it to send it to the signatories.",
        ),
        messageSpecifique: (e) => messageErreurSignature(e, "totp", langue),
        apres: (r) => {
          if (r && typeof r.id === "string") router.push(hrefSignature(missionId, r.id));
          else rafraichir();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Demander une signature", "Request a signature")}
    >
      <p className="mp-sous-formulaire__titre">
        {t("Demander une signature", "Request a signature")}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Demande impossible", "Could not create the request")}
      />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Select
          libelle={t("Ce que vous faites signer", "What you are sending for signature")}
          required
          value={objet}
          onChange={(e) => {
            setObjet(e.target.value as ObjetSignature);
            setDocumentId("");
          }}
          options={optionsObjetSignature(langue)}
          erreur={f.erreurs.objet}
        />
        <Select
          libelle={t("Document PDF de la mission", "Engagement PDF document")}
          required
          invite={t("Choisir un document…", "Choose a document…")}
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          options={signables.map((d) => ({
            valeur: d.id,
            libelle: libelleDocumentSignable(d, langue),
          }))}
          erreur={f.erreurs.document_id}
          aide={
            signables.length === 0
              ? t(
                  "Aucun PDF de ce type n'est déposé dans la mission : ajoutez-le d'abord dans l'onglet « Documents ».",
                  'No PDF of this type has been uploaded to the engagement: add it first in the "Documents" tab.',
                )
              : undefined
          }
        />
        <Select
          libelle={t("Ordre des signatures", "Signing order")}
          value={ordre}
          onChange={(e) => setOrdre(e.target.value)}
          options={optionsOrdreSignature(langue)}
          erreur={f.erreurs.ordre}
        />
        <Champ
          libelle={t("Durée de validité (jours)", "Validity period (days)")}
          type="number"
          inputMode="numeric"
          min={PLAFONDS_SIGNATURES.validiteJoursMin}
          max={PLAFONDS_SIGNATURES.validiteJoursMax}
          value={jours}
          onChange={(e) => setJours(e.target.value)}
          erreur={f.erreurs.expire_jours}
          aide={t(
            `De ${PLAFONDS_SIGNATURES.validiteJoursMin} à ${PLAFONDS_SIGNATURES.validiteJoursMax} jours, à compter de l'envoi (l'échéance définitive est fixée à l'envoi).`,
            `From ${PLAFONDS_SIGNATURES.validiteJoursMin} to ${PLAFONDS_SIGNATURES.validiteJoursMax} days, counted from sending (the final due date is set when sent).`,
          )}
        />
      </div>
      {proposes.length === 0 ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Aucun signataire proposé", "No signatory proposed")}
        >
          <p>
            {noteClient ??
              t(
                "Aucune personne ne peut être proposée comme signataire.",
                "No one can be proposed as a signatory.",
              )}
          </p>
        </Alerte>
      ) : (
        <fieldset className={f.erreurs.signataires ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}>
          <legend className="mp-champ__libelle">{t("Signataires", "Signatories")}</legend>
          {noteClient ? <p className="mp-champ__aide">{noteClient}</p> : null}
          <div className="mp-canaux__options">
            {proposes.map((p) => (
              <CaseACocher
                key={p.utilisateur_id}
                libelle={`${p.nom} (${libellePartie(p.partie, langue)})`}
                aide={p.detail}
                checked={choisis.includes(p.utilisateur_id)}
                onChange={(e) =>
                  setChoisis(
                    e.target.checked
                      ? [...choisis, p.utilisateur_id]
                      : choisis.filter((x) => x !== p.utilisateur_id),
                  )
                }
              />
            ))}
          </div>
          {f.erreurs.signataires ? (
            <p className="mp-champ__erreur">{f.erreurs.signataires}</p>
          ) : null}
        </fieldset>
      )}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Création…", "Creating…")}>
          {t("Créer la demande", "Create the request")}
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
