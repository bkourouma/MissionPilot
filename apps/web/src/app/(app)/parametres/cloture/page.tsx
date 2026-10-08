import Link from "next/link";
import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { chargerServeur } from "../../../../lib/api-serveur";
import { anneeDemandee } from "../../../../lib/cabinet";
import { formaterDateHeure } from "../../../../lib/format";
import { aujourdhuiIso } from "../../../../lib/semaine";
import { exigerPermission } from "../../../../lib/session";
import {
  actionsPeriode,
  libelleMois,
  STATUT_PERIODE,
  type PeriodeTemps,
} from "../../../../lib/temps-admin";
import { ActionsPeriode } from "./Cloture";

export const metadata: Metadata = { title: "Clôture des temps" };

export default async function PageCloture({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("temps.cloturer");
  const annee = anneeDemandee((await searchParams).annee, new Date().getUTCFullYear());
  const r = await chargerServeur<{ annee: number; elements: PeriodeTemps[] }>(
    `/api/temps/periodes?annee=${annee}`,
  );
  const aujourdhui = aujourdhuiIso();

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Clôture mensuelle des temps"
        soustitre="Un mois terminé se clôture quand toutes ses feuilles sont validées : ses temps sont alors verrouillés et toute correction est tracée. Seul un associé rouvre une période, avec un motif."
      />
      <Carte
        titre={`Périodes ${annee}`}
        actions={
          <nav className="mp-navigation-annee" aria-label="Changer d'année">
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
            titre="Les périodes n'ont pas pu être chargées."
            message={r.message}
            hrefReessayer={`/parametres/cloture?annee=${annee}`}
          />
        ) : (
          <ul className="mp-liste-lignes" aria-label={`Mois de ${annee}`}>
            {r.donnees.elements.map((p) => {
              const a = actionsPeriode(p, utilisateur.roles, aujourdhui);
              const libelle = libelleMois(p.mois);
              return (
                <li key={p.mois} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{libelle}</strong>
                    <span className="mp-texte-doux">
                      {p.statut === "cloturee" && p.cloturee_le
                        ? `Clôturé le ${formaterDateHeure(p.cloturee_le)}`
                        : p.rouverte_le
                          ? `Rouvert le ${formaterDateHeure(p.rouverte_le)}${p.motif_reouverture ? ` : ${p.motif_reouverture}` : ""}`
                          : a.cloturer
                            ? "Mois terminé, prêt à clôturer si toutes les feuilles sont validées"
                            : "Mois en cours ou à venir"}
                    </span>
                  </span>
                  <BadgeStatut tonalite={STATUT_PERIODE[p.statut].tonalite}>
                    {STATUT_PERIODE[p.statut].libelle}
                  </BadgeStatut>
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
        Les demandes de correction des temps verrouillés se décident dans{" "}
        <Link href="/temps/corrections">Feuille de temps › Corrections</Link>.
      </p>
    </div>
  );
}
