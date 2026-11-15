import type { Metadata } from "next";
import type { SaisieKpiApi } from "@missionpilot/shared";
import { ActionsSaisieKpi } from "../../../../../components/canaux/ActionsSaisieKpi";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { Tableau } from "../../../../../components/ui/Tableau";
import {
  CHEMIN_CANAUX_SAISIES,
  dateHeureCourte,
  dateJourCourte,
  formaterValeurSaisie,
  hrefSaisies,
  libelleOrigineSaisie,
  libelleStatutSaisie,
  libelleMotifVraisemblance,
  libelleVraisemblance,
  lireParametresSaisies,
  optionsStatutSaisie,
  requeteSaisies,
  tonaliteStatutSaisie,
  tonaliteVraisemblance,
} from "../../../../../lib/canaux";
import { chargerPageCanaux } from "../../../../../lib/canaux-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Saisies reçues par message", "Entries received by message") };
}

/**
 * Propositions de saisie de KPI reçues par message (KPI-14) : valeur confirmée par la personne,
 * contrôle de vraisemblance, reprise par un utilisateur du cabinet. Aucune mesure n'est écrite par
 * le message lui-même.
 */
export default async function PageSaisiesCanaux({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("kpi.saisir");
  await exigerPermission("canaux.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const params = lireParametresSaisies(await searchParams);
  const r = await chargerPageCanaux<SaisieKpiApi>(requeteSaisies(params));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Saisies reçues par message", "Entries received by message")}
        soustitre={t(
          "Une personne a envoyé une valeur d'indicateur et l'a confirmée par OUI. Vérifiez-la, puis reprenez-la dans le KPI ou rejetez-la.",
          "A person sent a KPI value and confirmed it with YES. Check it, then take it up into the KPI or reject it.",
        )}
      />
      <form
        method="get"
        action={CHEMIN_CANAUX_SAISIES}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les saisies reçues", "Filter the entries received")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Statut", "Status")}
            name="statut"
            defaultValue={params.statut}
            options={optionsStatutSaisie(langue)}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          titre={t("Les saisies n'ont pas pu être chargées.", "The entries could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefSaisies(params, params.curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucune saisie dans cet état.", "No entry in this state.")}
          icone="courbe"
        >
          <p>
            {t(
              "Les saisies apparaissent ici quand une personne désignée sur un indicateur envoie sa valeur par message, une fois l'option activée sur le compte WhatsApp.",
              "Entries appear here when a person assigned to a KPI sends their value by message, once the option is enabled on the WhatsApp account.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau<SaisieKpiApi>
          legende={t("Saisies reçues par message", "Entries received by message")}
          legendeVisible
          cleLigne={(s) => s.id}
          colonnes={[
            { cle: "kpi", entete: t("Indicateur", "KPI"), rendu: (s) => s.kpi_libelle },
            {
              cle: "valeur",
              entete: t("Valeur", "Value"),
              alignement: "droite",
              rendu: (s) => formaterValeurSaisie(s.valeur, langue),
            },
            {
              cle: "date",
              entete: t("Date de mesure", "Measurement date"),
              rendu: (s) => dateJourCourte(s.date_mesure),
            },
            {
              cle: "vraisemblance",
              entete: t("Vraisemblance", "Plausibility"),
              rendu: (s) => (
                <span>
                  <BadgeStatut tonalite={tonaliteVraisemblance(s.vraisemblance)}>
                    {libelleVraisemblance(s.vraisemblance, langue)}
                  </BadgeStatut>
                  {s.motif_vraisemblance ? (
                    <>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">
                        {libelleMotifVraisemblance(s.motif_vraisemblance, langue)}
                      </span>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              cle: "origine",
              entete: t("Origine", "Origin"),
              rendu: (s) => libelleOrigineSaisie(s.origine, langue),
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (s) => (
                <span>
                  <BadgeStatut tonalite={tonaliteStatutSaisie(s.statut)}>
                    {libelleStatutSaisie(s.statut, langue)}
                  </BadgeStatut>
                  <br />
                  <span className="mp-texte-doux mp-texte-petit">
                    {dateHeureCourte(s.cree_le, langue)}
                  </span>
                </span>
              ),
            },
            {
              cle: "actions",
              entete: "Actions",
              rendu: (s) => <ActionsSaisieKpi saisie={s} />,
            },
          ]}
          lignes={r.donnees.elements}
        />
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={r.donnees.suivant ? hrefSaisies(params, r.donnees.suivant) : null}
          hrefDebut={params.curseur ? hrefSaisies(params) : null}
          libelle={t("Pages des saisies reçues", "Entries received pages")}
        />
      ) : null}
    </div>
  );
}
