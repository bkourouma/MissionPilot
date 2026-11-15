"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRafraichir } from "../formulaires/useRafraichir";
import type { ConsentementHistoriqueApi, DestinataireCanalApi } from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import {
  actionsDestinataire,
  aideNumeroSimule,
  cheminConsentementsDestinataire,
  cheminNumeroDestinataire,
  cheminVerificationDestinataire,
  dateHeureCourte,
  libelleCanal,
  libelleConsentement,
  libelleSourceConsentement,
  messageErreurCanaux,
  pageDepuis,
  validerCodeVerification,
  validerNumeroSaisi,
  validerReferencePreuve,
} from "../../lib/canaux";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import "./canaux.css";

export interface ActionsDestinataireCanalProps {
  destinataire: DestinataireCanalApi;
  /** `canaux.gerer` : numéros, consentements recueillis, retraits. */
  peutGerer: boolean;
}

type Panneau = "numero" | "code" | "consentement" | "historique" | null;

/**
 * Actions du cabinet sur un destinataire (une personne et un canal) : enregistrer un numéro (de
 * test, jamais réaffiché en entier), saisir le code reçu, enregistrer un consentement recueilli
 * (référence de la preuve obligatoire), retirer, lire l'historique. Un retrait n'est jamais
 * refusé ; après un STOP, seule la personne redonne son accord.
 */
export function ActionsDestinataireCanal({
  destinataire: d,
  peutGerer,
}: ActionsDestinataireCanalProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);
  const actions = actionsDestinataire(d, { gerer: peutGerer }, langue);
  const bascule = (p: Exclude<Panneau, null>) =>
    setPanneau((courant) => (courant === p ? null : p));
  const nom = `${d.utilisateur_nom} (${libelleCanal(d.canal, langue)})`;
  // Nul tant qu'aucun numéro n'est enregistré : ni code, ni consentement, ni historique alors.
  const destinataireId = d.id;

  async function retirer(): Promise<boolean> {
    if (destinataireId === null) return false;
    setErreurRetrait(null);
    try {
      await api.post(
        cheminConsentementsDestinataire(destinataireId),
        { statut: "retire" },
        { redirigerSi401: false },
      );
      rafraichir();
      return true;
    } catch (e) {
      setErreurRetrait(messageErreurCanaux(e, "totp", langue));
      return false;
    }
  }

  return (
    <div>
      <div className="mp-canaux__actions-ligne">
        {actions.enregistrerNumero ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "numero"}
            aria-label={
              d.numero_masque
                ? t(`Changer le numéro de ${nom}`, `Change the number of ${nom}`)
                : t(`Enregistrer le numéro de ${nom}`, `Save the number of ${nom}`)
            }
            onClick={() => bascule("numero")}
          >
            {d.numero_masque
              ? t("Changer le numéro", "Change the number")
              : t("Enregistrer un numéro", "Save a number")}
          </Bouton>
        ) : null}
        {actions.saisirCode && destinataireId !== null ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "code"}
            aria-label={t(`Saisir le code reçu pour ${nom}`, `Enter the code received for ${nom}`)}
            onClick={() => bascule("code")}
          >
            {t("Saisir le code", "Enter the code")}
          </Bouton>
        ) : null}
        {actions.enregistrerConsentement && destinataireId !== null ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "consentement"}
            aria-label={t(
              `Enregistrer un consentement recueilli pour ${nom}`,
              `Save a collected consent for ${nom}`,
            )}
            onClick={() => bascule("consentement")}
          >
            {t("Consentement recueilli", "Collected consent")}
          </Bouton>
        ) : null}
        {actions.retirer && destinataireId !== null ? (
          <BoutonConfirmation
            libelle={t("Retirer", "Withdraw")}
            ariaLabel={t(`Retirer le consentement de ${nom}`, `Withdraw the consent of ${nom}`)}
            question={t(
              `Retirer le consentement de ${d.utilisateur_nom} sur ${libelleCanal(d.canal, "fr")} ? Plus aucun message ne lui sera envoyé.`,
              `Withdraw the consent of ${d.utilisateur_nom} on ${libelleCanal(d.canal, "en")}? No more messages will be sent to them.`,
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, withdraw")}
            texteChargement={t("Retrait…", "Withdrawing…")}
            action={retirer}
          />
        ) : null}
        {destinataireId !== null ? (
          <Bouton
            variante="discret"
            aria-expanded={panneau === "historique"}
            aria-label={t(`Historique des consentements de ${nom}`, `Consent history of ${nom}`)}
            onClick={() => bascule("historique")}
          >
            {t("Historique", "History")}
          </Bouton>
        ) : null}
      </div>
      {erreurRetrait ? (
        <Alerte tonalite="danger" titre={t("Retrait impossible", "Withdrawal not possible")}>
          <p>{erreurRetrait}</p>
        </Alerte>
      ) : null}
      {actions.motifConsentementImpossible ? (
        <p className="mp-texte-doux mp-texte-petit">{actions.motifConsentementImpossible}</p>
      ) : null}
      {panneau === "numero" ? (
        <FormulaireNumero destinataire={d} onFin={(suite) => setPanneau(suite)} />
      ) : null}
      {panneau === "code" && destinataireId !== null ? (
        <FormulaireCode
          destinataire={d}
          destinataireId={destinataireId}
          onFin={() => setPanneau(null)}
        />
      ) : null}
      {panneau === "consentement" && destinataireId !== null ? (
        <FormulaireConsentement
          destinataire={d}
          destinataireId={destinataireId}
          onFin={() => setPanneau(null)}
        />
      ) : null}
      {panneau === "historique" && destinataireId !== null ? (
        <HistoriqueConsentements destinataire={d} destinataireId={destinataireId} />
      ) : null}
    </div>
  );
}

