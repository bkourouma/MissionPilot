"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import type { PersonnePlan } from "../../lib/plan-elements";
import {
  cheminValidationElement,
  cheminVersionsElement,
  etatPlanChange,
  libelleType,
  libelleVersionElement,
  lireTexte,
  messageEcriture,
  messagePlan,
  type ElementPlan,
  type NatureEcriture,
} from "../../lib/plan-strategique";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { BadgeRetire, BadgeStatutPlan } from "./BadgeStatutPlan";
import { ContenuElement } from "./ContenuElement";
import { FormulaireElement } from "./FormulaireElement";
import { HistoriqueElement } from "./HistoriqueElement";

export interface DroitsElement {
  rediger: boolean;
  /** Responsable de la mission (plan.valider) : le bouton « Valider » peut être proposé. */
  valider: boolean;
  /** Pourquoi « Valider » n'est pas proposé à cet utilisateur (séparation des tâches). */
  raisonValidation: string | null;
}

export interface ElementPlanCarteProps {
  planId: string;
  element: ElementPlan;
  horizon: number;
  devise: Devise;
  personnes: readonly PersonnePlan[];
  partage: boolean;
  droits: DroitsElement;
  niveauTitre?: 3 | 4 | 5 | 6;
  /** Contenus rattachés (objectifs d'un axe, initiatives d'un objectif) et formulaires d'ajout. */
  children?: ReactNode;
}

/**
 * Un contenu du plan : statut, version courante, actions (modifier = nouvelle version,
 * valider, retirer ou rétablir), historique. Les boutons sont un confort d'affichage : l'API
 * vérifie les droits, la séparation des tâches (403 VALIDATION_REQUISE, message affiché) et
 * l'état de la mission.
 */
export function ElementPlanCarte({
  planId,
  element: e,
  horizon,
  devise,
  personnes,
  partage,
  droits,
  niveauTitre = 4,
  children,
}: ElementPlanCarteProps) {
  const router = useRouter();
  const idTitre = useId();
  const [edition, setEdition] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, attendre] = useAttenteRafraichissement(e.version);
  const refSucces = useRef<HTMLDivElement>(null);
  const refErreur = useRef<HTMLDivElement>(null);
  const [focaliserSucces, setFocaliserSucces] = useState(false);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);
  useEffect(() => {
    if (succes && focaliserSucces) refSucces.current?.focus();
  }, [succes, focaliserSucces]);

  async function agir(nature: NatureEcriture): Promise<boolean> {
    if (attente) return false;
    setErreur(null);
    setSucces(null);
    try {
      const r =
        nature === "validation"
          ? await api.post<ElementPlan>(cheminValidationElement(planId, e.id))
          : await api.post<ElementPlan>(cheminVersionsElement(planId, e.id), {
              donnees: e.donnees,
              retire: nature === "retrait",
            });
      setFocaliserSucces(false);
      setSucces(messageEcriture(nature, r, nature !== "validation" && partage));
      attendre();
      router.refresh();
      return true;
    } catch (err) {
      setErreur(messagePlan(err, nature === "validation" ? "valider" : "rediger"));
      if (etatPlanChange(err)) router.refresh();
      return false;
    }
  }

  const Titre = `h${niveauTitre}` as const;
  const titre = lireTexte(e.donnees, "titre");
  const peutValider =
    droits.valider && e.statut_contenu !== "valide" && droits.raisonValidation === null;
  return (
    <article
      className={e.retire ? "mp-plan-element mp-plan-element--retire" : "mp-plan-element"}
      aria-labelledby={idTitre}
    >
      <div className="mp-plan-element__entete">
        {titre ? <span className="mp-plan-element__type">{libelleType(e.type)}</span> : null}
        <Titre className="mp-plan-element__titre" id={idTitre}>
          {titre ?? libelleType(e.type)}
        </Titre>
        <BadgeStatutPlan statut={e.statut_contenu} />
        {e.retire ? <BadgeRetire /> : null}
      </div>
      <p className="mp-plan-element__meta">
        {libelleVersionElement({ ...e, cree_le: e.version_le })}
      </p>

      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Action refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte ref={refSucces} tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {edition ? (
        <FormulaireElement
          planId={planId}
          type={e.type}
          mode={{ nature: "version", element: e }}
          horizon={horizon}
          devise={devise}
          personnes={personnes}
          partage={partage}
          onAnnuler={() => setEdition(false)}
          onTermine={(message) => {
            setEdition(false);
            setFocaliserSucces(true);
            setSucces(message);
            attendre();
          }}
        />
      ) : (
        <ContenuElement type={e.type} donnees={e.donnees} devise={devise} personnes={personnes} />
      )}

      {!edition && (droits.rediger || peutValider) ? (
        <div className="mp-plan-element__actions">
          {droits.rediger && !e.retire ? (
            <Bouton
              variante="secondaire"
              icone="crayon"
              disabled={attente}
              onClick={() => {
                setSucces(null);
                setErreur(null);
                setEdition(true);
              }}
            >
              Modifier
            </Bouton>
          ) : null}
          {peutValider ? (
            <BoutonConfirmation
              key={`valider-${e.version}`}
              libelle="Valider"
              question={`Valider la version ${e.version} de ce contenu ? Elle deviendra la version de référence, partageable au client.`}
              libelleConfirmation="Oui, valider"
              texteChargement="Validation…"
              variante="primaire"
              icone="succes"
              action={() => agir("validation")}
            />
          ) : null}
          {droits.rediger ? (
            <BoutonConfirmation
              key={`retrait-${e.version}`}
              libelle={e.retire ? "Rétablir" : "Retirer du plan"}
              question={
                e.retire
                  ? "Rétablir ce contenu dans le plan ? Une nouvelle version sera créée, à faire valider."
                  : `Retirer ce contenu du plan ? Il reste dans l'historique ; le retrait crée une nouvelle version à faire valider.${partage ? " Le partage au client sera retiré." : ""}`
              }
              libelleConfirmation={e.retire ? "Oui, rétablir" : "Oui, retirer"}
              texteChargement="Enregistrement…"
              icone={e.retire ? "historique" : "fermer"}
              action={() => agir(e.retire ? "retablissement" : "retrait")}
            />
          ) : null}
        </div>
      ) : null}
      {!edition && droits.valider && droits.raisonValidation && e.statut_contenu !== "valide" ? (
        <p className="mp-texte-doux mp-texte-petit">{droits.raisonValidation}</p>
      ) : null}

      <HistoriqueElement
        key={e.version}
        planId={planId}
        elementId={e.id}
        type={e.type}
        devise={devise}
        personnes={personnes}
      />
      {children}
    </article>
  );
}
