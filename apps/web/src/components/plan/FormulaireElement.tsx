"use client";

import { useId, useState, type FormEvent } from "react";
import type { TypeElementPlan } from "@missionpilot/shared";
import { api, ErreurApi } from "../../lib/api";
import type { Devise } from "../../lib/format";
import {
  MESSAGE_CONTENU_IDENTIQUE,
  memeContenu,
  OPTIONS_PERSPECTIVES,
  OPTIONS_STATUTS_INITIATIVE,
  optionsDependances,
  optionsResponsables,
  saisieDepuisDonnees,
  saisieElementVide,
  validerElement,
  type ChampElement,
  type OptionInitiative,
  type PersonnePlan,
  type SaisieElement,
} from "../../lib/plan-elements";
import {
  cheminElements,
  cheminVersionsElement,
  messageEcriture,
  messagePlan,
  type ElementPlan,
} from "../../lib/plan-strategique";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { AvertissementPartage } from "./AvertissementPartage";

export type ModeFormulaireElement =
  { nature: "creation"; parentId?: string } | { nature: "version"; element: ElementPlan };

export interface FormulaireElementProps {
  planId: string;
  type: TypeElementPlan;
  mode: ModeFormulaireElement;
  horizon: number;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  /** Initiatives du plan, prédécesseurs possibles d'une initiative (PLA-05). */
  initiatives?: readonly OptionInitiative[];
  /** Le plan est partagé : l'écriture retirera le partage (avertissement visible). */
  partage: boolean;
  onAnnuler?: () => void;
  /** Après réussite : message à afficher par le parent (le formulaire se ferme). */
  onTermine?: (message: string) => void;
}

type Maj = <K extends keyof SaisieElement>(cle: K, valeur: SaisieElement[K]) => void;

interface ChampsProps {
  s: SaisieElement;
  maj: Maj;
  erreurs: Partial<Record<ChampElement, string>>;
  id: string;
}

const AIDE_LIGNES = "Une entrée par ligne.";

function ChampsSwot({ s, maj, erreurs }: ChampsProps) {
  const cases = [
    ["forces", "Forces"],
    ["faiblesses", "Faiblesses"],
    ["opportunites", "Opportunités"],
    ["menaces", "Menaces"],
  ] as const;
  return (
    <div className="mp-grille-champs">
      {cases.map(([cle, libelle]) => (
        <ZoneTexte
          key={cle}
          libelle={libelle}
          rows={5}
          value={s[cle]}
          onChange={(e) => maj(cle, e.target.value)}
          erreur={erreurs[cle] ?? (cle === "forces" ? erreurs.swot : undefined)}
          aide={`${AIDE_LIGNES} 30 lignes de 500 caractères au plus.`}
        />
      ))}
    </div>
  );
}

function ChampsTitre({ s, maj, erreurs }: ChampsProps) {
  return (
    <>
      <Champ
        libelle="Titre"
        required
        maxLength={200}
        autoComplete="off"
        value={s.titre}
        onChange={(e) => maj("titre", e.target.value)}
        erreur={erreurs.titre}
      />
      <ZoneTexte
        libelle="Description (facultatif)"
        rows={3}
        maxLength={5000}
        value={s.description}
        onChange={(e) => maj("description", e.target.value)}
        erreur={erreurs.description}
      />
    </>
  );
}

function ChampsObjectif(p: ChampsProps) {
  const { s, maj, erreurs } = p;
  return (
    <>
      <ChampsTitre {...p} />
      <div className="mp-grille-champs">
        <Select
          libelle="Perspective"
          required
          invite="Choisir…"
          value={s.perspective}
          onChange={(e) => maj("perspective", e.target.value)}
          options={OPTIONS_PERSPECTIVES}
          erreur={erreurs.perspective}
          aide="Perspective du tableau de bord prospectif."
        />
        <Champ
          libelle="Indicateur (facultatif)"
          maxLength={200}
          value={s.indicateur}
          onChange={(e) => maj("indicateur", e.target.value)}
          erreur={erreurs.indicateur}
        />
        <Champ
          libelle="Cible (facultatif)"
          maxLength={200}
          value={s.cible}
          onChange={(e) => maj("cible", e.target.value)}
          erreur={erreurs.cible}
          aide="Valeur visée, en texte (ex. « x2 », « 30 % du CA »)."
        />
        <Champ
          libelle="Échéance (facultatif)"
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          value={s.echeance}
          onChange={(e) => maj("echeance", e.target.value)}
          erreur={erreurs.echeance}
        />
      </div>
    </>
  );
}

