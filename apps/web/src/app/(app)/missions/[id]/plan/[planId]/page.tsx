import type { ReactNode } from "react";
import type { Metadata } from "next";
import type { TypeElementPlan } from "@missionpilot/shared";
import { AjoutElement } from "../../../../../../components/plan/AjoutElement";
import { AvertissementPartage } from "../../../../../../components/plan/AvertissementPartage";
import {
  ElementPlanCarte,
  type DroitsElement,
} from "../../../../../../components/plan/ElementPlanCarte";
import { PartagePlan } from "../../../../../../components/plan/PartagePlan";
import { SectionElementUnique } from "../../../../../../components/plan/SectionElementUnique";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { personnesPlan, type PersonnePlan } from "../../../../../../lib/plan-elements";
import { chargerPlan } from "../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  ELEMENTS_PLAN_MAX,
  manquesPartage,
  MESSAGE_ELEMENTS_MAX,
  MESSAGE_MISSION_CLOTUREE,
  raisonValidationElement,
  structurerPlan,
  type AxeStructure,
  type ContextePlan,
  type ElementPlan,
  type PlanDetaille,
} from "../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Plan stratégique" };

interface Contexte {
  plan: PlanDetaille;
  ctx: ContextePlan;
  personnes: PersonnePlan[];
  /** Des contenus peuvent encore être ajoutés (droits, plafond de 300). */
  ajout: boolean;
}

function droitsDe(e: ElementPlan, c: Contexte): DroitsElement {
  const d = droitsPlan(c.ctx);
  return {
    rediger: d.rediger,
    valider: d.valider,
    raisonValidation: raisonValidationElement(e, c.ctx),
  };
}

function Element({
  element,
  c,
  niveau,
  children,
}: {
  element: ElementPlan;
  c: Contexte;
  niveau: 4 | 5 | 6;
  children?: ReactNode;
}) {
  return (
    <ElementPlanCarte
      planId={c.plan.id}
      element={element}
      horizon={c.plan.horizon}
      devise={c.plan.devise}
      personnes={c.personnes}
      partage={c.plan.partage_client}
      droits={droitsDe(element, c)}
      niveauTitre={niveau}
    >
      {children}
    </ElementPlanCarte>
  );
}

function Ajout({
  c,
  type,
  parentId,
  libelle,
}: {
  c: Contexte;
  type: TypeElementPlan;
  parentId?: string;
  libelle: string;
}) {
  if (!c.ajout) return null;
  return (
    <AjoutElement
      planId={c.plan.id}
      type={type}
      parentId={parentId}
      libelle={libelle}
      horizon={c.plan.horizon}
      devise={c.plan.devise}
      personnes={c.personnes}
      partage={c.plan.partage_client}
    />
  );
}

