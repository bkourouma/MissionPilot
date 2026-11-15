import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { optionsPersonnes } from "../../../../lib/personnes";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";
import { obtenirSession } from "../../../../lib/session";
import { actionsTache, type TacheCollaboration } from "../../../../lib/taches-collaboration";
import { CarteTache } from "../CarteTache";
import { EditionTache } from "./EditionTache";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "Task" : "Tâche" };
}

/** Fiche d'une tâche assignée : visible de son créateur et de la personne assignée seulement. */
export default async function PageTache({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const tr = (fr: string, en: string) => (langue === "en" ? en : fr);
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSession();
  const r = await chargerServeur<TacheCollaboration>(`/api/taches-collaboration/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/mes-taches", libelle: tr("Mes tâches", "My tasks") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={tr("Tâche", "Task")} retour={retour} />
        <EtatErreur
          titre={tr("La tâche n'a pas pu être chargée.", "The task could not be loaded.")}
          message={r.message}
          hrefReessayer={`/mes-taches/${id}`}
        />
      </div>
    );
  }
  const t = r.donnees;
  const a = actionsTache(t, utilisateur.id, utilisateur.roles);
  const personnes = a.modifier ? optionsPersonnes(await chargerPersonnes(utilisateur.roles)) : [];
  const creee = (await searchParams).creee === "1";

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage titre={t.titre} retour={retour} />
      {creee ? (
        <Alerte tonalite="succes" annonce="status">
          <p>
            {t.assignee_id === utilisateur.id
              ? tr("Tâche créée.", "Task created.")
              : tr(
                  `Tâche créée et assignée à ${t.assignee_nom}, qui en est notifié.`,
                  `Task created and assigned to ${t.assignee_nom}, who has been notified.`,
                )}
          </p>
        </Alerte>
      ) : null}
      <ul className="mp-taches" aria-label={tr("Tâche", "Task")}>
        <CarteTache tache={t} utilisateurId={utilisateur.id} roles={utilisateur.roles} />
      </ul>
      <Carte titre="Description" niveauTitre={2}>
        {t.description ? (
          <p className="mp-texte-preserve mp-coupure">{t.description}</p>
        ) : (
          <p className="mp-texte-doux">{tr("Aucune description.", "No description.")}</p>
        )}
        <p className="mp-texte-doux mp-texte-petit">
          {tr(
            `Créée le ${formaterDateHeure(t.cree_le)} · dernière modification le ${formaterDateHeure(t.modifie_le)}`,
            `Created on ${formaterDateHeure(t.cree_le, undefined, langue)} · last modified on ${formaterDateHeure(t.modifie_le, undefined, langue)}`,
          )}
        </p>
      </Carte>
      {a.modifier ? <EditionTache tache={t} personnes={personnes} /> : null}
    </div>
  );
}
