import type { Metadata } from "next";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";
import {
  actionLibelles,
  entiteLibelles,
  libelleAction,
  libelleEntite,
  lignesDetails,
  lireFiltresAudit,
  requete,
  type EntreeAudit,
  type Utilisateur,
} from "../../../../lib/utilisateurs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Journal d'audit", "Audit log") };
}

const options = (table: Record<string, string>) =>
  Object.entries(table).map(([valeur, libelle]) => ({ valeur, libelle }));

export default async function PageJournal({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("audit.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const filtres = lireFiltresAudit(await searchParams);
  const { curseur, ...sansCurseur } = filtres;
  const [journal, utilisateurs] = await Promise.all([
    chargerServeur<{ elements: EntreeAudit[]; curseur_suivant: string | null }>(
      `/api/audit${requete({ ...filtres, limite: "30" })}`,
    ),
    chargerServeur<{ elements: Utilisateur[] }>("/api/utilisateurs"),
  ]);
  const optionsUtilisateurs = utilisateurs.ok
    ? utilisateurs.donnees.elements.map((u) => ({ valeur: u.id, libelle: u.nom }))
    : [];
  const ici = `/parametres/journal${requete(filtres)}`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Journal d'audit", "Audit log")}
        soustitre={t(
          "Toutes les créations, modifications et suppressions du cabinet, de la plus récente à la plus ancienne.",
          "All creations, updates and deletions in the firm, from most recent to oldest.",
        )}
      />

      <form
        method="get"
        action="/parametres/journal"
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer le journal", "Filter the log")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Élément concerné", "Item concerned")}
            name="entite"
            invite={t("Tous", "All")}
            options={options(entiteLibelles(langue))}
            defaultValue={filtres.entite ?? ""}
          />
          <Select
            libelle={t("Action", "Action")}
            name="action"
            invite={t("Toutes", "All")}
            options={options(actionLibelles(langue))}
            defaultValue={filtres.action ?? ""}
          />
          <Select
            libelle={t("Auteur", "Author")}
            name="utilisateur_id"
            invite={t("Tous", "All")}
            options={optionsUtilisateurs}
            defaultValue={filtres.utilisateur_id ?? ""}
          />
          <Champ libelle={t("Du", "From")} type="date" name="du" defaultValue={filtres.du ?? ""} />
          <Champ libelle={t("Au", "To")} type="date" name="au" defaultValue={filtres.au ?? ""} />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            {t("Filtrer", "Filter")}
          </button>
          <a href="/parametres/journal" className={classesBouton("discret")}>
            {t("Effacer les filtres", "Clear filters")}
          </a>
        </div>
      </form>

      {!journal.ok ? (
        <EtatErreur
          titre={t(
            "Le journal d'audit n'a pas pu être chargé.",
            "The audit log could not be loaded.",
          )}
          message={journal.message}
          hrefReessayer={ici}
        />
      ) : journal.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucune entrée ne correspond à ces filtres.", "No entry matches these filters.")}
        >
          <p>
            {t(
              "Élargissez la période ou effacez les filtres.",
              "Widen the period or clear the filters.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ol className="mp-journal" aria-label={t("Entrées du journal", "Log entries")}>
          {journal.donnees.elements.map((e) => {
            const lignes = lignesDetails(e.details, langue);
            return (
              <li key={e.id} className="mp-journal__entree">
                <p className="mp-journal__titre">
                  <strong>{libelleAction(e.action, langue)}</strong> ·{" "}
                  {libelleEntite(e.entite, langue)}
                </p>
                <p className="mp-texte-doux">
                  {formaterDateHeure(e.cree_le, "Africa/Abidjan", langue)} · {t("par", "by")}{" "}
                  {e.utilisateur_nom ?? t("système", "system")}
                </p>
                {lignes.length > 0 ? (
                  <details className="mp-journal__details">
                    <summary>{t("Voir le détail", "View details")}</summary>
                    <ul>
                      {lignes.map((l, i) => (
                        <li key={i} className="mp-coupure">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {journal.ok ? (
        <PaginationCurseur
          libelle={t("Pagination du journal", "Log pagination")}
          hrefDebut={curseur ? `/parametres/journal${requete(sansCurseur)}` : null}
          hrefSuivante={
            journal.donnees.curseur_suivant
              ? `/parametres/journal${requete({ ...sansCurseur, curseur: String(journal.donnees.curseur_suivant) })}`
              : null
          }
        />
      ) : null}
    </div>
  );
}
