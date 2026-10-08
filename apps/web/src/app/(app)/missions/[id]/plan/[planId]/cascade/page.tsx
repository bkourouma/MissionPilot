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
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import {
  cheminCascade,
  GRAVITE_LIBELLES,
  hrefCascade,
  libellePorteur,
  libelleStatutNoeud,
  libelleTrou,
  resumeCouverture,
  TONALITE_GRAVITE,
  trousParGravite,
  TYPE_NOEUD_LIBELLES,
  type CascadePlan,
  type NoeudCascade,
} from "../../../../../../../lib/plan-cascade";
import { personnesPlan, type PersonnePlan } from "../../../../../../../lib/plan-elements";
import { chargerPlan } from "../../../../../../../lib/plan-serveur";
import {
  droitsPlan,
  MESSAGE_MISSION_CLOTUREE,
  type ContextePlan,
} from "../../../../../../../lib/plan-strategique";
import { chargerPersonnes } from "../../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Cascade du plan" };

/** Éléments du plan dont le porteur se désigne ici (une initiative a son responsable). */
const A_PORTEUR = new Set(["vision", "axe", "objectif"]);

function Noeud({
  n,
  c,
  planId,
  rediger,
  personnes,
}: {
  n: NoeudCascade;
  c: CascadePlan;
  planId: string;
  rediger: boolean;
  personnes: readonly PersonnePlan[];
}) {
  const statut = libelleStatutNoeud(n.type, n.statut);
  return (
    <li
      className={`mp-cascade__noeud${n.trous.length ? " mp-cascade__noeud--trou" : ""}`}
      style={{ "--profondeur": n.profondeur } as CSSProperties}
    >
      <div className="mp-cascade__entete">
        <span className="mp-cascade__type">{TYPE_NOEUD_LIBELLES[n.type]}</span>
        <strong className="mp-coupure">{n.titre || "Sans titre"}</strong>
        {n.actif ? null : <BadgeStatut tonalite="neutre">Inactif</BadgeStatut>}
      </div>
      <p className="mp-texte-doux mp-texte-petit">
        {[
          `Porteur : ${libellePorteur(c, n.porteur_id)}`,
          n.echeance ? `Échéance : ${formaterDate(n.echeance)}` : null,
          statut,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {n.trous.length ? (
        <ul className="mp-liste-simple" aria-label={`Écarts de « ${n.titre} »`}>
          {n.trous.map((t) => (
            <li key={t}>{libelleTrou(t)}</li>
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
          libelleOuverture="Ajouter un projet"
        />
      ) : null}
      {rediger && n.type === "projet" && n.actif && !n.orphelin ? (
        <FormulaireNoeudCascade
          planId={planId}
          type="jalon"
          parentId={n.id}
          personnes={personnes}
          libelleOuverture="Ajouter un jalon"
        />
      ) : null}
      {rediger && n.modifiable && (n.type === "projet" || n.type === "jalon") ? (
        <FormulaireNoeudCascade
          planId={planId}
          type={n.type}
          noeud={n}
          personnes={personnes}
          libelleOuverture={`Modifier ${n.type === "projet" ? "le projet" : "le jalon"}`}
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
        titre="La cascade du plan n'a pas pu être chargée."
        message={c.message}
        hrefReessayer={hrefCascade(id, planId)}
      />
    );
  }
  const cascade = c.donnees;
  const personnes = personnesPlan(cabinet, m.equipe, { id: utilisateur.id, nom: utilisateur.nom });
  const groupes = trousParGravite(cascade);

  return (
    <>
      {droits.cloturee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{MESSAGE_MISSION_CLOTUREE}</p>
        </Alerte>
      ) : null}
      <Carte titre="Couverture de la cascade" niveauTitre={3}>
        <div className="mp-plan__section">
          <p>{resumeCouverture(cascade)}</p>
          <div className="mp-plan__badges">
            {(["bloquant", "important", "information"] as const).map((g) => (
              <BadgeStatut key={g} tonalite={cascade.synthese[g] ? TONALITE_GRAVITE[g] : "succes"}>
                {`${GRAVITE_LIBELLES[g]} : ${cascade.synthese[g]}`}
              </BadgeStatut>
            ))}
          </div>
          <p className="mp-texte-doux mp-texte-petit">
            Trous et taux calculés par le moteur à la date du {formaterDate(cascade.reference)}.
            Vision, axes, objectifs et initiatives se rédigent dans l&apos;onglet « Contenus » ; les
            KPI dans l&apos;onglet « KPI ».
          </p>
        </div>
      </Carte>
      <Carte titre="Écarts signalés" niveauTitre={3}>
        {groupes.length === 0 ? (
          <p>Aucun écart : chaque nœud a un porteur et la cascade est complète.</p>
        ) : (
          <div className="mp-plan__section">
            {groupes.map((g) => (
              <section key={g.gravite} aria-label={GRAVITE_LIBELLES[g.gravite]}>
                <h4 className="mp-plan__intertitre">{`${GRAVITE_LIBELLES[g.gravite]} (${g.trous.length})`}</h4>
                <ul className="mp-liste-simple">
                  {g.trous.map((t, i) => (
                    <li key={`${t.code}-${t.noeud_id ?? "plan"}-${i}`}>{t.texte}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Carte>
      <Carte titre="Graphe stratégique" niveauTitre={3}>
        {cascade.noeuds.length === 0 ? (
          <EtatVide titre="Plan sans contenu." icone="barres">
            <p>Rédigez la vision, les axes et les objectifs dans l&apos;onglet « Contenus ».</p>
          </EtatVide>
        ) : (
          <ul className="mp-cascade" aria-label="Cascade de la vision aux jalons et aux KPI">
            {cascade.noeuds.map((n) => (
              <Noeud
                key={n.id}
                n={n}
                c={cascade}
                planId={planId}
                rediger={droits.rediger}
                personnes={personnes}
              />
            ))}
          </ul>
        )}
      </Carte>
    </>
  );
}
