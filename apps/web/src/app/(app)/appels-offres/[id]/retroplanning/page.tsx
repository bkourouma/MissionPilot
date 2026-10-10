import { notFound } from "next/navigation";
import type { Metadata } from "next";
import "../../../../../components/appels-offres/appels-offres.css";
import { ActionsEtapeAo } from "../../../../../components/appels-offres/ActionsAo";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  droitsAppelsOffres,
  estOuverte,
  hrefFiche,
  CHEMIN_PERSONNES_ASSIGNABLES,
  hrefRetroplanning,
  libelleStatutAo,
  texteAlerte,
  tonaliteAlerte,
  tonaliteStatutAo,
  type FicheDetail,
  type RetroplanningAo,
} from "../../../../../lib/appels-offres";
import { exigerLectureAo } from "../../../../../lib/appels-offres-serveur";
import { formaterDate } from "../../../../../lib/format";
import type { Personne } from "../../../../../lib/personnes";
import { GenererRetroplanningAo } from "./GenererRetroplanningAo";

export const metadata: Metadata = { title: "Rétro-planning" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rétro-planning de réponse (AO-08) : étapes standard placées à rebours de la date limite par le
 * moteur (compressées si le temps manque), confiées par des tâches assignées (« Mes tâches ») ;
 * alertes calculées à la lecture avant la date limite et pour les étapes en retard.
 */
export default async function PageRetroplanning({ params }: { params: Promise<{ id: string }> }) {
  const session = await exigerLectureAo();
  const roles = session.utilisateur.roles;
  const droits = droitsAppelsOffres(roles);
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [fiche, plan] = await Promise.all([
    chargerServeur<FicheDetail>(`/api/appels-offres/${id}`),
    chargerServeur<RetroplanningAo>(`/api/appels-offres/${id}/retroplanning`),
  ]);
  if (!fiche.ok && fiche.statut === 404) notFound();
  if (!fiche.ok || !plan.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Rétro-planning" retour={{ href: hrefFiche(id), libelle: "Fiche" }} />
        <EtatErreur
          titre="Le rétro-planning n'a pas pu être chargé."
          message="Réessayez dans un instant."
          hrefReessayer={hrefRetroplanning(id)}
        />
      </div>
    );
  }
  const f = fiche.donnees;
  const { etapes, alertes } = plan.donnees;
  const modifiable = droits.gerer && estOuverte(f.statut);
  let personnes: Personne[] = [];
  if (modifiable && droits.assigner) {
    // Liste dédiée de l'API : utilisateurs actifs qui ont `ao.lire` (l'API refuse les autres), sans
    // dépendre du droit de lire les collaborateurs ni de la pagination de leur référentiel.
    const c = await chargerServeur<{ elements: Personne[] }>(CHEMIN_PERSONNES_ASSIGNABLES);
    if (c.ok) personnes = c.donnees.elements;
  }

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`Rétro-planning : ${f.titre}`}
        soustitre={
          f.date_limite
            ? `Date limite : ${formaterDate(f.date_limite)}`
            : "Date limite non renseignée"
        }
        retour={{ href: hrefFiche(id), libelle: "Fiche" }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut)}
          </BadgeStatut>
        }
      />

      {alertes.length > 0 ? (
        <Carte titre="Alertes">
          <ul className="mp-liste-lignes">
            {alertes.map((a, i) => (
              <li key={i} className="mp-liste-lignes__ligne">
                <span>{texteAlerte(a)}</span>
                <BadgeStatut tonalite={tonaliteAlerte(a.joursRestants)}>
                  {a.joursRestants < 0 ? "En retard" : `J-${a.joursRestants}`}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {etapes.length === 0 ? (
        <EtatVide titre="Aucun rétro-planning." icone="calendrier">
          <p>
            {f.date_limite
              ? "Les étapes standard se placent à rebours de la date limite."
              : "Renseignez d'abord la date limite sur la fiche."}
          </p>
          {modifiable && f.date_limite ? <GenererRetroplanningAo id={f.id} /> : null}
        </EtatVide>
      ) : (
        <ol className="mp-liste-lignes">
          {etapes.map((e) => (
            <li key={e.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <span>
                  {e.ordre}. {e.libelle}
                </span>
                <span className="mp-texte-doux mp-texte-petit">
                  Prévue le {formaterDate(e.date_prevue)}
                  {e.responsable_nom ? ` · ${e.responsable_nom}` : ""}
                  {e.tache_id ? ` · tâche confiée à ${e.tache_assignee_nom ?? "un collègue"}` : ""}
                </span>
                {modifiable ? (
                  <ActionsEtapeAo etape={e} personnes={personnes} peutAssigner={droits.assigner} />
                ) : null}
              </div>
              <BadgeStatut tonalite={e.faite ? "succes" : "neutre"}>
                {e.faite ? "Faite" : "À faire"}
              </BadgeStatut>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
