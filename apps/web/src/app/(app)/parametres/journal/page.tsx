import type { Metadata } from "next";
import { classesBouton } from "../../../../components/ui/Bouton";
import { Champ } from "../../../../components/ui/Champ";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { exigerPermission } from "../../../../lib/session";
import {
  ACTION_LIBELLES,
  ENTITE_LIBELLES,
  libelleAction,
  libelleEntite,
  lignesDetails,
  lireFiltresAudit,
  requete,
  type EntreeAudit,
  type Utilisateur,
} from "../../../../lib/utilisateurs";

export const metadata: Metadata = { title: "Journal d'audit" };

const options = (table: Record<string, string>) =>
  Object.entries(table).map(([valeur, libelle]) => ({ valeur, libelle }));

export default async function PageJournal({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("audit.lire");
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
        titre="Journal d'audit"
        soustitre="Toutes les créations, modifications et suppressions du cabinet, de la plus récente à la plus ancienne."
      />

      <form
        method="get"
        action="/parametres/journal"
        className="mp-filtres"
        role="search"
        aria-label="Filtrer le journal"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Élément concerné"
            name="entite"
            invite="Tous"
            options={options(ENTITE_LIBELLES)}
            defaultValue={filtres.entite ?? ""}
          />
          <Select
            libelle="Action"
            name="action"
            invite="Toutes"
            options={options(ACTION_LIBELLES)}
            defaultValue={filtres.action ?? ""}
          />
          <Select
            libelle="Auteur"
            name="utilisateur_id"
            invite="Tous"
            options={optionsUtilisateurs}
            defaultValue={filtres.utilisateur_id ?? ""}
          />
          <Champ libelle="Du" type="date" name="du" defaultValue={filtres.du ?? ""} />
          <Champ libelle="Au" type="date" name="au" defaultValue={filtres.au ?? ""} />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            Filtrer
          </button>
          <a href="/parametres/journal" className={classesBouton("discret")}>
            Effacer les filtres
          </a>
        </div>
      </form>

      {!journal.ok ? (
        <EtatErreur
          titre="Le journal d'audit n'a pas pu être chargé."
          message={journal.message}
          hrefReessayer={ici}
        />
      ) : journal.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune entrée ne correspond à ces filtres.">
          <p>Élargissez la période ou effacez les filtres.</p>
        </EtatVide>
      ) : (
        <ol className="mp-journal" aria-label="Entrées du journal">
          {journal.donnees.elements.map((e) => {
            const lignes = lignesDetails(e.details);
            return (
              <li key={e.id} className="mp-journal__entree">
                <p className="mp-journal__titre">
                  <strong>{libelleAction(e.action)}</strong> · {libelleEntite(e.entite)}
                </p>
                <p className="mp-texte-doux">
                  {formaterDateHeure(e.cree_le)} · par {e.utilisateur_nom ?? "système"}
                </p>
                {lignes.length > 0 ? (
                  <details className="mp-journal__details">
                    <summary>Voir le détail</summary>
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
          libelle="Pagination du journal"
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
