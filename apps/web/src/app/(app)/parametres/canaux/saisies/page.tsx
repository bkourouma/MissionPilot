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
  libelleVraisemblance,
  lireParametresSaisies,
  OPTIONS_STATUT_SAISIE,
  requeteSaisies,
  tonaliteStatutSaisie,
  tonaliteVraisemblance,
} from "../../../../../lib/canaux";
import { chargerPageCanaux } from "../../../../../lib/canaux-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Saisies reçues par message" };

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
  const params = lireParametresSaisies(await searchParams);
  const r = await chargerPageCanaux<SaisieKpiApi>(requeteSaisies(params));

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Saisies reçues par message"
        soustitre="Une personne a envoyé une valeur d'indicateur et l'a confirmée par OUI. Vérifiez-la, puis reprenez-la dans le KPI ou rejetez-la."
      />
      <form
        method="get"
        action={CHEMIN_CANAUX_SAISIES}
        className="mp-filtres"
        role="search"
        aria-label="Filtrer les saisies reçues"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Statut"
            name="statut"
            defaultValue={params.statut}
            options={OPTIONS_STATUT_SAISIE}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>Filtrer</span>
          </button>
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          titre="Les saisies n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefSaisies(params, params.curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune saisie dans cet état." icone="courbe">
          <p>
            Les saisies apparaissent ici quand une personne désignée sur un indicateur envoie sa
            valeur par message, une fois l&apos;option activée sur le compte WhatsApp.
          </p>
        </EtatVide>
      ) : (
        <Tableau<SaisieKpiApi>
          legende="Saisies reçues par message"
          legendeVisible
          cleLigne={(s) => s.id}
          colonnes={[
            { cle: "kpi", entete: "Indicateur", rendu: (s) => s.kpi_libelle },
            {
              cle: "valeur",
              entete: "Valeur",
              alignement: "droite",
              rendu: (s) => formaterValeurSaisie(s.valeur),
            },
            { cle: "date", entete: "Date de mesure", rendu: (s) => dateJourCourte(s.date_mesure) },
            {
              cle: "vraisemblance",
              entete: "Vraisemblance",
              rendu: (s) => (
                <span>
                  <BadgeStatut tonalite={tonaliteVraisemblance(s.vraisemblance)}>
                    {libelleVraisemblance(s.vraisemblance)}
                  </BadgeStatut>
                  {s.motif_vraisemblance ? (
                    <>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">{s.motif_vraisemblance}</span>
                    </>
                  ) : null}
                </span>
              ),
            },
            { cle: "origine", entete: "Origine", rendu: (s) => libelleOrigineSaisie(s.origine) },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (s) => (
                <span>
                  <BadgeStatut tonalite={tonaliteStatutSaisie(s.statut)}>
                    {libelleStatutSaisie(s.statut)}
                  </BadgeStatut>
                  <br />
                  <span className="mp-texte-doux mp-texte-petit">{dateHeureCourte(s.cree_le)}</span>
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
          libelle="Pages des saisies reçues"
        />
      ) : null}
    </div>
  );
}
