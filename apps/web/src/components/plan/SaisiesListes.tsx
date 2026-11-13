"use client";

import type { ReactNode } from "react";
import { libelleDevise, type Devise } from "../../lib/format";
import {
  apportVide,
  APPORTS_MAX,
  effectifVide,
  EFFECTIFS_MAX,
  empruntVide,
  EMPRUNTS_MAX,
  investissementVide,
  INVESTISSEMENTS_MAX,
  optionsAnnees,
  type ModeEmprunt,
  type SaisieApport,
  type SaisieEffectif,
  type SaisieEmprunt,
  type SaisieInvestissement,
} from "../../lib/plan-hypotheses";
import { aideMontant } from "../../lib/saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ChampParAnnee } from "./ChampParAnnee";

type Erreurs = Partial<Record<string, string>>;

interface ListeProps<T> {
  elements: T[];
  onChange: (elements: T[]) => void;
  erreurs: Erreurs;
  horizon: number;
  devise: Devise;
  exercices: readonly (number | null)[];
}

function remplacer<T>(liste: T[], i: number, patch: Partial<T>): T[] {
  return liste.map((x, j) => (j === i ? { ...x, ...patch } : x));
}

function Ligne({
  titre,
  onSupprimer,
  children,
}: {
  titre: string;
  onSupprimer: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <li className="mp-plan-ligne-saisie">
      <p className="mp-plan-ligne-saisie__titre">{titre}</p>
      {children}
      <div>
        <Bouton
          variante="discret"
          icone="corbeille"
          onClick={onSupprimer}
          aria-label={t(`Supprimer : ${titre}`, `Delete: ${titre}`)}
        >
          {t("Supprimer", "Delete")}
        </Bouton>
      </div>
    </li>
  );
}

function Ajouter({
  libelle,
  onClick,
  desactive,
}: {
  libelle: string;
  onClick: () => void;
  desactive: boolean;
}) {
  return (
    <div>
      <Bouton variante="secondaire" icone="plus" onClick={onClick} disabled={desactive}>
        {libelle}
      </Bouton>
    </div>
  );
}

const modesEmprunt = (
  t: (fr: string, en: string) => string,
): { valeur: ModeEmprunt; libelle: string }[] => [
  { valeur: "annuites_constantes", libelle: t("Annuités constantes", "Constant annuities") },
  {
    valeur: "amortissement_constant",
    libelle: t("Amortissement constant du capital", "Constant principal repayment"),
  },
];

