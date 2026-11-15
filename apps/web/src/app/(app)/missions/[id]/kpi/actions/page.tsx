import Link from "next/link";
import type { Metadata } from "next";
import { FormulaireAction } from "../../../../../../components/kpi/FormulairesActionKpi";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  cheminAlertesKpi,
  droitsKpi,
  lireCurseur,
  hrefTableauKpi,
  type AlerteEnregistree,
  type PageKpi,
} from "../../../../../../lib/kpi";
import {
  cheminActionsMission,
  enRetard,
  hrefAction,
  hrefActions,
  libelleStatutAction,
  optionsAlertes,
  texteVerdict,
  type PageActions,
} from "../../../../../../lib/kpi-pilotage";
import {
  chargerDecisionsPourAction,
  chargerOptionsPilotage,
} from "../../../../../../lib/kpi-pilotage-serveur";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../lib/session";
import { STATUTS_ACTION_KPI } from "@missionpilot/shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Actions correctives", "Corrective actions") };
}

const texte = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Registre des actions correctives de la mission (KPI-18) : chaque action est reliée au KPI (et à
 * l'alerte) qui l'a motivée, a un responsable, une échéance et un statut ; son efficacité est
 * mesurée par le moteur sur le KPI une fois l'action terminée. Une alerte se transforme en action
 * par `?kpi=…&alerte=…`, une décision de revue par `?decision=…&revue=…` (lien « Créer une action »
 * de la page de la revue).
 */
export default async function PageActionsKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const q = await searchParams;
  const statutBrut = texte(q.statut);
  const statut = STATUTS_ACTION_KPI.find((s) => s === statutBrut);
  const curseur = lireCurseur(q.curseur);
  const identifiant = (v: string | undefined) => (v && estIdentifiant(v) ? v : "");
  const decisionPropose = identifiant(texte(q.decision));
  const revueProposee = identifiant(texte(q.revue));
  const alertePropose = identifiant(texte(q.alerte));
  const jour = aujourdhui();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const requete = new URLSearchParams();
  if (statut) requete.set("statut", statut);
  if (curseur) requete.set("curseur", curseur);
  requete.set("limite", "25");
  const [actions, options, choixDecisions] = await Promise.all([
    chargerServeur<PageActions>(cheminActionsMission(m.id, requete.toString())),
    chargerOptionsPilotage(utilisateur.roles, m, m.id, langue),
    droits.saisir || droits.gerer
      ? chargerDecisionsPourAction(m.id, revueProposee || undefined, langue)
      : Promise.resolve({ decisions: [], erreur: null }),
  ]);
  // Le KPI de la décision d'où l'on vient est proposé quand aucun KPI n'est imposé par l'adresse.
  const kpiBrut = identifiant(texte(q.kpi));
  const kpiDecision = choixDecisions.decisions.find((d) => d.valeur === decisionPropose)?.kpiId;
  const kpiPropose = kpiBrut || kpiDecision || "";
  const alertes = kpiPropose
    ? await chargerServeur<PageKpi<AlerteEnregistree>>(cheminAlertesKpi(kpiPropose, { limite: 20 }))
    : null;
  const filtre = (s?: string) => {
    const p = new URLSearchParams();
    if (s) p.set("statut", s);
    const requeteStatut = p.toString();
    return requeteStatut ? `${hrefActions(m.id)}?${requeteStatut}` : hrefActions(m.id);
  };
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefTableauKpi(m.id)} className={classesBouton("secondaire")}>
          {t("Revenir au tableau de bord", "Back to the dashboard")}
        </Link>
      </div>
      <p className="mp-texte-doux">
        {t(
          "Une action corrective répond à une alerte ou à une décision de revue. Une fois terminée, le moteur compare le KPI avant et après sa date d'effet : c'est une variation observée, pas une preuve de causalité.",
          "A corrective action responds to an alert or a review decision. Once completed, the engine compares the KPI before and after its effective date: it is an observed change, not proof of causality.",
        )}
      </p>
      <nav
        aria-label={t("Filtrer par statut", "Filter by status")}
        className="mp-actions-formulaire"
      >
        <Link href={filtre()} className={classesBouton(statut ? "discret" : "secondaire")}>
          {t("Toutes", "All")}
        </Link>
        {STATUTS_ACTION_KPI.map((s) => (
          <Link
            key={s}
            href={filtre(s)}
            className={classesBouton(statut === s ? "secondaire" : "discret")}
          >
            {libelleStatutAction(s, langue)}
          </Link>
        ))}
      </nav>
      {!actions.ok ? (
        <EtatErreur
          titre={t("Les actions n'ont pas pu être chargées.", "The actions could not be loaded.")}
          message={actions.message}
          hrefReessayer={filtre(statut)}
        />
      ) : actions.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune action corrective.", "No corrective action.")} icone="info">
          <p>
            {t(
              "Enregistrez une action pour suivre ce qui est fait face à une alerte ou un écart.",
              "Record an action to track what is done in response to an alert or a variance.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          <Tableau
            legende={t("Actions correctives de la mission", "The engagement's corrective actions")}
            colonnes={[
              { cle: "numero", entete: t("N°", "No."), alignement: "droite" },
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
                rendu: (a) => (
                  <>
                    {formaterDate(a.echeance, "UTC", langue)}
                    {enRetard(a.echeance, a.statut, jour) ? (
                      <>
                        {" "}
                        <BadgeStatut tonalite="danger">{t("En retard", "Overdue")}</BadgeStatut>
                      </>
                    ) : null}
                  </>
                ),
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
            lignes={actions.donnees.elements}
            cleLigne={(a) => a.id}
          />
          <PaginationCurseur
            hrefSuivante={
              actions.donnees.curseur_suivant
                ? `${filtre(statut)}${statut ? "&" : "?"}curseur=${encodeURIComponent(actions.donnees.curseur_suivant)}`
                : null
            }
            hrefDebut={curseur ? filtre(statut) : null}
          />
        </>
      )}
      {droits.saisir || droits.gerer ? (
        <Carte
          titre={t("Nouvelle action corrective", "New corrective action")}
          id="nouvelle-action"
        >
          {options.erreurKpis ? (
            <Alerte
              tonalite="attention"
              titre={t("KPI indisponibles", "KPIs unavailable")}
              annonce="aucune"
            >
              <p>{options.erreurKpis}</p>
            </Alerte>
          ) : (
            <FormulaireAction
              key={`${kpiPropose}-${alertePropose}-${decisionPropose}`}
              missionId={m.id}
              kpis={options.kpisActifs}
              alertes={
                alertes && alertes.ok ? optionsAlertes(alertes.donnees.elements, langue) : []
              }
              decisions={choixDecisions.decisions}
              personnes={options.personnes}
              kpiId={kpiPropose}
              alerteId={alertePropose}
              decisionId={
                choixDecisions.decisions.some((d) => d.valeur === decisionPropose)
                  ? decisionPropose
                  : ""
              }
              jour={jour}
            />
          )}
          {choixDecisions.erreur ? <p className="mp-texte-doux">{choixDecisions.erreur}</p> : null}
        </Carte>
      ) : null}
    </div>
  );
}
