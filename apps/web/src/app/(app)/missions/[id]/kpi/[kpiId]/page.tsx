import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
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
  FREQUENCE_LIBELLES,
  hrefKpi,
  hrefModifierKpi,
  hrefTableauKpi,
  libellePerspective,
  lireCurseur,
  NATURE_LIBELLES,
  nomProprietaire,
  raisonSansSaisie,
  SENS_LIBELLES,
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

export const metadata: Metadata = { title: "Fiche d'un KPI" };

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
        titre="Le KPI n'a pas pu être chargé."
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
  noms.set(utilisateur.id, `${utilisateur.nom} (vous)`);
  const proprietaires = candidatsProprietaire(m, noms);
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
          <Icone nom="chevronGauche" taille={16} /> Tableau de bord des KPI
        </Link>
      </p>
      {sp.cree === "1" ? (
        <Alerte tonalite="succes" titre="KPI créé" annonce="status">
          <p>
            Saisissez maintenant ses premières mesures ; son statut apparaîtra dès la première
            période close mesurée.
          </p>
        </Alerte>
      ) : null}
      {sp.modifie === "1" ? (
        <Alerte tonalite="succes" annonce="status">
          <p>Modifications de la définition enregistrées.</p>
        </Alerte>
      ) : null}

      <Carte
        titre={kpi.libelle}
        actions={
          droits.gerer ? (
            <Link href={hrefModifierKpi(m.id, kpi.id)} className={classesBouton("secondaire")}>
              <Icone nom="crayon" />
              <span>Modifier la définition</span>
            </Link>
          ) : null
        }
      >
        <div className="mp-pile">
          <span className="mp-badges">
            {kpi.actif ? null : <BadgeStatut tonalite="neutre">KPI désactivé</BadgeStatut>}
            <BadgeStatut tonalite="neutre" sansIcone>
              {libellePerspective(kpi.perspective)}
            </BadgeStatut>
          </span>
          {kpi.description ? <p className="mp-texte-preserve">{kpi.description}</p> : null}
          <Situation
            kpi={kpi}
            missionId={m.id}
            situation={situation}
            erreur={tableau && !tableau.ok ? tableau.message : null}
          />
        </div>
      </Carte>

      <Carte titre="Saisir une mesure">
        {droits.saisir ? (
          <SaisieMesure kpi={kpi} aujourdhui={jour} />
        ) : (
          <p className="mp-texte-doux">{raisonSansSaisie(m, kpi, roles)}</p>
        )}
      </Carte>

      <Carte titre="Historique des mesures" id="historique">
        {!mesures.ok ? (
          <EtatErreur
            titre="L'historique des mesures n'a pas pu être chargé."
            message={mesures.message}
            hrefReessayer={lien({}, "historique")}
          />
        ) : mesures.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune mesure saisie pour ce KPI." icone="courbe">
            <p>
              Les mesures saisies par le cabinet ou par les contributeurs du client apparaîtront
              ici, du plus récent au plus ancien.
            </p>
          </EtatVide>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux mp-texte-petit">
              Historique en ajout seul : une mesure n&apos;est jamais modifiée ni supprimée ; une
              correction ou une annulation ajoute une ligne motivée.
            </p>
            <HistoriqueMesures
              kpi={kpi}
              lignes={mesures.donnees.elements}
              aujourdhui={jour}
              saisir={droits.saisir}
              annulerPortail={droits.gerer}
            />
            <PaginationCurseur
              libelle="Pages de l'historique des mesures"
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

      <Carte titre="Évolution par période">
        <EvolutionKpi missionId={m.id} date={null} kpiId={kpi.id} />
      </Carte>

      <Carte titre="Définition">
        <Definition
          kpi={kpi}
          proprietaire={nomProprietaire(kpi.proprietaire_id, proprietaires, noms)}
        />
      </Carte>

      <Carte titre="Cibles">
        <div className="mp-pile">
          <p>
            Cible en vigueur aujourd&apos;hui :{" "}
            <strong>
              {kpi.cible_actuelle === null
                ? "aucune"
                : formaterValeurKpi(kpi.cible_actuelle, kpi.unite)}
            </strong>
          </p>
          <HistoriqueCibles cibles={kpi.cibles} unite={kpi.unite} noms={noms} />
          {droits.gerer ? (
            <details className="mp-details">
              <summary>Publier une nouvelle version de cible</summary>
              <FormulaireCible kpi={kpi} aujourdhui={jour} />
            </details>
          ) : null}
        </div>
      </Carte>

      <Carte titre="Contributeurs du client">
        <Contributeurs kpi={kpi} gerer={droits.gerer} portail={portail} mission={m} />
      </Carte>

      <Carte titre="Alertes enregistrées" id="alertes">
        {!alertes.ok ? (
          <EtatErreur
            titre="Les alertes n'ont pas pu être chargées."
            message={alertes.message}
            hrefReessayer={lien({}, "alertes")}
          />
        ) : alertes.donnees.elements.length === 0 ? (
          <p className="mp-texte-doux">Aucune alerte enregistrée pour ce KPI.</p>
        ) : (
          <div className="mp-pile">
            <p className="mp-texte-doux mp-texte-petit">
              Une alerte est enregistrée une seule fois par période, à la saisie ou lors du contrôle
              quotidien ; le propriétaire et les responsables de la mission sont notifiés.
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
                  detectee: `Détectée le ${formaterDateHeure(a.detectee_le)}`,
                };
              })}
            />
            <PaginationCurseur
              libelle="Pages des alertes enregistrées"
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
        <Carte titre={kpi.actif ? "Désactivation" : "Réactivation"}>
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
}: {
  kpi: DetailKpi;
  missionId: string;
  situation: TableauDeBordKpi["kpis"][number] | undefined;
  erreur: string | null;
}) {
  if (!kpi.actif) {
    return (
      <p className="mp-texte-doux">
        KPI désactivé : il n&apos;est plus évalué. Son historique reste consultable ci-dessous.
      </p>
    );
  }
  if (erreur) {
    return (
      <Alerte tonalite="attention" titre="Situation indisponible" annonce="aucune">
        <p>{erreur}</p>
      </Alerte>
    );
  }
  if (!situation) {
    return <p className="mp-texte-doux">Situation indisponible : rechargez la page.</p>;
  }
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux mp-texte-petit">
        Situation au {formaterDate(situation.date_reference)}, évaluée par le moteur.
      </p>
      <CarteKpi kpi={situation} missionId={missionId} niveauTitre={3} avecLien={false} />
    </div>
  );
}

