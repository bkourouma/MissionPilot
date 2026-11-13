import type { ReactNode } from "react";
import type { Metadata } from "next";
import type { Langue, Traduire, TypeElementPlan } from "@missionpilot/shared";
import { GenerationLivrable } from "../../../../../../components/rapports/GenerationLivrable";
import { AjoutElement } from "../../../../../../components/plan/AjoutElement";
import { CitationsLivrable } from "../../../../../../components/preuves/CitationsLivrable";
import { AvertissementPartage } from "../../../../../../components/plan/AvertissementPartage";
import { NotationDiagnostic } from "../../../../../../components/plan/NotationDiagnostic";
import {
  ElementPlanCarte,
  type DroitsElement,
} from "../../../../../../components/plan/ElementPlanCarte";
import { PartagePlan } from "../../../../../../components/plan/PartagePlan";
import { SectionElementUnique } from "../../../../../../components/plan/SectionElementUnique";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { hrefNotation } from "../../../../../../lib/notation";
import {
  cheminLienNotation,
  cheminNotationsProposees,
  peutLierNotationPlan,
  peutLireNotationPlan,
  type LienNotation,
  type NotationsProposees,
} from "../../../../../../lib/plan-diagnostic";
import {
  initiativesDuPlan,
  personnesPlan,
  type OptionInitiative,
  type PersonnePlan,
} from "../../../../../../lib/plan-elements";
import { chargerPlan } from "../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  ELEMENTS_PLAN_MAX,
  manquesPartage,
  messageElementsMax,
  messageMissionCloturee,
  raisonValidationElement,
  structurerPlan,
  type AxeStructure,
  type ContextePlan,
  type ElementPlan,
  type PlanDetaille,
} from "../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Plan stratégique", "Strategic plan") };
}

interface Contexte {
  t: Traduire;
  langue: Langue;
  plan: PlanDetaille;
  ctx: ContextePlan;
  personnes: PersonnePlan[];
  /** Initiatives du plan : dépendances proposées et affichées (PLA-05). */
  initiatives: OptionInitiative[];
  /** Des contenus peuvent encore être ajoutés (droits, plafond de 300). */
  ajout: boolean;
}

