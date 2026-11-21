"use client";

import { useRef, useState, type FormEvent } from "react";
import type { RedCreancierVue, RedTypeEvenementNegociation } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  cheminEvenements,
  libelleTypeEvenement,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsEvenementDepuisFormulaire,
  evenementVide,
  nouvelleCleLigne,
  type ChampEvenement,
  type SaisieEvenement,
} from "../../lib/redressement-saisie";
import { aideMontant } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionRed } from "./BoutonActionRed";
import { indexFocusApresRetrait, useFocusLignes } from "./useFocusLignes";

const TYPES_LIBRES: RedTypeEvenementNegociation[] = [
  "ouverture",
  "proposition",
  "contre_proposition",
  "note",
];

/**
 * Formulaire d'événement de négociation, selon le type. Les types proposés suivent la situation
 * affichée (accord en vigueur ou non) ; l'API juge (deuxième accord, paiement excessif, accord
 * rompu…). Pour un accord : échéancier régulier (nombre, première date, périodicité) ou explicite
 * (60 lignes au plus). L'imputation d'un paiement est faite par l'API.
 */
export function FormulaireEvenement({
  creancierId,
  devise,
  aujourdhui,
  accord,
}: {
  creancierId: string;
  devise: Devise;
  aujourdhui: string;
  /** Accord en vigueur et ses échéances non soldées (rang, date, montant restant). */
  accord: {
    id: string;
    restantes: { rang: number; date: string; montant_restant: number }[];
  } | null;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampEvenement>();
  const { refListe, focaliser } = useFocusLignes();
  const [s, setS] = useState<SaisieEvenement>(() => evenementVide(aujourdhui, accord?.id ?? ""));
  const types: RedTypeEvenementNegociation[] = accord
    ? [...TYPES_LIBRES, "paiement", "rupture"]
    : [...TYPES_LIBRES, "accord"];

  // Anti double clic : un seul envoi à la fois, même avant que le bouton soit rendu désactivé.
  const verrou = useRef(false);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    try {
      await envoyer();
    } finally {
      verrou.current = false;
    }
  }

  async function envoyer() {
    await f.envoyer(
      corpsEvenementDepuisFormulaire(
        { ...s, accord_id: accord?.id ?? s.accord_id },
        devise,
        langue,
      ),
      (charge) => api.post<RedCreancierVue>(cheminEvenements(creancierId), charge),
      {
        succes: t("Événement enregistré.", "Event saved."),
        messageSpecifique: (e) => messageRedressement(e, langue),
        apres: () =>
          setS((x) => ({
            ...x,
            type: "note",
            montant: "",
            conditions: "",
            echeance_rang: "",
            lignes: [],
          })),
      },
    );
  }

  const montantObligatoire = s.type === "accord" || s.type === "paiement";
  const avecMontant = s.type !== "rupture";
  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Ajouter un événement de négociation", "Add a negotiation event")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type d'événement", "Event type")}
          value={s.type}
          onChange={(e) =>
            setS((x) => ({ ...x, type: e.target.value as RedTypeEvenementNegociation }))
          }
          options={types.map((tp) => ({ valeur: tp, libelle: libelleTypeEvenement(tp, langue) }))}
        />
        <Champ
          libelle={t("Date de l'événement", "Event date")}
          type="date"
          required
          value={s.date_evenement}
          onChange={(e) => setS((x) => ({ ...x, date_evenement: e.target.value }))}
          erreur={f.erreurs.date_evenement}
        />
        {avecMontant ? (
          <Champ
            libelle={
              s.type === "accord" ? t("Montant convenu", "Agreed amount") : t("Montant", "Amount")
            }
            required={montantObligatoire}
            inputMode="decimal"
            autoComplete="off"
            value={s.montant}
            onChange={(e) => setS((x) => ({ ...x, montant: e.target.value }))}
            erreur={f.erreurs.montant}
            aide={aideMontant(devise, langue)}
          />
        ) : null}
        {s.type === "paiement" ? (
          <Select
            libelle={t("Échéance concernée", "Installment concerned")}
            value={s.echeance_rang}
            invite={t("Aucune échéance précise", "No specific installment")}
            onChange={(e) => setS((x) => ({ ...x, echeance_rang: e.target.value }))}
            options={(accord?.restantes ?? []).map((r) => ({
              valeur: String(r.rang),
              libelle: t(
                `Échéance ${r.rang} du ${formaterDate(r.date)} : ${formaterMontantMineur(r.montant_restant, devise)} restant`,
                `Installment ${r.rang} of ${formaterDate(r.date, "UTC", langue)}: ${formaterMontantMineur(r.montant_restant, devise, langue)} remaining`,
              ),
            }))}
            erreur={f.erreurs.echeance_rang}
          />
        ) : null}
      </div>
      {f.erreurs.accord_id ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.accord_id}</p>
        </Alerte>
      ) : null}

      {s.type === "accord" ? (
        <fieldset className="mp-red-fiche">
          <legend>{t("Échéancier de l'accord", "Agreement installment schedule")}</legend>
          <Select
            libelle={t("Mode", "Mode")}
            value={s.mode}
            onChange={(e) =>
              setS((x) => ({ ...x, mode: e.target.value as SaisieEvenement["mode"] }))
            }
            options={[
              { valeur: "regulier", libelle: t("Échéancier régulier", "Regular schedule") },
              { valeur: "explicite", libelle: t("Échéancier explicite", "Explicit schedule") },
            ]}
          />
          {s.mode === "regulier" ? (
            <div className="mp-grille-champs">
              <Champ
                libelle={t("Nombre d'échéances", "Number of installments")}
                inputMode="numeric"
                autoComplete="off"
                value={s.nombre_echeances}
                onChange={(e) => setS((x) => ({ ...x, nombre_echeances: e.target.value }))}
                erreur={f.erreurs.nombre_echeances}
              />
              <Champ
                libelle={t("Date de la première échéance", "First installment date")}
                type="date"
                value={s.date_premiere}
                onChange={(e) => setS((x) => ({ ...x, date_premiere: e.target.value }))}
                erreur={f.erreurs.date_premiere}
              />
              <Champ
                libelle={t("Périodicité (mois)", "Frequency (months)")}
                inputMode="numeric"
                autoComplete="off"
                value={s.periodicite_mois}
                onChange={(e) => setS((x) => ({ ...x, periodicite_mois: e.target.value }))}
                erreur={f.erreurs.periodicite_mois}
              />
            </div>
          ) : (
            <div className="mp-red-section">
              {f.erreurs.lignes ? (
                <Alerte tonalite="danger" annonce="alert">
                  <p>{f.erreurs.lignes}</p>
                </Alerte>
              ) : null}
              <ul ref={refListe} className="mp-red-lignes">
                {s.lignes.map((l, i) => (
                  <li key={l.cle} className="mp-red-ligne">
                    <Champ
                      libelle={t(`Échéance ${i + 1} : date`, `Installment ${i + 1}: date`)}
                      type="date"
                      value={l.date}
                      onChange={(e) =>
                        setS((x) => ({
                          ...x,
                          lignes: x.lignes.map((y) =>
                            y.cle === l.cle ? { ...y, date: e.target.value } : y,
                          ),
                        }))
                      }
                    />
                    <Champ
                      libelle={t(`Échéance ${i + 1} : montant`, `Installment ${i + 1}: amount`)}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.montant}
                      onChange={(e) =>
                        setS((x) => ({
                          ...x,
                          lignes: x.lignes.map((y) =>
                            y.cle === l.cle ? { ...y, montant: e.target.value } : y,
                          ),
                        }))
                      }
                    />
                    <Bouton
                      variante="discret"
                      aria-label={t(`Retirer l'échéance ${i + 1}`, `Remove installment ${i + 1}`)}
                      onClick={() => {
                        setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }));
                        focaliser(indexFocusApresRetrait(i, s.lignes.length - 1));
                      }}
                    >
                      {t("Retirer", "Remove")}
                    </Bouton>
                  </li>
                ))}
              </ul>
              <div className="mp-actions-formulaire">
                <Bouton
                  variante="secondaire"
                  disabled={s.lignes.length >= 60}
                  onClick={() => {
                    setS((x) => ({
                      ...x,
                      lignes: [...x.lignes, { cle: nouvelleCleLigne(), date: "", montant: "" }],
                    }));
                    focaliser(s.lignes.length);
                  }}
                >
                  {t("Ajouter une échéance", "Add an installment")}
                </Bouton>
                {s.lignes.length >= 60 ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    {t("60 échéances au plus.", "60 installments at most.")}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </fieldset>
      ) : null}

      <ZoneTexte
        libelle={t("Conditions (facultatif)", "Terms (optional)")}
        maxLength={2000}
        value={s.conditions}
        onChange={(e) => setS((x) => ({ ...x, conditions: e.target.value }))}
        erreur={f.erreurs.conditions}
        aide={t(
          "Confidentielles : jamais reprises dans le journal d'audit.",
          "Confidential: never copied into the audit log.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer l'événement", "Save the event")}
        </Bouton>
      </div>
    </form>
  );
}

/** « Rompre l'accord » : une confirmation avant d'enregistrer la rupture (jamais annulable). */
export function RompreAccord({
  creancierId,
  accordId,
  aujourdhui,
}: {
  creancierId: string;
  accordId: string;
  aujourdhui: string;
}) {
  const t = useT();
  return (
    <BoutonActionRed
      libelle={t("Rompre l'accord", "Break the agreement")}
      chemin={cheminEvenements(creancierId)}
      corps={{ type: "rupture", date_evenement: aujourdhui, accord_id: accordId }}
      succes={t("Rupture de l'accord enregistrée.", "Agreement break recorded.")}
      variante="danger"
      confirmation={{
        question: t(
          "Rompre l'accord ? La rupture est enregistrée dans le fil de négociation.",
          "Break the agreement? The break is recorded in the negotiation timeline.",
        ),
        libelleConfirmation: t("Oui, rompre l'accord", "Yes, break the agreement"),
      }}
    />
  );
}
