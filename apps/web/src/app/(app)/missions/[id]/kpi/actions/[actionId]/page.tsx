import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  FormulaireCommentaireAction,
  FormulaireStatutAction,
} from "../../../../../../../components/kpi/FormulairesActionKpi";
import "../../../../../../../components/kpi/kpi.css";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { droitsKpi, hrefKpi } from "../../../../../../../lib/kpi";
import {
  AVERTISSEMENT_EFFICACITE,
  cheminAction,
  enRetard,
  hrefAction,
  hrefActions,
  hrefRevue,
  LIBELLES_STATUT_ACTION,
  texteEfficaciteDetail,
  texteVerdict,
  type ActionKpi,
  type EvenementAction,
} from "../../../../../../../lib/kpi-pilotage";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Action corrective" };

const TYPES: Record<EvenementAction["type"], string> = {
  creation: "Création",
  statut: "Changement de statut",
  modification: "Modification",
  commentaire: "Commentaire",
};

/**
 * Une action corrective : son rattachement (KPI, alerte, décision de revue), son statut, son
 * efficacité mesurée par le moteur une fois terminée, et son historique en ajout seul.
 */
export default async function PageActionKpi({
  params,
}: {
  params: Promise<{ id: string; actionId: string }>;
}) {
  const { id, actionId } = await params;
  if (!estIdentifiant(actionId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const a = await chargerServeur<ActionKpi>(cheminAction(actionId));
  if (!a.ok && a.statut === 404) notFound();
  if (!a.ok) {
    return (
      <EtatErreur
        titre="L'action n'a pas pu être chargée."
        message={a.message}
        hrefReessayer={hrefAction(m.id, actionId)}
      />
    );
  }
  // Une action d'une autre mission que celle de l'URL n'existe pas pour cette page.
  if (a.donnees.mission_id !== m.id) notFound();
  const action = a.donnees;
  const jour = aujourdhui();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const peutAgir = droits.gerer || droits.saisir || action.responsable_id === utilisateur.id;
  const e = action.efficacite;
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefActions(m.id)} className={classesBouton("secondaire")}>
          Revenir aux actions
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">
        Action {action.numero} — {action.titre}
      </h2>
      <Carte titre="Situation">
        <dl className="mp-kpi-mesures">
          <div>
            <dt>Statut</dt>
            <dd>
              {LIBELLES_STATUT_ACTION[action.statut]}
              {enRetard(action.echeance, action.statut, jour) ? (
                <>
                  {" "}
                  <BadgeStatut tonalite="danger">En retard</BadgeStatut>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>KPI concerné</dt>
            <dd>
              <Link href={hrefKpi(m.id, action.kpi_id)}>{action.kpi_libelle}</Link>
            </dd>
          </div>
          <div>
            <dt>Responsable</dt>
            <dd>{action.responsable_nom ?? "—"}</dd>
          </div>
          <div>
            <dt>Échéance</dt>
            <dd>{formaterDate(action.echeance)}</dd>
          </div>
          {action.date_effet ? (
            <div>
              <dt>Date d&apos;effet</dt>
              <dd>{formaterDate(action.date_effet)}</dd>
            </div>
          ) : null}
          {action.motif ? (
            <div>
              <dt>Motif de l&apos;abandon</dt>
              <dd>{action.motif}</dd>
            </div>
          ) : null}
          {action.revue_id ? (
            <div>
              <dt>Décidée en revue</dt>
              <dd>
                <Link href={hrefRevue(m.id, action.revue_id)}>Voir la revue</Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {action.description ? <p>{action.description}</p> : null}
      </Carte>

      <Carte titre="Efficacité mesurée sur le KPI">
        <p>
          <strong>{texteVerdict(e)}</strong>
        </p>
        {e ? <p>{texteEfficaciteDetail(e, "")}</p> : null}
        {e && e.periodes_avant.length + e.periodes_apres.length > 0 ? (
          <p className="mp-texte-doux">
            Périodes comparées — avant :{" "}
            {e.periodes_avant.map((p) => p.periode).join(", ") || "aucune"}; après :{" "}
            {e.periodes_apres.map((p) => p.periode).join(", ") || "aucune"}.
          </p>
        ) : null}
        <p className="mp-texte-doux">{AVERTISSEMENT_EFFICACITE}</p>
      </Carte>

      {peutAgir ? (
        <>
          <Carte titre="Faire avancer l'action">
            <FormulaireStatutAction action={action} jour={jour} />
          </Carte>
        </>
      ) : null}
      {peutAgir ? (
        <Carte titre="Ajouter un commentaire">
          <FormulaireCommentaireAction actionId={action.id} />
        </Carte>
      ) : null}

      <Carte titre="Historique">
        <Tableau<EvenementAction>
          legende="Historique de l'action (en ajout seul)"
          colonnes={[
            { cle: "date", entete: "Date", rendu: (x) => formaterDateHeure(x.cree_le) },
            { cle: "type", entete: "Événement", rendu: (x) => TYPES[x.type] },
            { cle: "auteur_nom", entete: "Auteur" },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (x) =>
                x.statut_avant && x.statut_avant !== x.statut_apres
                  ? `${LIBELLES_STATUT_ACTION[x.statut_avant as ActionKpi["statut"]]} → ${LIBELLES_STATUT_ACTION[x.statut_apres as ActionKpi["statut"]]}`
                  : LIBELLES_STATUT_ACTION[x.statut_apres as ActionKpi["statut"]],
            },
            { cle: "commentaire", entete: "Commentaire" },
          ]}
          lignes={action.evenements ?? []}
          cleLigne={(x) => x.id}
        />
      </Carte>
    </div>
  );
}
