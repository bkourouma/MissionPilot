import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
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
import {
  bornesDateArrete,
  cheminKpiMission,
  cheminTableauKpi,
  droitsKpi,
  FREQUENCE_LIBELLES,
  hrefKpi,
  hrefNouveauKpi,
  hrefParametresKpi,
  hrefTableauKpi,
  formaterTauxKpi,
  kpisParPerspective,
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

export const metadata: Metadata = { title: "KPI de la mission" };

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
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const jour = aujourdhui();
  const arrete = lireDateArrete((await searchParams).date, jour);
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
        Statuts, atteintes, tendances, projections, scores et alertes sont calculés par le moteur de
        MissionPilot à partir des mesures saisies et des cibles en vigueur ; un statut est toujours
        écrit, jamais signalé par la seule couleur.
      </p>

      <SelecteurArrete
        missionId={m.id}
        date={arrete.date}
        jour={jour}
        actions={
          <>
            {droits.gerer ? (
              <Link href={hrefNouveauKpi(m.id)} className={classesBouton("primaire")}>
                <Icone nom="plus" />
                <span>Nouveau KPI</span>
              </Link>
            ) : null}
            <Link href={hrefParametresKpi(m.id)} className={classesBouton("discret")}>
              <Icone nom="reglages" />
              <span>Réglages du pilotage</span>
            </Link>
          </>
        }
      />
      <nav aria-label="Pilotage augmenté" className="mp-actions-formulaire">
        <Link href={hrefArbres(m.id)} className={classesBouton("secondaire")}>
          Arbres d&apos;indicateurs
        </Link>
        <Link href={hrefActions(m.id)} className={classesBouton("secondaire")}>
          Actions correctives
        </Link>
        <Link href={hrefRevues(m.id)} className={classesBouton("secondaire")}>
          Revues de performance
        </Link>
      </nav>
      {arrete.erreur ? (
        <Alerte tonalite="attention" titre="Date d'arrêté écartée" annonce="status">
          <p>{arrete.erreur}</p>
        </Alerte>
      ) : null}

      {aucunKpi ? (
        <EtatVide
          titre="Aucun KPI n'est encore suivi pour cette mission."
          icone="courbe"
          action={
            droits.gerer ? (
              <Link href={hrefNouveauKpi(m.id)} className={classesBouton("primaire")}>
                Définir un premier KPI
              </Link>
            ) : null
          }
        >
          <p>
            {droits.gerer
              ? "Définissez les indicateurs du client (libellé, unité, sens de lecture, fréquence, cible) : ils apparaîtront ici avec leur statut dès les premières mesures."
              : "Le directeur ou le chef de mission définit les KPI ; ils apparaîtront ici avec leur statut dès les premières mesures."}
          </p>
        </EtatVide>
      ) : !tableau.ok ? (
        <EtatErreur
          titre="Le tableau de bord n'a pas pu être calculé."
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
        />
      )}

      {!definitions.ok ? (
        <Alerte tonalite="attention" titre="Liste des KPI indisponible" annonce="aucune">
          <p>{definitions.message}</p>
        </Alerte>
      ) : null}

      {inactifs.length > 0 ? (
        <Carte titre="KPI désactivés">
          <p className="mp-texte-doux">
            Hors du tableau de bord, du score et des rappels ; leur historique est conservé.
          </p>
          <Tableau
            legende="KPI désactivés"
            colonnes={[
              {
                cle: "libelle",
                entete: "KPI",
                rendu: (d: DefinitionKpi) => <Link href={hrefKpi(m.id, d.id)}>{d.libelle}</Link>,
              },
              {
                cle: "perspective",
                entete: "Perspective",
                rendu: (d) => libellePerspective(d.perspective),
              },
              {
                cle: "frequence",
                entete: "Fréquence",
                rendu: (d) => FREQUENCE_LIBELLES[d.frequence],
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
}: {
  missionId: string;
  date: string | null;
  jour: string;
  actions: ReactNode;
}) {
  const { min, max } = bornesDateArrete(jour);
  return (
    <div className="mp-kpi-barre">
      <form
        method="get"
        action={hrefTableauKpi(missionId)}
        className="mp-kpi-barre__date"
        role="search"
        aria-label="Date d'arrêté du tableau de bord"
      >
        <Champ
          libelle="Date d'arrêté"
          type="date"
          name="date"
          min={min}
          max={max}
          defaultValue={date ?? jour}
          aide={`Du ${formaterDate(min)} au ${formaterDate(max)}. Les mesures postérieures sont ignorées.`}
        />
        <button type="submit" className={classesBouton("secondaire")}>
          <Icone nom="calendrier" />
          <span>Afficher</span>
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
}: {
  missionId: string;
  tableau: TableauDeBordKpi;
  date: string | null;
  intitule: string;
  gerer: boolean;
  qualite: QualiteMission | null;
  /** Message de l'échec du calcul de la qualité des données (jamais ignoré en silence). */
  erreurQualite: string | null;
}) {
  const groupes = kpisParPerspective(tableau.kpis);
  const libelles = new Map(tableau.kpis.map((k) => [k.id, k]));
  return (
    <>
      <h2 className="mp-kpi-section__titre">Situation au {formaterDate(tableau.date_reference)}</h2>

      {tableau.kpis.length === 0 ? (
        <EtatVide titre="Aucun KPI actif à évaluer." icone="courbe">
          <p>
            {gerer
              ? "Tous les KPI de la mission sont désactivés : réactivez-en un depuis sa fiche, ou définissez-en un nouveau."
              : "Tous les KPI de la mission sont désactivés."}
          </p>
        </EtatVide>
      ) : (
        <>
          <Carte titre="Score composite">
            <div className="mp-kpi-section">
              <ScoreKpi score={tableau.score_global} grand />
              {tableau.perspectives.length > 0 ? (
                <ul className="mp-kpi-perspectives" aria-label="Score par perspective">
                  {tableau.perspectives.map((p) => (
                    <li key={p.perspective ?? "sans"} className="mp-kpi-perspective">
                      <h3 className="mp-kpi-perspective__titre">
                        {libellePerspective(p.perspective)}
                      </h3>
                      <p className="mp-texte-doux mp-texte-petit">
                        {p.nombre_kpi} KPI suivi{p.nombre_kpi > 1 ? "s" : ""}
                      </p>
                      <ScoreKpi score={p.score} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {tableau.score_global ? (
                <DetailScore score={tableau.score_global} libelles={libelles} />
              ) : null}
            </div>
          </Carte>

          <Carte titre={`Alertes (${tableau.alertes.length})`}>
            {tableau.alertes.length === 0 ? (
              <p className="mp-texte-doux">
                Aucune alerte à cette date : ni dégradation continue, ni mesure en retard, ni seuil
                franchi.
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
            <Carte titre="Qualité des données">
              <QualiteDonneesKpi qualite={qualite} missionId={missionId} />
            </Carte>
          ) : erreurQualite ? (
            <Carte titre="Qualité des données">
              <EtatErreur
                titre="La qualité des données n'a pas pu être calculée."
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

          <Carte titre="Évolution par période">
            <EvolutionKpi missionId={missionId} date={date} />
          </Carte>

          <Carte titre="Export des données">
            <div className="mp-pile">
              <p className="mp-texte-doux">
                Fichier JSON versionné (missionpilot.kpi.v1) : définitions, versions des cibles,
                historique des mesures (corrections et annulations comprises), séries par période,
                statuts et alertes à la date d&apos;arrêté. Destiné au rapport KPI ou à un outil
                d&apos;analyse ; l&apos;export est consigné au journal.
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
}: {
  score: ScoreKpiVue;
  libelles: ReadonlyMap<string, { libelle: string }>;
}) {
  if (score.contributions.length === 0 && score.exclus.length === 0) return null;
  const lignes = [
    ...score.contributions.map((c) => ({
      id: c.kpi_id,
      libelle: libelles.get(c.kpi_id)?.libelle ?? "KPI",
      poids: formaterTauxKpi(c.poids_normalise),
      taux: formaterTauxKpi(c.taux),
      retenu: "Retenu",
    })),
    ...score.exclus.map((x) => ({
      id: x.kpi_id,
      libelle: libelles.get(x.kpi_id)?.libelle ?? "KPI",
      poids: "—",
      taux: "—",
      retenu: x.raison === "non_mesure" ? "Exclu : non mesuré" : "Exclu : sans cible",
    })),
  ];
  return (
    <details className="mp-details">
      <summary>Détail du score composite</summary>
      <p className="mp-texte-doux mp-texte-petit">
        Chaque KPI retenu pèse selon sa pondération ; son atteinte est bornée entre 0 et 100 % (un
        KPI très en avance ne compense pas un KPI en échec).
      </p>
      <Tableau
        legende="Contribution de chaque KPI au score composite"
        colonnes={[
          { cle: "libelle", entete: "KPI" },
          { cle: "poids", entete: "Poids", alignement: "droite" },
          { cle: "taux", entete: "Atteinte retenue", alignement: "droite" },
          { cle: "retenu", entete: "Prise en compte" },
        ]}
        lignes={lignes}
        cleLigne={(l) => l.id}
      />
    </details>
  );
}
