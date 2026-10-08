import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { hrefMissionMethode, lireCurseur } from "../../../../lib/methodes";
import { STATUT_MISSION, type PageMissions } from "../../../../lib/missions";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Méthode des missions" };

const hrefPage = (curseur?: string | null) =>
  curseur ? `/methodes/missions?curseur=${encodeURIComponent(curseur)}` : "/methodes/missions";

/** Missions visibles : accès à la méthode figée de chacune (STD-08). */
export default async function PageMissionsMethodes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("mission.lire");
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageMissions>(
    `/api/missions?limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Méthode des missions"
        soustitre="Chaque mission est figée sur une version de méthode, modulée par son contexte et ses dérogations."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les missions n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefPage(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucune mission visible." icone="dossier" />
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((m) => (
            <li key={m.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefMissionMethode(m.id)} className="mp-lien-ligne">
                  {m.intitule}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">{m.client_raison_sociale}</span>
              </div>
              <BadgeStatut tonalite={STATUT_MISSION[m.statut].tonalite}>
                {STATUT_MISSION[m.statut].libelle}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          libelle="Pages des missions"
          hrefSuivante={r.donnees.suivant ? hrefPage(r.donnees.suivant) : null}
          hrefDebut={curseur ? hrefPage() : null}
        />
      ) : null}
    </div>
  );
}
