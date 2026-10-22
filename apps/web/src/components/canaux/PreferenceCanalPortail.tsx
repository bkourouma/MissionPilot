"use client";

import { useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import type { MoiCanalApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  AIDE_NUMERO_SIMULE,
  BANDEAU_SIMULE,
  libelleCanal,
  libelleConsentement,
  tonaliteConsentement,
  validerCodeVerification,
} from "../../lib/canaux";
import {
  cheminPreferenceCanal,
  cheminRetraitCanalPortail,
  cheminVerificationCanalPortail,
  etapePreference,
  messageErreurPreferences,
  MESSAGE_RETRAIT_IMMEDIAT,
  texteMention,
  validerPreference,
} from "../../lib/portail-canaux";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import "./canaux.css";

export interface PreferenceCanalPortailProps {
  moi: MoiCanalApi;
}

/**
 * Préférences de messagerie d'une personne du portail pour un canal (WhatsApp ou SMS) : numéro,
 * mention de consentement à cocher EN ENTIER, code de vérification, retrait immédiat. Le numéro
 * n'est jamais réaffiché en entier. Tout est simulé : aucun message réel.
 */
export function PreferenceCanalPortail({ moi }: PreferenceCanalPortailProps) {
  const [changerNumero, setChangerNumero] = useState(false);
  const { rafraichir } = useRafraichir();
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);
  const etape = etapePreference(moi);
  const nom = libelleCanal(moi.canal);

  async function retirer(): Promise<boolean> {
    setErreurRetrait(null);
    try {
      await api.post(cheminRetraitCanalPortail(moi.canal), {}, { redirigerSi401: false });
      rafraichir();
      return true;
    } catch (e) {
      setErreurRetrait(messageErreurPreferences(e));
      return false;
    }
  }

  return (
    <Carte
      titre={nom}
      niveauTitre={2}
      actions={
        <BadgeStatut tonalite={tonaliteConsentement(moi.consentement)}>
          {`Consentement : ${libelleConsentement(moi.consentement).toLowerCase()}`}
        </BadgeStatut>
      }
    >
      <div className="mp-pile">
        <p className="mp-texte-doux">{BANDEAU_SIMULE}.</p>
        {!moi.canal_actif ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              Votre cabinet n&apos;a pas activé ce canal pour le moment : aucun message ne sera
              envoyé, même si vous donnez votre accord.
            </p>
          </Alerte>
        ) : null}
        {moi.numero_masque ? (
          <p>
            {`Numéro enregistré : ${moi.numero_masque} `}
            <BadgeStatut tonalite={moi.verifie ? "succes" : "attention"}>
              {moi.verifie ? "Vérifié" : "À vérifier"}
            </BadgeStatut>
          </p>
        ) : null}

        {etape === "numero" || changerNumero ? (
          <FormulairePreference
            moi={moi}
            avecNumero
            onFin={() => setChangerNumero(false)}
            titre={changerNumero ? "Changer de numéro" : "Votre numéro"}
          />
        ) : null}
        {etape === "code" && !changerNumero ? <FormulaireCodePortail moi={moi} /> : null}
        {etape === "consentement" && !changerNumero ? (
          <FormulairePreference moi={moi} avecNumero={false} titre="Votre accord" />
        ) : null}
        {etape === "actif" && !changerNumero ? (
          <div className="mp-pile">
            <p>
              Vous recevez des messages de votre cabinet sur ce numéro : rappels et synthèse, sans
              donnée confidentielle. Répondre STOP à un message met fin aux envois.
            </p>
            {erreurRetrait ? (
              <Alerte tonalite="danger" titre="Retrait impossible">
                <p>{erreurRetrait}</p>
              </Alerte>
            ) : null}
            <BoutonConfirmation
              libelle="Ne plus recevoir de messages"
              question={MESSAGE_RETRAIT_IMMEDIAT}
              libelleConfirmation="Oui, ne plus recevoir"
              texteChargement="Retrait…"
              action={retirer}
              ariaLabel={`Ne plus recevoir de messages ${nom}`}
            />
          </div>
        ) : null}
        {etape !== "numero" ? (
          <div>
            <Bouton variante="discret" onClick={() => setChangerNumero((c) => !c)}>
              {changerNumero ? "Garder ce numéro" : "Changer de numéro"}
            </Bouton>
          </div>
        ) : null}
      </div>
    </Carte>
  );
}

function FormulairePreference({
  moi,
  avecNumero,
  onFin,
  titre,
}: {
  moi: MoiCanalApi;
  avecNumero: boolean;
  onFin?: () => void;
  titre: string;
}) {
  const [numero, setNumero] = useState("");
  const [cochee, setCochee] = useState(false);
  const f = useFormulaire<"numero" | "mention">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerPreference({ numero, mentionCochee: cochee, avecNumero }, moi.mention.version),
      (charge) => api.put(cheminPreferenceCanal(moi.canal), charge, { redirigerSi401: false }),
      {
        succes: avecNumero
          ? "Numéro enregistré : un code de vérification vous est envoyé (simulé)."
          : "Merci : votre accord est enregistré.",
        messageSpecifique: (e) => messageErreurPreferences(e),
        apres: () => {
          setNumero("");
          setCochee(false);
          onFin?.();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`${titre} (${libelleCanal(moi.canal)})`}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {avecNumero ? (
        <Champ
          libelle="Numéro de téléphone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={40}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          erreur={f.erreurs.numero}
          aide={AIDE_NUMERO_SIMULE}
        />
      ) : null}
      <blockquote className="mp-canaux__mention">{texteMention(moi)}</blockquote>
      <CaseACocher
        libelle="J'ai lu et j'accepte ce texte"
        checked={cochee}
        onChange={(e) => setCochee(e.target.checked)}
      />
      {f.erreurs.mention ? <p className="mp-champ__erreur">{f.erreurs.mention}</p> : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {avecNumero ? "Enregistrer et recevoir un code" : "Donner mon accord"}
        </Bouton>
        {onFin ? (
          <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
            Annuler
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

function FormulaireCodePortail({ moi }: { moi: MoiCanalApi }) {
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCodeVerification(code),
      (charge) =>
        api.post(cheminVerificationCanalPortail(moi.canal), charge, { redirigerSi401: false }),
      {
        succes: "Numéro vérifié.",
        messageSpecifique: (e) => messageErreurPreferences(e),
        apres: () => setCode(""),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Code de vérification (${libelleCanal(moi.canal)})`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Vérification impossible"
      />
      <Champ
        libelle="Code reçu (6 chiffres)"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={10}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        erreur={f.erreurs.code}
        aide="Valable 10 minutes. Le message est simulé : aucun SMS ni WhatsApp réel n'est envoyé."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Vérification…">
          Vérifier mon numéro
        </Bouton>
      </div>
    </form>
  );
}
