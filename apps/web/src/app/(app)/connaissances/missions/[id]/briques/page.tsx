import type { Metadata } from "next";
import { SelectBriqueTache } from "../../../../../../components/connaissances/FormulairesConnaissances";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { droitsConnaissances } from "../../../../../../lib/capitalisation";
import { obtenirT } from "../../../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Briques des tâches", "Task building blocks") };
}

interface Rattachements {
  taches: { tache_id: string; libelle: string; phase: string; brique_code: string | null }[];
  briques: { code: string; libelle: string; etape: string; active: boolean }[];
}

/**
 * Rattachement des tâches d'une mission aux briques de sa méthode (CAP-02) : le temps validé
 * de ces tâches alimente la base d'estimation à la validation du retour d'expérience. Modifiable
 * par le chef ou le directeur de la mission tant qu'elle n'est pas clôturée.
 */
export default async function PageBriquesMission({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await exigerPermission("mission.lire");
  const { id } = await params;
  const t = await obtenirT();
  const r = await chargerServeur<Rattachements>(
    `/api/capitalisation/missions/${encodeURIComponent(id)}/briques`,
  );
  const modifiable = droitsConnaissances(utilisateur.roles).rediger;
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre={t("Briques des tâches", "Task building blocks")}
        soustitre={t(
          "Chaque tâche rattachée à une brique de la méthode nourrit la base d'estimation.",
          "Each task linked to a building block of the method feeds the estimation base.",
        )}
        retour={{ href: `/missions/${id}`, libelle: t("Mission", "Engagement") }}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("Les tâches n'ont pas pu être chargées.", "The tasks could not be loaded.")}
          message={r.message}
          hrefReessayer={`/connaissances/missions/${id}/briques`}
        />
      ) : r.donnees.briques.length === 0 ? (
        <EtatVide
          titre={t(
            "Aucune méthode du référentiel n'est liée à cette mission.",
            "No method from the framework is linked to this engagement.",
          )}
        />
      ) : (
        <Carte>
          {r.donnees.taches.length === 0 ? (
            <EtatVide
              titre={t("La mission n'a pas encore de tâches.", "The engagement has no tasks yet.")}
            />
          ) : (
            <ul className="mp-connaissances__resultats">
              {r.donnees.taches.map((tache) => (
                <li key={tache.tache_id}>
                  {modifiable ? (
                    <SelectBriqueTache
                      missionId={id}
                      tacheId={tache.tache_id}
                      libelleTache={`${tache.phase} · ${tache.libelle}`}
                      valeur={tache.brique_code}
                      briques={r.donnees.briques}
                    />
                  ) : (
                    <p>
                      {tache.phase} · {tache.libelle} :{" "}
                      <code>{tache.brique_code ?? t("aucune brique", "no building block")}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Carte>
      )}
    </div>
  );
}
