"use client";

import { useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import type { MoiCanalApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  aideNumeroSimule,
  textesCanaux,
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
  MESSAGE_RETRAIT_IMMEDIAT_EN,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const [changerNumero, setChangerNumero] = useState(false);
  const { rafraichir } = useRafraichir();
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);
  const etape = etapePreference(moi);
  const nom = libelleCanal(moi.canal, langue);

  async function retirer(): Promise<boolean> {
    setErreurRetrait(null);
    try {
      await api.post(cheminRetraitCanalPortail(moi.canal), {}, { redirigerSi401: false });
      rafraichir();
      return true;
    } catch (e) {
      setErreurRetrait(messageErreurPreferences(e, langue));
      return false;
    }
  }

  return (
    <Carte
      titre={nom}
      niveauTitre={2}
      actions={
        <BadgeStatut tonalite={tonaliteConsentement(moi.consentement)}>
          {`${t("Consentement", "Consent")}${t(" : ", ": ")}${libelleConsentement(moi.consentement, langue).toLowerCase()}`}
        </BadgeStatut>
      }
    >
      <div className="mp-pile">
        <p className="mp-texte-doux">{textesCanaux(langue).bandeauSimule}.</p>
        {!moi.canal_actif ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "Votre cabinet n'a pas activé ce canal pour le moment : aucun message ne sera envoyé, même si vous donnez votre accord.",
                "Your firm has not enabled this channel for now: no message will be sent, even if you give your consent.",
              )}
            </p>
          </Alerte>
        ) : null}
        {moi.numero_masque ? (
          <p>
            {`${t("Numéro enregistré", "Saved number")}${t(" : ", ": ")}${moi.numero_masque} `}
            <BadgeStatut tonalite={moi.verifie ? "succes" : "attention"}>
              {moi.verifie ? t("Vérifié", "Verified") : t("À vérifier", "To verify")}
            </BadgeStatut>
          </p>
        ) : null}

        {etape === "numero" || changerNumero ? (
          <FormulairePreference
            moi={moi}
            avecNumero
            onFin={() => setChangerNumero(false)}
            titre={
              changerNumero
                ? t("Changer de numéro", "Change number")
                : t("Votre numéro", "Your number")
            }
          />
        ) : null}
        {etape === "code" && !changerNumero ? <FormulaireCodePortail moi={moi} /> : null}
        {etape === "consentement" && !changerNumero ? (
          <FormulairePreference
            moi={moi}
            avecNumero={false}
            titre={t("Votre accord", "Your consent")}
          />
        ) : null}
        {etape === "actif" && !changerNumero ? (
          <div className="mp-pile">
            <p>
              {t(
                "Vous recevez des messages de votre cabinet sur ce numéro : rappels et synthèse, sans donnée confidentielle. Répondre STOP à un message met fin aux envois.",
                "You receive messages from your firm on this number: reminders and summary, with no confidential data. Replying STOP to a message ends the sends.",
              )}
            </p>
            {erreurRetrait ? (
              <Alerte tonalite="danger" titre={t("Retrait impossible", "Withdrawal not possible")}>
                <p>{erreurRetrait}</p>
              </Alerte>
            ) : null}
            <BoutonConfirmation
              libelle={t("Ne plus recevoir de messages", "Stop receiving messages")}
              question={t(MESSAGE_RETRAIT_IMMEDIAT, MESSAGE_RETRAIT_IMMEDIAT_EN)}
              libelleConfirmation={t("Oui, ne plus recevoir", "Yes, stop receiving")}
              texteChargement={t("Retrait…", "Withdrawing…")}
              action={retirer}
              ariaLabel={t(`Ne plus recevoir de messages ${nom}`, `Stop receiving ${nom} messages`)}
            />
          </div>
        ) : null}
        {etape !== "numero" ? (
          <div>
            <Bouton variante="discret" onClick={() => setChangerNumero((c) => !c)}>
              {changerNumero
                ? t("Garder ce numéro", "Keep this number")
                : t("Changer de numéro", "Change number")}
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
  const t = useT();
  const langue = useLangue();
  const [numero, setNumero] = useState("");
  const [cochee, setCochee] = useState(false);
  const f = useFormulaire<"numero" | "mention">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerPreference({ numero, mentionCochee: cochee, avecNumero }, moi.mention.version, langue),
      (charge) => api.put(cheminPreferenceCanal(moi.canal), charge, { redirigerSi401: false }),
      {
        succes: avecNumero
          ? t(
              "Numéro enregistré : un code de vérification vous est envoyé (simulé).",
              "Number saved: a verification code is being sent to you (simulated).",
            )
          : t("Merci : votre accord est enregistré.", "Thank you: your consent has been saved."),
        messageSpecifique: (e) => messageErreurPreferences(e, langue),
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
      aria-label={`${titre} (${libelleCanal(moi.canal, langue)})`}
    >
      <p className="mp-sous-formulaire__titre">{titre}</p>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {avecNumero ? (
        <Champ
          libelle={t("Numéro de téléphone", "Phone number")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={40}
          value={numero}
          onChange={(e) => setNumero(e.target.value)}
          erreur={f.erreurs.numero}
          aide={aideNumeroSimule(langue)}
        />
      ) : null}
      <blockquote className="mp-canaux__mention">{texteMention(moi, langue)}</blockquote>
      <CaseACocher
        libelle={t("J'ai lu et j'accepte ce texte", "I have read and accept this text")}
        checked={cochee}
        onChange={(e) => setCochee(e.target.checked)}
      />
      {f.erreurs.mention ? <p className="mp-champ__erreur">{f.erreurs.mention}</p> : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {avecNumero
            ? t("Enregistrer et recevoir un code", "Save and receive a code")
            : t("Donner mon accord", "Give my consent")}
        </Bouton>
        {onFin ? (
          <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
            {t("Annuler", "Cancel")}
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

function FormulaireCodePortail({ moi }: { moi: MoiCanalApi }) {
  const t = useT();
  const langue = useLangue();
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCodeVerification(code, langue),
      (charge) =>
        api.post(cheminVerificationCanalPortail(moi.canal), charge, { redirigerSi401: false }),
      {
        succes: t("Numéro vérifié.", "Number verified."),
        messageSpecifique: (e) => messageErreurPreferences(e, langue),
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
      aria-label={`${t("Code de vérification", "Verification code")} (${libelleCanal(moi.canal, langue)})`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Vérification impossible", "Verification not possible")}
      />
      <Champ
        libelle={t("Code reçu (6 chiffres)", "Code received (6 digits)")}
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={10}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        erreur={f.erreurs.code}
        aide={t(
          "Valable 10 minutes. Le message est simulé : aucun SMS ni WhatsApp réel n'est envoyé.",
          "Valid for 10 minutes. The message is simulated: no real SMS or WhatsApp is sent.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
        >
          {t("Vérifier mon numéro", "Verify my number")}
        </Bouton>
      </div>
    </form>
  );
}
