"use client";

import { useState, type FormEvent } from "react";
import {
  RED_DOMAINES,
  RED_DOMAINE_LIBELLES,
  RED_VOLETS,
  RED_VOLET_LIBELLES,
  type RedActionVue,
  type RedDefinitionLevierVue,
  type RedDomaine,
  type RedImpactLevierVue,
  type RedVolet,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import { ajouterJoursIso } from "../../lib/kpi";
import {
  cheminAction,
  cheminActionsDossier,
  cheminSimulationLevier,
  messageRedressement,
} from "../../lib/redressement";
import {
  corpsActionDepuisFormulaire,
  corpsSimulationDepuisFormulaire,
  parametresVersSaisie,
  type ChampAction,
  type SaisieAction,
} from "../../lib/redressement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ImpactLevier } from "./ImpactLevier";
import { ChampsParametresLevier } from "./SimulateurLevier";

const OPTIONS_VOLETS = RED_VOLETS.map((v) => ({ valeur: v, libelle: RED_VOLET_LIBELLES[v] }));
const OPTIONS_DOMAINES = RED_DOMAINES.map((d) => ({ valeur: d, libelle: RED_DOMAINE_LIBELLES[d] }));

export interface OptionResponsable {
  valeur: string;
  libelle: string;
}

/**
 * Formulaire d'action du plan (création ou modification) : titre, description, volet, domaine,
 * échéance, responsable, levier facultatif (liste du catalogue, paramètres avec unité et bornes,
 * « Simuler ») et, à la création, la case « Créer aussi une tâche dans Mes tâches » (droit
 * d'assigner une tâche). L'impact d'un levier est calculé par le moteur et conservé avec l'action.
 */
export function FormulaireAction({
  dossierId,
  devise,
  responsables,
  leviers,
  aujourdhui,
  peutAssignerTache,
  action,
  levierInitial,
  responsableParDefaut,
}: {
  dossierId: string;
  devise: Devise;
  responsables: OptionResponsable[];
  leviers: RedDefinitionLevierVue[];
  aujourdhui: string;
  peutAssignerTache: boolean;
  /** Absent : création. */
  action?: RedActionVue;
  levierInitial?: string;
  responsableParDefaut: string;
}) {
  const f = useFormulaire<ChampAction>();
  const creation = action === undefined;
  const [s, setS] = useState<SaisieAction>(() => {
    const codeLevier = action?.levier?.code ?? levierInitial ?? "";
    const definition = leviers.find((l) => l.code === codeLevier);
    return {
      titre: action?.titre ?? "",
      description: action?.description ?? "",
      volet: action?.volet ?? "quick_win",
      domaine: action?.domaine ?? "tresorerie",
      echeance: action?.echeance ?? ajouterJoursIso(aujourdhui, 90),
      responsable_id: action?.responsable.id ?? responsableParDefaut,
      levier_code: definition ? codeLevier : "",
      parametres:
        action?.levier && definition
          ? parametresVersSaisie(definition, action.levier.parametres, devise)
          : {},
      creer_tache: false,
    };
  });
  const [impact, setImpact] = useState<RedImpactLevierVue | null>(null);
  const [erreurSimulation, setErreurSimulation] = useState<string | null>(null);
  const [simulationEnCours, setSimulationEnCours] = useState(false);
  const definition = leviers.find((l) => l.code === s.levier_code);

  async function simuler() {
    setErreurSimulation(null);
    setImpact(null);
    const v = corpsSimulationDepuisFormulaire(definition, s.parametres, devise);
    if (!v.ok) {
      setErreurSimulation(v.erreurs.levier ?? v.erreurs.parametres ?? "Saisie invalide.");
      return;
    }
    setSimulationEnCours(true);
    try {
      setImpact(await api.post<RedImpactLevierVue>(cheminSimulationLevier(dossierId), v.charge));
    } catch (e) {
      setErreurSimulation(messageRedressement(e));
    } finally {
      setSimulationEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (creation) {
      await f.envoyer(
        corpsActionDepuisFormulaire(s, devise, leviers, "creation"),
        (charge) => api.post<RedActionVue>(cheminActionsDossier(dossierId), charge),
        {
          succes: "Action ajoutée au plan.",
          messageSpecifique: messageRedressement,
          apres: () => {
            setS((x) => ({ ...x, titre: "", description: "", creer_tache: false }));
            setImpact(null);
          },
        },
      );
    } else {
      await f.envoyer(
        corpsActionDepuisFormulaire(s, devise, leviers, "modification"),
        (charge) => api.patch<RedActionVue>(cheminAction(action.id), charge),
        { succes: "Action modifiée.", messageSpecifique: messageRedressement },
      );
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={creation ? "Ajouter une action" : "Modifier l'action"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={creation ? "Ajout impossible" : "Modification refusée"}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Titre de l'action"
          required
          maxLength={200}
          autoComplete="off"
          value={s.titre}
          onChange={(e) => setS((x) => ({ ...x, titre: e.target.value }))}
          erreur={f.erreurs.titre}
        />
        <Select
          libelle="Volet"
          value={s.volet}
          onChange={(e) => setS((x) => ({ ...x, volet: e.target.value as RedVolet }))}
          options={OPTIONS_VOLETS}
        />
        <Select
          libelle="Domaine"
          value={s.domaine}
          onChange={(e) => setS((x) => ({ ...x, domaine: e.target.value as RedDomaine }))}
          options={OPTIONS_DOMAINES}
        />
        <Champ
          libelle="Échéance"
          type="date"
          required
          value={s.echeance}
          onChange={(e) => setS((x) => ({ ...x, echeance: e.target.value }))}
          erreur={f.erreurs.echeance}
        />
        <Select
          libelle="Responsable"
          required
          value={s.responsable_id}
          invite="Choisir…"
          onChange={(e) => setS((x) => ({ ...x, responsable_id: e.target.value }))}
          options={responsables}
          erreur={f.erreurs.responsable_id}
          aide="Directeur, chef et équipe de la mission."
        />
      </div>
      <ZoneTexte
        libelle="Description (facultatif)"
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={f.erreurs.description}
      />

      <fieldset className="mp-red-fiche">
        <legend>Levier (facultatif)</legend>
        <Select
          libelle="Levier du catalogue"
          value={s.levier_code}
          invite="Aucun levier"
          onChange={(e) => {
            setS((x) => ({ ...x, levier_code: e.target.value, parametres: {} }));
            setImpact(null);
            setErreurSimulation(null);
          }}
          options={leviers.map((l) => ({ valeur: l.code, libelle: l.libelle }))}
          erreur={f.erreurs.levier}
        />
        {definition ? (
          <>
            <ChampsParametresLevier
              definition={definition}
              valeurs={s.parametres}
              onChange={(cle, valeur) =>
                setS((x) => ({ ...x, parametres: { ...x.parametres, [cle]: valeur } }))
              }
              devise={devise}
            />
            {f.erreurs.parametres ? (
              <Alerte tonalite="danger" annonce="alert">
                <p>{f.erreurs.parametres}</p>
              </Alerte>
            ) : null}
            <div className="mp-actions-formulaire">
              <Bouton
                variante="secondaire"
                chargement={simulationEnCours}
                texteChargement="Simulation…"
                onClick={() => void simuler()}
              >
                Simuler
              </Bouton>
            </div>
            {erreurSimulation ? (
              <Alerte tonalite="danger" annonce="alert">
                <p>{erreurSimulation}</p>
              </Alerte>
            ) : null}
            {impact ? <ImpactLevier impact={impact} /> : null}
          </>
        ) : null}
      </fieldset>

      {creation && peutAssignerTache ? (
        <CaseACocher
          libelle="Créer aussi une tâche dans Mes tâches"
          aide="Le responsable la retrouve dans sa liste ; les statuts ne sont pas synchronisés."
          checked={s.creer_tache}
          onChange={(e) => setS((x) => ({ ...x, creer_tache: e.target.checked }))}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {creation ? "Ajouter l'action" : "Enregistrer l'action"}
        </Bouton>
      </div>
    </form>
  );
}
