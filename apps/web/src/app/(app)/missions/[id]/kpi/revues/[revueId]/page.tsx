import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoutonActionKpi } from "../../../../../../../components/kpi/BoutonActionKpi";
import { BoutonDossierRevue } from "../../../../../../../components/kpi/BoutonDossierRevue";
import {
  FormulaireDecision,
  FormulaireOrdreDuJour,
  FormulaireTenueRevue,
  SuiviDecision,
} from "../../../../../../../components/kpi/FormulairesRevueKpi";
import "../../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { droitsKpi } from "../../../../../../../lib/kpi";
import {
  avertissementTronque,
  cheminActionRevue,
  cheminGenererOrdreDuJour,
  cheminRevue,
  commentairesDecision,
  hrefAction,
  hrefNouvelleAction,
  hrefRevue,
  hrefRevues,
  libellePointRevue,
  libelleStatutAction,
  libelleStatutDecision,
  libelleEcheance,
  libelleOrigineOrdreDuJour,
  texteVerdict,
  type ActionKpi,
  type DecisionKpi,
  type DetailRevue,
  type PointOrdreDuJour,
} from "../../../../../../../lib/kpi-pilotage";
import { chargerOptionsPilotage } from "../../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Revue de performance", "Performance review") };
}

/**
 * Une revue de performance : ordre du jour (proposé par le moteur, déterministe), dossier et
 * présentation à télécharger, décisions et actions suivies jusqu'à la clôture. Une revue tenue
 * garde figé le dossier examiné ; elle ne se clôture que lorsque tout ce qu'elle a décidé est
 * terminé ou abandonné.
 */
