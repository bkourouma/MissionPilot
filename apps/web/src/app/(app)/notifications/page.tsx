import Link from "next/link";
import type { Metadata } from "next";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import {
  hrefNotifications,
  lireParametresNotifications,
  type PageNotifications,
} from "../../../lib/notifications";
import { obtenirSession } from "../../../lib/session";
import { ElementNotification, ToutLire } from "./Notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function PageDesNotifications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await obtenirSession();
  const { nonLues, curseur } = lireParametresNotifications(await searchParams);
  const q = new URLSearchParams({ limite: "30" });
  if (nonLues) q.set("non_lues", "true");
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<PageNotifications>(`/api/notifications?${q.toString()}`);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Notifications"
        soustitre={
          r.ok
            ? r.donnees.non_lues === 0
              ? "Aucune notification non lue."
              : `${r.donnees.non_lues} notification(s) non lue(s), affichées en premier.`
            : undefined
        }
      />
      <nav className="mp-onglets" aria-label="Filtrer les notifications">
        <ul className="mp-onglets__liste">
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefNotifications(false)}
              aria-current={nonLues ? undefined : "page"}
            >
              Toutes
            </Link>
          </li>
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefNotifications(true)}
              aria-current={nonLues ? "page" : undefined}
            >
              Non lues
            </Link>
          </li>
        </ul>
      </nav>
      {!r.ok ? (
        <EtatErreur
          titre="Les notifications n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefNotifications(nonLues, curseur)}
        />
      ) : (
        <>
          <ToutLire nonLues={r.donnees.non_lues} />
          {r.donnees.elements.length === 0 ? (
            <EtatVide
              titre={
                nonLues ? "Aucune notification non lue." : "Aucune notification pour l'instant."
              }
              icone="cloche"
            >
              <p>
                Validations, rejets, alertes de suivi et changements de planning apparaîtront ici.
              </p>
            </EtatVide>
          ) : (
            <ul className="mp-liste-cartes">
              {r.donnees.elements.map((n) => (
                <li key={n.id}>
                  <ElementNotification n={n} />
                </li>
              ))}
            </ul>
          )}
          <PaginationCurseur
            libelle="Pages des notifications"
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefNotifications(nonLues, r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? hrefNotifications(nonLues) : null}
          />
        </>
      )}
    </div>
  );
}
