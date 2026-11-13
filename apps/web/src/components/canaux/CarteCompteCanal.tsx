"use client";

import { useState, type FormEvent } from "react";
import type { CompteCanalApi } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  canalAvecOptions,
  CHAMPS_OPTIONS_COMPTE,
  chargeModificationCompte,
  cheminCompteCanal,
  dateHeureCourte,
  etatApresEnregistrement,
  etatEditableDepuisCompte,
  exigeReconfirmationCompte,
  libelleOptionCompte,
  libelleCanal,
  libelleEtatCompte,
  messageErreurCanaux,
  type ChampCompte,
  type EtatCompteEditable,
} from "../../lib/canaux";
import {
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../lib/double-authentification";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { ChampsReconfirmation } from "../securite/ChampsReconfirmation";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { CaseACocher } from "../ui/CaseACocher";
import "./canaux.css";

export interface CarteCompteCanalProps {
  compte: CompteCanalApi;
  /** Activer, options : associé seul (`canaux.configurer`). */
  peutConfigurer: boolean;
  /** Désactiver (coupe-circuit) : `canaux.gerer`. */
  peutGerer: boolean;
}

/**
 * Compte d'un canal (WhatsApp ou SMS) : interrupteur « Activé » et options. Activer un compte
 * exige la reconfirmation d'identité de l'associé ; désactiver est immédiat. Tout est simulé :
 * rien n'est envoyé hors de CabinetPilot.
 */
export function CarteCompteCanal({ compte, peutConfigurer, peutGerer }: CarteCompteCanalProps) {
  const t = useT();
  const langue = useLangue();
  const [enregistre, setEnregistre] = useState<EtatCompteEditable>(
    etatEditableDepuisCompte(compte),
  );
  const [edite, setEdite] = useState<EtatCompteEditable>(etatEditableDepuisCompte(compte));
  const [modifieLe, setModifieLe] = useState<string | null>(compte.modifie_le);
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const [info, setInfo] = useState<string | null>(null);
  const f = useFormulaire<ChampCompte | ChampConfirmation>();

  const reconfirmer = peutConfigurer && exigeReconfirmationCompte(enregistre, edite);
  const modifie =
    edite.actif !== enregistre.actif ||
    CHAMPS_OPTIONS_COMPTE.some((c) => edite[c] !== enregistre[c]);
  // Un titulaire de `canaux.gerer` seul peut seulement désactiver un canal actif.
  const interrupteurLibre = peutConfigurer || (peutGerer && enregistre.actif);
  const avecOptions = canalAvecOptions(compte.canal);
  const nom = libelleCanal(compte.canal, langue);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setInfo(null);
    const v = chargeModificationCompte(
      enregistre,
      edite,
      { gerer: peutGerer, configurer: peutConfigurer },
      reconfirmer ? confirmation : null,
      langue,
    );
    if (!v.ok && v.erreurs.aucun !== undefined) {
      setInfo(v.erreurs.aucun);
      return;
    }
    await f.envoyer(
      v,
      (charge) =>
        api.put<unknown>(cheminCompteCanal(compte.canal), charge, { redirigerSi401: false }),
      {
        rafraichir: false,
        succes: edite.actif
          ? t(
              `Compte ${nom} enregistré. Rappel : les envois restent simulés.`,
              `${nom} account saved. Reminder: sends remain simulated.`,
            )
          : t(
              `Compte ${nom} enregistré : le canal est désactivé, plus aucun message ne partira.`,
              `${nom} account saved: the channel is disabled, no message will be sent.`,
            ),
        messageSpecifique: (e) => messageErreurCanaux(e, confirmation.facteur, langue),
        apres: (r) => {
          const nouvel = etatApresEnregistrement(r, edite);
          setEnregistre(nouvel);
          setEdite(nouvel);
          setModifieLe(new Date().toISOString());
        },
      },
    );
    // Jamais de mot de passe ni de code conservé après un essai.
    setConfirmation((c) => ({ ...c, motDePasse: "", code: "" }));
  }

  return (
    <Carte
      titre={nom}
      niveauTitre={3}
      actions={
        <BadgeStatut tonalite={enregistre.actif ? "succes" : "neutre"}>
          {libelleEtatCompte(enregistre, langue)}
        </BadgeStatut>
      }
    >
      <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
        <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
        {!peutConfigurer ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {peutGerer
                ? t(
                    "Seul un associé peut activer ce canal ou changer ses options. Vous pouvez le désactiver à tout moment.",
                    "Only a partner can enable this channel or change its options. You can disable it at any time.",
                  )
                : t(
                    "Lecture seule : seul un associé peut modifier ce compte.",
                    "Read only: only a partner can modify this account.",
                  )}
            </p>
          </Alerte>
        ) : null}
        <CaseACocher
          libelle={t("Activé", "Enabled")}
          aide={t(
            `Un canal désactivé n'envoie rien. ${nom} est simulé : aucun message réel ne part.`,
            `A disabled channel sends nothing. ${nom} is simulated: no real message is sent.`,
          )}
          checked={edite.actif}
          disabled={!interrupteurLibre}
          onChange={(e) => {
            setEdite({ ...edite, actif: e.target.checked });
            setInfo(null);
          }}
        />
        {avecOptions ? (
          <fieldset className="mp-groupe">
            <legend className="mp-champ__libelle">
              {t("Options du compte", "Account options")}
            </legend>
            <div className="mp-canaux__options">
              {CHAMPS_OPTIONS_COMPTE.map((champ) => (
                <CaseACocher
                  key={champ}
                  libelle={libelleOptionCompte(champ, langue).libelle}
                  aide={libelleOptionCompte(champ, langue).aide}
                  checked={edite[champ]}
                  disabled={!peutConfigurer}
                  onChange={(e) => {
                    setEdite({ ...edite, [champ]: e.target.checked });
                    setInfo(null);
                  }}
                />
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="mp-texte-doux">
            {t(
              "Le SMS sert de repli quand WhatsApp refuse un message (option du compte WhatsApp). Il exige un consentement SMS distinct de la personne.",
              "SMS is a fallback when WhatsApp rejects a message (WhatsApp account option). It requires a separate SMS consent from the person.",
            )}
          </p>
        )}
        {reconfirmer ? (
          <ChampsReconfirmation
            saisie={confirmation}
            onChange={setConfirmation}
            erreurs={f.erreurs}
            motif={`activer le canal ${nom}`}
            motifEn={`enable the ${nom} channel`}
          />
        ) : null}
        {info ? (
          <Alerte tonalite="info" annonce="status">
            <p>{info}</p>
          </Alerte>
        ) : null}
        <p className="mp-texte-doux mp-texte-petit">
          {`${t("Dernière modification", "Last modified")}${t(" : ", ": ")}${dateHeureCourte(modifieLe, langue)}`}
        </p>
        {peutGerer || peutConfigurer ? (
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante={avecOptions ? "primaire" : "secondaire"}
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
              disabled={!modifie}
            >
              {t(`Enregistrer le compte ${nom}`, `Save the ${nom} account`)}
            </Bouton>
          </div>
        ) : null}
      </form>
    </Carte>
  );
}
