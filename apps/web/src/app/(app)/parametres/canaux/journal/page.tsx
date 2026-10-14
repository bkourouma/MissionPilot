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
  OPTIONS_OBJET_ENVOI,
  OPTIONS_STATUT_ENVOI,
  precisionEnvoi,
  requeteJournal,
  tonaliteStatutEnvoi,
} from "../../../../../lib/canaux";
import { chargerPageCanaux } from "../../../../../lib/canaux-serveur";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Journal des envois" };

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
  const params = lireParametresJournal(await searchParams);
  const r = await chargerPageCanaux<EnvoiCanalApi>(requeteJournal(params));
  const filtre = Boolean(params.statut || params.objet_type || params.destinataire_id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Journal des envois"
        soustitre="Chaque message préparé par MissionPilot, avec son issue. Le journal ne garde ni le texte des messages ni les numéros."
      />
      <form
        method="get"
        action={CHEMIN_CANAUX_JOURNAL}
        className="mp-filtres"
        role="search"
        aria-label="Filtrer le journal des envois"
      >
        {params.destinataire_id ? (
          <input type="hidden" name="destinataire_id" value={params.destinataire_id} />
        ) : null}
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Statut"
            name="statut"
            defaultValue={params.statut ?? ""}
            invite="Tous les statuts"
            options={OPTIONS_STATUT_ENVOI}
          />
          <Select
            libelle="Objet lié"
            name="objet_type"
            defaultValue={params.objet_type ?? ""}
            invite="Tous les objets"
            options={OPTIONS_OBJET_ENVOI}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="recherche" />
            <span>Filtrer</span>
          </button>
          {filtre ? (
            <a href={CHEMIN_CANAUX_JOURNAL} className={classesBouton("secondaire")}>
              Effacer les filtres
            </a>
          ) : null}
        </div>
      </form>
      {!r.ok ? (
        <EtatErreur
          titre="Le journal n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefJournal(params, params.curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtre ? "Aucun envoi ne correspond à ces filtres." : "Aucun envoi pour le moment."
          }
          icone="bulle"
        >
          <p>
            Les envois (vérifications de numéro, relances, synthèses, signatures) apparaissent ici
            dès que le cabinet active un canal.
          </p>
        </EtatVide>
      ) : (
        <Tableau<EnvoiCanalApi>
          legende="Journal des envois"
          legendeVisible
          cleLigne={(e) => e.id}
          colonnes={[
            { cle: "date", entete: "Date", rendu: (e) => dateHeureCourte(e.cree_le) },
            { cle: "canal", entete: "Canal", rendu: (e) => libelleCanal(e.canal) },
            { cle: "gabarit", entete: "Message", rendu: (e) => libelleGabarit(e.gabarit) },
            { cle: "destinataire", entete: "Destinataire", rendu: (e) => e.destinataire_nom },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (e) => (
                <span>
                  <BadgeStatut tonalite={tonaliteStatutEnvoi(e.statut)}>
                    {libelleStatutEnvoi(e.statut)}
                  </BadgeStatut>
                  {precisionEnvoi(e) ? (
                    <>
                      <br />
                      <span className="mp-texte-doux mp-texte-petit">{precisionEnvoi(e)}</span>
                    </>
                  ) : null}
                </span>
              ),
            },
            { cle: "objet", entete: "Objet lié", rendu: (e) => objetLie(e) },
          ]}
          lignes={r.donnees.elements}
        />
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={r.donnees.suivant ? hrefJournal(params, r.donnees.suivant) : null}
          hrefDebut={params.curseur ? hrefJournal(params) : null}
          libelle="Pages du journal des envois"
        />
      ) : null}
    </div>
  );
}