interface ContexteInitiative {
  horizon: number;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  initiatives: readonly OptionInitiative[];
  /** Identifiant de l'initiative modifiée (null en création). */
  soi: string | null;
}

function ChampsInitiative(p: ChampsProps & ContexteInitiative) {
  const { s, maj, erreurs, horizon, devise, personnes, id } = p;
  const predecesseurs = optionsDependances(p.initiatives, p.soi, s.dependances);
  const majGain = (i: number, v: string) =>
    maj(
      "gains",
      s.gains.map((g, j) => (j === i ? v : g)),
    );
  return (
    <>
      <ChampsTitre {...p} />
      <div className="mp-grille-champs">
        <Select
          libelle="Responsable"
          value={s.responsable_id}
          onChange={(e) => maj("responsable_id", e.target.value)}
          options={optionsResponsables(personnes, s.responsable_id)}
          erreur={erreurs.responsable_id}
        />
        <Select
          libelle="Statut"
          required
          value={s.statut}
          onChange={(e) => maj("statut", e.target.value)}
          options={OPTIONS_STATUTS_INITIATIVE}
          erreur={erreurs.statut}
        />
        <Champ
          libelle="Début (facultatif)"
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          value={s.debut}
          onChange={(e) => maj("debut", e.target.value)}
          erreur={erreurs.debut}
        />
        <Champ
          libelle="Échéance"
          type="date"
          required
          min="2000-01-01"
          max="2100-12-31"
          value={s.echeance}
          onChange={(e) => maj("echeance", e.target.value)}
          erreur={erreurs.echeance}
        />
        <Champ
          libelle={`Budget (${devise})`}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.budget}
          onChange={(e) => maj("budget", e.target.value)}
          erreur={erreurs.budget}
          aide={`${aideMontant(devise)} Investissement initial du calcul de ROI.`}
        />
      </div>
      {predecesseurs.length ? (
        <GroupeCases
          legende="Dépend de (facultatif)"
          nom={`${id}-dependances`}
          options={predecesseurs}
          valeurs={s.dependances}
          onChange={(v) => maj("dependances", v)}
          erreur={erreurs.dependances}
          aide="Initiatives qui doivent être terminées avant que celle-ci commence. Si l'une d'elles glisse, la feuille de route recale automatiquement cette initiative (si elle est à lancer ou suspendue)."
        />
      ) : null}
      <fieldset className="mp-plan-annuel" aria-describedby={`${id}-gains-aide`}>
        <legend className="mp-champ__libelle">{`Gains nets annuels (${devise}, facultatif)`}</legend>
        <p className="mp-champ__aide" id={`${id}-gains-aide`}>
          {`Une valeur par année d'horizon (${horizon} ans), signe moins pour une perte. Laissez toutes les années vides si les gains ne sont pas encore estimés : le ROI ne sera pas calculé. La VAN et le TRI sont calculés par le moteur.`}
        </p>
        <div className="mp-plan-annuel__annees">
          {s.gains.map((g, i) => (
            <Champ
              key={i}
              libelle={`Année ${i + 1}`}
              inputMode="decimal"
              autoComplete="off"
              value={g}
              onChange={(e) => majGain(i, e.target.value)}
              erreur={i === 0 ? erreurs.gains : undefined}
            />
          ))}
        </div>
      </fieldset>
    </>
  );
}