export default async function PageRevueKpi({
  params,
}: {
  params: Promise<{ id: string; revueId: string }>;
}) {
  const { id, revueId } = await params;
  if (!estIdentifiant(revueId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const [revue, options] = await Promise.all([
    chargerServeur<DetailRevue>(cheminRevue(revueId)),
    chargerOptionsPilotage(utilisateur.roles, m, m.id, langue),
  ]);
  if (!revue.ok && revue.statut === 404) notFound();
  if (!revue.ok) {
    return (
      <EtatErreur
        titre={t("La revue n'a pas pu être chargée.", "The review could not be loaded.")}
        message={revue.message}
        hrefReessayer={hrefRevue(m.id, revueId)}
      />
    );
  }
  const v = revue.donnees;
  // Une revue d'une autre mission que celle de l'URL n'existe pas pour cette page.
  if (v.mission_id !== m.id) notFound();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const kpiLibelle = new Map(options.kpis.map((k) => [k.valeur, k.libelle]));
  const planifiee = v.statut === "planifiee";
  const tenue = v.statut === "tenue";
  const totalMinutes = v.ordre_du_jour.reduce((s, p) => s + p.duree_minutes, 0);
  const ouvertes =
    v.decisions.filter((d) => d.statut === "ouverte" || d.statut === "en_cours").length +
    v.actions.filter((a) => a.statut === "a_faire" || a.statut === "en_cours").length;
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefRevues(m.id)} className={classesBouton("secondaire")}>
          {t("Revenir aux revues", "Back to the reviews")}
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">
        {t("Revue", "Review")} {v.numero} — {v.titre}
      </h2>
      <Carte titre={t("Situation", "Situation")}>
        <dl className="mp-kpi-mesures">
          <div>
            <dt>{t("Statut", "Status")}</dt>
            <dd>
              {t(
                LIBELLES_STATUT_REVUE_TEXTE[v.statut][0],
                LIBELLES_STATUT_REVUE_TEXTE[v.statut][1],
              )}
            </dd>
          </div>
          <div>
            <dt>{t("Date de la revue", "Review date")}</dt>
            <dd>{formaterDate(v.date_prevue, "UTC", langue)}</dd>
          </div>
          <div>
            <dt>{t("Arrêté des KPI examinés", "Cut-off of the KPIs reviewed")}</dt>
            <dd>{formaterDate(v.date_reference, "UTC", langue)}</dd>
          </div>
          <div>
            <dt>{t("Animateur", "Facilitator")}</dt>
            <dd>{v.animateur_nom ?? t("À désigner", "To be assigned")}</dd>
          </div>
        </dl>
        {v.dossier_fige ? (
          <p className="mp-texte-doux">
            {t(
              "Le dossier examiné est figé : les mesures saisies après la tenue n'y changent rien.",
              "The file reviewed is frozen: measurements entered after the review changes nothing in it.",
            )}
          </p>
        ) : null}
      </Carte>

      <Carte titre={t("Ordre du jour", "Agenda")}>
        {v.ordre_du_jour.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun ordre du jour. Le moteur le propose d'après les KPI en rouge ou en dégradation, les actions en retard, les décisions ouvertes et la qualité des données.",
              "No agenda. The engine proposes one based on red or deteriorating KPIs, overdue actions, open decisions and data quality.",
            )}
          </p>
        ) : (
          <>
            <Tableau<PointOrdreDuJour>
              legende={t("Ordre du jour de la revue", "Review agenda")}
              colonnes={[
                { cle: "rang", entete: t("N°", "No."), alignement: "droite" },
                {
                  cle: "libelle",
                  entete: t("Point", "Item"),
                  rendu: (p) => (
                    <>
                      {p.libelle}
                      {p.kpi_id && kpiLibelle.get(p.kpi_id) && p.origine === "manuel"
                        ? ` (${kpiLibelle.get(p.kpi_id)})`
                        : ""}
                    </>
                  ),
                },
                {
                  cle: "code",
                  entete: t("Nature", "Type"),
                  rendu: (p) => libellePointRevue(p.code, langue),
                },
                {
                  cle: "duree",
                  entete: t("Durée", "Duration"),
                  alignement: "droite",
                  rendu: (p) => `${p.duree_minutes} min`,
                },
              ]}
              lignes={v.ordre_du_jour}
              cleLigne={(p) => String(p.rang)}
            />
            <p className="mp-texte-doux">
              {libelleOrigineOrdreDuJour(v.ordre_du_jour, langue)} ·{" "}
              {t(
                `durée prévue : ${totalMinutes} minutes.`,
                `planned duration: ${totalMinutes} minutes.`,
              )}
            </p>
          </>
        )}
        {planifiee && droits.gerer ? (
          <div className="mp-pile">
            <BoutonActionKpi
              libelle={
                v.ordre_du_jour.length === 0
                  ? t("Proposer l'ordre du jour", "Propose the agenda")
                  : t("Régénérer l'ordre du jour", "Regenerate the agenda")
              }
              chemin={cheminGenererOrdreDuJour(v.id)}
              succes={t("Ordre du jour proposé par le moteur.", "Agenda proposed by the engine.")}
              texteChargement={t("Calcul…", "Computing…")}
              confirmation={
                v.ordre_du_jour.length === 0
                  ? undefined
                  : {
                      question: t(
                        "Régénérer l'ordre du jour ? La liste actuelle sera remplacée.",
                        "Regenerate the agenda? The current list will be replaced.",
                      ),
                      libelleConfirmation: t("Oui, régénérer", "Yes, regenerate"),
                    }
              }
            />
            <FormulaireOrdreDuJour revueId={v.id} />
          </div>
        ) : null}
      </Carte>

      <Carte titre={t("Dossier et présentation", "File and presentation")}>
        <p className="mp-texte-doux">
          {t(
            "Généré à chaque demande depuis les données de la mission (document : PDF ou Word ; présentation : PowerPoint).",
            "Generated on each request from the engagement's data (document: PDF or Word; presentation: PowerPoint).",
          )}{" "}
          {planifiee
            ? t(
                "Tant que la revue n'est pas tenue, le dossier est un brouillon.",
                "Until the review is held, the file is a draft.",
              )
            : ""}
        </p>
        <BoutonDossierRevue revueId={v.id} numero={v.numero} />
      </Carte>

      {planifiee && droits.gerer ? (
        <Carte titre={t("Tenir ou annuler la revue", "Hold or cancel the review")}>
          <p className="mp-texte-doux">
            {t(
              "Tenir la revue fige le dossier tel qu'il est aujourd'hui, l'ordre du jour et le compte rendu, puis ouvre l'enregistrement des décisions. L'ordre du jour doit être établi. Le dossier reste un brouillon confidentiel : il n'est jamais marqué « validé ».",
              'Holding the review freezes the file as it is today, the agenda and the minutes, then opens the recording of decisions. The agenda must be established. The file remains a confidential draft: it is never marked "approved".',
            )}
          </p>
          <FormulaireTenueRevue revueId={v.id} />
          <BoutonActionKpi
            libelle={t("Annuler la revue", "Cancel the review")}
            chemin={cheminActionRevue(v.id, "annuler")}
            succes={t("Revue annulée.", "Review cancelled.")}
            variante="danger"
            confirmation={{
              question: t(
                "Annuler cette revue ? Une revue annulée ne se rouvre pas.",
                "Cancel this review? A cancelled review cannot be reopened.",
              ),
              libelleConfirmation: t("Oui, annuler la revue", "Yes, cancel the review"),
            }}
          />
        </Carte>
      ) : null}

      {(tenue || v.statut === "cloturee") && (
        <Carte titre={t(`Décisions (${v.decisions.length})`, `Decisions (${v.decisions.length})`)}>
          <Tableau<DecisionKpi>
            legende={t("Décisions de la revue", "Review decisions")}
            messageVide={t("Aucune décision enregistrée.", "No decision recorded.")}
            colonnes={[
              { cle: "numero", entete: t("N°", "No."), alignement: "droite" },
              {
                cle: "libelle",
                entete: t("Décision", "Decision"),
                rendu: (d) => (
                  <>
                    {d.libelle}
                    {d.motif ? <span className="mp-texte-doux"> — {d.motif}</span> : null}
                    {commentairesDecision(v.evenements_decisions, d.id, langue).map((c) => (
                      <p key={c.cle} className="mp-texte-doux mp-texte-petit">
                        {c.texte} : {c.commentaire}
                      </p>
                    ))}
                  </>
                ),
              },
              { cle: "responsable_nom", entete: t("Responsable", "Owner") },
              {
                cle: "echeance",
                entete: t("Échéance", "Due date"),
                rendu: (d) => libelleEcheance(d.echeance, langue),
              },
              {
                cle: "statut",
                entete: t("Statut", "Status"),
                rendu: (d) => libelleStatutDecision(d.statut, langue),
              },
              {
                cle: "suivi",
                entete: t("Suivi", "Follow-up"),
                rendu: (d) =>
                  tenue && (droits.gerer || d.responsable_id === utilisateur.id) ? (
                    <div className="mp-pile">
                      {d.statut === "ouverte" || d.statut === "en_cours" ? (
                        <Link
                          href={hrefNouvelleAction(m.id, {
                            decision: d.id,
                            revue: v.id,
                            kpi: d.kpi_id,
                          })}
                          className={classesBouton("discret")}
                        >
                          {t("Créer une action", "Create an action")}
                        </Link>
                      ) : null}
                      <SuiviDecision decision={d} />
                    </div>
                  ) : (
                    "—"
                  ),
              },
            ]}
            lignes={v.decisions}
            cleLigne={(d) => d.id}
          />
          <Tronque
            message={avertissementTronque(v.decisions_tronque, t("décisions", "decisions"), langue)}
            titre={t("Liste incomplète", "Incomplete list")}
          />
          {tenue && droits.gerer ? (
            <FormulaireDecision revueId={v.id} kpis={options.kpis} personnes={options.personnes} />
          ) : null}
        </Carte>
      )}

      {(tenue || v.statut === "cloturee") && (
        <Carte
          titre={t(
            `Actions issues de la revue (${v.actions.length})`,
            `Actions from the review (${v.actions.length})`,
          )}
        >
          <Tableau<ActionKpi>
            legende={t(
              "Actions correctives décidées en revue",
              "Corrective actions decided in the review",
            )}
            messageVide={t(
              "Aucune action rattachée à cette revue. Utilisez « Créer une action » sur une décision, ou le registre des actions.",
              'No action linked to this review. Use "Create an action" on a decision, or the action register.',
            )}
            colonnes={[
              {
                cle: "titre",
                entete: t("Action", "Action"),
                rendu: (a) => <Link href={hrefAction(m.id, a.id)}>{a.titre}</Link>,
              },
              { cle: "kpi_libelle", entete: "KPI" },
              { cle: "responsable_nom", entete: t("Responsable", "Owner") },
              {
                cle: "echeance",
                entete: t("Échéance", "Due date"),
                rendu: (a) => formaterDate(a.echeance, "UTC", langue),
              },
              {
                cle: "statut",
                entete: t("Statut", "Status"),
                rendu: (a) => libelleStatutAction(a.statut, langue),
              },
              {
                cle: "efficacite",
                entete: t("Efficacité mesurée", "Measured effectiveness"),
                rendu: (a) => (a.statut === "terminee" ? texteVerdict(a.efficacite, langue) : "—"),
              },
            ]}
            lignes={v.actions}
            cleLigne={(a) => a.id}
          />
          <Tronque
            message={avertissementTronque(v.actions_tronque, t("actions", "actions"), langue)}
            titre={t("Liste incomplète", "Incomplete list")}
          />
        </Carte>
      )}

      {tenue && droits.gerer ? (
        <Carte titre={t("Clôturer la revue", "Close the review")}>
          {ouvertes > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t("Suivi en cours", "Follow-up in progress")}
              annonce="aucune"
            >
              <p>
                {t(
                  `${ouvertes} décision(s) ou action(s) restent ouvertes : terminez-les, ou abandonnez-les avec un motif, avant de clôturer.`,
                  `${ouvertes} decision(s) or action(s) remain open: complete them, or abandon them with a reason, before closing.`,
                )}
              </p>
            </Alerte>
          ) : null}
          <BoutonActionKpi
            libelle={t("Clôturer la revue", "Close the review")}
            chemin={cheminActionRevue(v.id, "cloturer")}
            succes={t("Revue clôturée.", "Review closed.")}
            variante="primaire"
            titreErreur={t("Clôture impossible", "Could not close")}
            confirmation={{
              question: t(
                "Clôturer cette revue ? Une revue clôturée ne se rouvre pas.",
                "Close this review? A closed review cannot be reopened.",
              ),
              libelleConfirmation: t("Oui, clôturer la revue", "Yes, close the review"),
            }}
          />
        </Carte>
      ) : null}

      {v.compte_rendu ? (
        <Carte titre={t("Compte rendu", "Minutes")}>
          <p className="mp-kpi-texte-libre">{v.compte_rendu}</p>
        </Carte>
      ) : null}
    </div>
  );
}

/** Liste plafonnée par l'API : jamais de troncature silencieuse. */
function Tronque({ message, titre }: { message: string | null; titre: string }) {
  return message ? (
    <Alerte tonalite="attention" titre={titre} annonce="aucune">
      <p>{message}</p>
    </Alerte>
  ) : null;
}

const LIBELLES_STATUT_REVUE_TEXTE = {
  planifiee: ["Planifiée : ordre du jour en préparation", "Scheduled: agenda in preparation"],
  tenue: ["Tenue : décisions et actions en suivi", "Held: decisions and actions being followed"],
  cloturee: [
    "Clôturée : tout est terminé ou abandonné",
    "Closed: everything is completed or abandoned",
  ],
  annulee: ["Annulée", "Cancelled"],
} as const;
