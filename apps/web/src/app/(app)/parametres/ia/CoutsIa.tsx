import Link from "next/link";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EtatErreur, PaginationCurseur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { Tableau } from "../../../../components/ui/Tableau";
import {
  formaterDate,
  formaterMontantMineur,
  formaterNombre,
  formaterPourcentage,
} from "../../../../lib/format";
import {
  decalerMois,
  etatPlafond,
  formaterMicroUsd,
  hrefCoutsIa,
  libelleMois,
  libelleServiesCache,
  type CoutMissionIa,
  type CoutsIa,
  type PageIa,
} from "../../../../lib/ia";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import type { ChargementFacultatif } from "../../../../lib/ia-serveur";

/**
 * Coûts IA du cabinet (« ia.configurer » ET « finance.lire ») : mois choisi, douze derniers
 * mois, coût par mission rapporté à son prix (cible ≤ 5 %). Tous les chiffres viennent de
 * l'API ; l'écran les met seulement en forme. Sans droit (403), la section est masquée.
 */
export async function CoutsIaSection({
  mois,
  moisCourant,
  couts,
  missions,
  curseurMissions,
}: {
  mois: string;
  moisCourant: string;
  couts: ChargementFacultatif<CoutsIa>;
  missions: ChargementFacultatif<PageIa<CoutMissionIa>>;
  curseurMissions: string | null;
}) {
  if (couts.etat === "refuse") return null;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Carte titre={t("Coûts IA", "AI costs")} id="couts">
      {couts.etat === "erreur" ? (
        <EtatErreur
          titre={t("Les coûts IA n'ont pas pu être chargés.", "The AI costs could not be loaded.")}
          message={couts.message}
          hrefReessayer={hrefCoutsIa(mois)}
        />
      ) : (
        <div className="mp-pile">
          <NavigationMois mois={mois} moisCourant={moisCourant} />
          <ResumeMois c={couts.donnees} />
          <Tableau
            legende={t("Coût IA des douze derniers mois", "AI cost over the last twelve months")}
            legendeVisible
            colonnes={[
              {
                cle: "mois",
                entete: t("Mois", "Month"),
                rendu: (l) => libelleMois(l.mois, langue),
              },
              {
                cle: "appels",
                entete: t("Appels facturés", "Billed calls"),
                alignement: "droite",
                rendu: (l) => formaterNombre(l.appels, 0, langue),
              },
              {
                cle: "cache",
                entete: t("Servies par le cache", "Served from cache"),
                alignement: "droite",
                rendu: (l) => formaterNombre(l.appels_cache ?? 0, 0, langue),
              },
              {
                cle: "cout",
                entete: t("Coût estimé", "Estimated cost"),
                alignement: "droite",
                rendu: (l) => formaterMicroUsd(l.cout_micro_usd, langue),
              },
            ]}
            lignes={couts.donnees.historique}
            cleLigne={(l) => l.mois}
          />
        </div>
      )}
      {missions.etat === "ok" ? (
        <CoutsMissions
          page={missions.donnees}
          seuil={couts.etat === "ok" ? couts.donnees.seuil_ratio_mission : null}
          mois={mois}
          curseur={curseurMissions}
        />
      ) : missions.etat === "erreur" ? (
        <EtatErreur
          titre={t(
            "Le coût IA par mission n'a pas pu être chargé.",
            "The AI cost per engagement could not be loaded.",
          )}
          message={missions.message}
          hrefReessayer={hrefCoutsIa(mois)}
        />
      ) : null}
    </Carte>
  );
}

