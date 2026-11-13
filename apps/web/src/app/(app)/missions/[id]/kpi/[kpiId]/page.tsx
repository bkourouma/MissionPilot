import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission, LOCALES_INTL, type Langue, type Traduire } from "@missionpilot/shared";
import { ActivationKpi } from "../../../../../../components/kpi/ActivationKpi";
import { CarteKpi } from "../../../../../../components/kpi/CarteKpi";
import { ContributeursKpi } from "../../../../../../components/kpi/ContributeursKpi";
import { EvolutionKpi } from "../../../../../../components/kpi/EvolutionKpi";
import { FormulaireCible } from "../../../../../../components/kpi/FormulaireCible";
import { HistoriqueCibles } from "../../../../../../components/kpi/HistoriqueCibles";
import { HistoriqueMesures } from "../../../../../../components/kpi/HistoriqueMesures";
import { ListeAlertesKpi } from "../../../../../../components/kpi/ListeAlertesKpi";
import { SaisieMesure } from "../../../../../../components/kpi/SaisieMesure";
import "../../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../components/ui/Icone";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  alerteDepuisEnregistrement,
  candidatsContributeurs,
  candidatsProprietaire,
  cheminAlertesKpi,
  cheminKpi,
  cheminMesuresKpi,
  cheminTableauKpi,
  droitsKpi,
  formaterTauxKpi,
  formaterValeurKpi,
  hrefKpi,
  hrefModifierKpi,
  hrefTableauKpi,
  libelleFrequence,
  libelleNature,
  libellePerspective,
  libelleSens,
  lireCurseur,
  nomProprietaire,
  raisonSansSaisie,
  texteSeuilsStatut,
  type AlerteEnregistree,
  type ComptePortailKpi,
  type DetailKpi,
  type MesureKpi,
  type PageKpi,
  type TableauDeBordKpi,
} from "../../../../../../lib/kpi";
import { chargerSansRedirection } from "../../../../../../lib/kpi-serveur";
import type { MissionDetaillee } from "../../../../../../lib/missions";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import { cheminUtilisateursPortail } from "../../../../../../lib/portail-gestion";
import { chargerPersonnes } from "../../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Fiche d'un KPI", "KPI page") };
}

const LIMITE_MESURES = 20;
const LIMITE_ALERTES = 10;

/**
 * Fiche d'un KPI : situation évaluée par le moteur, saisie des mesures, historique en ajout
 * seul (corrections et annulations motivées), évolution par période, définition, cibles
 * versionnées, contributeurs du client, alertes enregistrées et activation. Les droits
 * affichés sont un confort : l'API décide.
 */