function Axe({ a, c }: { a: AxeStructure; c: Contexte }) {
  const actif = !a.axe.retire;
  const vide = a.objectifs.length === 0 && a.initiatives.length === 0;
  return (
    <Element element={a.axe} c={c} niveau={4}>
      {!vide ? (
        <ul className="mp-plan-element__enfants" aria-label="Objectifs et initiatives de l'axe">
          {a.objectifs.map((o) => (
            <li key={o.objectif.id}>
              <Element element={o.objectif} c={c} niveau={5}>
                {o.initiatives.length ? (
                  <ul className="mp-plan-element__enfants" aria-label="Initiatives de l'objectif">
                    {o.initiatives.map((i) => (
                      <li key={i.id}>
                        <Element element={i} c={c} niveau={6} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!o.objectif.retire ? (
                  <Ajout
                    c={c}
                    type="initiative"
                    parentId={o.objectif.id}
                    libelle="Ajouter une initiative à cet objectif"
                  />
                ) : null}
              </Element>
            </li>
          ))}
          {a.initiatives.map((i) => (
            <li key={i.id}>
              <Element element={i} c={c} niveau={5} />
            </li>
          ))}
        </ul>
      ) : null}
      {actif && c.ajout ? (
        <div className="mp-plan-element__actions">
          <Ajout c={c} type="objectif" parentId={a.axe.id} libelle="Ajouter un objectif" />
          <Ajout
            c={c}
            type="initiative"
            parentId={a.axe.id}
            libelle="Ajouter une initiative à l'axe"
          />
        </div>
      ) : null}
    </Element>
  );
}

/**
 * Contenus du plan (PLA-01 à PLA-05) : diagnostic, SWOT, vision et mission, puis axes →
 * objectifs → initiatives, chacun avec son statut, ses versions et sa validation ; partage au
 * client en tête (ce qui manque est expliqué). Rendu serveur, rien dans le navigateur.
 */
export default async function PageContenusPlan({
  params,
}: {
  params: Promise<{ id: string; planId: string }>;
}) {
  const { id, planId } = await params;
  const { utilisateur } = await exigerPermission("plan.lire");
  const [mission, r] = await Promise.all([chargerMission(id), chargerPlan(planId)]);
  // La mise en page affiche les erreurs de chargement (mission, plan).
  if (!mission.ok || !r.ok || r.donnees.mission_id !== mission.donnees.id) return null;
  const m = mission.donnees;
  const plan = r.donnees;
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const cabinet = await chargerPersonnes(utilisateur.roles);
  const c: Contexte = {
    plan,
    ctx,
    personnes: personnesPlan(cabinet, m.equipe, { id: utilisateur.id, nom: utilisateur.nom }),
    ajout: droits.rediger && plan.elements.length < ELEMENTS_PLAN_MAX,
  };
  const s = structurerPlan(plan.elements);
  const unique = (type: "diagnostic" | "swot" | "vision_mission", element: ElementPlan | null) => ({
    planId: plan.id,
    type,
    element,
    horizon: plan.horizon,
    devise: plan.devise,
    personnes: c.personnes,
    partage: plan.partage_client,
    droits: element
      ? droitsDe(element, c)
      : { rediger: c.ajout, valider: droits.valider, raisonValidation: null },
  });

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      {droits.rediger ? <AvertissementPartage partage={plan.partage_client} /> : null}
      {droits.rediger && !c.ajout ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{MESSAGE_ELEMENTS_MAX}</p>
        </Alerte>
      ) : null}

      <Carte titre="Partage au client" niveauTitre={3}>
        <PartagePlan
          planId={plan.id}
          partage={plan.partage_client}
          partageLe={plan.partage_le}
          manques={manquesPartage(plan)}
          peutPartager={droits.partager}
          raisonSansDroit={
            droits.cloturee
              ? MESSAGE_MISSION_CLOTUREE
              : "Le partage est décidé par un responsable de la mission (directeur, chef de mission ou associé)."
          }
        />
      </Carte>

      <Carte titre="Diagnostic" niveauTitre={3}>
        <SectionElementUnique
          {...unique("diagnostic", s.diagnostic)}
          libelleAjout="Rédiger le diagnostic"
          texteVide="Synthèse des constats sur l'entreprise : situation, marché, organisation, finances."
        />
      </Carte>

      <Carte titre="Analyse SWOT" niveauTitre={3}>
        <SectionElementUnique
          {...unique("swot", s.swot)}
          libelleAjout="Rédiger l'analyse SWOT"
          texteVide="Forces, faiblesses, opportunités et menaces, une entrée par ligne."
        />
      </Carte>

      <Carte titre="Vision et mission" niveauTitre={3}>
        <SectionElementUnique
          {...unique("vision_mission", s.vision_mission)}
          libelleAjout="Rédiger la vision et la mission"
          texteVide="Ambition à l'horizon du plan, raison d'être et valeurs de l'entreprise."
        />
      </Carte>

      <Carte titre="Axes, objectifs et initiatives" niveauTitre={3}>
        <div className="mp-plan__section">
          {s.axes.length === 0 ? (
            <EtatVide titre="Aucun axe stratégique." icone="drapeau">
              <p>
                Commencez par les axes : chaque axe porte des objectifs (selon les quatre
                perspectives), et chaque objectif des initiatives avec responsable, dates, budget et
                gains attendus.
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-plan-liste" aria-label="Axes stratégiques">
              {s.axes.map((a) => (
                <li key={a.axe.id}>
                  <Axe a={a} c={c} />
                </li>
              ))}
            </ul>
          )}
          {s.orphelins.length ? (
            <ul className="mp-plan-liste" aria-label="Contenus sans rattachement">
              {s.orphelins.map((e) => (
                <li key={e.id}>
                  <Element element={e} c={c} niveau={4} />
                </li>
              ))}
            </ul>
          ) : null}
          <Ajout c={c} type="axe" libelle="Ajouter un axe stratégique" />
        </div>
      </Carte>
    </>
  );
}
