import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { FormulaireNoeudCascade } from "../../../../../../../components/plan/FormulaireNoeudCascade";
import { FormulairePorteur } from "../../../../../../../components/plan/FormulairePorteur";
import "../../../../../../../components/plan/plan-augmente.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminCascade,
  hrefCascade,
  libelleGravite,
  libellePorteur,
  libelleStatutNoeud,
  libelleTrou,
  libelleTypeNoeud,
  resumeCouverture,
  TONALITE_GRAVITE,
  trousParGravite,
  type CascadePlan,
  type NoeudCascade,
} from "../../../../../../../lib/plan-cascade";
import type { Langue, Traduire } from "@missionpilot/shared";
import { personnesPlan, type PersonnePlan } from "../../../../../../../lib/plan-elements";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  messageMissionCloturee,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Cascade du plan", "Plan cascade") };
}

/** Éléments du plan dont le porteur se désigne ici (une initiative a son responsable). */
const A_PORTEUR = new Set(["vision", "axe", "objectif"]);

function Noeud({
  n,
  c,
  planId,
  rediger,
  personnes,
  t,
  langue,
}: {
  n: NoeudCascade;
  c: CascadePlan;
  planId: string;
  rediger: boolean;
  personnes: readonly PersonnePlan[];
  t: Traduire;
  langue: Langue;
}) {
  const statut = libelleStatutNoeud(n.type, n.statut, langue);
  return (
    <li
      className={`mp-cascade__noeud${n.trous.length ? " mp-cascade__noeud--trou" : ""}`}
      style={{ "--profondeur": n.profondeur } as CSSProperties}
    >
      <div className="mp-cascade__entete">
        <span className="mp-cascade__type">{libelleTypeNoeud(n.type, langue)}</span>
        <strong className="mp-coupure">{n.titre || t("Sans titre", "Untitled")}</strong>
        {n.actif ? null : <BadgeStatut tonalite="neutre">{t("Inactif", "Inactive")}</BadgeStatut>}
      </div>
      <p className="mp-texte-doux mp-texte-petit">
        {[
          `${t("Porteur", "Owner")}${langue === "en" ? ":" : " :"} ${libellePorteur(c, n.porteur_id, langue)}`,
          n.echeance
            ? `${t("Échéance", "Due date")}${langue === "en" ? ":" : " :"} ${formaterDate(n.echeance, "UTC", langue)}`
            : null,
          statut,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {n.trous.length ? (
        <ul
          className="mp-liste-simple"
          aria-label={t(`Écarts de « ${n.titre} »`, `Gaps of \u201c${n.titre}\u201d`)}
        >
          {n.trous.map((code) => (
            <li key={code}>{libelleTrou(code, langue)}</li>
          ))}
        </ul>
      ) : null}
      {rediger && A_PORTEUR.has(n.type) ? (
        <FormulairePorteur
          planId={planId}
          elementId={n.id}
          titre={n.titre}
          porteurId={n.porteur_id}
          personnes={personnes}
        />
      ) : null}
      {rediger && n.type === "initiative" && n.actif ? (
        <FormulaireNoeudCascade
          planId={planId}
          type="projet"
          parentId={n.id}
          personnes={personnes}
          libelleOuverture={t("Ajouter un projet", "Add a project")}
        />
      ) : null}
      {rediger && n.type === "projet" && n.actif && !n.orphelin ? (
        <FormulaireNoeudCascade
          planId={planId}
          type="jalon"
          parentId={n.id}
          personnes={personnes}
          libelleOuverture={t("Ajouter un jalon", "Add a milestone")}
        />
      ) : null}
      {rediger && n.modifiable && (n.type === "projet" || n.type === "jalon") ? (
        <FormulaireNoeudCascade
          planId={planId}
          type={n.type}
          noeud={n}
          personnes={personnes}
          libelleOuverture={
            n.type === "projet"
              ? t("Modifier le projet", "Edit the project")
              : t("Modifier le jalon", "Edit the milestone")
          }
        />
      ) : null}
    </li>
  );
}

/**
 * Cascade stratégique en graphe (PLA-12) : de la vision aux jalons et aux KPI, chaque nœud avec
 * son porteur ; trous et taux de couverture calculés par le moteur côté API (à la date du jour).
 * Les rédacteurs du plan désignent les porteurs et ajoutent projets et jalons.
 */
export default async function PageCascadePlan({
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
  const ctx: ContextePlan = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const [c, cabinet] = await Promise.all([
    chargerServeur<CascadePlan>(cheminCascade(planId)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!c.ok) {
    return (
      <EtatErreur
        titre={t(
          "La cascade du plan n'a pas pu être chargée.",
          "The plan cascade could not be loaded.",
        )}
        message={c.message}
        hrefReessayer={hrefCascade(id, planId)}
      />
    );
  }
  const cascade = c.donnees;
  const personnes = personnesPlan(
    cabinet,
    m.equipe,
    { id: utilisateur.id, nom: utilisateur.nom },
    langue,
  );
  const groupes = trousParGravite(cascade, langue);

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{messageMissionCloturee(langue)}</p>
        </Alerte>
      ) : null}
      <Carte titre={t("Couverture de la cascade", "Cascade coverage")} niveauTitre={3}>
        <div className="mp-plan__section">
          <p>{resumeCouverture(cascade, langue)}</p>
          <div className="mp-plan__badges">
            {(["bloquant", "important", "information"] as const).map((g) => (
              <BadgeStatut key={g} tonalite={cascade.synthese[g] ? TONALITE_GRAVITE[g] : "succes"}>
                {`${libelleGravite(g, langue)}${langue === "en" ? ":" : " :"} ${cascade.synthese[g]}`}
              </BadgeStatut>
            ))}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `Trous et taux calculés par le moteur à la date du ${formaterDate(cascade.reference)}. Vision, axes, objectifs et initiatives se rédigent dans l'onglet « Contenus » ; les KPI dans l'onglet « KPI ».`,
              `Gaps and rates computed by the engine as of ${formaterDate(cascade.reference, "UTC", langue)}. Vision, axes, objectives and initiatives are written in the \u201cContent\u201d tab; KPIs in the \u201cKPI\u201d tab.`,
            )}
          </p>
        </div>
      </Carte>
      <Carte titre={t("Écarts signalés", "Reported gaps")} niveauTitre={3}>
        {groupes.length === 0 ? (
          <p>
            {cascade.noeuds.length === 0
              ? t("Aucun nœud : la cascade est vide.", "No nodes: the cascade is empty.")
              : t(
                  "Aucun écart : chaque nœud a un porteur et la cascade est complète.",
                  "No gaps: every node has an owner and the cascade is complete.",
                )}
          </p>
        ) : (
          <div className="mp-plan__section">
            {groupes.map((g) => (
              <section key={g.gravite} aria-label={libelleGravite(g.gravite, langue)}>
                <h4 className="mp-plan__intertitre">{`${libelleGravite(g.gravite, langue)} (${g.trous.length})`}</h4>
                <ul className="mp-liste-simple">
                  {g.trous.map((trou, i) => (
                    <li key={`${trou.code}-${trou.noeud_id ?? "plan"}-${i}`}>{trou.texte}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Carte>
      <Carte titre={t("Graphe stratégique", "Strategic graph")} niveauTitre={3}>
        {cascade.noeuds.length === 0 ? (
          <EtatVide titre={t("Plan sans contenu.", "Plan without content.")} icone="barres">
            <p>
              {t(
                "Rédigez la vision, les axes et les objectifs dans l'onglet « Contenus ».",
                "Write the vision, axes and objectives in the \u201cContent\u201d tab.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul
            className="mp-cascade"
            aria-label={t(
              "Cascade de la vision aux jalons et aux KPI",
              "Cascade from the vision to milestones and KPIs",
            )}
          >
            {cascade.noeuds.map((n) => (
              <Noeud
                key={n.id}
                n={n}
                c={cascade}
                planId={planId}
                rediger={droits.rediger}
                personnes={personnes}
                t={t}
                langue={langue}
              />
            ))}
          </ul>
        )}
      </Carte>
    </>
  );
}