export default async function PageKpi({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kpiId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, kpiId } = await params;
  if (!estIdentifiant(kpiId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const sp = await searchParams;
  const curseur = lireCurseur(sp.curseur);
  const curseurAlertes = lireCurseur(sp.curseur_alertes);
  const k = await chargerServeur<DetailKpi>(cheminKpi(kpiId));
  if (!k.ok && k.statut === 404) notFound();
  if (!k.ok) {
    return (
      <EtatErreur
        titre={t("Le KPI n'a pas pu être chargé.", "The KPI could not be loaded.")}
        message={k.message}
        hrefReessayer={hrefKpi(m.id, kpiId)}
      />
    );
  }
  const kpi = k.donnees;
  if (kpi.mission_id !== m.id) notFound();
  const roles = utilisateur.roles;
  const droits = droitsKpi(roles, utilisateur.id, m, kpi);
  const [mesures, alertes, tableau, personnes, portail] = await Promise.all([
    chargerServeur<PageKpi<MesureKpi>>(
      cheminMesuresKpi(kpi.id, { limite: LIMITE_MESURES, curseur }),
    ),
    chargerServeur<PageKpi<AlerteEnregistree>>(
      cheminAlertesKpi(kpi.id, { limite: LIMITE_ALERTES, curseur: curseurAlertes }),
    ),
    kpi.actif
      ? chargerServeur<TableauDeBordKpi>(cheminTableauKpi(m.id, null))
      : Promise.resolve(null),
    chargerPersonnes(roles),
    droits.gerer && aPermission(roles, "portail.gerer")
      ? chargerSansRedirection<{ utilisateurs: ComptePortailKpi[] }>(
          cheminUtilisateursPortail(m.client_id),
        )
      : Promise.resolve(null),
  ]);
  const noms = new Map(personnes.map((p) => [p.utilisateur_id, p.nom]));
  for (const e of m.equipe) noms.set(e.utilisateur_id, e.nom);
  noms.set(utilisateur.id, `${utilisateur.nom} (${t("vous", "you")})`);
  const proprietaires = candidatsProprietaire(m, noms, langue);
  const jour = aujourdhui();
  const situation = tableau?.ok ? tableau.donnees.kpis.find((x) => x.id === kpi.id) : undefined;
  const lien = (p: { curseur?: string | null; curseur_alertes?: string | null }, ancre: string) =>
    `${hrefKpi(m.id, kpi.id, {
      curseur: p.curseur === undefined ? curseur : p.curseur,
      curseur_alertes: p.curseur_alertes === undefined ? curseurAlertes : p.curseur_alertes,
    })}#${ancre}`;

  return (
    <div className="mp-kpi">
      <p>
        <Link href={hrefTableauKpi(m.id)}>
          <Icone nom="chevronGauche" taille={16} /> {t("Tableau de bord des KPI", "KPI dashboard")}
        </Link>
      </p>
      {sp.cree === "1" ? (
        <Alerte tonalite="succes" titre={t("KPI créé", "KPI created")} annonce="status">
          <p>
            {t(
              "Saisissez maintenant ses premières mesures ; son statut apparaîtra dès la première période close mesurée.",
              "Now enter its first measurements; its status will appear from the first closed period measured.",
            )}
          </p>
        </Alerte>
      ) : null}
      {sp.modifie === "1" ? (
        <Alerte tonalite="succes" annonce="status">
          <p>
            {t("Modifications de la définition enregistrées.", "Changes to the definition saved.")}
          </p>
        </Alerte>
      ) : null}

      <Carte
        titre={kpi.libelle}
        actions={
          droits.gerer ? (
            <Link href={hrefModifierKpi(m.id, kpi.id)} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>{t("Modifier la définition", "Edit the definition")}</span>
            </Link>
          ) : null
        }
      >
        <div className="mp-pile">
          <span className="mp-badges">
            {kpi.actif ? null : (
              <BadgeStatut tonalite="neutre">{t("KPI désactivé", "KPI disabled")}</BadgeStatut>
            )}
            <BadgeStatut tonalite="neutre" sansIcone>
              {libellePerspective(kpi.perspective, langue)}
            </BadgeStatut>
          </span>
          {kpi.description ? <p className="mp-texte-preserve">{kpi.description}</p> : null}
          <Situation
            kpi={kpi}
            missionId={m.id}
            situation={situation}
            erreur={tableau && !tableau.ok ? tableau.message : null}
            t={t}
            langue={langue}
          />
        </div>
      </Carte>

      <Carte titre={t("Saisir une mesure", "Enter a measurement")}>
        {droits.saisir ? (
          <SaisieMesure kpi={kpi} aujourdhui={jour} />
        ) : (
          <p className="mp-texte-doux">{raisonSansSaisie(m, kpi, roles, langue)}</p>
        )}
      </Carte>

      <Carte titre={t("Historique des mesures", "Measurement history")} id="historique">
        {!mesures.ok ? (
          <EtatErreur
            titre={t(
              "L'historique des mesures n'a pas pu être chargé.",
              "The measurement history could not be loaded.",
            )}
            message={mesures.message}
            hrefReessayer={lien({}, "historique")}
          />
        ) : mesures.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucune mesure saisie pour ce KPI.", "No measurement entered for this KPI.")}
            icone="courbe"
          >
            <p>
              {t(
                "Les mesures saisies par le cabinet ou par les contributeurs du client apparaîtront ici, du plus récent au plus ancien.",
                "Measurements entered by the firm or by the client's contributors will appear here, from newest to oldest.",
              )}
            </p>
          </EtatVide>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "Historique en ajout seul : une mesure n'est jamais modifiée ni supprimée ; une correction ou une annulation ajoute une ligne motivée.",
                "Append-only history: a measurement is never edited or deleted; a correction or cancellation adds a line with a reason.",
              )}
            </p>
            <HistoriqueMesures
              kpi={kpi}
              lignes={mesures.donnees.elements}
              aujourdhui={jour}
              saisir={droits.saisir}
              annulerPortail={droits.gerer}
            />
            <PaginationCurseur
              libelle={t("Pages de l'historique des mesures", "Measurement history pages")}
              hrefSuivante={
                mesures.donnees.curseur_suivant
                  ? lien({ curseur: mesures.donnees.curseur_suivant }, "historique")
                  : null
              }
              hrefDebut={curseur ? lien({ curseur: null }, "historique") : null}
            />
          </div>
        )}
      </Carte>

      <Carte titre={t("Évolution par période", "Trend by period")}>
        <EvolutionKpi missionId={m.id} date={null} kpiId={kpi.id} />
      </Carte>

      <Carte titre={t("Définition", "Definition")}>
        <Definition
          kpi={kpi}
          proprietaire={nomProprietaire(kpi.proprietaire_id, proprietaires, noms, langue)}
          t={t}
          langue={langue}
        />
      </Carte>

      <Carte titre={t("Cibles", "Targets")}>
        <div className="mp-pile">
          <p>
            {t("Cible en vigueur aujourd'hui :", "Target in effect today:")}{" "}
            <strong>
              {kpi.cible_actuelle === null
                ? t("aucune", "none")
                : formaterValeurKpi(kpi.cible_actuelle, kpi.unite, langue)}
            </strong>
          </p>
          <HistoriqueCibles cibles={kpi.cibles} unite={kpi.unite} noms={noms} />
          {droits.gerer ? (
            <details className="mp-details">
              <summary>
                {t("Publier une nouvelle version de cible", "Publish a new target version")}
              </summary>
              <FormulaireCible kpi={kpi} aujourdhui={jour} />
            </details>
          ) : null}
        </div>
      </Carte>

      <Carte titre={t("Contributeurs du client", "Client contributors")}>
        <Contributeurs
          kpi={kpi}
          gerer={droits.gerer}
          portail={portail}
          mission={m}
          t={t}
          langue={langue}
        />
      </Carte>

      <Carte titre={t("Alertes enregistrées", "Recorded alerts")} id="alertes">
        {!alertes.ok ? (
          <EtatErreur
            titre={t("Les alertes n'ont pas pu être chargées.", "The alerts could not be loaded.")}
            message={alertes.message}
            hrefReessayer={lien({}, "alertes")}
          />
        ) : alertes.donnees.elements.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucune alerte enregistrée pour ce KPI.", "No alert recorded for this KPI.")}
          </p>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "Une alerte est enregistrée une seule fois par période, à la saisie ou lors du contrôle quotidien ; le propriétaire et les responsables de la mission sont notifiés.",
                "An alert is recorded only once per period, at data entry or during the daily check; the owner and the engagement leads are notified.",
              )}
            </p>
            <ListeAlertesKpi
              missionId={m.id}
              alertes={alertes.donnees.elements.map((a) => {
                const { code, periode, ...donnees } = alerteDepuisEnregistrement(a);
                return {
                  cle: a.id,
                  code,
                  periode,
                  unite: kpi.unite,
                  donnees,
                  detectee: t(
                    `Détectée le ${formaterDateHeure(a.detectee_le, undefined, langue)}`,
                    `Detected on ${formaterDateHeure(a.detectee_le, undefined, langue)}`,
                  ),
                };
              })}
            />
            <PaginationCurseur
              libelle={t("Pages des alertes enregistrées", "Recorded alerts pages")}
              hrefSuivante={
                alertes.donnees.curseur_suivant
                  ? lien({ curseur_alertes: alertes.donnees.curseur_suivant }, "alertes")
                  : null
              }
              hrefDebut={curseurAlertes ? lien({ curseur_alertes: null }, "alertes") : null}
            />
          </div>
        )}
      </Carte>

      {droits.gerer ? (
        <Carte
          titre={kpi.actif ? t("Désactivation", "Deactivation") : t("Réactivation", "Reactivation")}
        >
          <ActivationKpi kpiId={kpi.id} libelle={kpi.libelle} actif={kpi.actif} />
        </Carte>
      ) : null}
    </div>
  );
}