function Definition({ kpi, proprietaire }: { kpi: DetailKpi; proprietaire: string }) {
  const alertes = [
    kpi.alerte_haut === null
      ? null
      : `au-dessus de ${formaterValeurKpi(kpi.alerte_haut, kpi.unite)}`,
    kpi.alerte_bas === null
      ? null
      : `en dessous de ${formaterValeurKpi(kpi.alerte_bas, kpi.unite)}`,
    kpi.alerte_variation === null
      ? null
      : `variation de plus de ${formaterTauxKpi(kpi.alerte_variation)} d'une période à l'autre`,
  ].filter((x): x is string => x !== null);
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>Unité</dt>
        <dd>{kpi.unite}</dd>
      </div>
      <div>
        <dt>Sens de lecture</dt>
        <dd>{SENS_LIBELLES[kpi.sens]}</dd>
      </div>
      <div>
        <dt>Nature</dt>
        <dd>{NATURE_LIBELLES[kpi.nature]}</dd>
      </div>
      <div>
        <dt>Fréquence</dt>
        <dd>{FREQUENCE_LIBELLES[kpi.frequence]}</dd>
      </div>
      <div>
        <dt>Suivi</dt>
        <dd>
          Depuis le {formaterDate(kpi.debut_suivi)}
          {kpi.fin_suivi ? `, jusqu'au ${formaterDate(kpi.fin_suivi)}` : ", sans date de fin"}
        </dd>
      </div>
      <div>
        <dt>Pondération</dt>
        <dd>{kpi.ponderation.toLocaleString("fr-FR")}</dd>
      </div>
      <div>
        <dt>Seuils de statut</dt>
        <dd>{texteSeuilsStatut(kpi)}</dd>
      </div>
      <div>
        <dt>Seuils d&apos;alerte</dt>
        <dd>{alertes.length === 0 ? "Aucun" : `Alerte ${alertes.join(" ; ")}.`}</dd>
      </div>
      <div>
        <dt>Propriétaire</dt>
        <dd>{proprietaire}</dd>
      </div>
      <div>
        <dt>Rappels de saisie</dt>
        <dd>{kpi.rappels_actifs ? "Actifs" : "Désactivés pour ce KPI"}</dd>
      </div>
    </dl>
  );
}

function Contributeurs({
  kpi,
  gerer,
  portail,
  mission,
}: {
  kpi: DetailKpi;
  gerer: boolean;
  portail:
    | { ok: true; donnees: { utilisateurs: ComptePortailKpi[] } }
    | { ok: false; message: string }
    | null;
  mission: Pick<MissionDetaillee, "client_raison_sociale">;
}) {
  const liste =
    kpi.contributeurs.length === 0 ? (
      <p className="mp-texte-doux">
        Aucun contributeur désigné : seul le cabinet saisit les mesures de ce KPI.
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
        {`Dirigeants et contributeurs du portail de ${mission.client_raison_sociale} autorisés à saisir les mesures de ce KPI. Ils ne voient ni la mission, ni l'équipe, ni les alertes internes.`}
      </p>
      {liste}
      {gerer && portail === null ? (
        <p className="mp-texte-doux mp-texte-petit">
          La désignation des contributeurs demande la gestion du portail client.
        </p>
      ) : null}
      {gerer && portail && !portail.ok ? (
        <Alerte tonalite="attention" titre="Comptes du portail indisponibles" annonce="aucune">
          <p>{portail.message}</p>
        </Alerte>
      ) : null}
      {gerer && portail?.ok ? (
        <ChoixContributeurs kpi={kpi} comptes={portail.donnees.utilisateurs} />
      ) : null}
    </div>
  );
}

function ChoixContributeurs({ kpi, comptes }: { kpi: DetailKpi; comptes: ComptePortailKpi[] }) {
  const candidats = candidatsContributeurs(comptes, kpi.contributeurs);
  if (candidats.length === 0) {
    return (
      <p className="mp-texte-doux">
        Aucun dirigeant ni contributeur n&apos;a encore de compte sur le portail de ce client :
        invitez-les depuis la fiche du client.
      </p>
    );
  }
  return (
    <details className="mp-details">
      <summary>Choisir les contributeurs</summary>
      <ContributeursKpi
        kpiId={kpi.id}
        candidats={candidats}
        actuels={kpi.contributeurs.map((c) => c.id)}
      />
    </details>
  );
}
