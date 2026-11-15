import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { chargerServeur } from "../../../../lib/api-serveur";
import { anneeDemandee } from "../../../../lib/cabinet";
import { formaterDateHeure } from "../../../../lib/format";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import {
  actionsPeriode,
  libelleMois,
  statutPeriode,
  type PeriodeTemps,
} from "../../../../lib/temps-admin";
import { ActionsPeriode } from "./Cloture";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Clôture des temps", "Time close-out") };
}

export default async function PageCloture({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.cloturer");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const annee = anneeDemandee((await searchParams).annee, new Date().getUTCFullYear());
  const r = await chargerServeur<{ annee: number; elements: PeriodeTemps[] }>(
    `/api/temps/periodes?annee=${annee}`,
  );
  const aujourdhui = aujourdhuiIso();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Clôture mensuelle des temps", "Monthly time close-out")}
        soustitre={t(
          "Un mois terminé se clôture quand toutes ses feuilles sont validées : ses temps sont alors verrouillés et toute correction est tracée. Seul un associé rouvre une période, avec un motif.",
          "A finished month is closed once all its timesheets are approved: its time entries are then locked and every correction is tracked. Only a partner can reopen a period, with a reason.",
        )}
      />
      <Carte
        titre={t(`Périodes ${annee}`, `${annee} periods`)}
        actions={
          <nav className="mp-navigation-annee" aria-label={t("Changer d'année", "Change year")}>
            <Link className="mp-pagination__lien" href={`/parametres/cloture?annee=${annee - 1}`}>
              <Icone nom="chevronGauche" taille={18} />
              <span>{annee - 1}</span>
            </Link>
            <Link className="mp-pagination__lien" href={`/parametres/cloture?annee=${annee + 1}`}>
              <span>{annee + 1}</span>
              <Icone nom="chevronDroit" taille={18} />
            </Link>
          </nav>
        }
      >
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les périodes n'ont pas pu être chargées.",
              "The periods could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={`/parametres/cloture?annee=${annee}`}
          />
        ) : (
          <ul className="mp-liste-lignes" aria-label={t(`Mois de ${annee}`, `Months of ${annee}`)}>
            {r.donnees.elements.map((p) => {
              const a = actionsPeriode(p, utilisateur.roles, aujourdhui);
              const libelle = libelleMois(p.mois, langue);
              const statut = statutPeriode(p.statut, langue);
              return (
                <li key={p.mois} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{libelle}</strong>
                    <span className="mp-texte-doux">
                      {p.statut === "cloturee" && p.cloturee_le
                        ? t(
                            `Clôturé le ${formaterDateHeure(p.cloturee_le, undefined, langue)}`,
                            `Closed on ${formaterDateHeure(p.cloturee_le, undefined, langue)}`,
                          )
                        : p.rouverte_le
                          ? t(
                              `Rouvert le ${formaterDateHeure(p.rouverte_le, undefined, langue)}${p.motif_reouverture ? ` : ${p.motif_reouverture}` : ""}`,
                              `Reopened on ${formaterDateHeure(p.rouverte_le, undefined, langue)}${p.motif_reouverture ? `: ${p.motif_reouverture}` : ""}`,
                            )
                          : a.cloturer
                            ? t(
                                "Mois terminé, prêt à clôturer si toutes les feuilles sont validées",
                                "Month finished, ready to close if all timesheets are approved",
                              )
                            : t("Mois en cours ou à venir", "Current or upcoming month")}
                    </span>
                  </span>
                  <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
                  {a.cloturer || a.rouvrir ? (
                    <ActionsPeriode
                      mois={p.mois}
                      libelle={libelle}
                      cloturer={a.cloturer}
                      rouvrir={a.rouvrir}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
      <p className="mp-texte-doux">
        {t(
          "Les demandes de correction des temps verrouillés se décident dans",
          "Correction requests for locked time entries are decided in",
        )}{" "}
        <Link href="/temps/corrections">
          {t("Feuille de temps › Corrections", "Timesheet › Corrections")}
        </Link>
        .
      </p>
    </div>
  );
}