function Situation({
  kpi,
  missionId,
  situation,
  erreur,
  t,
  langue,
}: {
  kpi: DetailKpi;
  missionId: string;
  situation: TableauDeBordKpi["kpis"][number] | undefined;
  erreur: string | null;
  t: Traduire;
  langue: Langue;
}) {
  if (!kpi.actif) {
    return (
      <p className="mp-texte-doux">
        {t(
          "KPI désactivé : il n'est plus évalué. Son historique reste consultable ci-dessous.",
          "KPI disabled: it is no longer assessed. Its history remains available below.",
        )}
      </p>
    );
  }
  if (erreur) {
    return (
      <Alerte
        tonalite="attention"
        titre={t("Situation indisponible", "Situation unavailable")}
        annonce="aucune"
      >
        <p>{erreur}</p>
      </Alerte>
    );
  }
  if (!situation) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Situation indisponible : rechargez la page.",
          "Situation unavailable: reload the page.",
        )}
      </p>
    );
  }
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          `Situation au ${formaterDate(situation.date_reference, "UTC", langue)}, évaluée par le moteur.`,
          `Situation as of ${formaterDate(situation.date_reference, "UTC", langue)}, assessed by the engine.`,
        )}
      </p>
      <CarteKpi kpi={situation} missionId={missionId} niveauTitre={3} avecLien={false} />
    </div>
  );
}