/** Catégories d'effectif : ETP, salaire brut annuel, charges sociales (obligatoires). */
export function EditeurEffectifs({
  elements,
  onChange,
  erreurs,
  horizon,
  devise,
  exercices,
}: ListeProps<SaisieEffectif>) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-plan__section">
      {elements.length ? (
        <ul className="mp-plan-liste">
          {elements.map((e, i) => {
            const k = `effectifs.${i}`;
            const maj = (patch: Partial<SaisieEffectif>) => onChange(remplacer(elements, i, patch));
            return (
              <Ligne
                key={i}
                titre={`${t("Catégorie", "Category")} ${i + 1}${e.libelle.trim() ? `${langue === "en" ? ":" : " :"} ${e.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle={t("Libellé", "Label")}
                    required
                    maxLength={120}
                    value={e.libelle}
                    onChange={(ev) => maj({ libelle: ev.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                    aide={t("Ex. « Consultants seniors ».", "E.g. \u201cSenior consultants\u201d.")}
                  />
                  <Champ
                    libelle={t(
                      `Salaire annuel brut par personne (${libelleDevise(devise)})`,
                      `Gross annual salary per person (${libelleDevise(devise)})`,
                    )}
                    required
                    inputMode="decimal"
                    value={e.salaire}
                    onChange={(ev) => maj({ salaire: ev.target.value })}
                    erreur={erreurs[`${k}.salaire`]}
                    aide={`${t("En année 1.", "In year 1.")} ${aideMontant(devise, langue)}`}
                  />
                  <Champ
                    libelle={t(
                      "Taux de charges sociales patronales (%)",
                      "Employer payroll tax rate (%)",
                    )}
                    required
                    inputMode="decimal"
                    value={e.chargesSociales}
                    onChange={(ev) => maj({ chargesSociales: ev.target.value })}
                    erreur={erreurs[`${k}.chargesSociales`]}
                    aide={t(
                      "Obligatoire : sans lui, le coût du personnel serait sous-estimé.",
                      "Required: without it, staff cost would be underestimated.",
                    )}
                  />
                  <Champ
                    libelle={t(
                      "Revalorisation annuelle (%, facultatif)",
                      "Annual raise (%, optional)",
                    )}
                    inputMode="decimal"
                    value={e.revalorisation}
                    onChange={(ev) => maj({ revalorisation: ev.target.value })}
                    erreur={erreurs[`${k}.revalorisation`]}
                    aide={t("Appliquée à partir de l'année 2.", "Applied from year 2.")}
                  />
                </div>
                <ChampParAnnee
                  legende={t(
                    "Effectifs (équivalents temps plein)",
                    "Headcount (full-time equivalents)",
                  )}
                  requis
                  valeur={e.effectifs}
                  onChange={(v) => maj({ effectifs: v })}
                  cle={`${k}.effectifs`}
                  erreurs={erreurs}
                  exercices={exercices}
                  aide={t(
                    "Décimales admises (ex. 2,5 pour un temps partiel).",
                    "Decimals allowed (e.g. 2.5 for part-time).",
                  )}
                />
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Aucune catégorie : le modèle ne compte aucune charge de personnel.",
            "No categories: the model includes no personnel expenses.",
          )}
        </p>
      )}
      <Ajouter
        libelle={t("Ajouter une catégorie d'effectif", "Add a headcount category")}
        desactive={elements.length >= EFFECTIFS_MAX}
        onClick={() => onChange([...elements, effectifVide(horizon)])}
      />
    </div>
  );
}

/** Investissements : année d'acquisition, montant, durée d'amortissement linéaire. */
export function EditeurInvestissements({
  elements,
  onChange,
  erreurs,
  horizon,
  devise,
  exercices,
}: ListeProps<SaisieInvestissement>) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-plan__section">
      {elements.length ? (
        <ul className="mp-plan-liste">
          {elements.map((x, i) => {
            const k = `investissements.${i}`;
            const maj = (patch: Partial<SaisieInvestissement>) =>
              onChange(remplacer(elements, i, patch));
            return (
              <Ligne
                key={i}
                titre={`${t("Investissement", "Investment")} ${i + 1}${x.libelle.trim() ? `${langue === "en" ? ":" : " :"} ${x.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle={t("Libellé", "Label")}
                    required
                    maxLength={120}
                    value={x.libelle}
                    onChange={(e) => maj({ libelle: e.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                  />
                  <Select
                    libelle={t("Année d'acquisition", "Acquisition year")}
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices, false, langue)}
                    erreur={erreurs[`${k}.annee`]}
                  />
                  <Champ
                    libelle={t(
                      `Montant (${libelleDevise(devise)})`,
                      `Amount (${libelleDevise(devise)})`,
                    )}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise, langue)}
                  />
                  <Champ
                    libelle={t("Durée d'amortissement (années)", "Depreciation period (years)")}
                    required
                    inputMode="numeric"
                    value={x.duree}
                    onChange={(e) => maj({ duree: e.target.value })}
                    erreur={erreurs[`${k}.duree`]}
                    aide={t(
                      "Amortissement linéaire en année pleine dès l'acquisition.",
                      "Straight-line depreciation over full years from acquisition.",
                    )}
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">
          {t("Aucun investissement prévu.", "No planned investments.")}
        </p>
      )}
      <Ajouter
        libelle={t("Ajouter un investissement", "Add an investment")}
        desactive={elements.length >= INVESTISSEMENTS_MAX}
        onClick={() => onChange([...elements, investissementVide()])}
      />
    </div>
  );
}

/** Emprunts : année de déblocage (0 = déjà en cours), montant, taux, durée, différé, mode. */
export function EditeurEmprunts({
  elements,
  onChange,
  erreurs,
  horizon,
  devise,
  exercices,
}: ListeProps<SaisieEmprunt>) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-plan__section">
      {elements.length ? (
        <ul className="mp-plan-liste">
          {elements.map((x, i) => {
            const k = `emprunts.${i}`;
            const maj = (patch: Partial<SaisieEmprunt>) => onChange(remplacer(elements, i, patch));
            return (
              <Ligne
                key={i}
                titre={`${t("Emprunt", "Loan")} ${i + 1}${x.libelle.trim() ? `${langue === "en" ? ":" : " :"} ${x.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle={t("Libellé", "Label")}
                    required
                    maxLength={120}
                    value={x.libelle}
                    onChange={(e) => maj({ libelle: e.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                  />
                  <Select
                    libelle={t("Année de déblocage", "Disbursement year")}
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices, true, langue)}
                    erreur={erreurs[`${k}.annee`]}
                    aide={t(
                      "Année 0 : montant = capital restant dû, durée = durée restante.",
                      "Year 0: amount = outstanding principal, term = remaining term.",
                    )}
                  />
                  <Champ
                    libelle={t(
                      `Montant (${libelleDevise(devise)})`,
                      `Amount (${libelleDevise(devise)})`,
                    )}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise, langue)}
                  />
                  <Champ
                    libelle={t("Taux d'intérêt annuel (%)", "Annual interest rate (%)")}
                    required
                    inputMode="decimal"
                    value={x.taux}
                    onChange={(e) => maj({ taux: e.target.value })}
                    erreur={erreurs[`${k}.taux`]}
                  />
                  <Champ
                    libelle={t("Durée totale (années)", "Total term (years)")}
                    required
                    inputMode="numeric"
                    value={x.duree}
                    onChange={(e) => maj({ duree: e.target.value })}
                    erreur={erreurs[`${k}.duree`]}
                    aide={t("Différé compris.", "Including deferral.")}
                  />
                  <Champ
                    libelle={t(
                      "Différé d'amortissement (années, facultatif)",
                      "Repayment deferral (years, optional)",
                    )}
                    inputMode="numeric"
                    value={x.differe}
                    onChange={(e) => maj({ differe: e.target.value })}
                    erreur={erreurs[`${k}.differe`]}
                    aide={t(
                      "Années où seuls les intérêts sont payés.",
                      "Years in which only interest is paid.",
                    )}
                  />
                  <Select
                    libelle={t("Mode de remboursement", "Repayment mode")}
                    required
                    value={x.mode}
                    onChange={(e) => maj({ mode: e.target.value as ModeEmprunt })}
                    options={modesEmprunt(t)}
                    erreur={erreurs[`${k}.mode`]}
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">{t("Aucun emprunt.", "No loans.")}</p>
      )}
      <Ajouter
        libelle={t("Ajouter un emprunt", "Add a loan")}
        desactive={elements.length >= EMPRUNTS_MAX}
        onClick={() => onChange([...elements, empruntVide()])}
      />
    </div>
  );
}

/** Augmentations de capital : année et montant apporté. */
export function EditeurApports({
  elements,
  onChange,
  erreurs,
  horizon,
  devise,
  exercices,
}: ListeProps<SaisieApport>) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-plan__section">
      {elements.length ? (
        <ul className="mp-plan-liste">
          {elements.map((x, i) => {
            const k = `apports.${i}`;
            const maj = (patch: Partial<SaisieApport>) => onChange(remplacer(elements, i, patch));
            return (
              <Ligne
                key={i}
                titre={t(`Augmentation de capital ${i + 1}`, `Capital increase ${i + 1}`)}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Select
                    libelle={t("Année", "Year")}
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices, false, langue)}
                    erreur={erreurs[`${k}.annee`]}
                  />
                  <Champ
                    libelle={t(
                      `Montant apporté (${libelleDevise(devise)})`,
                      `Amount contributed (${libelleDevise(devise)})`,
                    )}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise, langue)}
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">
          {t("Aucune augmentation de capital.", "No capital increases.")}
        </p>
      )}
      <Ajouter
        libelle={t("Ajouter une augmentation de capital", "Add a capital increase")}
        desactive={elements.length >= APPORTS_MAX}
        onClick={() => onChange([...elements, apportVide()])}
      />
    </div>
  );
}