async function NavigationMois({ mois, moisCourant }: { mois: string; moisCourant: string }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <nav className="mp-ia-mois" aria-label={t("Choix du mois", "Month selection")}>
      <Link className="mp-pagination__lien" href={hrefCoutsIa(decalerMois(mois, -1))}>
        <Icone nom="chevronGauche" taille={18} />
        <span>{t("Mois précédent", "Previous month")}</span>
      </Link>
      <h3 className="mp-ia-mois__titre">{libelleMois(mois, langue)}</h3>
      {mois < moisCourant ? (
        <Link className="mp-pagination__lien" href={hrefCoutsIa(decalerMois(mois, 1))}>
          <span>{t("Mois suivant", "Next month")}</span>
          <Icone nom="chevronDroit" taille={18} />
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}

async function ResumeMois({ c }: { c: CoutsIa }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const etat = etatPlafond(c.part_plafond, langue);
  const taux = c.taux_conversion;
  return (
    <>
      <dl className="mp-liste-def">
        <div>
          <dt>{t("Coût estimé du mois", "Estimated cost for the month")}</dt>
          <dd>{formaterMicroUsd(c.cout_micro_usd, langue)}</dd>
        </div>
        <div>
          <dt>{t("Appels facturés", "Billed calls")}</dt>
          <dd>{formaterNombre(c.appels, 0, langue)}</dd>
        </div>
        <div>
          <dt>{t("Générations servies par le cache", "Generations served from cache")}</dt>
          <dd>{libelleServiesCache(c.appels_cache, langue)}</dd>
        </div>
        <div>
          <dt>{t("Plafond mensuel du cabinet", "Firm's monthly ceiling")}</dt>
          <dd>{formaterMicroUsd(c.plafond_mensuel_micro_usd, langue)}</dd>
        </div>
        {c.plafond_effectif_micro_usd !== c.plafond_mensuel_micro_usd ? (
          <div>
            <dt>{t("Plafond appliqué", "Ceiling applied")}</dt>
            <dd>
              {t(
                `${formaterMicroUsd(c.plafond_effectif_micro_usd)} (borné par l'opérateur pour la clé de la plateforme)`,
                `${formaterMicroUsd(c.plafond_effectif_micro_usd, langue)} (capped by the operator for the platform key)`,
              )}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{t("Part du plafond appliqué consommée", "Share of the applied ceiling used")}</dt>
          <dd className="mp-badges">
            <span>{formaterPourcentage(c.part_plafond, 1, langue)}</span>
            <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
          </dd>
        </div>
      </dl>
      <p className="mp-texte-petit mp-texte-doux">
        {t(
          `Coûts estimés d'après les tarifs publiés des modèles (en dollars US). Conversion vers la devise des missions au taux de départ du ${formaterDate(taux.date)}${taux.a_valider ? ", à valider par le métier" : ""}.`,
          `Costs estimated from the models' published prices (in US dollars). Converted to the engagements' currency at the starting rate of ${formaterDate(taux.date, "UTC", langue)}${taux.a_valider ? ", to be validated by the business" : ""}.`,
        )}
      </p>
    </>
  );
}

async function CoutsMissions({
  page,
  seuil,
  mois,
  curseur,
}: {
  page: PageIa<CoutMissionIa>;
  seuil: number | null;
  mois: string;
  curseur: string | null;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const libelleSeuil =
    seuil === null ? t("le seuil", "the threshold") : formaterPourcentage(seuil, 0, langue);
  return (
    <div className="mp-pile">
      <Tableau
        legende={t("Coût IA cumulé par mission", "Cumulative AI cost per engagement")}
        legendeVisible
        messageVide={t(
          "Aucune mission n'a encore consommé d'IA.",
          "No engagement has used AI yet.",
        )}
        colonnes={[
          {
            cle: "mission",
            entete: t("Mission", "Engagement"),
            rendu: (l) => (
              <Link href={`/missions/${l.mission_id}`}>
                {l.intitule ?? t("Mission sans intitulé", "Untitled engagement")}
              </Link>
            ),
          },
          {
            cle: "appels",
            entete: t("Appels", "Calls"),
            alignement: "droite",
            rendu: (l) => formaterNombre(l.appels, 0, langue),
          },
          {
            cle: "cout",
            entete: t("Coût estimé", "Estimated cost"),
            alignement: "droite",
            rendu: (l) =>
              `${formaterMicroUsd(l.cout_micro_usd, langue)} (${formaterMontantMineur(l.cout_devise, l.devise, langue)})`,
          },
          {
            cle: "prix",
            entete: t("Prix de la mission", "Engagement price"),
            alignement: "droite",
            rendu: (l) =>
              l.prix_mission === null
                ? t("Budget non figé", "Budget not frozen")
                : formaterMontantMineur(l.prix_mission, l.devise, langue),
          },
          {
            cle: "ratio",
            entete: t("Coût / prix", "Cost / price"),
            rendu: (l) =>
              l.depasse_seuil === null ? (
                <BadgeStatut tonalite="neutre">{t("Non calculable", "Not computable")}</BadgeStatut>
              ) : (
                <BadgeStatut tonalite={l.depasse_seuil ? "danger" : "succes"}>
                  {`${formaterPourcentage(l.ratio_cout_prix, 2, langue)} : ${l.depasse_seuil ? t(`au-delà de ${libelleSeuil}`, `above ${libelleSeuil}`) : t(`sous ${libelleSeuil}`, `below ${libelleSeuil}`)}`}
                </BadgeStatut>
              ),
          },
        ]}
        lignes={page.elements}
        cleLigne={(l) => l.mission_id}
      />
      <PaginationCurseur
        libelle={t("Pages du coût par mission", "Cost per engagement pages")}
        hrefSuivante={page.curseur_suivant ? hrefCoutsIa(mois, page.curseur_suivant) : null}
        hrefDebut={curseur ? hrefCoutsIa(mois) : null}
      />
    </div>
  );
}
