import Link from "next/link";
import type { NiveauIndicateurs } from "@missionpilot/shared";
import {
  detailRatio,
  formaterDelai,
  formaterEcartJours,
  lireCarnet,
  NIVEAU_LIBELLES,
  type ElementAssocie,
  type ElementClient,
  type ElementCollaborateur,
  type ElementGrade,
  type ElementMission,
  type ReponseIndicateurs,
  type VueCharge,
  type VueMissions,
} from "../../lib/indicateurs";
import {
  formaterJours,
  formaterMontantMineur,
  formaterPourcentage,
  type Devise,
} from "../../lib/format";
import { Tableau, type ColonneTableau } from "../ui/Tableau";

/** Colonnes de charge (occupation, facturabilité, discipline) : sans aucune donnée financière. */
function colonnesCharge<T extends VueCharge>(): ColonneTableau<T>[] {
  return [
    {
      cle: "dispo",
      entete: "Jours disponibles",
      alignement: "droite",
      rendu: (l) => formaterJours(l.jours_disponibles),
    },
    {
      cle: "occupation",
      entete: "Occupation",
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_occupation),
    },
    {
      cle: "facturabilite",
      entete: "Facturabilité",
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_facturabilite),
    },
    {
      cle: "discipline",
      entete: "Discipline de saisie",
      alignement: "droite",
      rendu: (l) =>
        `${formaterPourcentage(l.discipline_saisie.taux)} (${detailRatio(l.discipline_saisie)})`,
    },
  ];
}

/**
 * Colonnes de missions ; les colonnes monétaires n'existent que si l'API a servi le champ
 * (droit « finance.lire » ou « budget.lire_montants ») : jamais de colonne vide trompeuse.
 */
function colonnesMissions<T extends VueMissions>(
  devise: Devise,
  droits: ReponseIndicateurs["droits"],
): ColonneTableau<T>[] {
  const colonnes: ColonneTableau<T>[] = [
    {
      cle: "conso",
      entete: "Consommation",
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.consommation_budgetaire),
    },
    {
      cle: "ecart",
      entete: "Écart à terminaison",
      alignement: "droite",
      rendu: (l) =>
        formaterEcartJours(l.ecart_terminaison.jours, l.ecart_terminaison.relatif_jours),
    },
    {
      cle: "jalons",
      entete: "Respect des jalons",
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.respect_jalons.taux),
    },
  ];
  if (droits.finance) {
    colonnes.push(
      {
        cle: "marge",
        entete: "Marge",
        alignement: "droite",
        rendu: (l) =>
          l.marge
            ? `${formaterMontantMineur(l.marge.marge, devise)} (${formaterPourcentage(l.marge.taux_marge)})`
            : "—",
      },
      {
        cle: "realisation",
        entete: "Réalisation",
        alignement: "droite",
        rendu: (l) => formaterPourcentage(l.taux_realisation),
      },
      {
        cle: "encours",
        entete: "Encours",
        alignement: "droite",
        rendu: (l) =>
          l.encours ? formaterMontantMineur(l.encours.encours_production, devise) : "—",
      },
    );
  }
  if (droits.montants) {
    colonnes.push({
      cle: "carnet",
      // Sans finance.lire, l'API sert le carnet fondé sur les honoraires facturés.
      entete: droits.finance ? "Carnet de commandes" : "Carnet (signé − facturé)",
      alignement: "droite",
      rendu: (l) => {
        const carnet = lireCarnet(l);
        return carnet ? formaterMontantMineur(carnet.valeur, devise) : "—";
      },
    });
  }
  return colonnes;
}

export function TableauNiveau({ reponse: r }: { reponse: ReponseIndicateurs }) {
  const legende = `Indicateurs par ${NIVEAU_LIBELLES[r.niveau].toLowerCase()}`;
  const niveau: NiveauIndicateurs = r.niveau;
  switch (niveau) {
    case "collaborateur":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementCollaborateur[]}
          cleLigne={(l) => l.collaborateur_id}
          messageVide="Aucun collaborateur interne actif."
          colonnes={[
            { cle: "nom", entete: "Collaborateur", rendu: (l) => l.nom },
            { cle: "grade", entete: "Grade", rendu: (l) => l.grade_code ?? "—" },
            ...colonnesCharge<ElementCollaborateur>(),
          ]}
        />
      );
    case "grade":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementGrade[]}
          cleLigne={(l) => l.grade_code ?? "sans-grade"}
          messageVide="Aucun grade à afficher."
          colonnes={[
            { cle: "grade", entete: "Grade", rendu: (l) => l.grade_libelle },
            {
              cle: "nombre",
              entete: "Collaborateurs",
              alignement: "droite",
              rendu: (l) => String(l.nombre_collaborateurs),
            },
            ...colonnesCharge<ElementGrade>(),
          ]}
        />
      );
    case "mission":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementMission[]}
          cleLigne={(l) => l.mission_id}
          messageVide="Aucune mission sur la période."
          colonnes={[
            {
              cle: "mission",
              entete: "Mission",
              rendu: (l) => <Link href={`/missions/${l.mission_id}/suivi`}>{l.intitule}</Link>,
            },
            ...colonnesMissions<ElementMission>(r.devise, r.droits),
          ]}
        />
      );
    case "associe":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementAssocie[]}
          cleLigne={(l) => l.directeur_id ?? "sans-directeur"}
          messageVide="Aucune mission sur la période."
          colonnes={[
            { cle: "nom", entete: "Associé ou directeur", rendu: (l) => l.nom },
            {
              cle: "missions",
              entete: "Missions",
              alignement: "droite",
              rendu: (l) => String(l.nombre_missions),
            },
            ...colonnesMissions<ElementAssocie>(r.devise, r.droits),
          ]}
        />
      );
    case "client":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementClient[]}
          cleLigne={(l) => l.client_id}
          messageVide="Aucun client sur la période."
          colonnes={[
            { cle: "client", entete: "Client", rendu: (l) => l.raison_sociale },
            {
              cle: "missions",
              entete: "Missions",
              alignement: "droite",
              rendu: (l) => String(l.nombre_missions),
            },
            {
              cle: "delai",
              entete: "Délai moyen d'encaissement",
              alignement: "droite",
              rendu: (l) => formaterDelai(l.delai_moyen_encaissement),
            },
            ...(r.droits.finance
              ? [
                  {
                    cle: "marge",
                    entete: "Marge",
                    alignement: "droite" as const,
                    rendu: (l: ElementClient) =>
                      l.marge
                        ? `${formaterMontantMineur(l.marge.marge, r.devise)} (${formaterPourcentage(l.marge.taux_marge)})`
                        : "—",
                  },
                ]
              : []),
          ]}
        />
      );
    default:
      return null;
  }
}
