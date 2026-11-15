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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Indicateur", "Indicator") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
  if (!peut(utilisateur.roles, "portail.kpi.saisir")) {
    return <NonDisponible titre={t("Indicateur", "Indicator")} />;
  }
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const curseur = lireCurseur((await searchParams).curseur);

  const [r, historique] = await Promise.all([
    chargerPortail<KpiPortail>(cheminApiKpiPortail(id)),
    chargerPortail<PagePortail<MesurePortail>>(cheminApiMesuresPortail(id, curseur)),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_KPI_PORTAIL, libelle: t("Vos indicateurs", "Your indicators") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Indicateur", "Indicator")} retour={retour} />
        <EtatErreur
          titre={t("Cet indicateur n'a pas pu être chargé.", "This indicator could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefKpiPortail(id)}
        />
      </div>
    );
  }

  const kpi = r.donnees;
  const aujourdhui = dateDuJour(new Date());
  const etat = etatSaisieKpi(kpi, aujourdhui, langue);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={kpi.libelle}
        soustitre={kpi.description ?? undefined}
        retour={retour}
        badges={
          etat.saisissable ? (
            <BadgeStatut tonalite="attention">{t("À renseigner", "To be filled in")}</BadgeStatut>
          ) : (
            <BadgeStatut tonalite="neutre">{t("Saisie fermée", "Entry closed")}</BadgeStatut>
          )
        }
      />
      <Carte titre={t("Ce que l'on vous demande", "What is asked of you")} niveauTitre={2}>
        <dl className="mp-kpi-mesures">
          <div>
            <dt>{t("Fréquence", "Frequency")}</dt>
            <dd>{libelleFrequence(kpi.frequence, langue)}</dd>
          </div>
          <div>
            <dt>{t("Période en cours", "Current period")}</dt>
            <dd>{libellePeriode(kpi.periode_en_cours, langue)}</dd>
          </div>
          <div>
            <dt>{t("Cible en vigueur", "Target in effect")}</dt>
            <dd>
              {kpi.cible_actuelle === null
                ? t("Pas de cible définie", "No target defined")
                : formaterValeurKpi(kpi.cible_actuelle, kpi.unite, langue)}
            </dd>
          </div>
          <div>
            <dt>{t("Suivi", "Tracking")}</dt>
            <dd>
              {kpi.fin_suivi
                ? t(
                    `Du ${formaterDate(kpi.debut_suivi, "UTC", langue)} au ${formaterDate(kpi.fin_suivi, "UTC", langue)}`,
                    `From ${formaterDate(kpi.debut_suivi, "UTC", langue)} to ${formaterDate(kpi.fin_suivi, "UTC", langue)}`,
                  )
                : t(
                    `Depuis le ${formaterDate(kpi.debut_suivi, "UTC", langue)}`,
                    `Since ${formaterDate(kpi.debut_suivi, "UTC", langue)}`,
                  )}
            </dd>
          </div>
        </dl>
        <p className="mp-texte-doux mp-texte-petit">{libelleSens(kpi.sens, langue)}.</p>
      </Carte>

      <Carte titre={t("Saisir une mesure", "Enter a measurement")} niveauTitre={2}>
        {etat.saisissable ? (
          <SaisieMesurePortail kpi={kpi} aujourdhui={aujourdhui} />
        ) : (
          <Alerte tonalite="info" annonce="status">
            <p>{etat.raison}</p>
          </Alerte>
        )}
        {etat.saisissable ? (
          <p className="mp-texte-doux mp-texte-petit">{libelleNature(kpi.nature, langue)}</p>
        ) : null}
      </Carte>

      <Carte titre={t("Historique des mesures", "Measurement history")} niveauTitre={2}>
        {!historique.ok ? (
          <EtatErreur
            titre={t("L'historique n'a pas pu être chargé.", "The history could not be loaded.")}
            message={historique.message}
            hrefReessayer={hrefKpiPortail(id)}
          />
        ) : historique.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucune mesure n'a encore été saisie.",
              "No measurement has been entered yet.",
            )}
            icone="courbe"
          >
            <p>
              {t(
                "Les valeurs que vous enregistrerez apparaîtront ici, de la plus récente à la plus ancienne.",
                "The values you save will appear here, from the most recent to the oldest.",
              )}
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
            libelle={t("Pages de l'historique", "History pages")}
          />
        ) : null}
      </Carte>
    </div>
  );
}
