import type { Metadata } from "next";
import { SelectBriqueTache } from "../../../../../../components/connaissances/FormulairesConnaissances";
import { Carte } from "../../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { droitsConnaissances } from "../../../../../../lib/capitalisation";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Briques des tâches" };

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
  const r = await chargerServeur<Rattachements>(
    `/api/capitalisation/missions/${encodeURIComponent(id)}/briques`,
  );
  const modifiable = droitsConnaissances(utilisateur.roles).rediger;
  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Briques des tâches"
        soustitre="Chaque tâche rattachée à une brique de la méthode nourrit la base d'estimation."
        retour={{ href: `/missions/${id}`, libelle: "Mission" }}
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les tâches n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={`/connaissances/missions/${id}/briques`}
        />
      ) : r.donnees.briques.length === 0 ? (
        <EtatVide titre="Aucune méthode du référentiel n'est liée à cette mission." />
      ) : (
        <Carte>
          {r.donnees.taches.length === 0 ? (
            <EtatVide titre="La mission n'a pas encore de tâches." />
          ) : (
            <ul className="mp-connaissances__resultats">
              {r.donnees.taches.map((t) => (
                <li key={t.tache_id}>
                  {modifiable ? (
                    <SelectBriqueTache
                      missionId={id}
                      tacheId={t.tache_id}
                      libelleTache={`${t.phase} · ${t.libelle}`}
                      valeur={t.brique_code}
                      briques={r.donnees.briques}
                    />
                  ) : (
                    <p>
                      {t.phase} · {t.libelle} : <code>{t.brique_code ?? "aucune brique"}</code>
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
