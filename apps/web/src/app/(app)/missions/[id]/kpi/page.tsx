import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { Langue, Traduire } from "@missionpilot/shared";
import { BoutonExportKpi } from "../../../../../components/kpi/BoutonExportKpi";
import { CarteKpi } from "../../../../../components/kpi/CarteKpi";
import { EvolutionKpi } from "../../../../../components/kpi/EvolutionKpi";
import { ListeAlertesKpi } from "../../../../../components/kpi/ListeAlertesKpi";
import { QualiteDonneesKpi } from "../../../../../components/kpi/QualiteDonneesKpi";
import { ScoreKpi } from "../../../../../components/kpi/ScoreKpi";
import "../../../../../components/kpi/kpi.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import {
  bornesDateArrete,
  cheminKpiMission,
  cheminTableauKpi,
  droitsKpi,
  hrefKpi,
  hrefNouveauKpi,
  hrefParametresKpi,
  hrefTableauKpi,
  formaterTauxKpi,
  kpisParPerspective,
  libelleFrequence,
  libellePerspective,
  lireDateArrete,
  type DefinitionKpi,
  type ScoreKpiVue,
  type TableauDeBordKpi,
} from "../../../../../lib/kpi";
import {
  cheminQualite,
  hrefActions,
  hrefArbres,
  hrefRevues,
  type QualiteMission,
} from "../../../../../lib/kpi-pilotage";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../lib/periode";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("KPI de la mission", "Engagement KPIs") };
}

/**
 * Tableau de bord des KPI d'une mission (KPI-03) à une date d'arrêté : score composite global
 * et par perspective, statut de chaque KPI (texte, icône et valeur), atteinte, écart,
 * tendance, projection de la période en cours, alertes ; évolution par période à la demande
 * et export JSON versionné.
 *
 * Tous les chiffres sont ceux de l'API (moteur `packages/engines/src/kpi`) : la page n'en
 * recalcule aucun. Rien n'est conservé dans le navigateur (rendu serveur, date dans l'URL).
 */
