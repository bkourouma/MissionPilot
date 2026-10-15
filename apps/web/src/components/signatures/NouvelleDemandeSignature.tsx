"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ObjetSignature } from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { VersionDocument } from "../../lib/documents";
import {
  cheminApiSignatures,
  documentsSignables,
  hrefSignature,
  libelleDocumentSignable,
  libellePartie,
  messageErreurSignature,
  OPTIONS_OBJET_SIGNATURE,
  OPTIONS_ORDRE_SIGNATURE,
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
          Demander une signature
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
      ),
      (charge) =>
        api.post<{ id?: string }>(cheminApiSignatures(missionId), charge, {
          redirigerSi401: false,
        }),
      {
        rafraichir: false,
        succes: "Demande créée en brouillon. Ouvrez-la pour l'envoyer aux signataires.",
        messageSpecifique: (e) => messageErreurSignature(e),
        apres: (r) => {
          if (r && typeof r.id === "string") router.push(hrefSignature(missionId, r.id));
          else router.refresh();
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
      aria-label="Demander une signature"
    >
      <p className="mp-sous-formulaire__titre">Demander une signature</p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Demande impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Ce que vous faites signer"
          required
          value={objet}
          onChange={(e) => {
            setObjet(e.target.value as ObjetSignature);
            setDocumentId("");
          }}
          options={OPTIONS_OBJET_SIGNATURE}
          erreur={f.erreurs.objet}
        />
        <Select
          libelle="Document PDF de la mission"
          required
          invite="Choisir un document…"
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          options={signables.map((d) => ({ valeur: d.id, libelle: libelleDocumentSignable(d) }))}
          erreur={f.erreurs.document_id}
          aide={
            signables.length === 0
              ? "Aucun PDF de ce type n'est déposé dans la mission : ajoutez-le d'abord dans l'onglet « Documents »."
              : undefined
          }
        />
        <Select
          libelle="Ordre des signatures"
          value={ordre}
          onChange={(e) => setOrdre(e.target.value)}
          options={OPTIONS_ORDRE_SIGNATURE}
          erreur={f.erreurs.ordre}
        />
        <Champ
          libelle="Durée de validité (jours)"
          type="number"
          inputMode="numeric"
          min={PLAFONDS_SIGNATURES.validiteJoursMin}
          max={PLAFONDS_SIGNATURES.validiteJoursMax}
          value={jours}
          onChange={(e) => setJours(e.target.value)}
          erreur={f.erreurs.expire_jours}
          aide={`De ${PLAFONDS_SIGNATURES.validiteJoursMin} à ${PLAFONDS_SIGNATURES.validiteJoursMax} jours, à compter de l'envoi.`}
        />
      </div>
      {proposes.length === 0 ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Aucun signataire proposé">
          <p>{noteClient ?? "Aucune personne ne peut être proposée comme signataire."}</p>
        </Alerte>
      ) : (
        <fieldset className={f.erreurs.signataires ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}>
          <legend className="mp-champ__libelle">Signataires</legend>
          {noteClient ? <p className="mp-champ__aide">{noteClient}</p> : null}
          <div className="mp-canaux__options">
            {proposes.map((p) => (
              <CaseACocher
                key={p.utilisateur_id}
                libelle={`${p.nom} (${libellePartie(p.partie)})`}
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
        <Bouton type="submit" chargement={f.enCours} texteChargement="Création…">
          Créer la demande
        </Bouton>
        <Bouton variante="discret" onClick={() => setOuvert(false)} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