function Definition({
  kpi,
  proprietaire,
  t,
  langue,
}: {
  kpi: DetailKpi;
  proprietaire: string;
  t: Traduire;
  langue: Langue;
}) {
  const alertes = [
    kpi.alerte_haut === null
      ? null
      : t(
          `au-dessus de ${formaterValeurKpi(kpi.alerte_haut, kpi.unite, langue)}`,
          `above ${formaterValeurKpi(kpi.alerte_haut, kpi.unite, langue)}`,
        ),
    kpi.alerte_bas === null
      ? null
      : t(
          `en dessous de ${formaterValeurKpi(kpi.alerte_bas, kpi.unite, langue)}`,
          `below ${formaterValeurKpi(kpi.alerte_bas, kpi.unite, langue)}`,
        ),
    kpi.alerte_variation === null
      ? null
      : t(
          `variation de plus de ${formaterTauxKpi(kpi.alerte_variation, langue)} d'une période à l'autre`,
          `change of more than ${formaterTauxKpi(kpi.alerte_variation, langue)} from one period to the next`,
        ),
  ].filter((x): x is string => x !== null);
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>{t("Unité", "Unit")}</dt>
        <dd>{kpi.unite}</dd>
      </div>
      <div>
        <dt>{t("Sens de lecture", "Reading direction")}</dt>
        <dd>{libelleSens(kpi.sens, langue)}</dd>
      </div>
      <div>
        <dt>{t("Nature", "Type")}</dt>
        <dd>{libelleNature(kpi.nature, langue)}</dd>
      </div>
      <div>
        <dt>{t("Fréquence", "Frequency")}</dt>
        <dd>{libelleFrequence(kpi.frequence, langue)}</dd>
      </div>
      <div>
        <dt>{t("Suivi", "Tracking")}</dt>
        <dd>
          {t("Depuis le", "Since")} {formaterDate(kpi.debut_suivi, "UTC", langue)}
          {kpi.fin_suivi
            ? t(
                `, jusqu'au ${formaterDate(kpi.fin_suivi, "UTC", langue)}`,
                `, until ${formaterDate(kpi.fin_suivi, "UTC", langue)}`,
              )
            : t(", sans date de fin", ", with no end date")}
        </dd>
      </div>
      <div>
        <dt>{t("Pondération", "Weighting")}</dt>
        <dd>{kpi.ponderation.toLocaleString(LOCALES_INTL[langue])}</dd>
      </div>
      <div>
        <dt>{t("Seuils de statut", "Status thresholds")}</dt>
        <dd>{texteSeuilsStatut(kpi, langue)}</dd>
      </div>
      <div>
        <dt>{t("Seuils d'alerte", "Alert thresholds")}</dt>
        <dd>
          {alertes.length === 0
            ? t("Aucun", "None")
            : t(`Alerte ${alertes.join(" ; ")}.`, `Alert ${alertes.join("; ")}.`)}
        </dd>
      </div>
      <div>
        <dt>{t("Propriétaire", "Owner")}</dt>
        <dd>{proprietaire}</dd>
      </div>
      <div>
        <dt>{t("Rappels de saisie", "Data entry reminders")}</dt>
        <dd>
          {kpi.rappels_actifs
            ? t("Actifs", "Active")
            : t("Désactivés pour ce KPI", "Disabled for this KPI")}
        </dd>
      </div>
    </dl>
  );
}

