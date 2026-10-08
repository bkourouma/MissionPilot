import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import { optionsPersonnes } from "../../../../lib/personnes";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";
import { obtenirSession } from "../../../../lib/session";
import { actionsTache, type TacheCollaboration } from "../../../../lib/taches-collaboration";
import { CarteTache } from "../CarteTache";
import { EditionTache } from "./EditionTache";

export const metadata: Metadata = { title: "Tâche" };

/** Fiche d'une tâche assignée : visible de son créateur et de la personne assignée seulement. */
export default async function PageTache({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await obtenirSession();
  const r = await chargerServeur<TacheCollaboration>(`/api/taches-collaboration/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/mes-taches", libelle: "Mes tâches" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Tâche" retour={retour} />
        <EtatErreur
          titre="La tâche n'a pas pu être chargée."
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
              ? "Tâche créée."
              : `Tâche créée et assignée à ${t.assignee_nom}, qui en est notifié.`}
          </p>
        </Alerte>
      ) : null}
      <ul className="mp-taches" aria-label="Tâche">
        <CarteTache tache={t} utilisateurId={utilisateur.id} roles={utilisateur.roles} />
      </ul>
      <Carte titre="Description" niveauTitre={2}>
        {t.description ? (
          <p className="mp-texte-preserve mp-coupure">{t.description}</p>
        ) : (
          <p className="mp-texte-doux">Aucune description.</p>
        )}
        <p className="mp-texte-doux mp-texte-petit">
          {`Créée le ${formaterDateHeure(t.cree_le)} · dernière modification le ${formaterDateHeure(t.modifie_le)}`}
        </p>
      </Carte>
      {a.modifier ? <EditionTache tache={t} personnes={personnes} /> : null}
    </div>
  );
}
