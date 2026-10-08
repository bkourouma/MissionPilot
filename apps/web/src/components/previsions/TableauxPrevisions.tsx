import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import { formaterJours, formaterMontantMineur, formaterPourcentage } from "../../lib/format";
import {
  etatMois,
  LIBELLE_ETAPE,
  libelleMois,
  type EtapePrevision,
  type MoisPrevision,
  type ReponsePrevisions,
} from "../../lib/previsions";

/** Chiffre d'affaires prévu par mois (carnet signé, pipeline pondéré) et charge contre capacité. */
export function TableauxPrevisions({ donnees: r }: { donnees: ReponsePrevisions }) {
  const m = (v: number) => formaterMontantMineur(v, r.devise);

  const colonnesCa: ColonneTableau<MoisPrevision>[] = [
    { cle: "mois", entete: "Mois", rendu: (l) => libelleMois(l.mois) },
    { cle: "carnet", entete: "Carnet signé", alignement: "droite", rendu: (l) => m(l.ca_carnet) },
    {
      cle: "pipeline",
      entete: "Pipeline pondéré",
      alignement: "droite",
      rendu: (l) => m(l.ca_pipeline),
    },
    {
      cle: "total",
      entete: "Total prévu",
      alignement: "droite",
      rendu: (l) => <strong>{m(l.ca_total)}</strong>,
    },
  ];

  const colonnesCharge: ColonneTableau<MoisPrevision>[] = [
    { cle: "mois", entete: "Mois", rendu: (l) => libelleMois(l.mois) },
    {
      cle: "capacite",
      entete: "Capacité",
      alignement: "droite",
      rendu: (l) => formaterJours(l.capacite_jours),
    },
    {
      cle: "carnet",
      entete: "Carnet (affecté)",
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_carnet_jours),
    },
    {
      cle: "pourvoir",
      entete: "À pourvoir",
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_a_pourvoir_jours),
    },
    {
      cle: "pipeline",
      entete: "Pipeline pondéré",
      alignement: "droite",
      rendu: (l) => formaterJours(l.charge_pipeline_jours),
    },
    {
      cle: "total",
      entete: "Charge totale",
      alignement: "droite",
      rendu: (l) => <strong>{formaterJours(l.charge_totale_jours)}</strong>,
    },
    {
      cle: "ecart",
      entete: "Capacité restante",
      alignement: "droite",
      rendu: (l) => formaterJours(l.ecart_jours),
    },
    {
      cle: "occupation",
      entete: "Occupation",
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_occupation, 0),
    },
    {
      cle: "etat",
      entete: "État",
      rendu: (l) => {
        const e = etatMois(l);
        return <BadgeStatut tonalite={e.tonalite}>{e.court}</BadgeStatut>;
      },
    },
  ];

  const colonnesEtapes: ColonneTableau<EtapePrevision>[] = [
    { cle: "etape", entete: "Étape", rendu: (e) => LIBELLE_ETAPE[e.etape] },
    { cle: "nombre", entete: "Opportunités", alignement: "droite" },
    { cle: "montant", entete: "Montant estimé", alignement: "droite", rendu: (e) => m(e.montant) },
    {
      cle: "pondere",
      entete: "Montant pondéré",
      alignement: "droite",
      rendu: (e) => <strong>{m(e.montant_pondere)}</strong>,
    },
  ];

  return (
    <>
      <Carte titre="Chiffre d'affaires prévu">
        <Tableau
          legende="Chiffre d'affaires prévu par mois"
          lignes={r.mois}
          cleLigne={(l) => l.mois}
          colonnes={colonnesCa}
        />
      </Carte>
      <Carte titre="Charge et capacité">
        <Tableau
          legende="Charge en jours contre capacité, par mois"
          lignes={r.mois}
          cleLigne={(l) => l.mois}
          colonnes={colonnesCharge}
        />
      </Carte>
      <Carte titre="Pipeline par étape">
        <Tableau
          legende="Pipeline ouvert par étape"
          lignes={r.par_etape}
          cleLigne={(e) => e.etape}
          colonnes={colonnesEtapes}
        />
      </Carte>
    </>
  );
}