function Contributeurs({
  kpi,
  gerer,
  portail,
  mission,
  t,
  langue,
}: {
  kpi: DetailKpi;
  gerer: boolean;
  portail:
    | { ok: true; donnees: { utilisateurs: ComptePortailKpi[] } }
    | { ok: false; message: string }
    | null;
  mission: Pick<MissionDetaillee, "client_raison_sociale">;
  t: Traduire;
  langue: Langue;
}) {
  const liste =
    kpi.contributeurs.length === 0 ? (
      <p className="mp-texte-doux">
        {t(
          "Aucun contributeur désigné : seul le cabinet saisit les mesures de ce KPI.",
          "No contributor designated: only the firm enters the measurements of this KPI.",
        )}
      </p>
    ) : (
      <ul className="mp-liste-simple">
        {kpi.contributeurs.map((c) => (
          <li key={c.id}>
            {c.nom} <span className="mp-texte-doux">({c.email})</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">
        {t(
          `Dirigeants et contributeurs du portail de ${mission.client_raison_sociale} autorisés à saisir les mesures de ce KPI. Ils ne voient ni la mission, ni l'équipe, ni les alertes internes.`,
          `Executives and contributors of ${mission.client_raison_sociale}'s portal allowed to enter this KPI's measurements. They see neither the engagement, nor the team, nor internal alerts.`,
        )}
      </p>
      {liste}
      {gerer && portail === null ? (
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "La désignation des contributeurs demande la gestion du portail client.",
            "Designating contributors requires client portal management.",
          )}
        </p>
      ) : null}
      {gerer && portail && !portail.ok ? (
        <Alerte
          tonalite="attention"
          titre={t("Comptes du portail indisponibles", "Portal accounts unavailable")}
          annonce="aucune"
        >
          <p>{portail.message}</p>
        </Alerte>
      ) : null}
      {gerer && portail?.ok ? (
        <ChoixContributeurs
          kpi={kpi}
          comptes={portail.donnees.utilisateurs}
          t={t}
          langue={langue}
        />
      ) : null}
    </div>
  );
}

function ChoixContributeurs({
  kpi,
  comptes,
  t,
  langue,
}: {
  kpi: DetailKpi;
  comptes: ComptePortailKpi[];
  t: Traduire;
  langue: Langue;
}) {
  const candidats = candidatsContributeurs(comptes, kpi.contributeurs, langue);
  if (candidats.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucun dirigeant ni contributeur n'a encore de compte sur le portail de ce client : invitez-les depuis la fiche du client.",
          "No executive or contributor has an account on this client's portal yet: invite them from the client page.",
        )}
      </p>
    );
  }
  return (
    <details className="mp-details">
      <summary>{t("Choisir les contributeurs", "Choose the contributors")}</summary>
      <ContributeursKpi
        kpiId={kpi.id}
        candidats={candidats}
        actuels={kpi.contributeurs.map((c) => c.id)}
      />
    </details>
  );
}
