import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { hrefMissionMethode, lireCurseur } from "../../../../lib/methodes";
import { libelleStatutMission, STATUT_MISSION, type PageMissions } from "../../../../lib/missions";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Méthode des missions", "Engagement methods") };
}

const hrefPage = (curseur?: string | null) =>
  curseur ? `/methodes/missions?curseur=${encodeURIComponent(curseur)}` : "/methodes/missions";

/** Missions visibles : accès à la méthode figée de chacune (STD-08). */
export default async function PageMissionsMethodes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("mission.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageMissions>(
    `/api/missions?limite=50${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`,
  );
  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Méthode des missions", "Engagement methods")}
        soustitre={t(
          "Chaque mission est figée sur une version de méthode, modulée par son contexte et ses dérogations.",
          "Each engagement is locked to a method version, modulated by its context and its waivers.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les missions n'ont pas pu être chargées.",
            "The engagements could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage(curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={t("Aucune mission visible.", "No visible engagement.")} icone="dossier">
          <p>
            {t(
              "Les missions auxquelles vous avez accès apparaîtront ici, avec la version de méthode à laquelle chacune est figée.",
              "The engagements you can access will appear here, with the method version each one is locked to.",
            )}
          </p>
        </EtatVide>
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
                {libelleStatutMission(m.statut, langue)}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          libelle={t("Pages des missions", "Engagement pages")}
          hrefSuivante={r.donnees.suivant ? hrefPage(r.donnees.suivant) : null}
          hrefDebut={curseur ? hrefPage() : null}
        />
      ) : null}
    </div>
  );
}
