import type { Metadata } from "next";
import type { EnvoiCanalApi } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { Select } from "../../../../../components/ui/Select";
import { Tableau } from "../../../../../components/ui/Tableau";
import {
  CHEMIN_CANAUX_JOURNAL,
  dateHeureCourte,
  hrefJournal,
  libelleCanal,
  libelleGabarit,
  libelleStatutEnvoi,
  lireParametresJournal,
  objetLie,
  optionsObjetEnvoi,
  optionsStatutEnvoi,
  precisionEnvoi,
  requeteJournal,
  tonaliteStatutEnvoi,
} from "../../../../../lib/canaux";
import { chargerPageCanaux } from "../../../../../lib/canaux-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Journal des envois", "Send log") };
}

/**
 * Journal des envois simulés : date, canal, gabarit, destinataire, statut, motif de blocage et
 * objet lié. AUCUN contenu de message, aucun numéro : le journal est sans contenu par conception.
 */
export default async function PageJournalCanaux({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("canaux.lire");
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const params = lireParametresJournal(await searchParams);
  const r = await chargerPageCanaux<EnvoiCanalApi>(requeteJournal(params));
  const filtre = Boolean(params.statut || params.objet_type || params.destinataire_id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Journal des envois", "Send log")}
        soustitre={t(
          "Chaque message préparé par CabinetPilot, avec son issue. Le journal ne garde ni le texte des messages ni les numéros.",
          "Each message prepared by CabinetPilot, with its outcome. The log keeps neither the message text nor the numbers.",
        )}
      />
      <form
        method="get"
        action={CHEMIN_CANAUX_JOURNAL}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer le journal des envois", "Filter the send log")}
      >
        {params.destinataire_id ? (
          <input type="hidden" name="destinataire_id" value={params.destinataire_id} />
        ) : null}
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Statut", "Status")}
            name="statut"
            defaultValue={params.statut ?? ""}
            invite={t("Tous les statuts", "All statuses")}
            options={optionsStatutEnvoi(langue)}
          />
          <Select
            libelle={t("Objet lié", "Linked item")}
            name="objet_type"
            defaultValue={params.objet_type ?? ""}
            invite={t("Tous les objets", "All items")}
            options={optionsObjetEnvoi(langue)}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
          {filtre ? (
            <a href={CHEMIN_CANAUX_JOURNAL} className={classesBouton("secondaire")}>
              {t("Effacer les filtres", "Clear filters")}
            </a>
          ) : null}
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          titre={t("Le journal n'a pas pu être chargé.", "The log could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefJournal(params, params.curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre
              ? t("Aucun envoi ne correspond à ces filtres.", "No send matches these filters.")
              : t("Aucun envoi pour le moment.", "No sends yet.")
          }
          icone="bulle"
        >
          <p>
            {t(
              "Les envois (vérifications de numéro, relances, synthèses, signatures) apparaissent ici dès que le cabinet active un canal.",
              "Sends (number verifications, reminders, summaries, signatures) appear here as soon as the firm enables a channel.",
            )}
          </p>
        </EtatVide>
      ) : (
        <Tableau<EnvoiCanalApi>
          legende={t("Journal des envois", "Send log")}
          legendeVisible
          cleLigne={(e) => e.id}
          colonnes={[
            { cle: "date", entete: "Date", rendu: (e) => dateHeureCourte(e.cree_le, langue) },
            {
              cle: "canal",
              entete: t("Canal", "Channel"),
              rendu: (e) => libelleCanal(e.canal, langue),
            },
            { cle: "gabarit", entete: "Message", rendu: (e) => libelleGabarit(e.gabarit, langue) },
            {
              cle: "destinataire",
              entete: t("Destinataire", "Recipient"),
              rendu: (e) => e.destinataire_nom,
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (e) => (
                <span>
                  <BadgeStatut tonalite={tonaliteStatutEnvoi(e.statut)}>
                    {libelleStatutEnvoi(e.statut, langue)}
                  </BadgeStatut>
                  {precisionEnvoi(e, langue) ? (
                    <>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">
                        {precisionEnvoi(e, langue)}
                      </span>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              cle: "objet",
              entete: t("Objet lié", "Linked item"),
              rendu: (e) => objetLie(e, langue),
            },
          ]}
          lignes={r.donnees.elements}
        />
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={r.donnees.suivant ? hrefJournal(params, r.donnees.suivant) : null}
          hrefDebut={params.curseur ? hrefJournal(params) : null}
          libelle={t("Pages du journal des envois", "Send log pages")}
        />
      ) : null}
    </div>
  );
}
