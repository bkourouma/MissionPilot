import { BadgeStatut } from "../ui/BadgeStatut";
import { Calcule } from "../ui/Calcule";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { formaterJours, formaterMontantMineur, formaterPourcentage } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  etatMois,
  libelleEtape,
  libelleMois,
  type EtapePrevision,
  type MoisPrevision,
  type ReponsePrevisions,
} from "../../lib/previsions";

/** Chiffre d'affaires prévu par mois (carnet signé, pipeline pondéré) et charge contre capacité. */
export async function TableauxPrevisions({ donnees: r }: { donnees: ReponsePrevisions }) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const m = (v: number) => formaterMontantMineur(v, r.devise, langue);

  const colonnesCa: ColonneTableau<MoisPrevision>[] = [
    {
      cle: "mois",
      entete: t("Mois", "Month"),
      rendu: (l) => <span className="mp-sans-coupure">{libelleMois(l.mois, langue)}</span>,
    },
    {
      cle: "carnet",
      entete: t("Carnet signé", "Signed backlog"),
      alignement: "droite",
      rendu: (l) => m(l.ca_carnet),
    },
    {
      cle: "pipeline",
      entete: t("Pipeline pondéré", "Weighted pipeline"),
      alignement: "droite",
      rendu: (l) => m(l.ca_pipeline),
    },
    {
      cle: "total",
      entete: t("Total prévu", "Total forecast"),
      alignement: "droite",
      rendu: (l) => <strong>{m(l.ca_total)}</strong>,
    },
  ];

  const colonnesCharge: ColonneTableau<MoisPrevision>[] = [
    {
      cle: "mois",
      entete: t("Mois", "Month"),
      rendu: (l) => <span className="mp-sans-coupure">{libelleMois(l.mois, langue)}</span>,
    },
    {
      cle: "capacite",
      entete: t("Capacité", "Capacity"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.capacite_jours, langue),
    },
    {
      cle: "carnet",
      entete: t("Carnet (affecté)", "Backlog (assigned)"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_carnet_jours, langue),
    },
    {
      cle: "pourvoir",
      entete: t("À pourvoir", "To be staffed"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_a_pourvoir_jours, langue),
    },
    {
      cle: "pipeline",
      entete: t("Pipeline pondéré", "Weighted pipeline"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_pipeline_jours, langue),
    },
    {
      cle: "total",
      entete: t("Charge totale", "Total workload"),
      alignement: "droite",
      rendu: (l) => <strong>{formaterJours(l.charge_totale_jours, langue)}</strong>,
    },
    {
      cle: "ecart",
      entete: t("Capacité restante", "Remaining capacity"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.ecart_jours, langue),
    },
    {
      cle: "occupation",
      entete: t("Occupation", "Utilization"),
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_occupation, 0, langue),
    },
    {
      cle: "etat",
      entete: t("État", "Status"),
      rendu: (l) => {
        const e = etatMois(l, langue);
        return <BadgeStatut tonalite={e.tonalite}>{e.court}</BadgeStatut>;
      },
    },
  ];

  const colonnesEtapes: ColonneTableau<EtapePrevision>[] = [
    { cle: "etape", entete: t("Étape", "Stage"), rendu: (e) => libelleEtape(e.etape, langue) },
    { cle: "nombre", entete: t("Opportunités", "Opportunities"), alignement: "droite" },
    {
      cle: "montant",
      entete: t("Montant estimé", "Estimated amount"),
      alignement: "droite",
      rendu: (e) => m(e.montant),
    },
    {
      cle: "pondere",
      entete: t("Montant pondéré", "Weighted amount"),
      alignement: "droite",
      rendu: (e) => <strong>{m(e.montant_pondere)}</strong>,
    },
  ];

  return (
    <>
      <Carte
        titre={t("Chiffre d'affaires prévu", "Forecast revenue")}
        actions={<Calcule />}
        piedDePage={
          <p className="mp-texte-doux mp-texte-petit">
            {t(`Montants en ${r.devise}.`, `Amounts in ${r.devise}.`)}
          </p>
        }
      >
        <Tableau
          messageVide={t("Aucun mois à afficher.", "No months to display.")}
          legende={t("Chiffre d'affaires prévu par mois", "Forecast revenue by month")}
          lignes={r.mois}
          cleLigne={(l) => l.mois}
          colonnes={colonnesCa}
        />
      </Carte>
      <Carte
        titre={t("Charge et capacité", "Workload and capacity")}
        actions={<Calcule />}
        piedDePage={
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "Jours de travail par mois. L'état compare la charge totale à la capacité (texte et icône, pas seulement la couleur).",
              "Working days per month. The status compares total workload to capacity (text and icon, not colour alone).",
            )}
          </p>
        }
      >
        <Tableau
          messageVide={t("Aucun mois à afficher.", "No months to display.")}
          legende={t(
            "Charge en jours contre capacité, par mois",
            "Workload in days against capacity, by month",
          )}
          lignes={r.mois}
          cleLigne={(l) => l.mois}
          colonnes={colonnesCharge}
        />
      </Carte>
      <Carte
        titre={t("Pipeline par étape", "Pipeline by stage")}
        actions={<Calcule />}
        piedDePage={
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `Montants en ${r.devise}. Le montant pondéré applique la probabilité de chaque opportunité.`,
              `Amounts in ${r.devise}. The weighted amount applies each opportunity's probability.`,
            )}
          </p>
        }
      >
        <Tableau
          messageVide={t("Aucune opportunité ouverte.", "No open opportunities.")}
          legende={t("Pipeline ouvert par étape", "Open pipeline by stage")}
          lignes={r.par_etape}
          cleLigne={(e) => e.etape}
          colonnes={colonnesEtapes}
        />
      </Carte>
    </>
  );
}
