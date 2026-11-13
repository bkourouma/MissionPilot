import Link from "next/link";
import type { Metadata } from "next";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../components/ui/EtatListe";
import { chargerServeur } from "../../../lib/api-serveur";
import { obtenirT } from "../../../lib/i18n/serveur";
import {
  hrefNotifications,
  lireParametresNotifications,
  type PageNotifications,
} from "../../../lib/notifications";
import { obtenirSession } from "../../../lib/session";
import { ElementNotification, ToutLire } from "./Notifications";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Notifications", "Notifications") };
}

export default async function PageDesNotifications({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  await obtenirSession();
  const { nonLues, curseur } = lireParametresNotifications(await searchParams);
  const q = new URLSearchParams({ limite: "30" });
  if (nonLues) q.set("non_lues", "true");
  if (curseur) q.set("curseur", curseur);
  const r = await chargerServeur<PageNotifications>(`/api/notifications?${q.toString()}`);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Notifications", "Notifications")}
        soustitre={
          r.ok
            ? r.donnees.non_lues === 0
              ? t("Aucune notification non lue.", "No unread notifications.")
              : t(
                  `${r.donnees.non_lues} notification(s) non lue(s), affichées en premier.`,
                  `${r.donnees.non_lues} unread notification(s), shown first.`,
                )
            : undefined
        }
      />
      <nav
        className="mp-onglets"
        aria-label={t("Filtrer les notifications", "Filter notifications")}
      >
        <ul className="mp-onglets__liste">
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefNotifications(false)}
              aria-current={nonLues ? undefined : "page"}
            >
              {t("Toutes", "All")}
            </Link>
          </li>
          <li>
            <Link
              className="mp-onglets__lien"
              href={hrefNotifications(true)}
              aria-current={nonLues ? "page" : undefined}
            >
              {t("Non lues", "Unread")}
            </Link>
          </li>
        </ul>
      </nav>
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les notifications n'ont pas pu être chargées.",
            "The notifications could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefNotifications(nonLues, curseur)}
        />
      ) : (
        <>
          <ToutLire nonLues={r.donnees.non_lues} />
          {r.donnees.elements.length === 0 ? (
            <EtatVide
              titre={
                nonLues
                  ? t("Aucune notification non lue.", "No unread notifications.")
                  : t("Aucune notification pour l'instant.", "No notifications yet.")
              }
              icone="cloche"
            >
              <p>
                {t(
                  "Validations, rejets, alertes de suivi et changements de planning apparaîtront ici.",
                  "Approvals, rejections, follow-up alerts and schedule changes will appear here.",
                )}
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
            libelle={t("Pages des notifications", "Notification pages")}
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