function FormulaireNumero({
  destinataire: d,
  onFin,
}: {
  destinataire: DestinataireCanalApi;
  onFin: (suite: Panneau) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [numero, setNumero] = useState("");
  const f = useFormulaire<"numero">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerNumeroSaisi(numero, langue),
      (charge) =>
        api.put(cheminNumeroDestinataire(d.utilisateur_id, d.canal), charge, {
          redirigerSi401: false,
        }),
      {
        succes: t(
          "Numéro enregistré : un code de vérification a été envoyé (simulé : il apparaît dans la boîte du simulateur). Saisissez-le pour vérifier le numéro.",
          "Number saved: a verification code has been sent (simulated: it appears in the simulator mailbox). Enter it to verify the number.",
        ),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: () => {
          setNumero("");
          onFin("code");
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t(`Numéro de ${d.utilisateur_nom}`, `Number of ${d.utilisateur_nom}`)}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Champ
        libelle={t("Numéro de téléphone", "Phone number")}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        required
        maxLength={40}
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        erreur={f.erreurs.numero}
        aide={aideNumeroSimule(langue)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer et envoyer le code", "Save and send the code")}
        </Bouton>
        <Bouton variante="discret" onClick={() => onFin(null)} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireCode({
  destinataire: d,
  destinataireId,
  onFin,
}: {
  destinataire: DestinataireCanalApi;
  destinataireId: string;
  onFin: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCodeVerification(code, langue),
      (charge) =>
        api.post(cheminVerificationDestinataire(destinataireId), charge, { redirigerSi401: false }),
      {
        succes: t("Numéro vérifié.", "Number verified."),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: () => {
          setCode("");
          onFin();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Code de vérification de ${d.utilisateur_nom}`,
        `Verification code of ${d.utilisateur_nom}`,
      )}
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
          "Valable 10 minutes, 5 essais. Le code envoyé est simulé : il se lit dans la boîte du simulateur.",
          "Valid for 10 minutes, 5 attempts. The code sent is simulated: read it in the simulator mailbox.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Vérification…", "Verifying…")}
        >
          {t("Vérifier le numéro", "Verify the number")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function FormulaireConsentement({
  destinataire: d,
  destinataireId,
  onFin,
}: {
  destinataire: DestinataireCanalApi;
  destinataireId: string;
  onFin: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [reference, setReference] = useState("");
  const f = useFormulaire<"reference_preuve">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerReferencePreuve(reference, langue),
      (charge) =>
        api.post(cheminConsentementsDestinataire(destinataireId), charge, {
          redirigerSi401: false,
        }),
      {
        succes: t("Consentement enregistré.", "Consent saved."),
        messageSpecifique: (e) => messageErreurCanaux(e, "totp", langue),
        apres: () => {
          setReference("");
          onFin();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-canaux__panneau"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Consentement recueilli pour ${d.utilisateur_nom}`,
        `Collected consent for ${d.utilisateur_nom}`,
      )}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        {t(
          "À utiliser quand la personne a donné son accord par écrit ou oralement, hors de CabinetPilot. La référence de la preuve est conservée dans l'historique.",
          "Use when the person has given consent in writing or orally, outside CabinetPilot. The reference of the proof is kept in the history.",
        )}
      </p>
      <ZoneTexte
        libelle={t("Référence de la preuve", "Proof reference")}
        required
        maxLength={500}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        erreur={f.erreurs.reference_preuve}
        aide={t(
          "10 caractères au moins : par exemple « formulaire signé le 12/03/2027, dossier n° 24 ».",
          'At least 10 characters: for example "form signed on 12/03/2027, file no. 24".',
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le consentement", "Save the consent")}
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}

function HistoriqueConsentements({
  destinataire: d,
  destinataireId,
}: {
  destinataire: DestinataireCanalApi;
  destinataireId: string;
}) {
  const t = useT();
  const langue = useLangue();
  const [etat, setEtat] = useState<
    | { etape: "attente" }
    | { etape: "erreur"; message: string }
    | { etape: "pret"; lignes: ConsentementHistoriqueApi[]; suite: boolean }
  >({ etape: "attente" });

  // Chargement à l'ouverture seulement (historique en ajout seul, lu à la demande).
  useEffect(() => {
    let annule = false;
    api
      .get<unknown>(`${cheminConsentementsDestinataire(destinataireId)}?limite=100`, {
        redirigerSi401: false,
      })
      .then((corps) => {
        if (annule) return;
        const page = pageDepuis<ConsentementHistoriqueApi>(corps);
        setEtat({ etape: "pret", lignes: page.elements, suite: page.suivant !== null });
      })
      .catch((e: unknown) => {
        if (!annule) setEtat({ etape: "erreur", message: messageErreur(e) });
      });
    return () => {
      annule = true;
    };
  }, [destinataireId]);

  return (
    <div
      className="mp-canaux__panneau"
      role="region"
      aria-label={t(`Historique de ${d.utilisateur_nom}`, `History of ${d.utilisateur_nom}`)}
    >
      {etat.etape === "attente" ? (
        <p className="mp-texte-doux" role="status">
          {t("Chargement de l'historique…", "Loading history…")}
        </p>
      ) : etat.etape === "erreur" ? (
        <Alerte
          tonalite="danger"
          titre={t("L'historique n'a pas pu être chargé.", "The history could not be loaded.")}
        >
          <p>{etat.message}</p>
        </Alerte>
      ) : etat.lignes.length === 0 ? (
        <p className="mp-texte-doux">
          {t("Aucun consentement n'a encore été enregistré.", "No consent has been recorded yet.")}
        </p>
      ) : (
        <>
          <ul className="mp-canaux__historique">
            {etat.lignes.map((l) => (
              <li key={l.id}>
                <BadgeStatut tonalite={l.statut === "accorde" ? "succes" : "danger"}>
                  {libelleConsentement(l.statut, langue)}
                </BadgeStatut>
                <span>{libelleSourceConsentement(l.source, langue)}</span>
                <span className="mp-texte-doux">{dateHeureCourte(l.cree_le, langue)}</span>
                {l.reference_preuve ? (
                  <span className="mp-texte-doux">{`${t("Preuve", "Proof")}${t(" : ", ": ")}${l.reference_preuve}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {etat.suite ? (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "Seuls les 100 enregistrements les plus récents sont affichés.",
                "Only the 100 most recent records are shown.",
              )}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
