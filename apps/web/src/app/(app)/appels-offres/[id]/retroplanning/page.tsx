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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import type { Personne } from "../../../../../lib/personnes";
import { GenererRetroplanningAo } from "./GenererRetroplanningAo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Rétro-planning", "Backward schedule") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rétro-planning de réponse (AO-08) : étapes standard placées à rebours de la date limite par le
 * moteur (compressées si le temps manque), confiées par des tâches assignées (« Mes tâches ») ;
 * alertes calculées à la lecture avant la date limite et pour les étapes en retard.
 */
export default async function PageRetroplanning({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        <EnteteDePage
          titre={t("Rétro-planning", "Backward schedule")}
          retour={{ href: hrefFiche(id), libelle: t("Fiche", "Record") }}
        />
        <EtatErreur
          titre={t(
            "Le rétro-planning n'a pas pu être chargé.",
            "The backward schedule could not be loaded.",
          )}
          message={t("Réessayez dans un instant.", "Try again in a moment.")}
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
        titre={t(`Rétro-planning : ${f.titre}`, `Backward schedule: ${f.titre}`)}
        soustitre={
          f.date_limite
            ? t(
                `Date limite : ${formaterDate(f.date_limite)}`,
                `Deadline: ${formaterDate(f.date_limite, "UTC", langue)}`,
              )
            : t("Date limite non renseignée", "Deadline not set")
        }
        retour={{ href: hrefFiche(id), libelle: t("Fiche", "Record") }}
        badges={
          <BadgeStatut tonalite={tonaliteStatutAo(f.statut)}>
            {libelleStatutAo(f.statut, langue)}
          </BadgeStatut>
        }
      />

      {alertes.length > 0 ? (
        <Carte titre={t("Alertes", "Alerts")}>
          <ul className="mp-liste-lignes">
            {alertes.map((a, i) => (
              <li key={i} className="mp-liste-lignes__ligne">
                <span>{texteAlerte(a, langue)}</span>
                <BadgeStatut tonalite={tonaliteAlerte(a.joursRestants)}>
                  {a.joursRestants < 0 ? t("En retard", "Late") : `J-${a.joursRestants}`}
                </BadgeStatut>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {etapes.length === 0 ? (
        <EtatVide titre={t("Aucun rétro-planning.", "No backward schedule.")} icone="calendrier">
          <p>
            {f.date_limite
              ? t(
                  "Les étapes standard se placent à rebours de la date limite.",
                  "The standard steps are placed backward from the deadline.",
                )
              : t(
                  "Renseignez d'abord la date limite sur la fiche.",
                  "Set the deadline on the record first.",
                )}
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
                  {t(
                    `Prévue le ${formaterDate(e.date_prevue)}`,
                    `Due ${formaterDate(e.date_prevue, "UTC", langue)}`,
                  )}
                  {e.responsable_nom ? ` · ${e.responsable_nom}` : ""}
                  {e.tache_id
                    ? t(
                        ` · tâche confiée à ${e.tache_assignee_nom ?? "un collègue"}`,
                        ` · task assigned to ${e.tache_assignee_nom ?? "a colleague"}`,
                      )
                    : ""}
                </span>
                {modifiable ? (
                  <ActionsEtapeAo etape={e} personnes={personnes} peutAssigner={droits.assigner} />
                ) : null}
              </div>
              <BadgeStatut tonalite={e.faite ? "succes" : "neutre"}>
                {e.faite ? t("Faite", "Done") : t("À faire", "To do")}
              </BadgeStatut>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
