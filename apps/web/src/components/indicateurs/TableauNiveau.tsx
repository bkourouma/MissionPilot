import Link from "next/link";
import type { Langue, NiveauIndicateurs, Traduire } from "@missionpilot/shared";
import {
  detailRatio,
  formaterDelai,
  formaterEcartJours,
  lireCarnet,
  NIVEAU_LIBELLES,
  NIVEAU_LIBELLES_EN,
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
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { Tableau, type ColonneTableau } from "../ui/Tableau";
import "./tableau-de-bord.css";

/** Valeur absente : le tiret reste visuel, les lecteurs d'écran lisent « Non disponible ». */
function tiret(t: Traduire) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="mp-visuellement-cache">{t("Non disponible", "Not available")}</span>
    </>
  );
}

/** Colonnes de charge (occupation, facturabilité, discipline) : sans aucune donnée financière. */
function colonnesCharge<T extends VueCharge>(t: Traduire, langue: Langue): ColonneTableau<T>[] {
  return [
    {
      cle: "dispo",
      entete: t("Jours disponibles", "Available days"),
      alignement: "droite",
      rendu: (l) => formaterJours(l.jours_disponibles, langue),
    },
    {
      cle: "occupation",
      entete: t("Occupation", "Utilization"),
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_occupation, 1, langue),
    },
    {
      cle: "facturabilite",
      entete: t("Facturabilité", "Billability"),
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.taux_facturabilite, 1, langue),
    },
    {
      cle: "discipline",
      entete: t("Discipline de saisie", "Time entry discipline"),
      alignement: "droite",
      rendu: (l) =>
        `${formaterPourcentage(l.discipline_saisie.taux, 1, langue)} (${detailRatio(l.discipline_saisie, langue)})`,
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
  t: Traduire,
  langue: Langue,
): ColonneTableau<T>[] {
  const colonnes: ColonneTableau<T>[] = [
    {
      cle: "conso",
      entete: t("Consommation", "Consumption"),
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.consommation_budgetaire, 1, langue),
    },
    {
      cle: "ecart",
      entete: t("Écart à terminaison", "Variance at completion"),
      alignement: "droite",
      rendu: (l) =>
        formaterEcartJours(l.ecart_terminaison.jours, l.ecart_terminaison.relatif_jours, langue),
    },
    {
      cle: "jalons",
      entete: t("Respect des jalons", "Milestone compliance"),
      alignement: "droite",
      rendu: (l) => formaterPourcentage(l.respect_jalons.taux, 1, langue),
    },
  ];
  if (droits.finance) {
    colonnes.push(
      {
        cle: "marge",
        entete: t("Marge", "Margin"),
        alignement: "droite",
        rendu: (l) =>
          l.marge
            ? `${formaterMontantMineur(l.marge.marge, devise, langue)} (${formaterPourcentage(l.marge.taux_marge, 1, langue)})`
            : tiret(t),
      },
      {
        cle: "realisation",
        entete: t("Réalisation", "Realization"),
        alignement: "droite",
        rendu: (l) => formaterPourcentage(l.taux_realisation, 1, langue),
      },
      {
        cle: "encours",
        entete: t("Encours", "Work in progress"),
        alignement: "droite",
        rendu: (l) =>
          l.encours
            ? formaterMontantMineur(l.encours.encours_production, devise, langue)
            : tiret(t),
      },
    );
  }
  if (droits.montants) {
    colonnes.push({
      cle: "carnet",
      // Sans finance.lire, l'API sert le carnet fondé sur les honoraires facturés.
      entete: droits.finance
        ? t("Carnet de commandes", "Order book")
        : t("Carnet (signé − facturé)", "Order book (signed − invoiced)"),
      alignement: "droite",
      rendu: (l) => {
        const carnet = lireCarnet(l, langue);
        return carnet ? formaterMontantMineur(carnet.valeur, devise, langue) : tiret(t);
      },
    });
  }
  return colonnes;
}

export async function TableauNiveau({ reponse: r }: { reponse: ReponseIndicateurs }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tableau = tableauParNiveau(r, t, langue);
  // Chiffres tabulaires alignés à droite (classe `mp-tdb-niveau`, tableau-de-bord.css).
  return tableau ? <div className="mp-tdb-niveau">{tableau}</div> : null;
}

function tableauParNiveau(r: ReponseIndicateurs, t: Traduire, langue: Langue) {
  const nomNiveau = (langue === "en" ? NIVEAU_LIBELLES_EN : NIVEAU_LIBELLES)[r.niveau];
  const legende = t(
    `Indicateurs par ${nomNiveau.toLowerCase()}`,
    `Indicators by ${nomNiveau.toLowerCase()}`,
  );
  const niveau: NiveauIndicateurs = r.niveau;
  switch (niveau) {
    case "collaborateur":
      return (
        <Tableau
          legende={legende}
          legendeVisible
          lignes={r.elements as ElementCollaborateur[]}
          cleLigne={(l) => l.collaborateur_id}
          messageVide={t("Aucun collaborateur interne actif.", "No active internal consultant.")}
          colonnes={[
            { cle: "nom", entete: t("Collaborateur", "Consultant"), rendu: (l) => l.nom },
            { cle: "grade", entete: t("Grade", "Grade"), rendu: (l) => l.grade_code ?? tiret(t) },
            ...colonnesCharge<ElementCollaborateur>(t, langue),
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
          messageVide={t("Aucun grade à afficher.", "No grade to display.")}
          colonnes={[
            { cle: "grade", entete: t("Grade", "Grade"), rendu: (l) => l.grade_libelle },
            {
              cle: "nombre",
              entete: t("Collaborateurs", "Consultants"),
              alignement: "droite",
              rendu: (l) => String(l.nombre_collaborateurs),
            },
            ...colonnesCharge<ElementGrade>(t, langue),
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
          messageVide={t("Aucune mission sur la période.", "No engagement in the period.")}
          colonnes={[
            {
              cle: "mission",
              entete: t("Mission", "Engagement"),
              rendu: (l) => <Link href={`/missions/${l.mission_id}/suivi`}>{l.intitule}</Link>,
            },
            ...colonnesMissions<ElementMission>(r.devise, r.droits, t, langue),
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
          messageVide={t("Aucune mission sur la période.", "No engagement in the period.")}
          colonnes={[
            {
              cle: "nom",
              entete: t("Associé ou directeur", "Partner or director"),
              rendu: (l) => l.nom,
            },
            {
              cle: "missions",
              entete: t("Missions", "Engagements"),
              alignement: "droite",
              rendu: (l) => String(l.nombre_missions),
            },
            ...colonnesMissions<ElementAssocie>(r.devise, r.droits, t, langue),
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
          messageVide={t("Aucun client sur la période.", "No client in the period.")}
          colonnes={[
            { cle: "client", entete: t("Client", "Client"), rendu: (l) => l.raison_sociale },
            {
              cle: "missions",
              entete: t("Missions", "Engagements"),
              alignement: "droite",
              rendu: (l) => String(l.nombre_missions),
            },
            {
              cle: "delai",
              entete: t("Délai moyen d'encaissement", "Average collection time"),
              alignement: "droite",
              rendu: (l) => formaterDelai(l.delai_moyen_encaissement, langue),
            },
            ...(r.droits.finance
              ? [
                  {
                    cle: "marge",
                    entete: t("Marge", "Margin"),
                    alignement: "droite" as const,
                    rendu: (l: ElementClient) =>
                      l.marge
                        ? `${formaterMontantMineur(l.marge.marge, r.devise, langue)} (${formaterPourcentage(l.marge.taux_marge, 1, langue)})`
                        : tiret(t),
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
