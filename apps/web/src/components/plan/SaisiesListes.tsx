"use client";

import type { ReactNode } from "react";
import type { Devise } from "../../lib/format";
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
  return (
    <li className="mp-plan-ligne-saisie">
      <p className="mp-plan-ligne-saisie__titre">{titre}</p>
      {children}
      <div>
        <Bouton
          variante="discret"
          icone="corbeille"
          onClick={onSupprimer}
          aria-label={`Supprimer : ${titre}`}
        >
          Supprimer
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

const MODES_EMPRUNT: { valeur: ModeEmprunt; libelle: string }[] = [
  { valeur: "annuites_constantes", libelle: "Annuités constantes" },
  { valeur: "amortissement_constant", libelle: "Amortissement constant du capital" },
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
                titre={`Catégorie ${i + 1}${e.libelle.trim() ? ` : ${e.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle="Libellé"
                    required
                    maxLength={120}
                    value={e.libelle}
                    onChange={(ev) => maj({ libelle: ev.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                    aide="Ex. « Consultants seniors »."
                  />
                  <Champ
                    libelle={`Salaire annuel brut par personne (${devise})`}
                    required
                    inputMode="decimal"
                    value={e.salaire}
                    onChange={(ev) => maj({ salaire: ev.target.value })}
                    erreur={erreurs[`${k}.salaire`]}
                    aide={`En année 1. ${aideMontant(devise)}`}
                  />
                  <Champ
                    libelle="Taux de charges sociales patronales (%)"
                    required
                    inputMode="decimal"
                    value={e.chargesSociales}
                    onChange={(ev) => maj({ chargesSociales: ev.target.value })}
                    erreur={erreurs[`${k}.chargesSociales`]}
                    aide="Obligatoire : sans lui, le coût du personnel serait sous-estimé."
                  />
                  <Champ
                    libelle="Revalorisation annuelle (%, facultatif)"
                    inputMode="decimal"
                    value={e.revalorisation}
                    onChange={(ev) => maj({ revalorisation: ev.target.value })}
                    erreur={erreurs[`${k}.revalorisation`]}
                    aide="Appliquée à partir de l'année 2."
                  />
                </div>
                <ChampParAnnee
                  legende="Effectifs (équivalents temps plein)"
                  requis
                  valeur={e.effectifs}
                  onChange={(v) => maj({ effectifs: v })}
                  cle={`${k}.effectifs`}
                  erreurs={erreurs}
                  exercices={exercices}
                  aide="Décimales admises (ex. 2,5 pour un temps partiel)."
                />
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">
          Aucune catégorie : le modèle ne compte aucune charge de personnel.
        </p>
      )}
      <Ajouter
        libelle="Ajouter une catégorie d'effectif"
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
                titre={`Investissement ${i + 1}${x.libelle.trim() ? ` : ${x.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle="Libellé"
                    required
                    maxLength={120}
                    value={x.libelle}
                    onChange={(e) => maj({ libelle: e.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                  />
                  <Select
                    libelle="Année d'acquisition"
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices)}
                    erreur={erreurs[`${k}.annee`]}
                  />
                  <Champ
                    libelle={`Montant (${devise})`}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise)}
                  />
                  <Champ
                    libelle="Durée d'amortissement (années)"
                    required
                    inputMode="numeric"
                    value={x.duree}
                    onChange={(e) => maj({ duree: e.target.value })}
                    erreur={erreurs[`${k}.duree`]}
                    aide="Amortissement linéaire en année pleine dès l'acquisition."
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">Aucun investissement prévu.</p>
      )}
      <Ajouter
        libelle="Ajouter un investissement"
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
                titre={`Emprunt ${i + 1}${x.libelle.trim() ? ` : ${x.libelle.trim()}` : ""}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Champ
                    libelle="Libellé"
                    required
                    maxLength={120}
                    value={x.libelle}
                    onChange={(e) => maj({ libelle: e.target.value })}
                    erreur={erreurs[`${k}.libelle`]}
                  />
                  <Select
                    libelle="Année de déblocage"
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices, true)}
                    erreur={erreurs[`${k}.annee`]}
                    aide="Année 0 : montant = capital restant dû, durée = durée restante."
                  />
                  <Champ
                    libelle={`Montant (${devise})`}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise)}
                  />
                  <Champ
                    libelle="Taux d'intérêt annuel (%)"
                    required
                    inputMode="decimal"
                    value={x.taux}
                    onChange={(e) => maj({ taux: e.target.value })}
                    erreur={erreurs[`${k}.taux`]}
                  />
                  <Champ
                    libelle="Durée totale (années)"
                    required
                    inputMode="numeric"
                    value={x.duree}
                    onChange={(e) => maj({ duree: e.target.value })}
                    erreur={erreurs[`${k}.duree`]}
                    aide="Différé compris."
                  />
                  <Champ
                    libelle="Différé d'amortissement (années, facultatif)"
                    inputMode="numeric"
                    value={x.differe}
                    onChange={(e) => maj({ differe: e.target.value })}
                    erreur={erreurs[`${k}.differe`]}
                    aide="Années où seuls les intérêts sont payés."
                  />
                  <Select
                    libelle="Mode de remboursement"
                    required
                    value={x.mode}
                    onChange={(e) => maj({ mode: e.target.value as ModeEmprunt })}
                    options={MODES_EMPRUNT}
                    erreur={erreurs[`${k}.mode`]}
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">Aucun emprunt.</p>
      )}
      <Ajouter
        libelle="Ajouter un emprunt"
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
                titre={`Augmentation de capital ${i + 1}`}
                onSupprimer={() => onChange(elements.filter((_, j) => j !== i))}
              >
                <div className="mp-grille-champs">
                  <Select
                    libelle="Année"
                    required
                    value={x.annee}
                    onChange={(e) => maj({ annee: e.target.value })}
                    options={optionsAnnees(horizon, exercices)}
                    erreur={erreurs[`${k}.annee`]}
                  />
                  <Champ
                    libelle={`Montant apporté (${devise})`}
                    required
                    inputMode="decimal"
                    value={x.montant}
                    onChange={(e) => maj({ montant: e.target.value })}
                    erreur={erreurs[`${k}.montant`]}
                    aide={aideMontant(devise)}
                  />
                </div>
              </Ligne>
            );
          })}
        </ul>
      ) : (
        <p className="mp-texte-doux">Aucune augmentation de capital.</p>
      )}
      <Ajouter
        libelle="Ajouter une augmentation de capital"
        desactive={elements.length >= APPORTS_MAX}
        onClick={() => onChange([...elements, apportVide()])}
      />
    </div>
  );
}