function ChampsSelonType(p: ChampsProps & ContexteInitiative & { type: TypeElementPlan }) {
  const { s, maj, erreurs } = p;
  switch (p.type) {
    case "diagnostic":
      return (
        <ZoneTexte
          libelle="Synthèse du diagnostic"
          required
          rows={8}
          maxLength={20000}
          value={s.synthese}
          onChange={(e) => maj("synthese", e.target.value)}
          erreur={erreurs.synthese}
          aide="Constats clés de l'entreprise (20 000 caractères au plus)."
        />
      );
    case "swot":
      return <ChampsSwot {...p} />;
    case "vision_mission":
      return (
        <>
          <ZoneTexte
            libelle="Vision"
            required
            rows={3}
            maxLength={2000}
            value={s.vision}
            onChange={(e) => maj("vision", e.target.value)}
            erreur={erreurs.vision}
          />
          <ZoneTexte
            libelle="Mission"
            required
            rows={3}
            maxLength={2000}
            value={s.mission}
            onChange={(e) => maj("mission", e.target.value)}
            erreur={erreurs.mission}
          />
          <ZoneTexte
            libelle="Valeurs (facultatif)"
            rows={3}
            value={s.valeurs}
            onChange={(e) => maj("valeurs", e.target.value)}
            erreur={erreurs.valeurs}
            aide={`${AIDE_LIGNES} 20 valeurs de 200 caractères au plus.`}
          />
        </>
      );
    case "axe":
      return <ChampsTitre {...p} />;
    case "objectif":
      return <ChampsObjectif {...p} />;
    case "initiative":
      return <ChampsInitiative {...p} />;
  }
}

/**
 * Saisie d'un contenu du plan : création (version 1, brouillon) ou modification, qui crée une
 * nouvelle version reprenant TOUT le contenu (statut « modifié » si le contenu avait déjà été
 * validé). L'API contrôle à nouveau chaque champ, le parent et les droits.
 */
export function FormulaireElement({
  planId,
  type,
  mode,
  horizon,
  devise,
  personnes,
  initiatives = [],
  partage,
  onAnnuler,
  onTermine,
}: FormulaireElementProps) {
  const id = useId();
  const f = useFormulaire<ChampElement>();
  const [s, setS] = useState<SaisieElement>(() =>
    mode.nature === "version"
      ? saisieDepuisDonnees(mode.element.donnees, devise, horizon)
      : saisieElementVide(horizon),
  );
  const maj: Maj = (cle, valeur) => setS((x) => ({ ...x, [cle]: valeur }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerElement(type, s, { horizon, devise }),
      async (donnees) => {
        if (mode.nature === "version") {
          if (memeContenu(donnees, mode.element.donnees)) {
            throw new ErreurApi("CONFLIT", MESSAGE_CONTENU_IDENTIQUE, 409);
          }
          return api.post<ElementPlan>(cheminVersionsElement(planId, mode.element.id), {
            donnees,
            retire: false,
          });
        }
        return api.post<ElementPlan>(cheminElements(planId), {
          type,
          ...(mode.parentId ? { parent_id: mode.parentId } : {}),
          donnees,
        });
      },
      {
        messageSpecifique: (err) => messagePlan(err, "rediger"),
        apres: (element) =>
          onTermine?.(
            messageEcriture(mode.nature === "version" ? "version" : "creation", element, partage),
          ),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
    >
      <AvertissementPartage partage={partage} />
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement refusé"
      />
      <ChampsSelonType
        type={type}
        s={s}
        maj={maj}
        erreurs={f.erreurs}
        id={id}
        horizon={horizon}
        devise={devise}
        personnes={personnes}
        initiatives={initiatives}
        soi={mode.nature === "version" ? mode.element.id : null}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {mode.nature === "version" ? "Enregistrer une nouvelle version" : "Ajouter"}
        </Bouton>
        {onAnnuler ? (
          <Bouton variante="secondaire" disabled={f.enCours} onClick={onAnnuler}>
            Annuler
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}
