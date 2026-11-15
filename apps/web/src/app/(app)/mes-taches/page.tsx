import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { SegmentsStatut } from "../../../components/facturation/SegmentsStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirLangue } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";
import {
  hrefTaches,
  lireFiltresTaches,
  libelleStatutTache,
  optionsStatutsTache,
  requeteTaches,
  type PageTaches,
} from "../../../lib/taches-collaboration";
import { CarteTache } from "./CarteTache";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "My tasks" : "Mes tâches" };
}

/**
 * « Mes tâches » (SOC-08) : tâches qui me sont assignées ou que j'ai créées, ouvertes d'abord
 * puis par échéance. Filtres et page dans l'URL (partage, retour, rechargement après coupure).
 */
export default async function PageMesTaches({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const { utilisateur } = await obtenirSession();
  const filtres = lireFiltresTaches(await searchParams);
  const r = await chargerServeur<PageTaches>(requeteTaches(filtres));
  const assigner = aPermission(utilisateur.roles, "tache.assigner");
  const vueCreees = filtres.vue === "creees";
  const libelleStatut = filtres.statut
    ? libelleStatutTache(filtres.statut, langue).toLowerCase()
    : "";

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Mes tâches", "My tasks")}
        soustitre={t(
          "Les tâches qui vous sont confiées par vos collègues et celles que vous leur avez assignées.",
          "Tasks your colleagues have given you and those you have assigned to them.",
        )}
        actions={
          assigner ? (
            <Link href="/mes-taches/nouvelle" className={classesBouton()}>
              <Icone nom="plus" />
              <span>{t("Nouvelle tâche", "New task")}</span>
            </Link>
          ) : null
        }
      />
      <nav className="mp-onglets" aria-label={t("Tâches affichées", "Tasks shown")}>
        <ul className="mp-onglets__liste">
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefTaches({ vue: "assignees", statut: filtres.statut })}
              aria-current={vueCreees ? undefined : "page"}
            >
              {t("Qui m'est assigné", "Assigned to me")}
            </Link>
          </li>
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefTaches({ vue: "creees", statut: filtres.statut })}
              aria-current={vueCreees ? "page" : undefined}
            >
              {t("Que j'ai créées", "Created by me")}
            </Link>
          </li>
        </ul>
      </nav>
      <SegmentsStatut
        statut={filtres.statut}
        options={optionsStatutsTache(langue)}
        href={(s) => hrefTaches({ vue: filtres.vue, statut: s as (typeof filtres)["statut"] })}
        libelle={t("Statut des tâches affichées", "Status of tasks shown")}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t("Les tâches n'ont pas pu être chargées.", "The tasks could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefTaches(filtres)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtres.statut
              ? t(`Aucune tâche « ${libelleStatut} ».`, `No "${libelleStatut}" tasks.`)
              : vueCreees
                ? t("Vous n'avez assigné aucune tâche.", "You have not assigned any tasks.")
                : t("Aucune tâche ne vous est assignée.", "No tasks are assigned to you.")
          }
          icone="taches"
          action={
            vueCreees && assigner ? (
              <Link href="/mes-taches/nouvelle" className={classesBouton("secondaire")}>
                {t("Assigner une tâche", "Assign a task")}
              </Link>
            ) : null
          }
        >
          <p>
            {vueCreees
              ? t(
                  "Les tâches que vous confiez à un collègue apparaîtront ici, avec leur avancement.",
                  "Tasks you give to a colleague will appear here, with their progress.",
                )
              : t(
                  "Quand un collègue vous confie une tâche, elle apparaît ici et vous êtes notifié.",
                  "When a colleague gives you a task, it appears here and you are notified.",
                )}
          </p>
        </EtatVide>
      ) : (
        <ul
          className="mp-taches"
          aria-label={
            vueCreees
              ? t("Tâches créées", "Tasks created")
              : t("Tâches assignées", "Tasks assigned")
          }
        >
          {r.donnees.elements.map((t) => (
            <CarteTache
              key={t.id}
              tache={t}
              utilisateurId={utilisateur.id}
              roles={utilisateur.roles}
              avecLienDetail
            />
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant
              ? hrefTaches({ ...filtres, curseur: r.donnees.curseur_suivant })
              : null
          }
          hrefDebut={filtres.curseur ? hrefTaches({ ...filtres, curseur: "" }) : null}
          libelle={t("Pages des tâches", "Task pages")}
        />
      ) : null}
    </div>
  );
}