function droitsDe(e: ElementPlan, c: Contexte): DroitsElement {
  const d = droitsPlan(c.ctx);
  return {
    rediger: d.rediger,
    valider: d.valider,
    raisonValidation: raisonValidationElement(e, c.ctx, c.langue),
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
      initiatives={c.initiatives}
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
      initiatives={c.initiatives}
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
        <ul
          className="mp-plan-element__enfants"
          aria-label={c.t(
            "Objectifs et initiatives de l'axe",
            "Objectives and initiatives of the axis",
          )}
        >
          {a.objectifs.map((o) => (
            <li key={o.objectif.id}>
              <Element element={o.objectif} c={c} niveau={5}>
                {o.initiatives.length ? (
                  <ul
                    className="mp-plan-element__enfants"
                    aria-label={c.t("Initiatives de l'objectif", "Initiatives of the objective")}
                  >
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
                    libelle={c.t(
                      "Ajouter une initiative à cet objectif",
                      "Add an initiative to this objective",
                    )}
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
          <Ajout
            c={c}
            type="objectif"
            parentId={a.axe.id}
            libelle={c.t("Ajouter un objectif", "Add an objective")}
          />
          <Ajout
            c={c}
            type="initiative"
            parentId={a.axe.id}
            libelle={c.t("Ajouter une initiative à l'axe", "Add an initiative to the axis")}
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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
    t,
    langue,
    plan,
    ctx,
    personnes: personnesPlan(
      cabinet,
      m.equipe,
      { id: utilisateur.id, nom: utilisateur.nom },
      langue,
    ),
    initiatives: initiativesDuPlan(plan.elements),
    ajout: droits.rediger && plan.elements.length < ELEMENTS_PLAN_MAX,
  };
  const s = structurerPlan(plan.elements);
  const lireNotation = peutLireNotationPlan(utilisateur.roles);
  const lierNotation = peutLierNotationPlan(utilisateur.roles, droits.cloturee);
  const [lien, proposees] = await Promise.all([
    lireNotation ? chargerServeur<LienNotation>(cheminLienNotation(plan.id)) : null,
    lierNotation ? chargerServeur<NotationsProposees>(cheminNotationsProposees(plan.id)) : null,
  ]);
  const notationLiee = lien?.ok ? lien.donnees.lien?.notation : null;
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
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      {droits.rediger ? <AvertissementPartage partage={plan.partage_client} /> : null}
      {droits.rediger && !c.ajout ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{messageElementsMax(langue)}</p>
        </Alerte>
      ) : null}

      <Carte titre={t("Partage au client", "Sharing with the client")} niveauTitre={3}>
        <PartagePlan
          planId={plan.id}
          partage={plan.partage_client}
          partageLe={plan.partage_le}
          manques={manquesPartage(plan, langue)}
          peutPartager={droits.partager}
          raisonSansDroit={
            droits.cloturee
              ? messageMissionCloturee(langue)
              : t(
                  "Le partage est décidé par un responsable de la mission (directeur, chef de mission ou associé).",
                  "Sharing is decided by an engagement lead (director, engagement manager or partner).",
                )
          }
        />
      </Carte>

      <Carte titre={t("Rapport du plan", "Plan report")} niveauTitre={3}>
        <GenerationLivrable type="plan" id={plan.id} cloturee={droits.cloturee} />
      </Carte>

      <CitationsLivrable missionId={id} livrable="plan" />

      <Carte titre={t("Diagnostic", "Diagnostic")} niveauTitre={3}>
        <SectionElementUnique
          {...unique("diagnostic", s.diagnostic)}
          libelleAjout={t("Rédiger le diagnostic", "Write the diagnostic")}
          texteVide={t(
            "Synthèse des constats sur l'entreprise : situation, marché, organisation, finances.",
            "Summary of findings about the company: situation, market, organization, finances.",
          )}
        />
        {lien?.ok ? (
          <NotationDiagnostic
            planId={plan.id}
            lien={lien.donnees}
            proposees={proposees?.ok ? proposees.donnees : null}
            hrefNotation={
              notationLiee ? hrefNotation(notationLiee.mission_id, notationLiee.numero) : null
            }
            partage={plan.partage_client}
          />
        ) : lien ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>
              {t(
                `La notation liée au diagnostic n'a pas pu être chargée : ${lien.message}`,
                `The rating linked to the diagnostic could not be loaded: ${lien.message}`,
              )}
            </p>
          </Alerte>
        ) : null}
      </Carte>

      <Carte titre={t("Analyse SWOT", "SWOT analysis")} niveauTitre={3}>
        <SectionElementUnique
          {...unique("swot", s.swot)}
          libelleAjout={t("Rédiger l'analyse SWOT", "Write the SWOT analysis")}
          texteVide={t(
            "Forces, faiblesses, opportunités et menaces, une entrée par ligne.",
            "Strengths, weaknesses, opportunities and threats, one entry per line.",
          )}
        />
      </Carte>

      <Carte titre={t("Vision et mission", "Vision and mission")} niveauTitre={3}>
        <SectionElementUnique
          {...unique("vision_mission", s.vision_mission)}
          libelleAjout={t("Rédiger la vision et la mission", "Write the vision and mission")}
          texteVide={t(
            "Ambition à l'horizon du plan, raison d'être et valeurs de l'entreprise.",
            "Ambition at the plan horizon, purpose and values of the company.",
          )}
        />
      </Carte>

      <Carte
        titre={t("Axes, objectifs et initiatives", "Axes, objectives and initiatives")}
        niveauTitre={3}
      >
        <div className="mp-plan__section">
          {s.axes.length === 0 ? (
            <EtatVide titre={t("Aucun axe stratégique.", "No strategic axis.")} icone="drapeau">
              <p>
                {t(
                  "Commencez par les axes : chaque axe porte des objectifs (selon les quatre perspectives), et chaque objectif des initiatives avec responsable, dates, budget et gains attendus.",
                  "Start with the axes: each axis carries objectives (across the four perspectives), and each objective carries initiatives with owner, dates, budget and expected gains.",
                )}
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-plan-liste" aria-label={t("Axes stratégiques", "Strategic axes")}>
              {s.axes.map((a) => (
                <li key={a.axe.id}>
                  <Axe a={a} c={c} />
                </li>
              ))}
            </ul>
          )}
          {s.orphelins.length ? (
            <ul
              className="mp-plan-liste"
              aria-label={t("Contenus sans rattachement", "Unattached content")}
            >
              {s.orphelins.map((e) => (
                <li key={e.id}>
                  <Element element={e} c={c} niveau={4} />
                </li>
              ))}
            </ul>
          ) : null}
          <Ajout
            c={c}
            type="axe"
            libelle={t("Ajouter un axe stratégique", "Add a strategic axis")}
          />
        </div>
      </Carte>
    </>
  );
}
