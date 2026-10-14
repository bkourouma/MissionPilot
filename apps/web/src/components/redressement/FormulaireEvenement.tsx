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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BoutonActionRed } from "./BoutonActionRed";

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
  const f = useFormulaire<ChampEvenement>();
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
      corpsEvenementDepuisFormulaire({ ...s, accord_id: accord?.id ?? s.accord_id }, devise),
      (charge) => api.post<RedCreancierVue>(cheminEvenements(creancierId), charge),
      {
        succes: "Événement enregistré.",
        messageSpecifique: messageRedressement,
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
      aria-label="Ajouter un événement de négociation"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Type d'événement"
          value={s.type}
          onChange={(e) =>
            setS((x) => ({ ...x, type: e.target.value as RedTypeEvenementNegociation }))
          }
          options={types.map((t) => ({ valeur: t, libelle: libelleTypeEvenement(t) }))}
        />
        <Champ
          libelle="Date de l'événement"
          type="date"
          required
          value={s.date_evenement}
          onChange={(e) => setS((x) => ({ ...x, date_evenement: e.target.value }))}
          erreur={f.erreurs.date_evenement}
        />
        {avecMontant ? (
          <Champ
            libelle={s.type === "accord" ? "Montant convenu" : "Montant"}
            required={montantObligatoire}
            inputMode="decimal"
            autoComplete="off"
            value={s.montant}
            onChange={(e) => setS((x) => ({ ...x, montant: e.target.value }))}
            erreur={f.erreurs.montant}
            aide={aideMontant(devise)}
          />
        ) : null}
        {s.type === "paiement" ? (
          <Select
            libelle="Échéance concernée"
            value={s.echeance_rang}
            invite="Aucune échéance précise"
            onChange={(e) => setS((x) => ({ ...x, echeance_rang: e.target.value }))}
            options={(accord?.restantes ?? []).map((r) => ({
              valeur: String(r.rang),
              libelle: `Échéance ${r.rang} du ${formaterDate(r.date)} : ${formaterMontantMineur(r.montant_restant, devise)} restant`,
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
          <legend>Échéancier de l&apos;accord</legend>
          <Select
            libelle="Mode"
            value={s.mode}
            onChange={(e) =>
              setS((x) => ({ ...x, mode: e.target.value as SaisieEvenement["mode"] }))
            }
            options={[
              { valeur: "regulier", libelle: "Échéancier régulier" },
              { valeur: "explicite", libelle: "Échéancier explicite" },
            ]}
          />
          {s.mode === "regulier" ? (
            <div className="mp-grille-champs">
              <Champ
                libelle="Nombre d'échéances"
                inputMode="numeric"
                autoComplete="off"
                value={s.nombre_echeances}
                onChange={(e) => setS((x) => ({ ...x, nombre_echeances: e.target.value }))}
                erreur={f.erreurs.nombre_echeances}
              />
              <Champ
                libelle="Date de la première échéance"
                type="date"
                value={s.date_premiere}
                onChange={(e) => setS((x) => ({ ...x, date_premiere: e.target.value }))}
                erreur={f.erreurs.date_premiere}
              />
              <Champ
                libelle="Périodicité (mois)"
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
              <ul className="mp-red-lignes">
                {s.lignes.map((l, i) => (
                  <li key={l.cle} className="mp-red-ligne">
                    <Champ
                      libelle={`Échéance ${i + 1} : date`}
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
                      libelle={`Échéance ${i + 1} : montant`}
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
                      aria-label={`Retirer l'échéance ${i + 1}`}
                      onClick={() =>
                        setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }))
                      }
                    >
                      Retirer
                    </Bouton>
                  </li>
                ))}
              </ul>
              <div className="mp-actions-formulaire">
                <Bouton
                  variante="secondaire"
                  disabled={s.lignes.length >= 60}
                  onClick={() =>
                    setS((x) => ({
                      ...x,
                      lignes: [...x.lignes, { cle: nouvelleCleLigne(), date: "", montant: "" }],
                    }))
                  }
                >
                  Ajouter une échéance
                </Bouton>
                {s.lignes.length >= 60 ? (
                  <span className="mp-texte-doux mp-texte-petit">60 échéances au plus.</span>
                ) : null}
              </div>
            </div>
          )}
        </fieldset>
      ) : null}

      <ZoneTexte
        libelle="Conditions (facultatif)"
        maxLength={2000}
        value={s.conditions}
        onChange={(e) => setS((x) => ({ ...x, conditions: e.target.value }))}
        erreur={f.erreurs.conditions}
        aide="Confidentielles : jamais reprises dans le journal d'audit."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer l&apos;événement
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
  return (
    <BoutonActionRed
      libelle="Rompre l'accord"
      chemin={cheminEvenements(creancierId)}
      corps={{ type: "rupture", date_evenement: aujourdhui, accord_id: accordId }}
      succes="Rupture de l'accord enregistrée."
      variante="danger"
      confirmation={{
        question: "Rompre l'accord ? La rupture est enregistrée dans le fil de négociation.",
        libelleConfirmation: "Oui, rompre l'accord",
      }}
    />
  );
}
