import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HistoriqueMesuresPortail } from "../../../../../components/portail/kpi/HistoriqueMesuresPortail";
import { SaisieMesurePortail } from "../../../../../components/portail/kpi/SaisieMesurePortail";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { formaterDate } from "../../../../../lib/format";
import { formaterValeurKpi, libellePeriode } from "../../../../../lib/kpi";
import { estIdentifiant, lireCurseur, peut, type PagePortail } from "../../../../../lib/portail";
import {
  cheminApiKpiPortail,
  cheminApiMesuresPortail,
  CHEMIN_KPI_PORTAIL,
  etatSaisieKpi,
  hrefKpiPortail,
  libelleFrequence,
  libelleNature,
  libelleSens,
  type KpiPortail,
  type MesurePortail,
} from "../../../../../lib/portail-kpi";
import { dateDuJour } from "../../../../../lib/portail-questionnaires";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";
import "../../../../../components/kpi/kpi.css";

export const metadata: Metadata = { title: "Indicateur" };

/**
 * Saisie d'une mesure et historique d'un indicateur confié à l'utilisateur. Inexistant, non
 * désigné ou d'un autre client : la même page « introuvable » (l'API répond le même 404).
 */
export default async function KpiPortailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.kpi.saisir")) {
    return <NonDisponible titre="Indicateur" />;
  }
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const curseur = lireCurseur((await searchParams).curseur);

  const [r, historique] = await Promise.all([
    chargerPortail<KpiPortail>(cheminApiKpiPortail(id)),
    chargerPortail<PagePortail<MesurePortail>>(cheminApiMesuresPortail(id, curseur)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_KPI_PORTAIL, libelle: "Vos indicateurs" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Indicateur" retour={retour} />
        <EtatErreur
          titre="Cet indicateur n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefKpiPortail(id)}
        />
      </div>
    );
  }

  const kpi = r.donnees;
  const aujourdhui = dateDuJour(new Date());
  const etat = etatSaisieKpi(kpi, aujourdhui);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={kpi.libelle}
        soustitre={kpi.description ?? undefined}
        retour={retour}
        badges={
          etat.saisissable ? (
            <BadgeStatut tonalite="attention">À renseigner</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">Saisie fermée</BadgeStatut>
          )
        }
      />
      <Carte titre="Ce que l'on vous demande" niveauTitre={2}>
        <dl className="mp-kpi-mesures">
          <div>
            <dt>Fréquence</dt>
            <dd>{libelleFrequence(kpi.frequence)}</dd>
          </div>
          <div>
            <dt>Période en cours</dt>
            <dd>{libellePeriode(kpi.periode_en_cours)}</dd>
          </div>
          <div>
            <dt>Cible en vigueur</dt>
            <dd>
              {kpi.cible_actuelle === null
                ? "Pas de cible définie"
                : formaterValeurKpi(kpi.cible_actuelle, kpi.unite)}
            </dd>
          </div>
          <div>
            <dt>Suivi</dt>
            <dd>
              {kpi.fin_suivi
                ? `Du ${formaterDate(kpi.debut_suivi)} au ${formaterDate(kpi.fin_suivi)}`
                : `Depuis le ${formaterDate(kpi.debut_suivi)}`}
            </dd>
          </div>
        </dl>
        <p className="mp-texte-doux mp-texte-petit">{libelleSens(kpi.sens)}.</p>
      </Carte>

      <Carte titre="Saisir une mesure" niveauTitre={2}>
        {etat.saisissable ? (
          <SaisieMesurePortail kpi={kpi} aujourdhui={aujourdhui} />
        ) : (
          <Alerte tonalite="info" annonce="status">
            <p>{etat.raison}</p>
          </Alerte>
        )}
        {etat.saisissable ? (
          <p className="mp-texte-doux mp-texte-petit">{libelleNature(kpi.nature)}</p>
        ) : null}
      </Carte>

      <Carte titre="Historique des mesures" niveauTitre={2}>
        {!historique.ok ? (
          <EtatErreur
            titre="L'historique n'a pas pu être chargé."
            message={historique.message}
            hrefReessayer={hrefKpiPortail(id)}
          />
        ) : historique.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune mesure n'a encore été saisie." icone="courbe">
            <p>
              Les valeurs que vous enregistrerez apparaîtront ici, de la plus récente à la plus
              ancienne.
            </p>
          </EtatVide>
        ) : (
          <HistoriqueMesuresPortail
            kpi={kpi}
            lignes={historique.donnees.elements}
            aujourdhui={aujourdhui}
            saisissable={etat.saisissable}
          />
        )}
        {historique.ok ? (
          <PaginationCurseur
            hrefSuivante={
              historique.donnees.curseur_suivant
                ? `${hrefKpiPortail(id)}?${new URLSearchParams({ curseur: historique.donnees.curseur_suivant }).toString()}`
                : null
            }
            hrefDebut={curseur ? hrefKpiPortail(id) : null}
            libelle="Pages de l'historique"
          />
        ) : null}
      </Carte>
    </div>
  );
}
