import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { SegmentsStatut } from "../../../components/facturation/SegmentsStatut";
import { classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirSession } from "../../../lib/session";
import {
  hrefTaches,
  lireFiltresTaches,
  OPTIONS_STATUTS_TACHE,
  requeteTaches,
  STATUT_TACHE,
  type PageTaches,
} from "../../../lib/taches-collaboration";
import { CarteTache } from "./CarteTache";

export const metadata: Metadata = { title: "Mes tâches" };

/**
 * « Mes tâches » (SOC-08) : tâches qui me sont assignées ou que j'ai créées, ouvertes d'abord
 * puis par échéance. Filtres et page dans l'URL (partage, retour, rechargement après coupure).
 */
export default async function PageMesTaches({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSession();
  const filtres = lireFiltresTaches(await searchParams);
  const r = await chargerServeur<PageTaches>(requeteTaches(filtres));
  const assigner = aPermission(utilisateur.roles, "tache.assigner");
  const vueCreees = filtres.vue === "creees";
  const libelleStatut = filtres.statut ? STATUT_TACHE[filtres.statut].libelle.toLowerCase() : "";

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Mes tâches"
        soustitre="Les tâches qui vous sont confiées par vos collègues et celles que vous leur avez assignées."
        actions={
          assigner ? (
            <Link href="/mes-taches/nouvelle" className={classesBouton()}>
              <Icone nom="plus" />
              <span>Nouvelle tâche</span>
            </Link>
          ) : null
        }
      />
      <nav className="mp-onglets" aria-label="Tâches affichées">
        <ul className="mp-onglets__liste">
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefTaches({ vue: "assignees", statut: filtres.statut })}
              aria-current={vueCreees ? undefined : "page"}
            >
              Qui m&apos;est assigné
            </Link>
          </li>
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefTaches({ vue: "creees", statut: filtres.statut })}
              aria-current={vueCreees ? "page" : undefined}
            >
              Que j&apos;ai créées
            </Link>
          </li>
        </ul>
      </nav>
      <SegmentsStatut
        statut={filtres.statut}
        options={OPTIONS_STATUTS_TACHE}
        href={(s) => hrefTaches({ vue: filtres.vue, statut: s as (typeof filtres)["statut"] })}
        libelle="Statut des tâches affichées"
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les tâches n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefTaches(filtres)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            filtres.statut
              ? `Aucune tâche « ${libelleStatut} ».`
              : vueCreees
                ? "Vous n'avez assigné aucune tâche."
                : "Aucune tâche ne vous est assignée."
          }
          icone="taches"
          action={
            vueCreees && assigner ? (
              <Link href="/mes-taches/nouvelle" className={classesBouton("secondaire")}>
                Assigner une tâche
              </Link>
            ) : null
          }
        >
          <p>
            {vueCreees
              ? "Les tâches que vous confiez à un collègue apparaîtront ici, avec leur avancement."
              : "Quand un collègue vous confie une tâche, elle apparaît ici et vous êtes notifié."}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-taches" aria-label={vueCreees ? "Tâches créées" : "Tâches assignées"}>
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
          libelle="Pages des tâches"
        />
      ) : null}
    </div>
  );
}
