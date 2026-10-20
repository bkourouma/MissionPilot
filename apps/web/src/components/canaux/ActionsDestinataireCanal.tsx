"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ConsentementHistoriqueApi, DestinataireCanalApi } from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import {
  actionsDestinataire,
  AIDE_NUMERO_SIMULE,
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
  const router = useRouter();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [erreurRetrait, setErreurRetrait] = useState<string | null>(null);
  const actions = actionsDestinataire(d, { gerer: peutGerer });
  const bascule = (p: Exclude<Panneau, null>) =>
    setPanneau((courant) => (courant === p ? null : p));
  const nom = `${d.utilisateur_nom} (${libelleCanal(d.canal)})`;
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
      router.refresh();
      return true;
    } catch (e) {
      setErreurRetrait(messageErreurCanaux(e));
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
            aria-label={`${d.numero_masque ? "Changer" : "Enregistrer"} le numéro de ${nom}`}
            onClick={() => bascule("numero")}
          >
            {d.numero_masque ? "Changer le numéro" : "Enregistrer un numéro"}
          </Bouton>
        ) : null}
        {actions.saisirCode && destinataireId !== null ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "code"}
            aria-label={`Saisir le code reçu pour ${nom}`}
            onClick={() => bascule("code")}
          >
            Saisir le code
          </Bouton>
        ) : null}
        {actions.enregistrerConsentement && destinataireId !== null ? (
          <Bouton
            variante="secondaire"
            aria-expanded={panneau === "consentement"}
            aria-label={`Enregistrer un consentement recueilli pour ${nom}`}
            onClick={() => bascule("consentement")}
          >
            Consentement recueilli
          </Bouton>
        ) : null}
        {actions.retirer && destinataireId !== null ? (
          <BoutonConfirmation
            libelle="Retirer"
            ariaLabel={`Retirer le consentement de ${nom}`}
            question={`Retirer le consentement de ${d.utilisateur_nom} sur ${libelleCanal(d.canal)} ? Plus aucun message ne lui sera envoyé.`}
            libelleConfirmation="Oui, retirer"
            texteChargement="Retrait…"
            action={retirer}
          />
        ) : null}
        {destinataireId !== null ? (
          <Bouton
            variante="discret"
            aria-expanded={panneau === "historique"}
            aria-label={`Historique des consentements de ${nom}`}
            onClick={() => bascule("historique")}
          >
            Historique
          </Bouton>
        ) : null}
      </div>
      {erreurRetrait ? (
        <Alerte tonalite="danger" titre="Retrait impossible">
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
  const [numero, setNumero] = useState("");
  const f = useFormulaire<"numero">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerNumeroSaisi(numero),
      (charge) =>
        api.put(cheminNumeroDestinataire(d.utilisateur_id, d.canal), charge, {
          redirigerSi401: false,
        }),
      {
        succes:
          "Numéro enregistré : un code de vérification a été envoyé (simulé : il apparaît dans la boîte du simulateur). Saisissez-le pour vérifier le numéro.",
        messageSpecifique: (e) => messageErreurCanaux(e),
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
      aria-label={`Numéro de ${d.utilisateur_nom}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Champ
        libelle="Numéro de téléphone"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        required
        maxLength={40}
        value={numero}
        onChange={(e) => setNumero(e.target.value)}
        erreur={f.erreurs.numero}
        aide={AIDE_NUMERO_SIMULE}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer et envoyer le code
        </Bouton>
        <Bouton variante="discret" onClick={() => onFin(null)} disabled={f.enCours}>
          Annuler
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
  const [code, setCode] = useState("");
  const f = useFormulaire<"code">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCodeVerification(code),
      (charge) =>
        api.post(cheminVerificationDestinataire(destinataireId), charge, { redirigerSi401: false }),
      {
        succes: "Numéro vérifié.",
        messageSpecifique: (e) => messageErreurCanaux(e),
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
      aria-label={`Code de vérification de ${d.utilisateur_nom}`}
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
        aide="Valable 10 minutes, 5 essais. Le code envoyé est simulé : il se lit dans la boîte du simulateur."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Vérification…">
          Vérifier le numéro
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
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
  const [reference, setReference] = useState("");
  const f = useFormulaire<"reference_preuve">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerReferencePreuve(reference),
      (charge) =>
        api.post(cheminConsentementsDestinataire(destinataireId), charge, {
          redirigerSi401: false,
        }),
      {
        succes: "Consentement enregistré.",
        messageSpecifique: (e) => messageErreurCanaux(e),
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
      aria-label={`Consentement recueilli pour ${d.utilisateur_nom}`}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <p className="mp-texte-doux">
        À utiliser quand la personne a donné son accord par écrit ou oralement, hors de
        MissionPilot. La référence de la preuve est conservée dans l&apos;historique.
      </p>
      <ZoneTexte
        libelle="Référence de la preuve"
        required
        maxLength={500}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        erreur={f.erreurs.reference_preuve}
        aide="10 caractères au moins : par exemple « formulaire signé le 12/03/2027, dossier n° 24 »."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer le consentement
        </Bouton>
        <Bouton variante="discret" onClick={onFin} disabled={f.enCours}>
          Annuler
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
      aria-label={`Historique de ${d.utilisateur_nom}`}
    >
      {etat.etape === "attente" ? (
        <p className="mp-texte-doux" role="status">
          Chargement de l&apos;historique…
        </p>
      ) : etat.etape === "erreur" ? (
        <Alerte tonalite="danger" titre="L'historique n'a pas pu être chargé.">
          <p>{etat.message}</p>
        </Alerte>
      ) : etat.lignes.length === 0 ? (
        <p className="mp-texte-doux">Aucun consentement n&apos;a encore été enregistré.</p>
      ) : (
        <>
          <ul className="mp-canaux__historique">
            {etat.lignes.map((l) => (
              <li key={l.id}>
                <BadgeStatut tonalite={l.statut === "accorde" ? "succes" : "danger"}>
                  {libelleConsentement(l.statut)}
                </BadgeStatut>
                <span>{libelleSourceConsentement(l.source)}</span>
                <span className="mp-texte-doux">{dateHeureCourte(l.cree_le)}</span>
                {l.reference_preuve ? (
                  <span className="mp-texte-doux">{`Preuve : ${l.reference_preuve}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {etat.suite ? (
            <p className="mp-texte-doux mp-texte-petit">
              Seuls les 100 enregistrements les plus récents sont affichés.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