export default async function PageKpiMission({
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
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const jour = aujourdhui();
  const arrete = lireDateArrete((await searchParams).date, jour, langue);
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const [tableau, definitions, qualite] = await Promise.all([
    chargerServeur<TableauDeBordKpi>(cheminTableauKpi(m.id, arrete.date)),
    chargerServeur<{ elements: DefinitionKpi[] }>(cheminKpiMission(m.id)),
    chargerServeur<QualiteMission>(cheminQualite(m.id, arrete.date ?? jour)),
  ]);
  const inactifs = definitions.ok ? definitions.donnees.elements.filter((d) => !d.actif) : [];
  const aucunKpi = definitions.ok && definitions.donnees.elements.length === 0;

  return (
    <div className="mp-kpi">
      <p className="mp-texte-doux">
        {t(
          "Statuts, atteintes, tendances, projections, scores et alertes sont calculés par le moteur de CabinetPilot à partir des mesures saisies et des cibles en vigueur ; un statut est toujours écrit, jamais signalé par la seule couleur.",
          "Statuses, attainments, trends, projections, scores and alerts are computed by the CabinetPilot engine from the measurements entered and the targets in effect; a status is always written out, never signalled by color alone.",
        )}
      </p>

      <SelecteurArrete
        missionId={m.id}
        date={arrete.date}
        jour={jour}
        t={t}
        langue={langue}
        actions={
          <>
            {droits.gerer ? (
              <Link href={hrefNouveauKpi(m.id)} className={classesBouton("primaire")}>
                <Icone nom="plus" />
                <span>{t("Nouveau KPI", "New KPI")}</span>
              </Link>
            ) : null}
            <Link href={hrefParametresKpi(m.id)} className={classesBouton("discret")}>
              <Icone nom="reglages" />
              <span>{t("Réglages du pilotage", "Management settings")}</span>
            </Link>
          </>
        }
      />
      <nav
        aria-label={t("Pilotage augmenté", "Advanced management")}
        className="mp-actions-formulaire"
      >
        <Link href={hrefArbres(m.id)} className={classesBouton("secondaire")}>
          {t("Arbres d'indicateurs", "KPI trees")}
        </Link>
        <Link href={hrefActions(m.id)} className={classesBouton("secondaire")}>
          {t("Actions correctives", "Corrective actions")}
        </Link>
        <Link href={hrefRevues(m.id)} className={classesBouton("secondaire")}>
          {t("Revues de performance", "Performance reviews")}
        </Link>
      </nav>
      {arrete.erreur ? (
        <Alerte
          tonalite="attention"
          titre={t("Date d'arrêté écartée", "Cut-off date discarded")}
          annonce="status"
        >
          <p>{arrete.erreur}</p>
        </Alerte>
      ) : null}

      {aucunKpi ? (
        <EtatVide
          titre={t(
            "Aucun KPI n'est encore suivi pour cette mission.",
            "No KPI is tracked yet for this engagement.",
          )}
          icone="courbe"
          action={
            droits.gerer ? (
              <Link href={hrefNouveauKpi(m.id)} className={classesBouton("primaire")}>
                {t("Définir un premier KPI", "Define a first KPI")}
              </Link>
            ) : null
          }
        >
          <p>
            {droits.gerer
              ? t(
                  "Définissez les indicateurs du client (libellé, unité, sens de lecture, fréquence, cible) : ils apparaîtront ici avec leur statut dès les premières mesures.",
                  "Define the client's indicators (label, unit, reading direction, frequency, target): they will appear here with their status from the first measurements.",
                )
              : t(
                  "Le directeur ou le chef de mission définit les KPI ; ils apparaîtront ici avec leur statut dès les premières mesures.",
                  "The engagement director or manager defines the KPIs; they will appear here with their status from the first measurements.",
                )}
          </p>
        </EtatVide>
      ) : !tableau.ok ? (
        <EtatErreur
          titre={t(
            "Le tableau de bord n'a pas pu être calculé.",
            "The dashboard could not be computed.",
          )}
          message={tableau.message}
          hrefReessayer={hrefTableauKpi(m.id, arrete.date)}
        />
      ) : (
        <TableauDeBord
          missionId={m.id}
          tableau={tableau.donnees}
          date={arrete.date}
          intitule={m.intitule}
          gerer={droits.gerer}
          qualite={qualite.ok ? qualite.donnees : null}
          erreurQualite={qualite.ok ? null : qualite.message}
          t={t}
          langue={langue}
        />
      )}

      {!definitions.ok ? (
        <Alerte
          tonalite="attention"
          titre={t("Liste des KPI indisponible", "KPI list unavailable")}
          annonce="aucune"
        >
          <p>{definitions.message}</p>
        </Alerte>
      ) : null}

      {inactifs.length > 0 ? (
        <Carte titre={t("KPI désactivés", "Disabled KPIs")}>
          <p className="mp-texte-doux">
            {t(
              "Hors du tableau de bord, du score et des rappels ; leur historique est conservé.",
              "Outside the dashboard, the score and the reminders; their history is kept.",
            )}
          </p>
          <Tableau
            legende={t("KPI désactivés", "Disabled KPIs")}
            colonnes={[
              {
                cle: "libelle",
                entete: "KPI",
                rendu: (d: DefinitionKpi) => <Link href={hrefKpi(m.id, d.id)}>{d.libelle}</Link>,
              },
              {
                cle: "perspective",
                entete: t("Perspective", "Perspective"),
                rendu: (d) => libellePerspective(d.perspective, langue),
              },
              {
                cle: "frequence",
                entete: t("Fréquence", "Frequency"),
                rendu: (d) => libelleFrequence(d.frequence, langue),
              },
            ]}
            lignes={inactifs}
            cleLigne={(d) => d.id}
          />
        </Carte>
      ) : null}
    </div>
  );
}

function SelecteurArrete({
  missionId,
  date,
  jour,
  actions,
  t,
  langue,
}: {
  missionId: string;
  date: string | null;
  jour: string;
  actions: ReactNode;
  t: Traduire;
  langue: Langue;
}) {
  const { min, max } = bornesDateArrete(jour);
  return (
    <div className="mp-kpi-barre">
      <form
        method="get"
        action={hrefTableauKpi(missionId)}
        className="mp-kpi-barre__date"
        role="search"
        aria-label={t("Date d'arrêté du tableau de bord", "Dashboard cut-off date")}
      >
        <Champ
          libelle={t("Date d'arrêté", "Cut-off date")}
          type="date"
          name="date"
          min={min}
          max={max}
          defaultValue={date ?? jour}
          aide={t(
            `Du ${formaterDate(min, "UTC", langue)} au ${formaterDate(max, "UTC", langue)}. Les mesures postérieures sont ignorées.`,
            `From ${formaterDate(min, "UTC", langue)} to ${formaterDate(max, "UTC", langue)}. Later measurements are ignored.`,
          )}
        />
        <button type="submit" className={classesBouton("secondaire")}>
          <Icone nom="calendrier" />
          <span>{t("Afficher", "Show")}</span>
        </button>
      </form>
      <div className="mp-actions-formulaire">{actions}</div>
    </div>
  );
}

function TableauDeBord({
  missionId,
  tableau,
  date,
  intitule,
  gerer,
  qualite,
  erreurQualite,
  t,
  langue,
}: {
  missionId: string;
  tableau: TableauDeBordKpi;
  date: string | null;
  intitule: string;
  gerer: boolean;
  qualite: QualiteMission | null;
  /** Message de l'échec du calcul de la qualité des données (jamais ignoré en silence). */
  erreurQualite: string | null;
  t: Traduire;
  langue: Langue;
}) {
  const groupes = kpisParPerspective(tableau.kpis, langue);
  const libelles = new Map(tableau.kpis.map((k) => [k.id, k]));
  return (
    <>
      <h2 className="mp-kpi-section__titre">
        {t(
          `Situation au ${formaterDate(tableau.date_reference, "UTC", langue)}`,
          `Situation as of ${formaterDate(tableau.date_reference, "UTC", langue)}`,
        )}
      </h2>

      {tableau.kpis.length === 0 ? (
        <EtatVide
          titre={t("Aucun KPI actif à évaluer.", "No active KPI to assess.")}
          icone="courbe"
        >
          <p>
            {gerer
              ? t(
                  "Tous les KPI de la mission sont désactivés : réactivez-en un depuis sa fiche, ou définissez-en un nouveau.",
                  "All the engagement's KPIs are disabled: reactivate one from its page, or define a new one.",
                )
              : t(
                  "Tous les KPI de la mission sont désactivés.",
                  "All the engagement's KPIs are disabled.",
                )}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre={t("Score composite", "Composite score")}>
            <div className="mp-kpi-section">
              <ScoreKpi score={tableau.score_global} grand />
              {tableau.perspectives.length > 0 ? (
                <ul
                  className="mp-kpi-perspectives"
                  aria-label={t("Score par perspective", "Score by perspective")}
                >
                  {tableau.perspectives.map((p) => (
                    <li key={p.perspective ?? "sans"} className="mp-kpi-perspective">
                      <h3 className="mp-kpi-perspective__titre">
                        {libellePerspective(p.perspective, langue)}
                      </h3>
                      <p className="mp-texte-doux mp-texte-petit">
                        {t(
                          `${p.nombre_kpi} KPI suivi${p.nombre_kpi > 1 ? "s" : ""}`,
                          `${p.nombre_kpi} KPI${p.nombre_kpi > 1 ? "s" : ""} tracked`,
                        )}
                      </p>
                      <ScoreKpi score={p.score} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {tableau.score_global ? (
                <DetailScore
                  score={tableau.score_global}
                  libelles={libelles}
                  t={t}
                  langue={langue}
                />
              ) : null}
            </div>
          </Carte>

          <Carte titre={`${t("Alertes", "Alerts")} (${tableau.alertes.length})`}>
            {tableau.alertes.length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  "Aucune alerte à cette date : ni dégradation continue, ni mesure en retard, ni seuil franchi.",
                  "No alert at this date: no continuous deterioration, no overdue measurement, no threshold crossed.",
                )}
              </p>
            ) : (
              <ListeAlertesKpi
                missionId={missionId}
                alertes={tableau.alertes.map(
                  ({ kpi_id, libelle, code, periode, ...donnees }, i) => ({
                    cle: `${kpi_id}-${code}-${periode}-${i}`,
                    code,
                    periode,
                    unite: libelles.get(kpi_id)?.unite ?? "",
                    kpi: { id: kpi_id, libelle },
                    donnees,
                  }),
                )}
              />
            )}
          </Carte>

          {qualite ? (
            <Carte titre={t("Qualité des données", "Data quality")}>
              <QualiteDonneesKpi qualite={qualite} missionId={missionId} />
            </Carte>
          ) : erreurQualite ? (
            <Carte titre={t("Qualité des données", "Data quality")}>
              <EtatErreur
                titre={t(
                  "La qualité des données n'a pas pu être calculée.",
                  "The data quality could not be computed.",
                )}
                message={erreurQualite}
                hrefReessayer={hrefTableauKpi(missionId, date)}
              />
            </Carte>
          ) : null}

          {groupes.map((g) => (
            <section
              key={g.perspective ?? "sans"}
              className="mp-kpi-section"
              aria-labelledby={`perspective-${g.perspective ?? "sans"}`}
            >
              <h2 id={`perspective-${g.perspective ?? "sans"}`} className="mp-kpi-section__titre">
                {g.libelle}
              </h2>
              <div className="mp-kpi-grille">
                {g.kpis.map((k) => (
                  <CarteKpi key={k.id} kpi={k} missionId={missionId} />
                ))}
              </div>
            </section>
          ))}

          <Carte titre={t("Évolution par période", "Trend by period")}>
            <EvolutionKpi missionId={missionId} date={date} />
          </Carte>

          <Carte titre={t("Export des données", "Data export")}>
            <div className="mp-pile">
              <p className="mp-texte-doux">
                {t(
                  "Fichier JSON versionné (missionpilot.kpi.v1) : définitions, versions des cibles, historique des mesures (corrections et annulations comprises), séries par période, statuts et alertes à la date d'arrêté. Destiné au rapport KPI ou à un outil d'analyse ; l'export est consigné au journal.",
                  "Versioned JSON file (missionpilot.kpi.v1): definitions, target versions, measurement history (corrections and cancellations included), series by period, statuses and alerts at the cut-off date. Intended for the KPI report or an analysis tool; the export is recorded in the log.",
                )}
              </p>
              <BoutonExportKpi missionId={missionId} date={date} intitule={intitule} />
            </div>
          </Carte>
        </>
      )}
    </>
  );
}

function DetailScore({
  score,
  libelles,
  t,
  langue,
}: {
  score: ScoreKpiVue;
  libelles: ReadonlyMap<string, { libelle: string }>;
  t: Traduire;
  langue: Langue;
}) {
  if (score.contributions.length === 0 && score.exclus.length === 0) return null;
  const lignes = [
    ...score.contributions.map((c) => ({
      id: c.kpi_id,
      libelle: libelles.get(c.kpi_id)?.libelle ?? "KPI",
      poids: formaterTauxKpi(c.poids_normalise, langue),
      taux: formaterTauxKpi(c.taux, langue),
      retenu: t("Retenu", "Retained"),
    })),
    ...score.exclus.map((x) => ({
      id: x.kpi_id,
      libelle: libelles.get(x.kpi_id)?.libelle ?? "KPI",
      poids: "—",
      taux: "—",
      retenu:
        x.raison === "non_mesure"
          ? t("Exclu : non mesuré", "Excluded: not measured")
          : t("Exclu : sans cible", "Excluded: no target"),
    })),
  ];
  return (
    <details className="mp-details">
      <summary>{t("Détail du score composite", "Composite score detail")}</summary>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Chaque KPI retenu pèse selon sa pondération ; son atteinte est bornée entre 0 et 100 % (un KPI très en avance ne compense pas un KPI en échec).",
          "Each retained KPI weighs according to its weighting; its attainment is capped between 0 and 100% (a KPI far ahead does not offset a failing KPI).",
        )}
      </p>
      <Tableau
        legende={t(
          "Contribution de chaque KPI au score composite",
          "Contribution of each KPI to the composite score",
        )}
        colonnes={[
          { cle: "libelle", entete: "KPI" },
          { cle: "poids", entete: t("Poids", "Weight"), alignement: "droite" },
          {
            cle: "taux",
            entete: t("Atteinte retenue", "Attainment retained"),
            alignement: "droite",
          },
          { cle: "retenu", entete: t("Prise en compte", "Treatment") },
        ]}
        lignes={lignes}
        cleLigne={(l) => l.id}
      />
    </details>
  );
}
