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
  LIBELLES_POINT_REVUE,
  LIBELLES_STATUT_ACTION,
  LIBELLES_STATUT_DECISION,
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

export const metadata: Metadata = { title: "Revue de performance" };

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
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const [revue, options] = await Promise.all([
    chargerServeur<DetailRevue>(cheminRevue(revueId)),
    chargerOptionsPilotage(utilisateur.roles, m, m.id),
  ]);
  if (!revue.ok && revue.statut === 404) notFound();
  if (!revue.ok) {
    return (
      <EtatErreur
        titre="La revue n'a pas pu être chargée."
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
          Revenir aux revues
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">
        Revue {v.numero} — {v.titre}
      </h2>
      <Carte titre="Situation">
        <dl className="mp-kpi-mesures">
          <div>
            <dt>Statut</dt>
            <dd>{LIBELLES_STATUT_REVUE_TEXTE[v.statut]}</dd>
          </div>
          <div>
            <dt>Date de la revue</dt>
            <dd>{formaterDate(v.date_prevue)}</dd>
          </div>
          <div>
            <dt>Arrêté des KPI examinés</dt>
            <dd>{formaterDate(v.date_reference)}</dd>
          </div>
          <div>
            <dt>Animateur</dt>
            <dd>{v.animateur_nom ?? "À désigner"}</dd>
          </div>
        </dl>
        {v.dossier_fige ? (
          <p className="mp-texte-doux">
            Le dossier examiné est figé : les mesures saisies après la tenue n&apos;y changent rien.
          </p>
        ) : null}
      </Carte>

      <Carte titre="Ordre du jour">
        {v.ordre_du_jour.length === 0 ? (
          <p className="mp-texte-doux">
            Aucun ordre du jour. Le moteur le propose d&apos;après les KPI en rouge ou en
            dégradation, les actions en retard, les décisions ouvertes et la qualité des données.
          </p>
        ) : (
          <>
            <Tableau<PointOrdreDuJour>
              legende="Ordre du jour de la revue"
              colonnes={[
                { cle: "rang", entete: "N°", alignement: "droite" },
                {
                  cle: "libelle",
                  entete: "Point",
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
                  entete: "Nature",
                  rendu: (p) => LIBELLES_POINT_REVUE[p.code] ?? p.code,
                },
                {
                  cle: "duree",
                  entete: "Durée",
                  alignement: "droite",
                  rendu: (p) => `${p.duree_minutes} min`,
                },
              ]}
              lignes={v.ordre_du_jour}
              cleLigne={(p) => String(p.rang)}
            />
            <p className="mp-texte-doux">
              {libelleOrigineOrdreDuJour(v.ordre_du_jour)} · durée prévue : {totalMinutes} minutes.
            </p>
          </>
        )}
        {planifiee && droits.gerer ? (
          <div className="mp-pile">
            <BoutonActionKpi
              libelle={
                v.ordre_du_jour.length === 0
                  ? "Proposer l'ordre du jour"
                  : "Régénérer l'ordre du jour"
              }
              chemin={cheminGenererOrdreDuJour(v.id)}
              succes="Ordre du jour proposé par le moteur."
              texteChargement="Calcul…"
              confirmation={
                v.ordre_du_jour.length === 0
                  ? undefined
                  : {
                      question: "Régénérer l'ordre du jour ? La liste actuelle sera remplacée.",
                      libelleConfirmation: "Oui, régénérer",
                    }
              }
            />
            <FormulaireOrdreDuJour revueId={v.id} />
          </div>
        ) : null}
      </Carte>

      <Carte titre="Dossier et présentation">
        <p className="mp-texte-doux">
          Généré à chaque demande depuis les données de la mission (document : PDF ou Word ;
          présentation : PowerPoint).{" "}
          {planifiee ? "Tant que la revue n'est pas tenue, le dossier est un brouillon." : ""}
        </p>
        <BoutonDossierRevue revueId={v.id} numero={v.numero} />
      </Carte>

      {planifiee && droits.gerer ? (
        <Carte titre="Tenir ou annuler la revue">
          <p className="mp-texte-doux">
            Tenir la revue fige le dossier tel qu&apos;il est aujourd&apos;hui, l&apos;ordre du jour
            et le compte rendu, puis ouvre l&apos;enregistrement des décisions. L&apos;ordre du jour
            doit être établi. Le dossier reste un brouillon confidentiel : il n&apos;est jamais
            marqué « validé ».
          </p>
          <FormulaireTenueRevue revueId={v.id} />
          <BoutonActionKpi
            libelle="Annuler la revue"
            chemin={cheminActionRevue(v.id, "annuler")}
            succes="Revue annulée."
            variante="danger"
            confirmation={{
              question: "Annuler cette revue ? Une revue annulée ne se rouvre pas.",
              libelleConfirmation: "Oui, annuler la revue",
            }}
          />
        </Carte>
      ) : null}

      {(tenue || v.statut === "cloturee") && (
        <Carte titre={`Décisions (${v.decisions.length})`}>
          <Tableau<DecisionKpi>
            legende="Décisions de la revue"
            messageVide="Aucune décision enregistrée."
            colonnes={[
              { cle: "numero", entete: "N°", alignement: "droite" },
              {
                cle: "libelle",
                entete: "Décision",
                rendu: (d) => (
                  <>
                    {d.libelle}
                    {d.motif ? <span className="mp-texte-doux"> — {d.motif}</span> : null}
                    {commentairesDecision(v.evenements_decisions, d.id).map((c) => (
                      <p key={c.cle} className="mp-texte-doux mp-texte-petit">
                        {c.texte} : {c.commentaire}
                      </p>
                    ))}
                  </>
                ),
              },
              { cle: "responsable_nom", entete: "Responsable" },
              { cle: "echeance", entete: "Échéance", rendu: (d) => libelleEcheance(d.echeance) },
              {
                cle: "statut",
                entete: "Statut",
                rendu: (d) => LIBELLES_STATUT_DECISION[d.statut],
              },
              {
                cle: "suivi",
                entete: "Suivi",
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
                          Créer une action
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
          <Tronque message={avertissementTronque(v.decisions_tronque, "décisions")} />
          {tenue && droits.gerer ? (
            <FormulaireDecision revueId={v.id} kpis={options.kpis} personnes={options.personnes} />
          ) : null}
        </Carte>
      )}

      {(tenue || v.statut === "cloturee") && (
        <Carte titre={`Actions issues de la revue (${v.actions.length})`}>
          <Tableau<ActionKpi>
            legende="Actions correctives décidées en revue"
            messageVide="Aucune action rattachée à cette revue. Utilisez « Créer une action » sur une décision, ou le registre des actions."
            colonnes={[
              {
                cle: "titre",
                entete: "Action",
                rendu: (a) => <Link href={hrefAction(m.id, a.id)}>{a.titre}</Link>,
              },
              { cle: "kpi_libelle", entete: "KPI" },
              { cle: "responsable_nom", entete: "Responsable" },
              { cle: "echeance", entete: "Échéance", rendu: (a) => formaterDate(a.echeance) },
              { cle: "statut", entete: "Statut", rendu: (a) => LIBELLES_STATUT_ACTION[a.statut] },
              {
                cle: "efficacite",
                entete: "Efficacité mesurée",
                rendu: (a) => (a.statut === "terminee" ? texteVerdict(a.efficacite) : "—"),
              },
            ]}
            lignes={v.actions}
            cleLigne={(a) => a.id}
          />
          <Tronque message={avertissementTronque(v.actions_tronque, "actions")} />
        </Carte>
      )}

      {tenue && droits.gerer ? (
        <Carte titre="Clôturer la revue">
          {ouvertes > 0 ? (
            <Alerte tonalite="attention" titre="Suivi en cours" annonce="aucune">
              <p>
                {ouvertes} décision(s) ou action(s) restent ouvertes : terminez-les, ou
                abandonnez-les avec un motif, avant de clôturer.
              </p>
            </Alerte>
          ) : null}
          <BoutonActionKpi
            libelle="Clôturer la revue"
            chemin={cheminActionRevue(v.id, "cloturer")}
            succes="Revue clôturée."
            variante="primaire"
            titreErreur="Clôture impossible"
            confirmation={{
              question: "Clôturer cette revue ? Une revue clôturée ne se rouvre pas.",
              libelleConfirmation: "Oui, clôturer la revue",
            }}
          />
        </Carte>
      ) : null}

      {v.compte_rendu ? (
        <Carte titre="Compte rendu">
          <p className="mp-kpi-texte-libre">{v.compte_rendu}</p>
        </Carte>
      ) : null}
    </div>
  );
}

/** Liste plafonnée par l'API : jamais de troncature silencieuse. */
function Tronque({ message }: { message: string | null }) {
  return message ? (
    <Alerte tonalite="attention" titre="Liste incomplète" annonce="aucune">
      <p>{message}</p>
    </Alerte>
  ) : null;
}

const LIBELLES_STATUT_REVUE_TEXTE = {
  planifiee: "Planifiée : ordre du jour en préparation",
  tenue: "Tenue : décisions et actions en suivi",
  cloturee: "Clôturée : tout est terminé ou abandonné",
  annulee: "Annulée",
} as const;
